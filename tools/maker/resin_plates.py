"""resin_plates.py - bouwplaten voor de resinprinters: past elk onderdeel, hoe schik je ze, hoeveel resin en tijd.

    python3 resin_plates.py <modelmap> [--files a.stl b.stl ...] [--name "Banshee"] [--printer auto|gk3|m3max|saturn]
                            [--out <map>] [--spacing 4] [--dry-run]

- Leest STL (binair/ASCII), OBJ en 3MF. Zonder --files: alle meshes in de map (behalve PrintReady/LaserReady/__MACOSX).
  Geef bij een model met supported én unsupported versies met --files enkel de set die geprint moet worden.
- De onderdelen blijven staan zoals de ontwerper ze aanlevert (voorgesupporte bestanden zijn al georiënteerd); op de
  plaat mogen ze een kwartslag draaien. Elk onderdeel komt met zijn onderkant op z=0.
- Printerkeuze (gebruikerskeuze 2026-10-26): de hoofdprinters zijn de UniFormation GK3 Ultra en de Anycubic Photon M3
  Max; "auto" neemt degene met de minste platen (gelijk: GK3 Ultra). Is het een miniatuur (alles past op de Elegoo
  Saturn 3 Ultra en de grootste maat is <= MINI_MM), dan komen er ook platen voor de Saturn bij.
- Schrijft <modelmap>/PrintReady/<Naam>_<printer>/: plate_<n>.stl (alle onderdelen op hun plaats, klaar voor de
  slicer), _OVERVIEW.png (bovenaanzicht), README.txt en plates.json; en print een JSON-samenvatting voor het
  productdocument (resin in ml, geschatte printtijd, figuren per plaat).
Geen supports, geen slicerbestand: dat doe je zelf in Chitubox/Lychee/UniFormation-slicer met je eigen instellingen.
"""
import argparse, json, math, os, re, struct, sys, zipfile
import xml.etree.ElementTree as ET
import numpy as np

# Bouwvolume X x Y x Z (mm). sec_per_layer = belichting + lift bij 0,05 mm, ruwe schatting -- pas aan als je het weet.
PRINTERS = {
    'gk3':    {'name': 'UniFormation GK3 Ultra', 'size': (300, 160, 300), 'sec_per_layer': 4.0},
    'm3max':  {'name': 'Anycubic Photon M3 Max', 'size': (298, 164, 300), 'sec_per_layer': 7.0},
    'saturn': {'name': 'Elegoo Saturn 3 Ultra', 'size': (218, 122, 260), 'sec_per_layer': 4.5},
}
MAIN = ('gk3', 'm3max')          # voorkeursvolgorde bij gelijkspel
MINI_MM = 80                     # grootste afmeting tot hier = miniatuur -> ook de Saturn
LAYER_MM = 0.05
BOTTOM_LAYERS, BOTTOM_SEC = 6, 30
EDGE_MM = 5                      # vrije rand op de bouwplaat
WASTE = 1.10                     # +10% resin voor verlies (vat, spoelen)
MESH_EXT = {'.stl', '.obj', '.3mf'}
SKIP_DIRS = {'PrintReady', 'LaserReady', '__MACOSX', '@eaDir', '.@__thumb', '#Recycle'}


# ---------- inlezen ----------
def load_stl(path):
    data = open(path, 'rb').read()
    if len(data) >= 84:
        n = struct.unpack_from('<I', data, 80)[0]
        if 84 + n * 50 == len(data):
            rec = np.frombuffer(data, dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]), count=n, offset=84)
            return rec['v'].astype(np.float64)
    verts = re.findall(rb'vertex\s+(\S+)\s+(\S+)\s+(\S+)', data)
    return np.array(verts, dtype=np.float64).reshape(-1, 3, 3)


def load_obj(path):
    vs, tris = [], []
    for line in open(path, encoding='utf-8', errors='replace'):
        if line.startswith('v '):
            vs.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('f '):
            idx = [int(t.split('/')[0]) for t in line.split()[1:]]
            idx = [i - 1 if i > 0 else len(vs) + i for i in idx]
            tris += [(idx[0], idx[k], idx[k + 1]) for k in range(1, len(idx) - 1)]
    v = np.array(vs, dtype=np.float64)
    return v[np.array(tris)]


