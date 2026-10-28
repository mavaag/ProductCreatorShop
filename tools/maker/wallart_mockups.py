"""wallart_mockups.py - mockups van een Wall Art-poster maken met de mockup-templates van de beheertool (maker-agent).

Voor elk ontwerp (een map in UV-Print/<collectie>/<ontwerp>) wordt het printbestand in perspectief in het kader van
elke UV-template geplaatst die in de mockup-generator op "Gebruik voor Wall Art" staat (mockup_templates.wall_art,
migratie 028). Het resultaat komt in de ontwerpmap als mockup_<template>.jpg; dat zijn de productfoto's.
Bestaat zo'n bestand al, dan wordt het niet overschreven (verwijder het zelf om het opnieuw te laten maken).
Printbestand = de enige afbeelding in de map die geen mockup_ is; staan er meerdere (bv. ook kamerfoto's van de
ontwerper), dan moet je het printbestand opgeven met --print <bestand> (de grootste is niet altijd de print).
Heeft de print een andere verhouding dan het kader, dan wordt ze in het midden bijgesneden (zoals bij het printen
op 20x30 / 30x40), niet uitgerekt.
--update-doc: de mockups (eerst) in de foto's van het productdocument van het ontwerp zetten (_catalog/products/<id>.json,
met source_path = de ontwerpmap); daarna publish_docs.py, dan komen ze in de Catalogus. Voor posters die al een
document hadden voor er mockups waren.
    python3 wallart_mockups.py "UV-Print/Posters-Characters/Batman" [...] [--print <bestand>] [--update-doc] [--dry-run]"""
import glob, io, json, math, os, re, shutil, sys, urllib.request
import numpy as np
from PIL import Image, ImageOps
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

ROOT = supa.MAKER_ROOT
IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp')
PREFIX = 'mockup_'


def templates():
    return supa.rest('GET', 'mockup_templates?select=id,name,room_image_url,corners,shape'
                            '&technique=eq.uv&wall_art=is.true&order=name') or []


