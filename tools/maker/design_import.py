"""design_import.py - fase 2: de ontwerpen uit _Shop/UVPrinting en _Shop/Engraving als modellen in de bibliotheek zetten.

Bij UV-print en gravure is een ontwerp vaak één afbeelding (een poster) of een set bestanden met dezelfde naam (Peeking
Alligator 01.dxf/.svg/.pdf/.png), geen map. Dit script maakt per ontwerp een modelmap:
  - UV-Print/<collectie>/<ontwerp>/    printbestand + previews (Posters-Characters, Posters-Funny, ...)
  - Engraving/<collectie>/<ontwerp>/   (Peeking-Animals, 3D-Wall-Superheroes, Daily-Use, ...)
Wat geen ontwerp is gaat (als kopie) naar _Werkbestanden/ (mockups, teststrips, laserinstellingen, klantwerk) of, voor
originele downloads (.zip van een pack), naar _Original-Archives/. _Shop zelf wordt niet aangeraakt.
    python3 design_import.py plan     # schrijft _catalog/design_import_plan.csv (niets wordt gekopieerd)
    python3 design_import.py apply    # kopieert volgens het (eventueel aangepaste) plan
Kolommen: actie (kopie/overslaan), doel, bestanden (paden t.o.v. MakerProducts, gescheiden door |), soort, opmerking.
apply kopieert enkel ontbrekende/gewijzigde bestanden en overschrijft niets dat niet van deze import komt."""
import csv, os, re, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

ROOT = supa.MAKER_ROOT
SHOP = os.path.join(ROOT, '_Shop')
PLAN = os.path.join(ROOT, '_catalog', 'design_import_plan.csv')
MARK = '.design-import'
IMG = {'.jpg', '.jpeg', '.png', '.webp'}
POSTER_COLL = {'CHARACTERS': 'Posters-Characters', 'FUNNY': 'Posters-Funny', 'GAMING': 'Posters-Gaming',
               'QUOTES': 'Posters-Quotes', 'Black&White': 'Posters-Black-White'}


def rel(p):
    return os.path.relpath(p, ROOT).replace(os.sep, '/')


def files_in(d):
    try: return sorted(os.path.join(d, f) for f in os.listdir(d) if os.path.isfile(os.path.join(d, f)) and f.lower() not in ('thumbs.db', 'desktop.ini') and not f.startswith('.'))
    except OSError: return []


def stem(f):
    return os.path.splitext(os.path.basename(f))[0]


# afwijkende namen (nagekeken op de afbeeldingen, 2026-10-28): download.jpg is de Luigi-poster, LUIGI1/2 en
# WOLVERINEDEADPOOL2 zijn extra previews, MARIO/MARIO2 zijn previews van de splatter-Mario (printbestand ontbreekt)
ALIAS = {'download': 'luigi', 'luigi1': 'luigi', 'luigi2': 'luigi', 'wolverinedeadpool2': 'wolverinedeadpool', 'mario2': 'mario'}
NAME = {'luigi': 'Luigi', 'mario': 'MarioSplatter'}


def preview_key(f):
    """Batman-1.png / HULK_2.png / Batman.png -> 'batman' / 'hulk' / 'batman'."""
    key = re.sub(r'[-_ ]\d+$', '', stem(f)).lower()
    return ALIAS.get(key, key)


def safe(name):
    return re.sub(r'[<>:"/\\|?*]+', '-', name).strip(' .-') or 'Ontwerp'


