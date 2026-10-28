"""upscale_print.py - Wall Art-print met een te lage resolutie vergroten met Real-ESRGAN (maker-agent).

Een poster wordt tot 30x40 cm (XL) geprint; voor een scherp resultaat willen we minstens ~150 dpi, dus een korte zijde
van MIN_SHORT_PX pixels. Is de print kleiner, dan wordt hij 4x vergroot met Real-ESRGAN (model realesrgan-x4plus,
in de container onder /opt/realesrgan; Vulkan op de Intel-GPU van de NAS) en naast het origineel bewaard als
<naam>_upscaled.png. Het origineel blijft staan; een bestaand _upscaled-bestand wordt niet overschreven.
AI-upscaling verzint details bij: kijk het resultaat na (tekst, gezichten, fijne lijnen) voor je het print.
Printbestand = de enige afbeelding in de map die geen mockup_ of _upscaled is (anders --print <bestand>).
--update-doc: in het productdocument van het ontwerp (_catalog/products/<id>.json, source_path = de map) het vergrote
bestand als printbestand zetten (variations[].production.files) + een notitie; daarna publish_docs.py.
    python3 upscale_print.py "UV-Print/Posters-Quotes/LifeIsABitch" [...] [--print <bestand>] [--update-doc] [--dry-run]"""
import glob, json, os, re, shutil, subprocess, sys, time
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

ROOT = supa.MAKER_ROOT
BIN = os.environ.get('REALESRGAN_BIN', '/opt/realesrgan/realesrgan-ncnn-vulkan')
MODELS = os.path.join(os.path.dirname(BIN), 'models')
MIN_SHORT_PX = 1800          # ~150 dpi op de korte zijde van 30 cm (XL)
SUFFIX = '_upscaled'
IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp')
TIMEOUT_S = 3600


def candidates(folder):
    return sorted(f for f in os.listdir(folder) if f.lower().endswith(IMAGE_EXT) and not f.lower().startswith('mockup_')
                  and SUFFIX not in os.path.splitext(f)[0].lower() and os.path.isfile(os.path.join(folder, f)))


def upscale(src, dst):
    """Real-ESRGAN x4; geeft (seconden, gebruikt apparaat) terug."""
    t = time.time()
    tmp = dst + '.part.png'
    r = subprocess.run([BIN, '-i', src, '-o', tmp, '-n', 'realesrgan-x4plus', '-m', MODELS, '-f', 'png'],
                       capture_output=True, text=True, timeout=TIMEOUT_S)
    out = (r.stdout + r.stderr)
    if r.returncode != 0 or not os.path.exists(tmp):
        if os.path.exists(tmp): os.remove(tmp)
        raise RuntimeError(out.strip().splitlines()[-1] if out.strip() else f'code {r.returncode}')
    os.replace(tmp, dst)
    device = next((m.group(1) for m in [re.search(r'\[0 (.+?)\]', out)] if m), 'onbekend')
    return round(time.time() - t), device


def update_doc(folder, print_rel, new_rel, size_from, size_to, dry):
    rel = os.path.relpath(folder, ROOT).replace(os.sep, '/')
    for fn in glob.glob(os.path.join(ROOT, '_catalog', 'products', '*.json')):
        doc = json.load(open(fn, encoding='utf-8'))
        if doc.get('source_path', '').strip('/') != rel: continue
        changed = False
        for v in doc.get('variations', []):
            files = (v.get('production') or {}).get('files') or []
            if print_rel in files:
                v['production']['files'] = [new_rel if f == print_rel else f for f in files]; changed = True
        if not changed:
            done = any(new_rel in ((v.get('production') or {}).get('files') or []) for v in doc.get('variations', []))
            return f'{rel}: ' + ('document had het vergrote printbestand al' if done
                                 else f'document verwijst niet naar {os.path.basename(print_rel)}, niet aangepast')
        if dry: return f'{rel}: document {os.path.basename(fn)} zou {os.path.basename(new_rel)} als printbestand krijgen'
        if not os.path.exists(fn + '.bak-upscale'): shutil.copy2(fn, fn + '.bak-upscale')
        doc.setdefault('notes_internal', []).append(
            f'Print file upscaled 4x with Real-ESRGAN ({size_from[0]}x{size_from[1]} -> {size_to[0]}x{size_to[1]} px): '
            f'{os.path.basename(new_rel)}. AI upscaling invents detail -- check text/faces before printing. Original kept.')
        tmp = fn + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f: json.dump(doc, f, ensure_ascii=False, indent=1)
        os.replace(tmp, fn)
        return f'{rel}: printbestand in document {os.path.basename(fn)} is nu {os.path.basename(new_rel)} (nu publish_docs.py)'
    return f'{rel}: geen productdocument gevonden'


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args; with_doc = '--update-doc' in args
    chosen = args[args.index('--print') + 1] if '--print' in args else None
    folders = [a for i, a in enumerate(args) if not a.startswith('--') and not (i and args[i - 1] == '--print')]
    if not folders: print(__doc__); sys.exit(1)
    if not dry and not os.path.exists(BIN): print(f'upscale_print: {BIN} ontbreekt (container opnieuw bouwen)'); sys.exit(1)
    done = 0
    for rel in folders:
        folder = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        if not os.path.isdir(folder): print(f'{rel}: map bestaat niet'); continue
        imgs = candidates(folder)
        name = chosen or (imgs[0] if len(imgs) == 1 else None)
        if not name:
            print(f'{rel}: ' + (f'meerdere afbeeldingen ({", ".join(imgs)}), geef het printbestand op met --print'
                                if imgs else 'geen afbeelding gevonden')); continue
        src = os.path.join(folder, name)
        if not os.path.isfile(src): print(f'{rel}: {name} bestaat niet'); continue
        w, h = Image.open(src).size
        dst = os.path.join(folder, os.path.splitext(name)[0] + SUFFIX + '.png')
        if min(w, h) >= MIN_SHORT_PX:
            print(f'{rel}: {name} is {w}x{h} px, groot genoeg'); continue
        if os.path.exists(dst):
            print(f'{rel}: {os.path.basename(dst)} bestaat al')
        elif dry:
            print(f'{rel}: {name} ({w}x{h}) -> {os.path.basename(dst)} ({w * 4}x{h * 4})')
        else:
            secs, device = upscale(src, dst)
            done += 1
            print(f'{rel}: {name} {w}x{h} -> {os.path.basename(dst)} {w * 4}x{h * 4} ({secs} s op {device})')
        if with_doc:
            base = os.path.relpath(folder, ROOT).replace(os.sep, '/')
            print(update_doc(folder, f'{base}/{name}', f'{base}/{os.path.basename(dst)}', (w, h), Image.open(dst).size if os.path.exists(dst) else (w * 4, h * 4), dry))
    print(f'upscale_print: {done} print{"" if done == 1 else "s"} vergroot' + (' (droge test)' if dry else ''))


if __name__ == '__main__':
    main()
