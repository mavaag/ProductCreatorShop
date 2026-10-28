"""shop_links.py - catalogusmodellen die een gepubliceerd shopproduct zijn, mee in _Shop zetten (maker-agent op de NAS).

Regel (2026-10-28): de Catalogus is de volledige bibliotheek; _Shop bevat enkel wat in de shop staat. Een model gaat
pas naar _Shop als zijn product in de beheertool gepubliceerd is. Producten waarvan de bestanden al in _Shop stonden
(de oude PRODUCTS-map, door shop_import.py naar de bibliotheek gekopieerd) worden hier automatisch aan hun model
gekoppeld zodra je hun map bevestigt (product_files) -- zie link_imported().

Een shopproduct hoort bij een catalogusmodel als het vanuit de Catalogus aangemaakt is (maker_picks.product_id) of als je
het model aan een bestaand WooCommerce-product gekoppeld hebt (maker_woo_links; WooCommerce-id -> SKU via
_catalog/woo_products.json -> product in de beheertool). Per koppeling:
  - kopieert de modelmap naar _Shop/<techniek>/<categorie>/<naam> -- enkel nieuwe/gewijzigde bestanden, er wordt nooit
    iets verwijderd of in de catalogus aangepast; latere LaserReady/PrintReady-sets komen bij een volgende ronde mee;
  - schrijft product_files (source 'catalog', confirmed, model_id), zodat Productie en de productenlijst de map tonen.
Heeft het product al een eigen bevestigde map (bestaand shopproduct), dan wordt niet gekopieerd: enkel de koppeling met
het model wordt bewaard (path = de modelmap in de catalogus). Een eenmaal gekozen _Shop-map blijft dezelfde. Wordt
een product later offline gehaald, dan blijft zijn map in _Shop staan (er wordt nooit iets verwijderd).
agent.py roept dit elke 10 minuten aan.
    python3 shop_links.py [--dry-run]"""
import csv, hashlib, html, json, os, re, shutil, sys, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

ROOT = supa.MAKER_ROOT
TECH_DIR = {'laser': 'LaserCutting', 'fdm': '3DPrinting', 'resin': 'ResinPrinting',
            'uv': 'UVPrinting', 'engraving': 'Engraving', 'sublimation': 'Sublimatie'}
PROCESS_DIR = {'3d_print': '3DPrinting', 'resin_print': 'ResinPrinting', 'laser_cutting': 'LaserCutting',
               'uv_print': 'UVPrinting', 'laser_engraving': 'Engraving', 'sublimation': 'Sublimatie'}
SKIP = re.compile(r'^(\.|@eaDir$|#Recycle$|desktop\.ini$|thumbs\.db$)', re.I)
MARKER = '.catalog-model'   # in de _Shop-map: id van het model, zodat een bestaande map met dezelfde naam herkend wordt


def safe(name):
    return re.sub(r'[<>:"/\\|?*]+', '-', name).strip(' .-') or 'Product'


def folder_name(name):
    """Mapnaam voor een product: de naam tot '|' of '–' ("Geometric Rhino Trophy – Precision ..." -> "Geometric Rhino
    Trophy"), maar niet als het deel vóór '–' maar een algemene aanduiding is ("Wall Art – Batman (...)" bleef anders
    voor elke poster "Wall Art")."""
    base = html.unescape(name).split('|')[0].strip()
    head = base.split('–')[0].strip()
    return head if len(head.split()) > 2 else base


def woo_shop():
    try:
        shop = json.load(open(os.path.join(ROOT, '_catalog', 'woo_products.json'), encoding='utf-8'))
        return shop.get('products', shop) if isinstance(shop, dict) else shop
    except (OSError, ValueError):
        return []