def load_3mf(path):
    ns = {'m': 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
    out = []
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not name.lower().endswith('.model'): continue
            root = ET.fromstring(z.read(name))
            for mesh in root.iter('{%s}mesh' % ns['m']):
                v = np.array([[float(e.get(a)) for a in 'xyz'] for e in mesh.iter('{%s}vertex' % ns['m'])])
                t = np.array([[int(e.get(a)) for a in ('v1', 'v2', 'v3')] for e in mesh.iter('{%s}triangle' % ns['m'])])
                if len(v) and len(t): out.append(v[t])
    return np.concatenate(out) if out else np.zeros((0, 3, 3))


def load_mesh(path):
    ext = os.path.splitext(path)[1].lower()
    return {'.stl': load_stl, '.obj': load_obj, '.3mf': load_3mf}[ext](path)


def part_info(path):
    tri = load_mesh(path)
    if len(tri) == 0: raise ValueError(f'{path}: geen driehoeken')
    lo, hi = tri.reshape(-1, 3).min(0), tri.reshape(-1, 3).max(0)
    # volume via getekende tetraëders (benadering bij niet-gesloten meshes)
    vol = abs(np.einsum('ij,ij->i', tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum()) / 6.0
    return {'file': path, 'tri': tri, 'lo': lo, 'size': hi - lo, 'volume_mm3': vol}


# ---------- schikken (MaxRects, beste korte zijde, kwartslag mag) ----------
class Bin:
    def __init__(self, w, h):
        self.w, self.h, self.free, self.used = w, h, [(0.0, 0.0, w, h)], []

    def fit(self, w, h):
        best = None
        for fx, fy, fw, fh in self.free:
            for rot, (pw, ph) in ((False, (w, h)), (True, (h, w))):
                if pw <= fw + 1e-6 and ph <= fh + 1e-6:
                    score = (min(fw - pw, fh - ph), max(fw - pw, fh - ph))
                    if best is None or score < best[0]: best = (score, fx, fy, pw, ph, rot)
        return best

    def place(self, x, y, w, h):
        new = []
        for fx, fy, fw, fh in self.free:
            if x >= fx + fw or x + w <= fx or y >= fy + fh or y + h <= fy:
                new.append((fx, fy, fw, fh)); continue
            if x > fx: new.append((fx, fy, x - fx, fh))
            if x + w < fx + fw: new.append((x + w, fy, fx + fw - x - w, fh))
            if y > fy: new.append((fx, fy, fw, y - fy))
            if y + h < fy + fh: new.append((fx, y + h, fw, fy + fh - y - h))
        self.free = [r for r in new if not any(r != o and r[0] >= o[0] and r[1] >= o[1] and r[0] + r[2] <= o[0] + o[2]
                                               and r[1] + r[3] <= o[1] + o[3] for o in new)]
        self.used.append((x, y, w, h))


def fits(part, printer):
    W, D, H = printer['size']
    sx, sy, sz = part['size']
    room = (W - 2 * EDGE_MM, D - 2 * EDGE_MM)
    return sz <= H and ((sx <= room[0] and sy <= room[1]) or (sy <= room[0] and sx <= room[1]))


def pack(parts, printer, spacing, copies=1):
    """Lijst platen; elke plaat = lijst (part, x, y, rot) met x/y = linkeronderhoek van de bounding box op de plaat."""
    W, D, _ = printer['size']
    items = sorted([p for _ in range(copies) for p in parts], key=lambda p: -p['size'][0] * p['size'][1])
    plates = []
    for p in items:
        w, h = p['size'][0] + spacing, p['size'][1] + spacing
        for b in plates:
            f = b[0].fit(w, h)
            if f: break
        else:
            b = (Bin(W - 2 * EDGE_MM + spacing, D - 2 * EDGE_MM + spacing), [])
            plates.append(b)
            f = b[0].fit(w, h)
            if not f: raise ValueError(f'{os.path.basename(p["file"])} past niet op de {printer["name"]}')
        _, x, y, pw, ph, rot = f
        b[0].place(x, y, pw, ph)
        b[1].append((p, EDGE_MM + x, EDGE_MM + y, rot))
    return [b[1] for b in plates]


def per_plate(parts, printer, spacing):
    """Hoeveel volledige figuren (alle onderdelen) passen samen op één plaat."""
    n = 1
    while n < 60 and len(pack(parts, printer, spacing, n + 1)) == 1: n += 1
    return n if len(pack(parts, printer, spacing, 1)) == 1 else 0


# ---------- wegschrijven ----------
def placed_triangles(part, x, y, rot):
    t = part['tri'] - part['lo']                     # onderkant/linkeronderhoek naar 0
    if rot:                                          # kwartslag rond z: (x, y) -> (sy - y, x)
        t = np.stack([part['size'][1] - t[..., 1], t[..., 0], t[..., 2]], axis=-1)
    return t + np.array([x, y, 0.0])


def write_stl(path, tris):
    tris = tris.astype(np.float32)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(tris), dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]))
    rec['n'], rec['v'] = n, tris
    with open(path, 'wb') as f:
        f.write(b'resin_plates.py'.ljust(80, b' ')); f.write(struct.pack('<I', len(tris))); f.write(rec.tobytes())


