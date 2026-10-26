"""orders_sync.py - WooCommerce-bestellingen automatisch naar de beheertool (draait in de maker-agent op de NAS).

Doet hetzelfde als de knop "Synchroniseer bestellingen" (app/api/woocommerce/orders-sync): haalt nieuwe/gewijzigde
bestellingen op sinds de cursor "last_order_sync_at" in settings en schrijft wc_orders + wc_order_items. agent.py roept
dit elke ORDERS_SYNC_MIN minuten aan. Gebruikt de WooCommerce-sleutel met leesrechten uit agent.env (WOO_URL, WOO_KEY,
WOO_SECRET) en de service-key van Supabase (supa.py).
    python3 orders_sync.py          # incrementeel
    python3 orders_sync.py --full   # volledige historiek opnieuw"""
import base64, datetime, json, os, sys, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

CURSOR = 'last_order_sync_at'


def woo_get(path, params):
    url, key, secret = (os.environ.get(k) for k in ('WOO_URL', 'WOO_KEY', 'WOO_SECRET'))
    if not (url and key and secret): raise RuntimeError('WOO_URL/WOO_KEY/WOO_SECRET ontbreken in agent.env')
    auth = 'Basic ' + base64.b64encode(f'{key}:{secret}'.encode()).decode()
    req = urllib.request.Request(f'{url.rstrip("/")}/wp-json/wc/v3/{path}?{urllib.parse.urlencode(params)}',
                                 headers={'Authorization': auth, 'User-Agent': 'maker-agent'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def line_meta(li):
    """Zichtbare opties van een bestelregel (variant, personalisatie); interne sleutels (_...) niet."""
    out = []
    for m in li.get('meta_data') or []:
        if str(m.get('key', '')).startswith('_'): continue
        v = m.get('display_value', m.get('value'))
        if isinstance(v, (dict, list)): v = json.dumps(v, ensure_ascii=False)
        out.append({'key': str(m.get('display_key') or m.get('key')), 'value': str(v)})
    return out


def order_row(o):
    b, s = o.get('billing') or {}, o.get('shipping') or {}
    name = ' '.join(x for x in (s.get('first_name') or b.get('first_name'), s.get('last_name') or b.get('last_name')) if x)
    return {
        'wc_order_id': o['id'], 'order_number': str(o.get('number') or o['id']), 'status': o['status'],
        'currency': o.get('currency') or 'EUR', 'total': float(o.get('total') or 0),
        'date_created': o['date_created_gmt'] + 'Z', 'date_modified': o['date_modified_gmt'] + 'Z',
        'customer_name': name, 'customer_note': o.get('customer_note') or '',
        'shipping_method': ', '.join(x.get('method_title', '') for x in o.get('shipping_lines') or []),
    }


def main():
    full = '--full' in sys.argv
    after = None
    if not full:
        cur = supa.rest('GET', f'settings?key=eq.{CURSOR}&select=value') or []
        if cur and isinstance(cur[0]['value'], str):
            t = datetime.datetime.fromisoformat(cur[0]['value'].replace('Z', '+00:00')) - datetime.timedelta(minutes=1)
            after = t.isoformat().replace('+00:00', 'Z')
    latest, fetched, page = after, 0, 1
    while True:
        params = {'per_page': 100, 'page': page, 'orderby': 'date', 'order': 'asc', 'status': 'any'}
        if after: params['modified_after'] = after
        orders = woo_get('orders', params)
        if not orders: break
        fetched += len(orders)
        saved = supa.rest('POST', 'wc_orders?on_conflict=wc_order_id&select=id,wc_order_id', [order_row(o) for o in orders],
                          prefer='resolution=merge-duplicates,return=representation') or []
        ids = {r['wc_order_id']: r['id'] for r in saved}
        if ids:   # regels telkens volledig vervangen (WooCommerce laat wijzigen achteraf toe)
            supa.rest('DELETE', 'wc_order_items?order_id=in.(' + ','.join(ids.values()) + ')', prefer='return=minimal')
        items = [{'order_id': ids[o['id']], 'wc_line_id': li.get('id'), 'wc_product_id': li.get('product_id') or None,
                  'wc_variation_id': li.get('variation_id') or None, 'sku': li.get('sku') or None, 'name': li['name'],
                  'quantity': li.get('quantity') or 0, 'total': float(li.get('total') or 0), 'meta': line_meta(li)}
                 for o in orders if o['id'] in ids for li in o.get('line_items') or []]
        if items: supa.rest('POST', 'wc_order_items', items, prefer='return=minimal')
        for o in orders:
            m = o['date_modified_gmt'] + 'Z'
            if not latest or m > latest: latest = m
        if len(orders) < 100: break
        page += 1
    if latest:
        supa.rest('POST', 'settings?on_conflict=key', [{'key': CURSOR, 'value': latest}], prefer='resolution=merge-duplicates,return=minimal')
    print(f'bestellingen: {fetched} nieuw/gewijzigd')


if __name__ == '__main__':
    main()
