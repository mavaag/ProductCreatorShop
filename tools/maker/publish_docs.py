"""publish_docs.py - zet de productdocumenten uit _catalog/products/<id>.json in Supabase (maker_models.doc).

De foto's uit het document (paden binnen MakerProducts) worden verkleind (max. 1600 px, JPEG) en in de publieke
bucket "product-images" gezet onder maker/<id>/; hun URL's komen in doc.product.image_urls. "Maak product" in de
Catalogus-pagina neemt die URL's over, en bij de WooCommerce-sync downloadt WooCommerce ze zelf.
    python3 publish_docs.py            # enkel nieuwe/gewijzigde documenten
    python3 publish_docs.py <id> ...   # enkel deze modellen (altijd opnieuw)"""
import datetime, glob, hashlib, io, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa
from PIL import Image

MAX_PX = 1600


def photo_bytes(fn):
    im = Image.open(fn)
    im.thumbnail((MAX_PX, MAX_PX))
    if im.mode in ('RGBA', 'LA', 'P'):                 # transparante PNG's op wit zetten
        im = im.convert('RGBA'); bg = Image.new('RGB', im.size, 'white'); bg.paste(im, mask=im.split()[-1]); im = bg
    out = io.BytesIO(); im.convert('RGB').save(out, 'JPEG', quality=85, optimize=True)
    return out.getvalue()


def main():
    only = set(a for a in sys.argv[1:] if not a.startswith('-'))
    files = sorted(glob.glob(os.path.join(supa.MAKER_ROOT, '_catalog', 'products', '*.json')))
    known = {r['id']: r for r in supa.select_all('maker_models', 'id,doc->>_source_md5')}
    done, skipped, missing = 0, 0, []
    for fn in files:
        cid = os.path.splitext(os.path.basename(fn))[0]
        if only and cid not in only: continue
        if cid not in known: missing.append(cid); continue
        raw = open(fn, 'rb').read(); md5 = hashlib.md5(raw).hexdigest()
        if not only and known[cid].get('_source_md5') == md5: skipped += 1; continue
        doc = json.loads(raw)
        photos = [p for p in doc['product']['images'] if not p.startswith('_catalog/thumbs/')] or doc['product']['images']
        urls = []
        for i, rel in enumerate(photos):
            src = os.path.join(supa.MAKER_ROOT, rel)
            if not os.path.exists(src): print(f'  {cid}: foto ontbreekt: {rel}'); continue
            urls.append(supa.upload('product-images', f'maker/{cid}/{i + 1}.jpg', photo_bytes(src), 'image/jpeg'))
        doc['product']['image_urls'] = urls
        doc['_source_md5'] = md5
        supa.rest('PATCH', f'maker_models?id=eq.{cid}', {'doc': doc, 'doc_updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat()},
                  prefer='return=minimal')
        done += 1
        print(f'  {cid} {doc["product"]["name"][:60]} ({len(urls)} foto\'s)')
    print(f'{done} documenten gepubliceerd, {skipped} ongewijzigd'
          + (f', {len(missing)} zonder model in Supabase (eerst sync_catalog.py): {", ".join(missing[:10])}' if missing else ''))


if __name__ == '__main__':
    main()
