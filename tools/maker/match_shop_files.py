"""match_shop_files.py - stelt per product in de beheertool voor welk catalogusmodel de productiebestanden bevat.

Regel (gebruiker, 2026-10-29): alles staat in de Catalogus; _Shop wordt niet meer gebruikt. Dit script vergelijkt elk
product zonder bevestigde map met de modellen van de juiste techniek (maker_models):
  - dezelfde foto: een afbeelding van het product in de shop (bv. Kirby_base.png) staat ook in de modelmap (sterk);
  - de naam: woorden van de productnaam in de modelnaam (en de bovenliggende map);
  - enkel modellen van de juiste techniek (3D-printen -> fdm, resin -> resin of fdm, laser -> laser, ...).
Schrijft het beste voorstel per product in product_files (confirmed = false, source 'catalog', model_id). Bevestigde of
zelf gekozen rijen worden nooit aangeraakt; een product met een bevestigde map krijgt geen nieuw voorstel.
    python3 match_shop_files.py [--dry-run]"""
import os, re, sys, urllib.parse
from difflib import SequenceMatcher
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

TECH = {'3d_print': ('fdm',), 'resin_print': ('resin', 'fdm'), 'laser_cutting': ('laser',),
        'uv_print': ('uv',), 'laser_engraving': ('engraving',), 'sublimation': ('sublimation',)}
KIND_TECH = {'3D-Print': 'fdm', 'Resin-Print': 'resin', 'Lasercut': 'laser', 'UV-Print': 'uv', 'Engraving': 'engraving',
             'Sublimation': 'sublimation'}   # zoals techniqueOf in lib/maker.ts: zonder technique telt de topmap
PROD_EXT = {'.3mf', '.stl', '.obj', '.step', '.gcode', '.bgcode', '.lac', '.svg', '.dxf', '.ai', '.eps', '.pdf', '.cdr',
            '.lbrn', '.lbrn2', '.xcs', '.lys', '.chitubox', '.ctb', '.goo', '.zip', '.rar', '.dwg', '.lp2'}
IMG_EXT = {'.jpg', '.jpeg', '.png', '.webp'}
STOP = {'the', 'and', 'with', 'for', 'of', 'a', 'an', 'in', 'kit', 'diy', 'set', 'edition', 'design', 'wooden', 'wood',
        '3d', 'printed', 'print', 'laser', 'cut', 'decor', 'art', 'gift', 'figure', 'figurine', 'resin', 'unpainted'}
MIN_SCORE = 0.45


def words(s):
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)                        # CamelCase -> losse woorden
    return [w for w in re.findall(r'[a-z0-9]+', s.lower().replace('+', ' ')) if w not in STOP and len(w) > 1]


def img_key(name):
    """Bestandsnaam zonder WordPress-achtervoegsels (-scaled, -1024x768, -1) en extensie, in kleine letters."""
    b = os.path.splitext(os.path.basename(urllib.parse.urlparse(name).path))[0].lower()
    return re.sub(r'(-scaled|-\d+x\d+|-\d)+$', '', b)


def model_folders():
    """Catalogusmodellen als {pad: (model, afbeeldingen in de map en één niveau dieper)}."""
    out = {}
    for m in supa.select_all('maker_models', 'id,path,kind,technique'):
        full = os.path.join(supa.MAKER_ROOT, m['path'])
        imgs = set()
        try:
            for dp, dn, fn in os.walk(full):
                if dp.count(os.sep) - full.count(os.sep) >= 1: dn[:] = []
                imgs |= {img_key(f) for f in fn if os.path.splitext(f)[1].lower() in IMG_EXT}
        except OSError:
            pass
        out[m['path'].strip('/')] = (m, imgs)
    return out


def score(product, rel, imgs, prod_imgs):
    parts = rel.split('/')
    if len(parts) < 3: return 0.0
    tail = ' '.join(parts[-2:])
    pw, fw = set(words(product['name'])), set(words(tail))
    if not pw or not fw: return 0.0
    overlap = len(pw & fw) / len(pw | fw)
    seq = SequenceMatcher(None, ' '.join(sorted(pw)), ' '.join(sorted(words(parts[-1])))).ratio()
    s = 0.6 * overlap + 0.4 * seq
    if prod_imgs & imgs: s += 0.6                                      # dezelfde foto: bijna zeker
    return s


def main():
    dry = '--dry-run' in sys.argv
    folders = model_folders()
    products = supa.select_all('products', 'id,name,sku,process_type,image_url')
    existing = supa.rest('GET', 'product_files?select=product_id,path,confirmed,source') or []
    confirmed = {r['product_id'] for r in existing if r['confirmed'] or r['source'] == 'manual'}
    rows = []
    for p in products:
        if p['id'] in confirmed: continue
        tech = TECH.get(p['process_type'])
        prod_imgs = {img_key(u) for u in (p.get('image_url') or '').split(',') if u.strip()}
        cands = [(score(p, rel, imgs, prod_imgs), rel, m['id']) for rel, (m, imgs) in folders.items()
                 if not tech or (m.get('technique') or KIND_TECH.get(m['kind'])) in tech]
        cands = sorted((c for c in cands if c[0] >= MIN_SCORE), reverse=True)[:1]
        for sc, rel, mid in cands:
            rows.append({'product_id': p['id'], 'path': rel, 'source': 'catalog', 'model_id': mid, 'confirmed': False,
                         'score': round(min(sc, 1.5), 3)})
            if dry: print(f'{sc:.2f}  {p["name"][:50]:50}  {rel}')
    if not dry:
        # oude onbevestigde voorstellen vervangen door de nieuwe
        stale = [r for r in existing if not r['confirmed'] and r['source'] in ('shop', 'catalog') and r['product_id'] not in confirmed]
        for r in stale:
            supa.rest('DELETE', f'product_files?product_id=eq.{r["product_id"]}&path=eq.{urllib.parse.quote(r["path"])}&confirmed=is.false',
                      prefer='return=minimal')
        for i in range(0, len(rows), 200):
            supa.rest('POST', 'product_files?on_conflict=product_id,path', rows[i:i + 200], prefer='resolution=merge-duplicates,return=minimal')
    print(f'{len(rows)} voorstellen voor {len(products) - len(confirmed)} producten zonder bevestigde map ({len(folders)} catalogusmodellen)')


if __name__ == '__main__':
    main()
