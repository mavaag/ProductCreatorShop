"""match_shop_files.py - stelt per product in de beheertool voor welke map in _Shop de productiebestanden bevat.

_Shop bevat de productiebestanden van de shopproducten (vroeger de PRODUCTS-map op de pc): 3DPrinting, LaserCutting, UVPrinting,
Engraving en Sublimatie, met per product een map. Dit script vergelijkt elk product met die mappen:
  - dezelfde foto: een afbeelding van het product in de shop (bv. Kirby_base.png) staat ook in de map (sterk);
  - de naam: woorden van de productnaam in de mapnaam (en de bovenliggende map);
  - enkel mappen van de juiste techniek (3D-printen -> 3DPrinting, ...).
Schrijft het beste voorstel per product in product_files (confirmed = false, source 'shop'). Bevestigde of zelf
gekozen rijen worden nooit aangeraakt; een product met een bevestigde map krijgt geen nieuw voorstel.
    python3 match_shop_files.py [--dry-run]"""
import os, re, sys, urllib.parse
from difflib import SequenceMatcher
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

SHOP = os.path.join(supa.MAKER_ROOT, '_Shop')
TECH_DIR = {'3d_print': '3DPrinting', 'resin_print': '3DPrinting', 'laser_cutting': 'LaserCutting',
            'uv_print': 'UVPrinting', 'laser_engraving': 'Engraving', 'sublimation': 'Sublimatie'}
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


def product_folders():
    """Mappen met productiebestanden (direct of in submappen), als {relatief pad: (afbeeldingen, heeft bestanden)}."""
    out = {}
    for dp, dn, fn in os.walk(SHOP):
        dn[:] = [d for d in dn if not d.startswith(('.', '@', '#'))]
        exts = {os.path.splitext(f)[1].lower() for f in fn}
        if exts & PROD_EXT:
            rel = os.path.relpath(dp, supa.MAKER_ROOT).replace(os.sep, '/')
            out[rel] = {img_key(f) for f in fn if os.path.splitext(f)[1].lower() in IMG_EXT}
    # een map waarvan enkel een submap bestanden heeft (bv. "Axolotl Complete/Axolotl Complete") -> de bovenste nemen
    merged = {}
    for rel in sorted(out):
        parent = rel.rsplit('/', 1)[0]
        if parent in merged and os.path.basename(rel).lower() == os.path.basename(parent).lower():
            merged[parent] |= out[rel]; continue
        merged[rel] = set(out[rel])
    return merged


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
    if not os.path.isdir(SHOP): sys.exit(f'{SHOP} bestaat niet (nog niet gekopieerd?)')
    folders = product_folders()
    products = supa.select_all('products', 'id,name,sku,process_type,image_url')
    existing = supa.rest('GET', 'product_files?select=product_id,path,confirmed,source') or []
    confirmed = {r['product_id'] for r in existing if r['confirmed'] or r['source'] == 'manual'}
    rows = []
    for p in products:
        if p['id'] in confirmed: continue
        tech = TECH_DIR.get(p['process_type'])
        prod_imgs = {img_key(u) for u in (p.get('image_url') or '').split(',') if u.strip()}
        cands = [(score(p, rel, imgs, prod_imgs), rel) for rel, imgs in folders.items()
                 if not tech or rel.split('/')[1] == tech]
        cands = sorted((c for c in cands if c[0] >= MIN_SCORE), reverse=True)[:1]
        for sc, rel in cands:
            rows.append({'product_id': p['id'], 'path': rel, 'source': 'shop', 'confirmed': False, 'score': round(min(sc, 1.5), 3)})
            if dry: print(f'{sc:.2f}  {p["name"][:50]:50}  {rel}')
    if not dry:
        # oude onbevestigde voorstellen vervangen door de nieuwe
        stale = [r for r in existing if not r['confirmed'] and r['source'] == 'shop' and r['product_id'] not in confirmed]
        for r in stale:
            supa.rest('DELETE', f'product_files?product_id=eq.{r["product_id"]}&path=eq.{urllib.parse.quote(r["path"])}&confirmed=is.false',
                      prefer='return=minimal')
        for i in range(0, len(rows), 200):
            supa.rest('POST', 'product_files?on_conflict=product_id,path', rows[i:i + 200], prefer='resolution=merge-duplicates,return=minimal')
    print(f'{len(rows)} voorstellen voor {len(products) - len(confirmed)} producten zonder bevestigde map ({len(folders)} mappen in _Shop)')


if __name__ == '__main__':
    main()