def import_map():
    """_Shop-map -> model in de bibliotheek, uit het plan van shop_import.py (gekopieerd of al in de catalogus)."""
    out = {}
    try: rows = list(csv.DictReader(open(os.path.join(ROOT, '_catalog', 'shop_import_plan.csv'), encoding='utf-8-sig'), delimiter=';'))
    except OSError: return out
    for r in rows:
        if r['actie'].strip().lower() == 'kopie': out[r['bron']] = r['doel'].strip().strip('/')
        elif r['opmerking'].startswith('staat al in de catalogus: '): out[r['bron']] = r['opmerking'].split(': ', 1)[1]
    return out


def link_imported(dry):
    """Bevestigde _Shop-map van een product (product_files) -> zijn model in de bibliotheek koppelen (maker_woo_links),
    zodat het product in de Catalogus onder "Al in de shop" staat. Een bestaande koppeling van een model blijft."""
    imported = import_map()
    if not imported: return 0
    files = supa.rest('GET', 'product_files?select=product_id,path&confirmed=is.true&source=neq.catalog') or []
    if not files: return 0
    model_ids = {r['id'] for r in supa.select_all('maker_models', 'id')}
    linked = {r['model_id'] for r in supa.rest('GET', 'maker_woo_links?select=model_id') or []}
    products = {p['id']: p for p in supa.select_all('products', 'id,sku,name')}
    woo_by_sku = {w['sku']: w for w in woo_shop() if w.get('sku')}
    rows = []
    for f in files:
        p = products.get(f['product_id'])
        w = woo_by_sku.get((p or {}).get('sku'))
        if not w: continue                                              # nog niet in WooCommerce
        for src, model_path in imported.items():
            if not (f['path'] == src or f['path'].startswith(src + '/')): continue
            mid = hashlib.sha1(os.fsencode(model_path)).hexdigest()[:12]   # zelfde id als build_catalog.py
            if mid not in model_ids or mid in linked: continue
            linked.add(mid)
            rows.append({'model_id': mid, 'woo_product_id': w['id'], 'woo_name': w['name'], 'woo_permalink': w.get('permalink')})
            if dry: print(f'koppel model {model_path}  ->  {w["name"][:50]}')
    if rows and not dry:
        supa.rest('POST', 'maker_woo_links?on_conflict=model_id', rows, prefer='resolution=ignore-duplicates,return=minimal')
    return len(rows)


def links():
    """[(product_id, model_id)] uit maker_picks en maker_woo_links."""
    out = [(p['product_id'], p['model_id']) for p in supa.rest('GET', 'maker_picks?select=model_id,product_id&product_id=not.is.null') or []]
    woo = supa.rest('GET', 'maker_woo_links?select=model_id,woo_product_id') or []
    if woo:
        shop = woo_shop()
        sku_by_woo = {p['id']: p.get('sku') for p in shop if p.get('sku')}
        skus = sorted({sku_by_woo[w['woo_product_id']] for w in woo if w['woo_product_id'] in sku_by_woo})
        prod = supa.rest('GET', 'products?select=id,sku&sku=in.(' + ','.join(urllib.parse.quote(f'"{s}"') for s in skus) + ')') if skus else []
        pid_by_sku = {p['sku']: p['id'] for p in prod or []}
        var = supa.rest('GET', 'product_variations?select=product_id,sku&sku=in.(' + ','.join(urllib.parse.quote(f'"{s}"') for s in skus) + ')') if skus else []
        for v in var or []: pid_by_sku.setdefault(v['sku'], v['product_id'])
        for w in woo:
            pid = pid_by_sku.get(sku_by_woo.get(w['woo_product_id']))
            if pid: out.append((pid, w['model_id']))
    return list(dict.fromkeys(out))


def owner(full):
    """None als de map nog niet bestaat, anders het model-id uit de marker ('' = map die niet van ons is)."""
    if not os.path.isdir(full): return None
    try: return open(os.path.join(full, MARKER), encoding='utf-8').read().strip()
    except OSError: return ''


