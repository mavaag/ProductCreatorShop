"""shop_import.py - de productmappen uit _Shop (laser, 3D-print, resin) als modellen in de catalogus-bibliotheek zetten.

Fase 1 van "alles in de Catalogus, _Shop enkel wat gepubliceerd is":
    python3 shop_import.py plan     # schrijft _catalog/shop_import_plan.csv (niets wordt gekopieerd)
    python3 shop_import.py apply    # voert de rijen met actie 'kopie' uit het (eventueel aangepaste) plan uit
Het plan kiest per productmap een plaats tussen de bestaande collecties:
  - laser  -> Lasercut/Vectors/<categorie>/<model>   (Animals, Decor, Heads-Trophies, Lamps-Lighting, Vehicles/..., ...)
  - 3D     -> 3D-Print/<categorie>/<model>           (elke map onder 3D-Print is een collectie)
  - resin  -> Resin-Print/<categorie>/<model>
Mappen die al in de catalogus staan (zelfde naam als een bestaand model) of die door shop_links.py uit de catalogus
gekopieerd zijn (.catalog-model) krijgen actie 'overslaan'. De CSV (puntkomma, opent in Excel) mag je aanpassen: actie
('kopie' / 'overslaan') en doel. apply kopieert enkel (nieuwe/gewijzigde bestanden), verwijdert of overschrijft nooit iets
in _Shop en slaat een doel over dat al bestaat en niet van deze import komt."""
import csv, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa
from match_shop_files import PROD_EXT
from shop_links import MARKER, SKIP, copy_tree

ROOT = supa.MAKER_ROOT
PLAN = os.path.join(ROOT, '_catalog', 'shop_import_plan.csv')
IMPORT_MARK = '.shop-import'   # in het doel: de bronmap in _Shop
WRAPPERS = {'PUBLISHED', 'NOT PUBLISHED', 'CATEGORIES', 'Flexi', 'Normal'}   # tussenniveaus, geen categorie
GENERIC = re.compile(r'^(stl|3mf|obj|files?|dxf|svg|pdf|eps|ai|cdr|lac|gcode|lbrn2?|xcs|printready|laserready|images?|photos?|'
                     r'renders?|small|medium|large|s|m|l|xl|\d+ ?mm|supports?|presupported|pre-supported|unsupported|parts?)$', re.I)
RESIN_EXT = {'.lys', '.chitubox', '.ctb', '.goo', '.pwmx', '.pwma', '.cbddlp'}

LASER_CAT = {'animals': 'Animals', 'decoration': 'Decor', 'lamps': 'Lamps-Lighting', 'clocks': 'Clocks',
             'acrylic': 'Lamps-Lighting', 'utilities': 'Home-Organizers', 'children': 'Games-Puzzles', 'games': 'Games-Puzzles',
             'nordicchainedaxe': 'Weapons', 'wall1': 'Decor', 'worldmap': 'Decor', 'lasercutting': 'Heads-Trophies',
             'to process': 'Heads-Trophies'}
VEHICLE = [(r'boat|ship|steamboat', 'Boats-Ships'), (r'balloon|airship|plane|helicopter', 'Aircraft-Helicopters'),
           (r'starwars|atwalker|space', 'Space'), (r'car|lamborghini|mercedes|beetle|truck|jeep', 'Cars-Trucks')]


def clean(name):
    return re.sub(r'_N$', '', name).strip() or name


def norm(name):
    n = re.sub(r'^\d{5,6}_(name_)?', '', name.lower())
    return re.sub(r'[^a-z0-9]', '', n)


def has_files(path, ext=PROD_EXT):
    try: return any(os.path.isfile(os.path.join(path, f)) and os.path.splitext(f)[1].lower() in ext for f in os.listdir(path))
    except OSError: return False


def subdirs(path):
    try: return sorted(os.path.join(path, d) for d in os.listdir(path) if not SKIP.match(d) and os.path.isdir(os.path.join(path, d)))
    except OSError: return []


def tree_has_files(path):
    for dp, dn, fn in os.walk(path):
        dn[:] = [d for d in dn if not SKIP.match(d)]
        if any(os.path.splitext(f)[1].lower() in PROD_EXT for f in fn): return True
    return False


def common_prefix(names):
    p = os.path.commonprefix(names)
    return len(p)