def plan_rows():
    rows = []
    add = lambda action, dest, files, kind, note='': rows.append(
        {'actie': action, 'doel': dest, 'bestanden': '|'.join(rel(f) for f in files), 'soort': kind, 'opmerking': note})

    # ---------- UV-print: posters ----------
    posters = os.path.join(SHOP, 'UVPrinting', 'Posters')
    for cat, coll in POSTER_COLL.items():
        cdir = os.path.join(posters, cat)
        if not os.path.isdir(cdir): continue
        prints = {}
        for sub, state in (('Published', 'gepubliceerd'), ('NotPublished', 'niet gepubliceerd'), ('', '')):
            for f in files_in(os.path.join(cdir, sub) if sub else cdir):
                if os.path.splitext(f)[1].lower() in IMG: prints.setdefault(preview_key(f), (f, state))
        previews = {}
        for sub in os.listdir(cdir):
            if 'preview' in sub.lower():
                for f in files_in(os.path.join(cdir, sub)): previews.setdefault(preview_key(f), []).append(f)
        for key, (f, state) in sorted(prints.items()):
            add('kopie', f'UV-Print/{coll}/{safe(NAME.get(key, stem(f)))}', [f] + previews.pop(key, []), 'ontwerp', state)
        for key, fs in sorted(previews.items()):   # preview zonder printbestand
            add('kopie', f'UV-Print/{coll}/{safe(NAME.get(key, stem(fs[0])))}', fs, 'ontwerp', 'enkel preview, geen printbestand gevonden')
    for f in files_in(posters):                    # losse poster in de map Posters zelf
        add('kopie', f'UV-Print/Posters-Gaming/{safe(stem(f).split(" Metal Poster")[0])}', [f], 'ontwerp', 'losse poster')

    uv = os.path.join(SHOP, 'UVPrinting')
    add('kopie', '_Werkbestanden/UV-Print/Mockups', files_in(uv), 'werkbestand', 'achtergronden/mockups, logo\'s')
    add('kopie', '_Werkbestanden/UV-Print/Teststrips', files_in(os.path.join(uv, 'TESTSTRIPS')), 'werkbestand', 'kleurtesten')
    fam = os.path.join(uv, 'Familly')
    add('kopie', '_Werkbestanden/Klantwerk/WarreFrauke',
        files_in(os.path.join(fam, 'WarreFrauke')) + files_in(fam), 'werkbestand', 'klantwerk')

    # ---------- gravure ----------
    eng = os.path.join(SHOP, 'Engraving')
    peek = os.path.join(eng, 'PeekingAnimals')
    groups = {}
    for f in files_in(peek):
        if f.lower().endswith('.zip'): continue
        groups.setdefault(stem(f), []).append(f)
    for s, fs in sorted(groups.items()):
        add('kopie', f'Engraving/Peeking-Animals/{safe(s)}', fs, 'ontwerp')
    hero = os.path.join(eng, '3D WALL SUPERHEROES DESIGN FILES')
    for f in files_in(hero):
        m = re.search(r'\((\d+)\)', stem(f))
        if m: add('kopie', f'Engraving/3D-Wall-Superheroes/Superhero {int(m.group(1)):02d}', [f], 'ontwerp')
        else: add('kopie', '_Werkbestanden/Engraving/Mockups', [f], 'werkbestand', 'voorbeeldfoto van het pack')
    rulers = os.path.join(eng, 'DailyUse', 'DecorativeRulers')
    add('kopie', 'Engraving/Daily-Use/DecorativeRulers', files_in(rulers), 'ontwerp')
    loose = files_in(eng)
    for f in loose:
        low, ext = os.path.basename(f).lower(), os.path.splitext(f)[1].lower()
        if ext == '.zip':
            add('kopie', '_Original-Archives/Engraving', [f], 'archief', 'originele download van een pack')
        elif ext in ('.xcs', '.pdf') or 'grid' in low:
            add('kopie', '_Werkbestanden/Engraving/Tests-en-instellingen', [f], 'werkbestand', 'laserinstellingen/testen/handleiding')
        elif low.startswith('joker'):
            add('kopie', 'Engraving/Losse-Ontwerpen/Joker', [f], 'ontwerp')
        else:
            add('kopie', f'_Werkbestanden/Klantwerk/{safe(stem(f))}', [f], 'werkbestand', 'klantwerk')
    for d in ('Gilbert',):
        add('kopie', f'_Werkbestanden/Klantwerk/{d}', files_in(os.path.join(eng, 'Personal', d)), 'werkbestand', 'klantwerk')
    add('kopie', '_Original-Archives/Engraving', [f for f in files_in(peek) if f.lower().endswith('.zip')], 'archief', 'originele download van een pack')
    # map de werkbestanden/archieven met dezelfde bestemming samen
    merged = {}
    for r in rows:
        if r['soort'] != 'ontwerp' and r['doel'] in merged:
            merged[r['doel']]['bestanden'] += ('|' if merged[r['doel']]['bestanden'] else '') + r['bestanden']
        elif r['bestanden']:
            merged.setdefault(r['doel'] if r['soort'] != 'ontwerp' else id(r), r)
    out = list(merged.values())
    for r in out:
        if r['soort'] == 'ontwerp' and os.path.exists(os.path.join(ROOT, r['doel'])) and not os.path.exists(os.path.join(ROOT, r['doel'], MARK)):
            r['actie'], r['opmerking'] = 'overslaan', f'{r["doel"]} bestaat al'
    return out


def plan():
    rows = plan_rows()
    with open(PLAN, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['actie', 'doel', 'soort', 'bestanden', 'opmerking'], delimiter=';')
        w.writeheader(); w.writerows(rows)
    designs = [r for r in rows if r['soort'] == 'ontwerp']
    print(f'plan: {len(designs)} ontwerpen, {len(rows) - len(designs)} mappen werkbestanden/archieven -> {PLAN}')


def apply():
    rows = list(csv.DictReader(open(PLAN, encoding='utf-8-sig'), delimiter=';'))
    n = 0
    for r in rows:
        if r['actie'].strip().lower() != 'kopie': continue
        dest = os.path.join(ROOT, r['doel'].strip().strip('/'))
        if not r['doel'].startswith(('UV-Print/', 'Engraving/', 'Sublimation/', '_Werkbestanden/', '_Original-Archives/')):
            print(f'overgeslagen (ongeldig doel): {r["doel"]}'); continue
        os.makedirs(dest, exist_ok=True)
        if r['soort'] == 'ontwerp':
            open(os.path.join(dest, MARK), 'w', encoding='utf-8').write(r['bestanden'])
        for f in r['bestanden'].split('|'):
            src = os.path.join(ROOT, f)
            dst = os.path.join(dest, os.path.basename(f))
            if not os.path.isfile(src): print(f'ontbreekt: {f}'); continue
            if os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src): continue
            if os.path.exists(dst) and r['soort'] != 'ontwerp':
                print(f'overgeslagen (bestaat al, ander bestand): {rel(dst)}'); continue
            shutil.copy2(src, dst); n += 1
    print(f'apply: {n} bestanden gekopieerd')


if __name__ == '__main__':
    {'plan': plan, 'apply': apply}[sys.argv[1] if len(sys.argv) > 1 else 'plan']()