def copy_tree(src, dst, skip=()):
    """Nieuwe/gewijzigde bestanden van src naar dst; niets verwijderen. skip = namen van submappen direct onder src die
    niet meegaan. Geeft het aantal gekopieerde bestanden."""
    n = 0
    for dp, dn, fn in os.walk(src):
        dn[:] = [d for d in dn if not SKIP.match(d) and not (dp == src and d in skip)]
        rel = os.path.relpath(dp, src)
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for f in fn:
            if SKIP.match(f): continue
            s, d = os.path.join(dp, f), os.path.join(dst, rel, f)
            st = os.stat(s)
            if os.path.exists(d):
                dt = os.stat(d)
                if dt.st_size == st.st_size and int(dt.st_mtime) >= int(st.st_mtime): continue
            shutil.copy2(s, d); n += 1
    return n


def main():
    dry = '--dry-run' in sys.argv
    n = link_imported(dry)
    if n: print(f'shop_links: {n} geïmporteerde modellen gekoppeld aan hun shopproduct')
    pairs = links()
    if not pairs: print('shop_links: geen gekoppelde catalogusmodellen'); return
    pids = sorted({p for p, _ in pairs}); mids = sorted({m for _, m in pairs})
    products = {p['id']: p for p in supa.rest('GET', f'products?select=id,name,categories,process_type,published&id=in.({",".join(pids)})') or []}
    models = {m['id']: m for m in supa.rest('GET', f'maker_models?select=id,title,path,technique,collection&id=in.({",".join(mids)})') or []}
    files = supa.rest('GET', f'product_files?select=product_id,path,source,confirmed,model_id&product_id=in.({",".join(pids)})') or []
    per_product = {}
    for pid, mid in pairs: per_product[pid] = per_product.get(pid, 0) + 1
    copied = 0
    for pid, mid in pairs:
        p, m = products.get(pid), models.get(mid)
        if not p or not m: continue
        mine = [f for f in files if f['product_id'] == pid]
        current = next((f for f in mine if f['source'] == 'catalog' and f.get('model_id') == mid), None)
        own = any(f['confirmed'] and f['source'] != 'catalog' for f in mine)
        src = os.path.join(ROOT, m['path'])
        if current and not current['path'].startswith('_Shop/'):
            continue                                                    # bestaand product: enkel de koppeling
        if not p.get('published') and not own:
            continue                                                    # pas naar _Shop bij publiceren
        if own and not current:
            dest = m['path']                                            # eigen map bestaat al: niet kopiëren
        elif current:
            dest = current['path']
        else:
            tech = TECH_DIR.get(m.get('technique')) or PROCESS_DIR.get(p['process_type'], '3DPrinting')
            cat = (p.get('categories') or '').split(',')[0].split('>')[-1].strip() or m.get('collection') or 'Catalogus'
            dest = f'_Shop/{tech}/{safe(cat)}/{safe(folder_name(p["name"]))}'
            if per_product[pid] > 1: dest += f'/{safe(m["title"])}'       # meerdere modellen bij één product: submap per model
            if owner(os.path.join(ROOT, dest)) not in (None, mid):
                dest += ' (catalogus)'                                  # er staat al een andere map met die naam
        if dest.startswith('_Shop/') and os.path.isdir(src):
            full = os.path.join(ROOT, dest)
            if dry: print(f'kopie  {m["path"]}  ->  {dest}')
            else:
                os.makedirs(full, exist_ok=True)
                with open(os.path.join(full, MARKER), 'w') as fh: fh.write(mid)
                copied += copy_tree(src, full)
        if not current and not dry:
            # voorstellen van match_shop_files.py blijven staan: bij een bestaand product kan daar de echte map tussen zitten
            supa.rest('POST', 'product_files?on_conflict=product_id,path',
                      [{'product_id': pid, 'path': dest, 'source': 'catalog', 'confirmed': True, 'model_id': mid, 'score': 0}],
                      prefer='resolution=merge-duplicates,return=minimal')
        if dry and not dest.startswith('_Shop/'): print(f'koppel {p["name"][:40]}  ->  {dest} (eigen map bestaat al)')
    print(f'shop_links: {len(pairs)} gekoppelde producten, {copied} bestanden gekopieerd naar _Shop')


if __name__ == '__main__':
    main()