def overview(path, plates, printer, title):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle
    W, D, _ = printer['size']
    fig, axes = plt.subplots(1, len(plates), figsize=(5.5 * len(plates), 5.5 * D / W + 0.8), squeeze=False)
    for i, (ax, plate) in enumerate(zip(axes[0], plates)):
        ax.add_patch(Rectangle((0, 0), W, D, fill=False, lw=2))
        for part, x, y, rot in plate:
            t = placed_triangles(part, x, y, rot)
            pts = t.reshape(-1, 3)[:, :2]
            if len(pts) > 20000: pts = pts[np.random.default_rng(0).choice(len(pts), 20000, replace=False)]
            ax.scatter(pts[:, 0], pts[:, 1], s=0.2, alpha=0.4)
            sx, sy = (part['size'][1], part['size'][0]) if rot else (part['size'][0], part['size'][1])
            ax.add_patch(Rectangle((x, y), sx, sy, fill=False, lw=0.6, ls='--'))
            ax.text(x + sx / 2, y + sy / 2, os.path.splitext(os.path.basename(part['file']))[0][:18], ha='center', va='center', fontsize=6)
        ax.set_xlim(-5, W + 5); ax.set_ylim(-5, D + 5); ax.set_aspect('equal')
        ax.set_title(f'plaat {i + 1} - {printer["name"]} ({W}x{D})', fontsize=9)
    fig.suptitle(title, fontsize=10)
    fig.tight_layout(); fig.savefig(path, dpi=110); plt.close(fig)


def estimate(plate, printer):
    hmax = max(p['size'][2] for p, *_ in plate)
    layers = math.ceil(hmax / LAYER_MM)
    sec = BOTTOM_LAYERS * BOTTOM_SEC + max(layers - BOTTOM_LAYERS, 0) * printer['sec_per_layer']
    ml = sum(p['volume_mm3'] for p, *_ in plate) / 1000 * WASTE
    return round(sec / 3600, 2), round(ml, 1), round(hmax, 1)


