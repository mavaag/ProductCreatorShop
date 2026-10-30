"""engrave_mockups.py - productfoto's van een gravuremodel maken met de gravure-templates van de beheertool (maker-agent).

Een gravuremodel (Engraving/<collectie>/<ontwerp>) is een ontwerp (SVG/PNG/JPG). Het wordt als lasergravure in de zone
van elke gravure-template gezet die in de mockup-generator (tabblad Lasergravure) op "Gebruik voor de agent" staat
(mockup_templates.agent, migratie 031), met de gravurekleur en het soort afbeelding van die template
(engrave_settings) -- dezelfde regels als lib/engraveMockup.ts, dus hetzelfde resultaat als in de mockup-generator.
Enkel templates met één zone; templates met meerdere zones zijn voor sets (--set).
Resultaat in de modelmap: mockup_engrave_<soort product>_<template>.jpg. Bestaat zo'n bestand al, dan wordt het niet
overschreven (verwijder het zelf om het opnieuw te laten maken).
--update-doc: de mockups worden de foto's van het productdocument (_catalog/products/<id>.json met source_path = de
modelmap); een variant met production.product_kind = het soort product van een template krijgt die mockup als foto
(variations[].image). Daarna publish_docs.py.
--set <map> <ontwerpmap> ...: een set (bv. 4 onderleggers): de ontwerpen komen in de zones van de templates met zoveel
zones (in volgorde), het resultaat in <map> (bv. de map van de set).
--design <bestand>: het ontwerp zelf opgeven als er meerdere afbeeldingen in de map staan.
--list: de templates voor de agent (soort product, zones, gravurekleur) en de blanco materialen tonen -- daaruit
volgen de varianten van het productdocument.
    python3 engrave_mockups.py "Engraving/Peeking-Animals/Peeking Bear" [...] [--update-doc] [--dry-run]
    python3 engrave_mockups.py --list"""
import glob, io, json, math, os, re, shutil, subprocess, sys, tempfile, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

ROOT = supa.MAKER_ROOT
PREFIX = 'mockup_engrave_'
DESIGN_EXT = ('.svg', '.png', '.jpg', '.jpeg', '.webp')
DEFAULT = {'color': '#3b2414', 'imageMode': 'auto'}


def templates():
    rows = supa.rest('GET', 'mockup_templates?select=id,name,room_image_url,corners,shape,zones,engrave_settings,product_kind'
                            '&technique=eq.engrave&agent=is.true&order=name') or []
    for t in rows:
        t['zone_list'] = t['zones'] or [{'corners': t['corners'], 'shape': t.get('shape') or 'rect'}]
    return rows


