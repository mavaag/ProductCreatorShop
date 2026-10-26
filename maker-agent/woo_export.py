"""woo_export.py - actuele lijst van de WooCommerce-producten voor de agent (alleen lezen).

Schrijft /volume1/MakerProducts/_catalog/woo_products.json: per product id, naam, sku, status, link, categorieën en
foto's (URL + bestandsnaam). agent.py roept dit aan voor elke opdracht, zodat de agent kan nakijken of een model al
in de shop staat -- ook producten die je net live gezet hebt.
Gebruikt een WooCommerce REST-sleutel met enkel leesrechten uit agent.env: WOO_URL, WOO_KEY, WOO_SECRET.
    python3 woo_export.py"""
import base64, datetime, json, os, sys, urllib.parse, urllib.request

OUT = os.path.join(os.environ.get('MAKER_ROOT', '/volume1/MakerProducts'), '_catalog', 'woo_products.json')
FIELDS = 'id,name,sku,status,permalink,type,categories,images,date_modified'


def fetch_all(url, key, secret):
    auth = 'Basic ' + base64.b64encode(f'{key}:{secret}'.encode()).decode()
    out, page = [], 1
    while True:
        q = urllib.parse.urlencode({'per_page': 100, 'page': page, 'status': 'any', '_fields': FIELDS})
        req = urllib.request.Request(f'{url.rstrip("/")}/wp-json/wc/v3/products?{q}',
                                     headers={'Authorization': auth, 'User-Agent': 'maker-agent'})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.loads(r.read())
            pages = int(r.headers.get('X-WP-TotalPages', '1'))
        out += rows
        if page >= pages or not rows: return out
        page += 1


def main():
    url, key, secret = (os.environ.get(k) for k in ('WOO_URL', 'WOO_KEY', 'WOO_SECRET'))
    if not (url and key and secret):
        print('woo_export: WOO_URL/WOO_KEY/WOO_SECRET ontbreken in agent.env -- shoplijst niet bijgewerkt')
        return 1
    rows = fetch_all(url, key, secret)
    products = [{
        'id': p['id'], 'name': p['name'], 'sku': p.get('sku', ''), 'status': p['status'], 'type': p.get('type'),
        'permalink': p.get('permalink'), 'categories': [c['name'] for c in p.get('categories', [])],
        'images': [{'src': i['src'], 'file': os.path.basename(urllib.parse.urlparse(i['src']).path)} for i in p.get('images', [])],
        'date_modified': p.get('date_modified'),
    } for p in rows]
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump({'exported_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'count': len(products),
                   'products': products}, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)
    print(f'woo_export: {len(products)} shopproducten -> {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