def is_bundle(path):
    """Een map met >= 3 submappen met bestanden, die geen varianten van hetzelfde model zijn (RhinoHead_LX2 / RhinoHead_M2,
    model 1..10, Small/Large) -> elke submap is een eigen model (Flexi Baby Dragon, Lamps/TotalCatalog)."""
    if has_files(path): return False                                    # eigen bestanden: één model (bv. Crocodile)
    subs = [d for d in subdirs(path) if not GENERIC.match(os.path.basename(d)) and tree_has_files(d)]
    if len(subs) < 3: return False
    names = [norm(os.path.basename(d)) for d in subs]
    if common_prefix(names) >= 5: return False
    own = norm(os.path.basename(path))[:5]
    if own and sum(n.startswith(own) for n in names) * 2 >= len(names): return False
    return True


def model_folders():
    """[(categorie, map)] in _Shop/{LaserCutting,3DPrinting,ResinPrinting}. Model = map direct onder de categorie
    (tussenniveaus zoals PUBLISHED, CATEGORIES, Flexi, Normal tellen niet); een bundel wordt per submap opgesplitst;
    een categoriemap zonder submappen maar met bestanden is zelf het model. Kopieën uit de catalogus (.catalog-model)
    worden overgeslagen."""
    out = []

    def add(cat, path):
        if os.path.exists(os.path.join(path, MARKER)): return
        subs = [d for d in subdirs(path) if tree_has_files(d)]
        if subs and not has_files(path) and all(os.path.exists(os.path.join(d, MARKER)) for d in subs): return
        if is_bundle(path):
            for d in subdirs(path):
                if tree_has_files(d) and not os.path.exists(os.path.join(d, MARKER)): out.append((cat, d))
        else:
            out.append((cat, path))

    def in_category(path, cat):
        subs = [d for d in subdirs(path) if os.path.basename(d) in WRAPPERS or tree_has_files(d)]
        if not subs:
            if has_files(path): add(cat, path)
            return
        for d in subs:
            if os.path.basename(d) in WRAPPERS: in_category(d, cat)
            else: add(cat, d)

    def top(path):
        for d in subdirs(path):
            if os.path.basename(d) in WRAPPERS: top(d)
            elif tree_has_files(d): in_category(d, os.path.basename(d))

    for tech in ('LaserCutting', '3DPrinting', 'ResinPrinting'):
        top(os.path.join(ROOT, '_Shop', tech))
    return [(cat, os.path.relpath(p, ROOT).replace(os.sep, '/')) for cat, p in out]


def destination(rel, cat, resin):
    tech, model = rel.split('/')[1], clean(os.path.basename(rel))
    if tech == 'LaserCutting':
        key = clean(cat).lower()
        if key.startswith('vehicules'):
            sub = next((v for pat, v in VEHICLE if re.search(pat, model.lower())), 'Cars-Trucks')
            return f'Lasercut/Vectors/Vehicles/{sub}/{model}', ''
        dest_cat = 'Heads-Trophies' if re.search(r'head|cabeza', model, re.I) else LASER_CAT.get(key)
        if not dest_cat: return f'Lasercut/Vectors/_Unsorted/{model}', f'categorie "{cat}" onbekend'
        return f'Lasercut/Vectors/{dest_cat}/{model}', ''
    top = 'Resin-Print' if tech == 'ResinPrinting' or resin else '3D-Print'
    return f'{top}/{clean(cat)}/{model}', ''


def family(path):
    """'laser' of '3d' (FDM en resin samen) uit een bibliotheekpad."""
    return 'laser' if path.startswith('Lasercut') else '3d'


def catalog_index():
    """(familie, genormaliseerde naam) -> pad van een bestaand model; dubbels enkel binnen dezelfde techniek."""
    idx = {}
    for m in supa.select_all('maker_models', 'id,path,title'):
        for n in (norm(os.path.basename(m['path'])), norm(m['title'])):
            if len(n) >= 4: idx.setdefault((family(m['path']), n), m['path'])
    return idx


def dir_size(path):
    return sum(os.path.getsize(os.path.join(dp, f)) for dp, dn, fn in os.walk(path) for f in fn)


def nested_copies(path):
    """Submappen die een exacte kopie zijn van een buurmap van path (zelfde naam en grootte) -- per ongeluk mee gekopieerd,
    zoals Animals/Normal/Crocodile/Giraffe naast Animals/Normal/Giraffe."""
    parent = os.path.dirname(path)
    return [os.path.basename(d) for d in subdirs(path)
            if os.path.isdir(os.path.join(parent, os.path.basename(d))) and dir_size(d) == dir_size(os.path.join(parent, os.path.basename(d)))]