def fetch(url):
    """Productfoto uit de opslag van Supabase; via het interne adres (de publieke URL is van buitenaf)."""
    if '/storage/v1/' in url: url = supa.URL.rstrip('/') + '/storage/v1/' + url.split('/storage/v1/', 1)[1]
    req = urllib.request.Request(url, headers={'apikey': supa.KEY, 'Authorization': f'Bearer {supa.KEY}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return ImageOps.exif_transpose(Image.open(io.BytesIO(r.read()))).convert('RGB')


def safe(name):
    return re.sub(r'[^A-Za-z0-9]+', '-', name).strip('-') or 'template'


# ---------- ontwerp ----------

def design_file(folder):
    """Het ontwerp: een SVG (scherp, transparant), anders de grootste PNG/JPG; geen mockups, niets in LaserReady."""
    files = [f for f in os.listdir(folder) if os.path.isfile(os.path.join(folder, f)) and not f.lower().startswith('mockup_')]
    for exts in (('.svg',), ('.png',), ('.jpg', '.jpeg', '.webp')):
        hits = sorted((f for f in files if f.lower().endswith(exts)), key=lambda f: os.path.getsize(os.path.join(folder, f)), reverse=True)
        if hits: return os.path.join(folder, hits[0])
    return None


def load_design(path):
    """RGBA, langste zijde hoogstens 1600 px (zoals engraveImage in de browser)."""
    if path.lower().endswith('.svg'):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, 'design.png')
            subprocess.run(['inkscape', path, '--export-type=png', f'--export-filename={out}', '--export-width=1600',
                            '--export-background-opacity=0'], check=True, capture_output=True, timeout=300)
            im = Image.open(out).convert('RGBA')
    else:
        im = ImageOps.exif_transpose(Image.open(path)).convert('RGBA')
    if max(im.size) > 1600: im.thumbnail((1600, 1600), Image.LANCZOS)
    return im


# ---------- gravure (port van lib/engraveMockup.ts) ----------

def hex_rgb(h):
    h = (h or '#000000').lstrip('#')
    if len(h) == 3: h = ''.join(c * 2 for c in h)
    n = int(h, 16) if re.fullmatch(r'[0-9a-fA-F]{6}', h) else 0
    return (n >> 16) & 255, (n >> 8) & 255, n & 255


def lum(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b


def is_light(color):
    return lum(*hex_rgb(color)) / 255 > 0.5


def looks_like_logo(a):
    """Logo = langs de rand (bijna) overal wit of transparant."""
    h, w = a.shape[:2]
    step = max(1, round(max(w, h) / 200))
    edge = np.concatenate([a[0, ::step], a[h - 1, ::step], a[::step, 0], a[::step, w - 1]])
    bg = (edge[:, 3] < 32) | (lum(edge[:, 0], edge[:, 1], edge[:, 2]) > 235)
    return len(edge) > 0 and bg.mean() >= 0.6


def engrave_image(im, color, mode):
    """Overal de gravurekleur, met de dekking volgens het ontwerp (logo: donker = graveren; foto op een lichte
    gravurekleur: licht = graveren, anders lijkt ze een negatief)."""
    a = np.asarray(im, dtype=np.float32)
    photo = mode == 'photo' or (mode == 'auto' and not looks_like_logo(a))
    positive = photo and is_light(color)
    l = lum(a[..., 0], a[..., 1], a[..., 2]) / 255
    al = a[..., 3] / 255
    alpha = l * al if positive else np.minimum(1, (1 - l) * al * (1 if photo else 1.2))
    r, g, b = hex_rgb(color)
    out = np.empty(a.shape, np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = r, g, b
    out[..., 3] = np.round(alpha * 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def zone_quad(quad, shape):
    """Ronde zone met de punten óp de cirkel (zijden ~45° schuin) -> hoeken van het omschreven vierkant."""
    if shape != 'ellipse': return quad
    def tilt(a, b):
        deg = abs(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))) % 90
        return 22.5 < deg < 67.5
    p0, p1, p2, p3 = quad
    if not all(tilt(a, b) for a, b in ((p0, p1), (p1, p2), (p2, p3), (p3, p0))): return quad
    c = (sum(p[0] for p in quad) / 4, sum(p[1] for p in quad) / 4)
    corner = lambda a, b: (a[0] + b[0] - c[0], a[1] + b[1] - c[1])
    return [corner(p0, p3), corner(p0, p1), corner(p2, p1), corner(p2, p3)]


def build_layer(design, quad, shape, color, mode):
    """Gravure op een vlak met de verhouding van de zone; past op 100% net in de zone (ronde zone: vult de cirkel)."""
    d = lambda a, b: math.dist(quad[a], quad[b])
    aspect = (d(0, 1) + d(3, 2)) / max(1, d(0, 3) + d(1, 2))
    W = 1600
    H = max(1, round(W / max(0.05, aspect)))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if design is not None:
        eng = engrave_image(design, color, mode)
        pad = 0.05
        area = (0, 0, W, H) if shape == 'ellipse' else (W * pad, H * pad, W * (1 - 2 * pad), H * (1 - 2 * pad))
        fit = min(area[2] / eng.width, area[3] / eng.height)
        w, h = max(1, round(eng.width * fit)), max(1, round(eng.height * fit))
        eng = eng.resize((w, h), Image.LANCZOS)
        layer.alpha_composite(eng, (round(area[0] + area[2] / 2 - w / 2), round(area[1] + area[3] / 2 - h / 2)))
    if shape == 'ellipse':
        mask = Image.new('L', (W, H), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, W - 1, H - 1), fill=255)
        layer.putalpha(Image.fromarray((np.asarray(layer.split()[3], np.float32) * np.asarray(mask, np.float32) / 255).astype(np.uint8)))
    return layer


def perspective_coeffs(dst, src):
    """Coëfficiënten voor Image.transform(PERSPECTIVE): punt in de foto (dst) -> punt in de laag (src)."""
    a = []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    return np.linalg.solve(np.array(a, dtype=float), np.array([c for p in src for c in p], dtype=float)).tolist()


def blend(base, color, alpha, mode):
    """base (h,w,3) 0-1; color (3,) 0-1; alpha (h,w) 0-1; mode multiply of screen (zoals canvas)."""
    c = np.asarray(color, np.float32)
    mixed = base * c if mode == 'multiply' else 1 - (1 - base) * (1 - c)
    return base + (mixed - base) * alpha[..., None]


def engrave_on(photo, design, zone, settings):
    """Tekent de gravure in één zone van de foto (zoals drawEngravingInQuad): lichte kleur licht op ('screen'),
    donkere maakt donkerder ('multiply'), met een smalle rand eronder voor wat diepte en een lichte vervaging."""
    w, h = photo.size
    color, mode = settings.get('color') or DEFAULT['color'], settings.get('imageMode') or DEFAULT['imageMode']
    shape = zone.get('shape') or 'rect'
    quad = zone_quad([(c['x'] * w, c['y'] * h) for c in zone['corners']], shape)
    layer = build_layer(design, quad, shape, color, mode)
    coeffs = perspective_coeffs(quad, [(0, 0), (layer.width, 0), (layer.width, layer.height), (0, layer.height)])
    warped = layer.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    light = is_light(color)
    depth = max(1, round(w / 1500))
    base = np.asarray(photo, np.float32) / 255
    a = np.asarray(warped.split()[3], np.float32) / 255
    edge = np.zeros_like(a); edge[depth:] = a[:-depth]
    base = blend(base, (0, 0, 0) if light else (1, 1, 1), edge * (0.35 if light else 0.25), 'multiply' if light else 'screen')
    soft = warped.filter(ImageFilter.GaussianBlur(0.5))
    sa = np.asarray(soft.split()[3], np.float32) / 255
    rgb = np.array(hex_rgb(color), np.float32) / 255
    base = blend(base, rgb, sa * 0.9, 'screen' if light else 'multiply')
    return Image.fromarray(np.clip(base * 255 + 0.5, 0, 255).astype(np.uint8))


def render(photo, designs, t):
    out = photo.copy()
    for zone, design in zip(t['zone_list'], designs):
        out = engrave_on(out, design, zone, t.get('engrave_settings') or {})
    return out


# ---------- document ----------

def update_doc(folder, tpl, dry):
    """Mockups -> doc.product.images en variations[].image per production.product_kind (backup .bak-mockups)."""
    rel = os.path.relpath(folder, ROOT).replace(os.sep, '/')
    mocks = [f'{rel}/{f}' for f in sorted(os.listdir(folder)) if f.startswith(PREFIX) and f.endswith('.jpg')]
    by_kind = {}
    for t in tpl:
        f = f'{rel}/{PREFIX}{safe(t["product_kind"])}_{safe(t["name"])}.jpg'
        if f in mocks: by_kind.setdefault(t['product_kind'].strip().lower(), f)
    for fn in glob.glob(os.path.join(ROOT, '_catalog', 'products', '*.json')):
        doc = json.load(open(fn, encoding='utf-8'))
        if doc.get('source_path', '').strip('/') != rel: continue
        if not mocks: return f'{rel}: geen mockups, document niet aangepast'
        changed = doc['product'].get('images') != mocks
        for v in doc.get('variations', []):
            img = by_kind.get(str((v.get('production') or {}).get('product_kind', '')).strip().lower())
            if img and v.get('image') != img: v['image'] = img; changed = True
        if not changed: return f'{rel}: document had de mockups al'
        if dry: return f'{rel}: document {os.path.basename(fn)} zou {len(mocks)} mockups krijgen'
        if not os.path.exists(fn + '.bak-mockups'): shutil.copy2(fn, fn + '.bak-mockups')
        doc['product']['images'] = mocks
        tmp = fn + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f: json.dump(doc, f, ensure_ascii=False, indent=1)
        os.replace(tmp, fn)
        return f'{rel}: {len(mocks)} mockups in document {os.path.basename(fn)} (nu publish_docs.py)'
    return f'{rel}: geen productdocument gevonden'


def list_templates():
    tpl = templates()
    if not tpl: print('geen gravure-templates op "Gebruik voor de agent"')
    for t in tpl:
        s = t.get('engrave_settings') or {}
        print(f'template "{t["name"]}": soort product "{t["product_kind"]}", {len(t["zone_list"])} zone(s), '
              f'gravurekleur {s.get("color") or DEFAULT["color"]}, afbeelding {s.get("imageMode") or DEFAULT["imageMode"]}')
    mats = supa.rest('GET', 'materials?select=name&category=eq.blank&order=name') or []
    print('blanco materialen: ' + ', '.join(m['name'] for m in mats))


def main():
    args = sys.argv[1:]
    if '--list' in args: list_templates(); return
    dry = '--dry-run' in args; with_doc = '--update-doc' in args
    chosen = args[args.index('--design') + 1] if '--design' in args else None
    paths = [a for i, a in enumerate(args) if not a.startswith('--') and not (i and args[i - 1] == '--design')]
    is_set = '--set' in args
    if not paths or (is_set and len(paths) < 3): print(__doc__); sys.exit(1)
    tpl = [t for t in templates() if t['product_kind'].strip()]
    if not tpl:
        print('engrave_mockups: geen templates op "Gebruik voor de agent" met een soort product (Mockup-generator > Lasergravure)'); return
    full = lambda p: p if os.path.isabs(p) else os.path.join(ROOT, p)
    # gewone modellen: elk zijn eigen ontwerp in de templates met één zone; set: alle ontwerpen samen in de templates
    # met evenveel zones
    jobs = [(paths[0], paths[1:])] if is_set else [(p, [p]) for p in paths]
    photos, made = {}, 0
    for out_rel, sources in jobs:
        folder = full(out_rel)
        if not os.path.isdir(folder): print(f'{out_rel}: map bestaat niet'); continue
        files = []
        for src in sources:
            f = os.path.join(full(src), chosen) if chosen and not is_set else (design_file(full(src)) if os.path.isdir(full(src)) else None)
            if not f or not os.path.isfile(f): print(f'{src}: geen ontwerp (SVG/PNG/JPG) gevonden'); files = None; break
            files.append(f)
        if not files: continue
        mine = [t for t in tpl if len(t['zone_list']) == len(files)]
        if not mine: print(f'{out_rel}: geen template met {len(files)} zone{"" if len(files) == 1 else "s"} op "Gebruik voor de agent"'); continue
        todo = [t for t in mine if not os.path.exists(os.path.join(folder, f'{PREFIX}{safe(t["product_kind"])}_{safe(t["name"])}.jpg'))]
        for t in mine:
            if t not in todo: print(f'{out_rel}: {PREFIX}{safe(t["product_kind"])}_{safe(t["name"])}.jpg bestaat al')
        if dry:
            for t in todo: print(f'{out_rel}: {", ".join(os.path.basename(f) for f in files)} -> {PREFIX}{safe(t["product_kind"])}_{safe(t["name"])}.jpg')
        elif todo:
            try:
                designs = [load_design(f) for f in files]
            except Exception as e:
                print(f'{out_rel}: ontwerp laden lukt niet: {e}'); continue
            for t in todo:
                if t['id'] not in photos: photos[t['id']] = fetch(t['room_image_url'])
                name = f'{PREFIX}{safe(t["product_kind"])}_{safe(t["name"])}.jpg'
                render(photos[t['id']], designs, t).save(os.path.join(folder, name), 'JPEG', quality=90)
                made += 1
                print(f'{out_rel}: {name}')
        if with_doc: print(update_doc(folder, mine, dry))
    fotos = 'mockup' if made == 1 else 'mockups'   # geen geneste quotes in de f-string (Python 3.11 in de container)
    print(f'engrave_mockups: {made} {fotos} gemaakt ({len(tpl)} template{"" if len(tpl) == 1 else "s"})' + (' (droge test)' if dry else ''))


if __name__ == '__main__':
    main()
