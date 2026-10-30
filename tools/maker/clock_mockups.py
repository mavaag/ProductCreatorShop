"""clock_mockups.py - productfoto's van een wandklok maken uit zijn snijbestand (maker-agent, regel 2026-10-30).

Klokken zijn zwart acryl of hout, Ø 28 cm, met uurwerk (zie maker-agent/AGENT_PROMPT.md, "Wall clocks"). Er zijn geen
echte foto's, dus dit script maakt ze uit het silhouet van de klok (de SVG, via Inkscape, of een PNG met
transparante achtergrond):
  mockup_clock_1_acrylic.jpg   zwart glanzend acryl op een lichte muur (hoofdfoto)
  mockup_clock_2_wood.jpg      hout op een lichte muur (foto van de variant Wood)
  mockup_clock_3_closeup.jpg   close-up van het midden van de acrylversie
  mockup_clock_4_<template>.jpg  de acrylklok in elke kamerfoto die in de mockup-generator op "Gebruik voor klokken"
                               staat (mockup_templates.clock, migratie 029); het kader is de plaats van de klok
Telkens met wijzers op 10:10 (rode secondewijzer) en een zachte schaduw (de klok hangt een paar mm van de muur).
Bestaat een bestand al, dan wordt het niet overschreven (verwijder het zelf om het opnieuw te laten maken).
--update-doc: de mockups worden de foto's van het productdocument (_catalog/products/<id>.json met source_path = de
modelmap); de houtfoto wordt ook de foto van de variant MATERIAL=Wood, de acrylfoto die van Black Acrylic
(variations[].image). Daarna publish_docs.py.
    python3 clock_mockups.py "Lasercut/Vectors/Clocks/WallClock_1/Joker Clock" [...] [--update-doc] [--dry-run]"""
import glob, io, json, math, os, re, shutil, subprocess, sys, tempfile, urllib.request
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

ROOT = supa.MAKER_ROOT
PREFIX = 'mockup_clock_'
SIZE = 1400                      # vierkante foto's op een muur
rng = np.random.default_rng(7)   # vaste ruis: dezelfde klok geeft telkens dezelfde foto


def templates():
    return supa.rest('GET', 'mockup_templates?select=id,name,room_image_url,corners&clock=is.true&order=name') or []