def shop_products():
    """product_files-pad -> productnaam (bevestigd of voorstel), ter info in het plan."""
    names = {p['id']: p['name'] for p in supa.select_all('products', 'id,name')}
    out = {}
    for f in supa.rest('GET', 'product_files?select=product_id,path,confirmed') or []:
        out.setdefault(f['path'], []).append(names.get(f['product_id'], '?') + ('' if f['confirmed'] else ' (voorstel)'))
    return out


def folder_stats(path):
    n = size = 0
    resin = False
    for dp, dn, fn in os.walk(path):
        dn[:] = [d for d in dn if not SKIP.match(d)]
        for f in fn:
            if SKIP.match(f): continue
            n += 1; size += os.path.getsize(os.path.join(dp, f))
            if os.path.splitext(f)[1].lower() in RESIN_EXT or 'presupport' in f.lower().replace('-', ''): resin = True
    return n, size, resin


def plan():
    idx, linked = catalog_index(), shop_products()
    rows, used = [], set()
    for cat, rel in model_folders():
        n, size, resin = folder_stats(os.path.join(ROOT, rel))
        dest, note = destination(rel, cat, resin)
        action = 'kopie'
        skip = nested_copies(os.path.join(ROOT, rel))
        if skip: note = 'zonder ' + ', '.join(skip) + ' (kopie van een buurmap)'
        dup = idx.get((family(dest), norm(os.path.basename(rel))))
        if dup:
            action, note = 'overslaan', f'staat al in de catalogus: {dup}'
        elif os.path.exists(os.path.join(ROOT, dest)):
            action, note = 'overslaan', f'staat al in de bibliotheek: {dest}'
        if action == 'kopie':
            base, i = dest, 2
            while dest in used: dest, i = f'{base} {i}', i + 1
            used.add(dest)
        products = '; '.join(p for path, names in linked.items() if path == rel or path.startswith(rel + '/') for p in names)
        rows.append({'actie': action, 'bron': rel, 'doel': dest, 'techniek': 'resin' if dest.startswith('Resin-Print') else
                     'laser' if dest.startswith('Lasercut') else 'fdm', 'bestanden': n, 'MB': round(size / 1e6, 1),
                     'shopproduct': products, 'opmerking': note, 'zonder': '|'.join(skip)})
    with open(PLAN, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]), delimiter=';')
        w.writeheader(); w.writerows(rows)
    k = sum(r['actie'] == 'kopie' for r in rows)
    print(f'plan: {len(rows)} productmappen, {k} te kopiëren ({sum(r["MB"] for r in rows if r["actie"] == "kopie") / 1000:.1f} GB), '
          f'{len(rows) - k} overslaan -> {PLAN}')


def apply():
    rows = list(csv.DictReader(open(PLAN, encoding='utf-8-sig'), delimiter=';'))
    done = 0
    for r in rows:
        if r['actie'].strip().lower() != 'kopie': continue
        src, dst = os.path.join(ROOT, r['bron']), os.path.join(ROOT, r['doel'].strip().strip('/'))
        if not r['doel'].startswith(('Lasercut/', '3D-Print/', 'Resin-Print/')) or not os.path.isdir(src):
            print(f'overgeslagen (ongeldig): {r["bron"]} -> {r["doel"]}'); continue
        mark = os.path.join(dst, IMPORT_MARK)
        if os.path.isdir(dst) and not (os.path.exists(mark) and open(mark, encoding='utf-8').read().strip() == r['bron']):
            print(f'overgeslagen (doel bestaat al): {r["doel"]}'); continue
        os.makedirs(dst, exist_ok=True)
        with open(mark, 'w', encoding='utf-8') as fh: fh.write(r['bron'])
        if r['doel'].startswith('Resin-Print/') or r.get('techniek') in ('resin', 'fdm'):
            with open(os.path.join(dst, '_technique.txt'), 'w', encoding='utf-8') as fh:
                fh.write('resin' if r['doel'].startswith('Resin-Print/') else 'fdm')
        done += copy_tree(src, dst, skip={d for d in (r.get('zonder') or '').split('|') if d})
    print(f'apply: {done} bestanden gekopieerd')


if __name__ == '__main__':
    {'plan': plan, 'apply': apply}[sys.argv[1] if len(sys.argv) > 1 else 'plan']()