def fetch(url):
    """Kamerfoto uit de opslag van Supabase; via het interne adres (de publieke URL is van buitenaf)."""
    if '/storage/v1/' in url: url = supa.URL.rstrip('/') + '/storage/v1/' + url.split('/storage/v1/', 1)[1]
    req = urllib.request.Request(url, headers={'apikey': supa.KEY, 'Authorization': f'Bearer {supa.KEY}'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return Image.open(io.BytesIO(r.read()))


def candidates(folder):
    return sorted(f for f in os.listdir(folder) if f.lower().endswith(IMAGE_EXT) and not f.lower().startswith(PREFIX)
                  and os.path.isfile(os.path.join(folder, f)))


def perspective_coeffs(dst, src):
    """Coëfficiënten voor Image.transform(PERSPECTIVE): punt in de kamerfoto (dst) -> punt in de print (src)."""
    a = []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    return np.linalg.solve(np.array(a, dtype=float), np.array([c for p in src for c in p], dtype=float)).tolist()


def render(room, poster, corners):
    room = ImageOps.exif_transpose(room).convert('RGB')
    w, h = room.size
    quad = [(c['x'] * w, c['y'] * h) for c in corners]   # linksboven, rechtsboven, rechtsonder, linksonder
    # verhouding van het kader (gemiddelde breedte / hoogte) -> print in het midden daarop bijsnijden
    d = lambda a, b: math.dist(quad[a], quad[b])
    ratio = (d(0, 1) + d(3, 2)) / max(d(0, 3) + d(1, 2), 1)
    poster = ImageOps.exif_transpose(poster)
    if abs(poster.width / poster.height - ratio) > 0.01:
        poster = ImageOps.fit(poster, (round(poster.height * ratio), poster.height) if poster.width / poster.height > ratio
                              else (poster.width, round(poster.width / ratio)), Image.LANCZOS)
    # print niet groter dan nodig (het kader in de kamerfoto), dan gaat het warpen vlot
    side = max(abs(quad[1][0] - quad[0][0]), abs(quad[2][1] - quad[1][1]), 1) * 2
    poster = poster.convert('RGBA')
    if max(poster.size) > side: poster.thumbnail((side, side), Image.LANCZOS)
    pw, ph = poster.size
    coeffs = perspective_coeffs(quad, [(0, 0), (pw, 0), (pw, ph), (0, ph)])
    warped = poster.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    room.paste(warped, (0, 0), warped)
    return room


def safe(name):
    return re.sub(r'[^A-Za-z0-9]+', '-', name).strip('-') or 'template'


def update_doc(rel, folder, dry):
    """Mockups van deze ontwerpmap vooraan in doc.product.images zetten (backup .bak-mockups); geeft een melding."""
    rel = os.path.relpath(folder, ROOT).replace(os.sep, '/')
    mocks = [f'{rel}/{f}' for f in sorted(os.listdir(folder)) if f.lower().startswith(PREFIX) and f.lower().endswith(IMAGE_EXT)]
    for fn in glob.glob(os.path.join(ROOT, '_catalog', 'products', '*.json')):
        doc = json.load(open(fn, encoding='utf-8'))
        if doc.get('source_path', '').strip('/') != rel: continue
        old = doc['product'].get('images') or []
        new = mocks + [i for i in old if i not in mocks]
        if new == old: return f'{rel}: document had de mockups al'
        if dry: return f'{rel}: document {os.path.basename(fn)} zou {len(mocks)} mockups krijgen'
        if not os.path.exists(fn + '.bak-mockups'): shutil.copy2(fn, fn + '.bak-mockups')
        doc['product']['images'] = new
        tmp = fn + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f: json.dump(doc, f, ensure_ascii=False, indent=1)
        os.replace(tmp, fn)
        return f'{rel}: {len(mocks)} mockups in document {os.path.basename(fn)} (nu publish_docs.py)'
    return f'{rel}: geen productdocument gevonden'


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args
    chosen = args[args.index('--print') + 1] if '--print' in args else None
    folders = [a for i, a in enumerate(args) if not a.startswith('--') and not (i and args[i - 1] == '--print')]
    with_doc = '--update-doc' in args
    if not folders: print(__doc__); sys.exit(1)
    tpl = templates()
    if not tpl:
        print('wallart_mockups: geen templates op "Gebruik voor Wall Art" (Mockup-generator > UV-print)'); return
    rooms = {}
    made = 0
    for rel in folders:
        folder = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        if not os.path.isdir(folder): print(f'{rel}: map bestaat niet'); continue
        imgs = candidates(folder)
        name = chosen or (imgs[0] if len(imgs) == 1 else None)
        if not name:
            print(f'{rel}: ' + (f'meerdere afbeeldingen ({", ".join(imgs)}), geef het printbestand op met --print'
                                if imgs else 'geen afbeelding gevonden')); continue
        if not os.path.isfile(os.path.join(folder, name)): print(f'{rel}: {name} bestaat niet'); continue
        poster = Image.open(os.path.join(folder, name))
        for t in tpl:
            if t.get('shape') == 'ellipse': print(f'{rel}: template {t["name"]} is rond, overgeslagen'); continue
            out = os.path.join(folder, f'{PREFIX}{safe(t["name"])}.jpg')
            if os.path.exists(out): print(f'{rel}: {os.path.basename(out)} bestaat al'); continue
            if dry: print(f'{rel}: {name} -> {os.path.basename(out)}'); continue
            if t['id'] not in rooms: rooms[t['id']] = fetch(t['room_image_url'])
            render(rooms[t['id']], poster, t['corners']).save(out, 'JPEG', quality=90)
            made += 1
            print(f'{rel}: {os.path.basename(out)}')
        if with_doc: print(update_doc(rel, folder, dry))
    print(f'wallart_mockups: {made} mockup{"" if made == 1 else "s"} gemaakt met {len(tpl)} template{"" if len(tpl) == 1 else "s"}'
          + (' (droge test)' if dry else ''))


if __name__ == '__main__':
    main()