def fetch(url):
    """Kamerfoto uit de opslag van Supabase; via het interne adres (de publieke URL is van buitenaf)."""
    if '/storage/v1/' in url: url = supa.URL.rstrip('/') + '/storage/v1/' + url.split('/storage/v1/', 1)[1]
    req = urllib.request.Request(url, headers={'apikey': supa.KEY, 'Authorization': f'Bearer {supa.KEY}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return ImageOps.exif_transpose(Image.open(io.BytesIO(r.read()))).convert('RGB')


# ---------- silhouet ----------

def source_file(folder):
    """Het snijbestand om het silhouet uit te halen: een SVG (niet in LaserReady), anders een PNG."""
    files = []
    for dp, dn, fn in os.walk(folder):
        dn[:] = [d for d in dn if d != 'LaserReady' and not d.startswith(('.', '@'))]
        files += [os.path.join(dp, f) for f in fn if not f.lower().startswith('mockup_')]
    for ext in ('.svg', '.png'):
        hits = sorted((f for f in files if f.lower().endswith(ext)), key=os.path.getsize, reverse=True)
        if hits: return hits[0]
    return None


def silhouette(path):
    """Alfamasker (L) van de klok, bijgesneden tot de klok zelf, ca. 1600 px breed."""
    if path.lower().endswith('.svg'):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, 'clock.png')
            subprocess.run(['inkscape', path, '--export-type=png', f'--export-filename={out}', '--export-width=2000',
                            '--export-background-opacity=0'], check=True, capture_output=True, timeout=300)
            im = Image.open(out).convert('RGBA')
    else:
        im = Image.open(path).convert('RGBA')
    a = np.array(im.split()[3])
    if a.min() > 200:   # geen transparantie: donker = klok
        a = 255 - np.array(im.convert('L'))
    a = np.where(a > 100, 255, 0).astype(np.uint8)
    if (a > 0).mean() < 0.03: raise ValueError('silhouet bijna leeg (enkel snijlijnen?)')
    ys, xs = np.nonzero(a)
    m = Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
    if max(m.size) > 1600: m.thumbnail((1600, 1600), Image.LANCZOS)
    return m


def clock_centre(mask):
    """Midden van de klok: het kleine gat voor de as dicht bij het midden, anders het midden van het silhouet."""
    a = np.array(mask) > 127
    holes, n = ndimage.label(~a)
    h, w = a.shape
    edge = set(np.unique(np.concatenate([holes[0], holes[-1], holes[:, 0], holes[:, -1]])))
    best = None
    for i, sl in enumerate(ndimage.find_objects(holes), 1):
        if i in edge or sl is None: continue
        hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if not (0.005 * w < ww < 0.06 * w and 0.6 < ww / max(hh, 1) < 1.6): continue
        cy, cx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
        d = math.hypot(cx - w / 2, cy - h / 2)
        if d < 0.2 * w and (best is None or d < best[0]): best = (d, cx, cy)
    return (best[1], best[2]) if best else (w / 2, h / 2)


# ---------- materialen ----------

def fbm(h, w, scale, octaves=4):
    out = np.zeros((h, w), np.float32); amp = 1.0
    for o in range(octaves):
        s = max(2, int(scale * 2 ** o))
        n = rng.normal(0, 1, (s, s)).astype(np.float32)
        out += amp * np.array(Image.fromarray(n).resize((w, h), Image.BICUBIC))
        amp *= 0.5
    return out / 1.9


def wood(size):
    """Licht berken-/populiermultiplex: onregelmatige jaarringen, fijne nerf, wat kleurverschil."""
    w, h = size
    yy = np.mgrid[0:h, 0:w][0].astype(np.float32)
    warp = fbm(h, w, 2, 2) * h / 14
    rings = (np.sin((yy + warp) / (h / 160)) * 0.5 + 0.5) ** 6          # smalle donkere nerflijnen
    # fijne streepjes in de lengte van de nerf: ruis die horizontaal uitgerekt is
    streak = np.array(Image.fromarray(rng.normal(0, 1, (h, max(2, w // 40))).astype(np.float32)).resize((w, h), Image.BICUBIC))
    tone = fbm(h, w, 2, 2) * 0.07
    t = (rings * 0.55 + streak * 0.07 + tone + 0.1).clip(0, 1)[..., None]
    light = np.array([222, 190, 146], np.float32); dark = np.array([176, 132, 86], np.float32)
    return Image.fromarray((light * (1 - t) + dark * t).clip(0, 255).astype(np.uint8))


def acrylic(size):
    """Glanzend zwart: bijna zwart met een brede en een smalle diagonale glans."""
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = xx / w - yy / h
    gloss = np.exp(-((d - 0.15) ** 2) / 0.02) * 34 + np.exp(-((d + 0.35) ** 2) / 0.004) * 16
    v = 13 + gloss
    return Image.fromarray(np.stack([v, v, v + 2], -1).clip(0, 255).astype(np.uint8))


def wall(w, h, tone=(233, 230, 225)):
    """Lichte gepleisterde muur, zacht licht van linksboven."""
    n = fbm(h, w, 40, 3) * 4 + rng.normal(0, 2.2, (h, w)).astype(np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    light = 1.04 - 0.16 * np.hypot((xx - w * 0.2) / w, (yy - h * 0.05) / h)
    return Image.fromarray(np.stack([(t + n) * light for t in tone], -1).clip(0, 255).astype(np.uint8))


# ---------- samenstellen ----------

def piece(mask, material):
    """De klok als RGBA in het materiaal, met iets donkerdere (gelaserde) randen."""
    tex = wood(mask.size) if material == 'wood' else acrylic(mask.size)
    out = Image.new('RGBA', mask.size); out.paste(tex, (0, 0), mask)
    k = max(3, mask.width // 300) | 1
    edge = ImageChops.subtract(mask, mask.filter(ImageFilter.MinFilter(k)))
    shade = Image.new('RGBA', mask.size, (70, 40, 15, 255) if material == 'wood' else (0, 0, 0, 255))
    out.paste(shade, (0, 0), edge.point(lambda v: int(v * 0.55)))
    return out


def hands(img, c, r, material):
    """Wijzers op 10:10, rode secondewijzer, messing asdop; met een klein schaduwtje."""
    col = (245, 245, 245) if material == 'acrylic' else (28, 28, 28)
    layer = Image.new('RGBA', img.size); d = ImageDraw.Draw(layer)
    shadow = Image.new('RGBA', img.size); ds = ImageDraw.Draw(shadow)

    def hand(angle, length, width, colour):
        a = math.radians(angle - 90)
        p1 = (c[0] - math.cos(a) * length * 0.18, c[1] - math.sin(a) * length * 0.18)
        p2 = (c[0] + math.cos(a) * length, c[1] + math.sin(a) * length)
        off = max(2, r / 60)
        ds.line([(p1[0] + off, p1[1] + off), (p2[0] + off, p2[1] + off)], fill=(0, 0, 0, 90), width=int(width))
        d.line([p1, p2], fill=colour, width=int(width))

    hand(305, r * 0.55, max(5, r / 16), col)     # uur op 10
    hand(60, r * 0.82, max(4, r / 24), col)      # minuut op 2
    hand(200, r * 0.92, max(2, r / 80), (205, 30, 30))
    cap = r * 0.045
    d.ellipse([c[0] - cap, c[1] - cap, c[0] + cap, c[1] + cap], fill=(190, 160, 95))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(max(1, r / 90))))
    img.alpha_composite(layer)


def on_wall(bg, mask, material, box):
    """Klok (masker) passend in box (x0, y0, x1, y1) op bg zetten, met schaduw en wijzers."""
    bw, bh = box[2] - box[0], box[3] - box[1]
    s = min(bw / mask.width, bh / mask.height)
    m = mask.resize((max(1, round(mask.width * s)), max(1, round(mask.height * s))), Image.LANCZOS)
    x = round(box[0] + (bw - m.width) / 2); y = round(box[1] + (bh - m.height) / 2)
    bg = bg.convert('RGBA')
    off = max(2, m.width / 70)
    sh = Image.new('L', bg.size, 0); sh.paste(m, (round(x + off), round(y + off * 1.3)))
    sh = sh.filter(ImageFilter.GaussianBlur(max(1, m.width / 90))).point(lambda v: int(v * 0.42))
    bg.paste(Image.new('RGBA', bg.size, (55, 50, 45, 255)), (0, 0), sh)
    bg.alpha_composite(piece(m, material), (x, y))
    cx, cy = clock_centre(m)
    hands(bg, (x + cx, y + cy), min(m.width, m.height) * 0.2, material)
    return bg.convert('RGB')


def make(mask, kind, room=None, corners=None):
    if kind in ('acrylic', 'wood'):
        b = round(SIZE * 0.17)
        return on_wall(wall(SIZE, SIZE), mask, kind, (b, round(b * 0.85), SIZE - b, SIZE - round(b * 1.15)))
    if kind == 'closeup':
        big = on_wall(wall(SIZE * 2, SIZE * 2), mask, 'acrylic', (60, 60, SIZE * 2 - 60, SIZE * 2 - 60))
        return big.crop((SIZE // 2, SIZE // 2, SIZE // 2 * 3, SIZE // 2 * 3))
    w, h = room.size
    xs = [c['x'] * w for c in corners]; ys = [c['y'] * h for c in corners]
    return on_wall(room.copy(), mask, 'acrylic', (min(xs), min(ys), max(xs), max(ys)))


def safe(name):
    return re.sub(r'[^A-Za-z0-9]+', '-', name).strip('-') or 'template'


def update_doc(folder, dry):
    """Mockups -> doc.product.images (acryl eerst) en variations[].image per MATERIAL (backup .bak-mockups)."""
    rel = os.path.relpath(folder, ROOT).replace(os.sep, '/')
    mocks = [f'{rel}/{f}' for f in sorted(os.listdir(folder)) if f.startswith(PREFIX) and f.endswith('.jpg')]
    for fn in glob.glob(os.path.join(ROOT, '_catalog', 'products', '*.json')):
        doc = json.load(open(fn, encoding='utf-8'))
        if doc.get('source_path', '').strip('/') != rel: continue
        if not mocks: return f'{rel}: geen mockups, document niet aangepast'
        by_mat = {'black acrylic': f'{rel}/{PREFIX}1_acrylic.jpg', 'wood': f'{rel}/{PREFIX}2_wood.jpg'}
        changed = doc['product'].get('images') != mocks
        for v in doc.get('variations', []):
            img = by_mat.get(str(v.get('attributes', {}).get('MATERIAL', '')).lower())
            if img and img in mocks and v.get('image') != img: v['image'] = img; changed = True
        if not changed: return f'{rel}: document had de mockups al'
        if dry: return f'{rel}: document {os.path.basename(fn)} zou {len(mocks)} mockups krijgen'
        if not os.path.exists(fn + '.bak-mockups'): shutil.copy2(fn, fn + '.bak-mockups')
        doc['product']['images'] = mocks
        tmp = fn + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f: json.dump(doc, f, ensure_ascii=False, indent=1)
        os.replace(tmp, fn)
        return f'{rel}: {len(mocks)} mockups in document {os.path.basename(fn)} (nu publish_docs.py)'
    return f'{rel}: geen productdocument gevonden'


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args; with_doc = '--update-doc' in args
    folders = [a for a in args if not a.startswith('--')]
    if not folders: print(__doc__); sys.exit(1)
    tpl = templates()
    rooms = {}
    made = 0
    for rel in folders:
        folder = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        if not os.path.isdir(folder): print(f'{rel}: map bestaat niet'); continue
        src = source_file(folder)
        if not src: print(f'{rel}: geen SVG of PNG om het silhouet uit te halen'); continue
        jobs = [('1_acrylic', 'acrylic', None), ('2_wood', 'wood', None), ('3_closeup', 'closeup', None)]
        jobs += [(f'4_{safe(t["name"])}', 'room', t) for t in tpl]
        todo = [(n, k, t) for n, k, t in jobs if not os.path.exists(os.path.join(folder, f'{PREFIX}{n}.jpg'))]
        if dry:
            for n, _, _ in todo: print(f'{rel}: {os.path.basename(src)} -> {PREFIX}{n}.jpg')
        elif todo:
            try:
                mask = silhouette(src)
            except Exception as e:
                print(f'{rel}: silhouet uit {os.path.basename(src)} lukt niet: {e}'); continue
            for n, kind, t in todo:
                if t and t['id'] not in rooms: rooms[t['id']] = fetch(t['room_image_url'])
                img = make(mask, kind, rooms.get(t['id']) if t else None, t['corners'] if t else None)
                img.save(os.path.join(folder, f'{PREFIX}{n}.jpg'), 'JPEG', quality=90)
                made += 1
                print(f'{rel}: {PREFIX}{n}.jpg')
        if with_doc: print(update_doc(folder, dry))
    print(f'clock_mockups: {made} foto{"" if made == 1 else "'s"} gemaakt ({len(tpl)} kamertemplate{"" if len(tpl) == 1 else "s"})'
          + (' (droge test)' if dry else ''))


if __name__ == '__main__':
    main()