def make_set(model_dir, name, key, parts, spacing, out_root, dry):
    printer = PRINTERS[key]
    plates = pack(parts, printer, spacing)
    k = per_plate(parts, printer, spacing)
    est = [estimate(p, printer) for p in plates]
    figure_ml = round(sum(p['volume_mm3'] for p in parts) / 1000 * WASTE, 1)
    res = {'printer': printer['name'], 'plates': len(plates), 'figures_per_plate': k,
           'print_hours': round(sum(e[0] for e in est), 2), 'resin_ml': figure_ml,
           'print_hours_full_plate': round(estimate(pack(parts, printer, spacing, k)[0], printer)[0], 2) if k else None,
           'plate_details': [{'plate': i + 1, 'parts': [os.path.basename(p['file']) for p, *_ in pl], 'height_mm': e[2],
                              'print_hours': e[0], 'resin_ml': e[1]} for i, (pl, e) in enumerate(zip(plates, est))]}
    folder = os.path.join(out_root, f'{re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")}_{key}')
    res['folder'] = folder
    if dry: return res
    os.makedirs(folder, exist_ok=True)
    for i, pl in enumerate(plates):
        write_stl(os.path.join(folder, f'plate_{i + 1}.stl'), np.concatenate([placed_triangles(*x) for x in pl]))
    overview(os.path.join(folder, '_OVERVIEW.png'), plates, printer, f'{name} - {len(plates)} plaat/platen')
    if k > 1:   # volle plaat voor een reeks: k figuren tegelijk
        full = pack(parts, printer, spacing, k)[0]
        write_stl(os.path.join(folder, f'batch_{k}x.stl'), np.concatenate([placed_triangles(*x) for x in full]))
        overview(os.path.join(folder, f'_BATCH_{k}x.png'), [full], printer, f'{name} - {k} figuren op 1 plaat')
    with open(os.path.join(folder, 'plates.json'), 'w', encoding='utf-8') as f: json.dump(res, f, indent=2, ensure_ascii=False)
    lines = [f'{name} - {printer["name"]}', '',
             f'{len(plates)} plaat/platen voor 1 figuur; {k} figuur/figuren passen samen op 1 plaat.' if k else
             f'{len(plates)} platen voor 1 figuur.',
             f'Resin per figuur: ca. {figure_ml} ml (incl. 10% verlies). Printtijd (schatting, {LAYER_MM} mm lagen): '
             f'ca. {res["print_hours"]} u voor 1 figuur.']
    if k > 1: lines.append(f'batch_{k}x.stl: {k} figuren samen op 1 plaat, ca. {res["print_hours_full_plate"]} u (zelfde hoogte, dus zelfde tijd).')
    lines.append('')
    for d in res['plate_details']:
        lines.append(f'plate_{d["plate"]}.stl: {", ".join(d["parts"])} - hoogte {d["height_mm"]} mm, ca. {d["print_hours"]} u, {d["resin_ml"]} ml')
    lines += ['', 'De onderdelen staan zoals de ontwerper ze aanleverde, met de onderkant op de plaat. Supports en het',
              'slicen (belichting, lift) doe je zelf in de slicer; een schuin gezet onderdeel neemt meer plaats in.',
              'Gemaakt door resin_plates.py (maker-agent).']
    open(os.path.join(folder, 'README.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('model_dir')
    ap.add_argument('--files', nargs='*')
    ap.add_argument('--name')
    ap.add_argument('--printer', default='auto', choices=['auto', *PRINTERS])
    ap.add_argument('--out')
    ap.add_argument('--spacing', type=float, default=4.0)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    d = os.path.abspath(a.model_dir)
    files = [os.path.join(d, f) if not os.path.isabs(f) else f for f in a.files] if a.files else sorted(
        os.path.join(dp, f) for dp, dn, fn in os.walk(d) if not dn.__setitem__(slice(None), [x for x in dn if x not in SKIP_DIRS])
        for f in fn if os.path.splitext(f)[1].lower() in MESH_EXT)
    if not files: sys.exit('geen STL/OBJ/3MF gevonden')
    parts = [part_info(f) for f in files]
    name = a.name or os.path.basename(d)
    out = a.out or os.path.join(d, 'PrintReady')
    biggest = max(float(p['size'].max()) for p in parts)
    summary = {'name': name, 'parts': [{'file': os.path.relpath(p['file'], d), 'size_mm': [round(float(x), 1) for x in p['size']],
                                        'volume_ml': round(p['volume_mm3'] / 1000, 2)} for p in parts],
               'size_mm': [round(float(x), 1) for x in np.max([p['size'] for p in parts], axis=0)], 'sets': []}
    too_big = [p for p in parts if not any(fits(p, PRINTERS[k]) for k in PRINTERS)]
    if too_big:
        summary['error'] = 'past op geen enkele printer: ' + ', '.join(
            f'{os.path.basename(p["file"])} ({" x ".join(str(round(float(x))) for x in p["size"])} mm)' for p in too_big)
        print(json.dumps(summary, indent=2, ensure_ascii=False)); sys.exit(2)
    if a.printer != 'auto':
        keys = [a.printer]
    else:
        ok = [k for k in MAIN if all(fits(p, PRINTERS[k]) for p in parts)]
        if not ok:
            keys = ['saturn']   # past enkel op de Saturn (zou niet mogen gebeuren: die is het kleinst)
        else:
            keys = [min(ok, key=lambda k: (len(pack(parts, PRINTERS[k], a.spacing)), MAIN.index(k)))]
        if biggest <= MINI_MM and all(fits(p, PRINTERS['saturn']) for p in parts): keys.append('saturn')
    summary['miniature'] = biggest <= MINI_MM
    for k in keys:
        summary['sets'].append(make_set(d, name, k, parts, a.spacing, out, a.dry_run))
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
