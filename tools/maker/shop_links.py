"""shop_links.py - shopproducten aan hun catalogusmodel koppelen (maker-agent op de NAS, elke 10 minuten).

Regel (gebruiker, 2026-10-29): alles blijft in de Catalogus. De productiebestanden van een shopproduct zijn de map van
zijn catalogusmodel; er wordt niets meer naar _Shop gekopieerd (die map is enkel nog het oude archief).

Een shopproduct hoort bij een catalogusmodel als
  - het vanuit de Catalogus aangemaakt is (maker_picks.product_id), of
  - je het model aan een bestaand WooCommerce-product koppelde (maker_woo_links; WooCommerce-id -> SKU via
    _catalog/woo_products.json -> product in de beheertool).
Per koppeling schrijft dit script een product_files-rij (path = de modelmap, source 'catalog', confirmed, model_id),
zodat Productie, de productpagina en de productenlijst de map tonen. Omgekeerd: bevestig je op de productpagina een map
die een catalogusmodel is (of wijst "Map koppelen" naar een model), dan wordt dat model hier aan het WooCommerce-product
gekoppeld (maker_woo_links), zodat het in de Catalogus onder "Al in de shop" staat -- zie link_confirmed().
Er wordt nooit iets op de NAS gekopieerd, verplaatst of verwijderd.
    python3 shop_links.py [--dry-run]"""
import json, os, sys, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

ROOT = supa.MAKER_ROOT


def woo_shop():
    try:
        shop = json.load(open(os.path.join(ROOT, '_catalog', 'woo_products.json'), encoding='utf-8'))
        return shop.get('products', shop) if isinstance(shop, dict) else shop
    except (OSError, ValueError):
        return []


def link_confirmed(dry):
    """Bevestigde productmap die een catalogusmodel is (product_files.model_id) -> dat model aan het WooCommerce-product
    koppelen (maker_woo_links). Een bestaande koppeling van een model blijft."""
    files = supa.rest('GET', 'product_files?select=product_id,model_id&confirmed=is.true&model_id=not.is.null') or []
    if not files: return 0
    linked = {r['model_id'] for r in supa.rest('GET', 'maker_woo_links?select=model_id') or []}
    products = {p['id']: p for p in supa.select_all('products', 'id,sku')}
    woo_by_sku = {w['sku']: w for w in woo_shop() if w.get('sku')}
    rows = []
    for f in files:
        w = woo_by_sku.get((products.get(f['product_id']) or {}).get('sku'))
        if not w or f['model_id'] in linked: continue                 # nog niet in WooCommerce / al gekoppeld
        linked.add(f['model_id'])
        rows.append({'model_id': f['model_id'], 'woo_product_id': w['id'], 'woo_name': w['name'], 'woo_permalink': w.get('permalink')})
        if dry: print(f'koppel model {f["model_id"]}  ->  {w["name"][:50]}')
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
        quoted = ','.join(urllib.parse.quote(f'"{s}"') for s in skus)
        prod = supa.rest('GET', f'products?select=id,sku&sku=in.({quoted})') if skus else []
        pid_by_sku = {p['sku']: p['id'] for p in prod or []}
        var = supa.rest('GET', f'product_variations?select=product_id,sku&sku=in.({quoted})') if skus else []
        for v in var or []: pid_by_sku.setdefault(v['sku'], v['product_id'])
        for w in woo:
            pid = pid_by_sku.get(sku_by_woo.get(w['woo_product_id']))
            if pid: out.append((pid, w['model_id']))
    return list(dict.fromkeys(out))


def main():
    dry = '--dry-run' in sys.argv
    n = link_confirmed(dry)
    if n: print(f'shop_links: {n} modellen gekoppeld aan hun shopproduct')
    pairs = links()
    if not pairs: print('shop_links: geen gekoppelde catalogusmodellen'); return
    pids = sorted({p for p, _ in pairs}); mids = sorted({m for _, m in pairs})
    models = {m['id']: m for m in supa.rest('GET', f'maker_models?select=id,path&id=in.({",".join(mids)})') or []}
    files = supa.rest('GET', f'product_files?select=product_id,path,model_id,confirmed&product_id=in.({",".join(pids)})') or []
    have = {(f['product_id'], f['model_id']) for f in files if f.get('model_id') and f['confirmed']}
    have |= {(f['product_id'], f['path']) for f in files if f['confirmed']}
    rows = []
    for pid, mid in pairs:
        m = models.get(mid)
        if not m or (pid, mid) in have or (pid, m['path']) in have: continue
        rows.append({'product_id': pid, 'path': m['path'], 'source': 'catalog', 'confirmed': True, 'model_id': mid, 'score': 0})
        if dry: print(f'koppel product {pid}  ->  {m["path"]}')
    if rows and not dry:
        # een voorstel voor dezelfde map wordt zo bevestigd (merge op product_id + path)
        supa.rest('POST', 'product_files?on_conflict=product_id,path', rows, prefer='resolution=merge-duplicates,return=minimal')
    print(f'shop_links: {len(pairs)} gekoppelde producten, {len(rows)} nieuwe productmappen' + (' (droge test)' if dry else ''))


if __name__ == '__main__':
    main()
