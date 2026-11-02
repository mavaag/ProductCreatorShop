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
        'shipping_total': float(o.get('shipping_total') or 0), 'shipping_tax': float(o.get('shipping_tax') or 0),
        'total_tax': float(o.get('total_tax') or 0), 'discount_total': float(o.get('discount_total') or 0),
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
                  'quantity': li.get('quantity') or 0, 'total': float(li.get('total') or 0),
                  'total_tax': float(li.get('total_tax') or 0), 'meta': line_meta(li)}
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
    consume_materials()
    run_promos()


def run_promos():
    """Vangnet voor de dagelijkse kortingscodes (verjaardag, 10e bestelling) van de plugin 3DP Klanten 1.2.0:
    de shop doet per dag maar één keer iets (vanaf 08:00), dus elke 10 minuten aanroepen is onschuldig."""
    try:
        r = woo_get('tdp-run-promos', {})
    except Exception as e:      # plugin (nog) niet geïnstalleerd of shop onbereikbaar
        print(f'kortingscodes overgeslagen: {e}')
        return
    if r.get('ran'):
        print(f"kortingscodes: {len(r.get('sent') or [])} verstuurd")


# ---------- materiaalverbruik (migratie 038) ----------
COUNTS = ('processing', 'on-hold', 'completed')     # bestelling telt: materiaal is (of wordt) gebruikt
RESTORES = ('cancelled', 'refunded', 'failed')      # verbruik terug naar de voorraad


def _ts(v):
    return datetime.datetime.fromisoformat(str(v).replace('Z', '+00:00'))


def _bump(material_id, delta, stock):
    """Voorraad aanpassen (enkel als die bijgehouden wordt: stock_quantity niet leeg)."""
    cur = stock.get(material_id)
    if cur is None: return
    new = round(float(cur) + delta, 4)
    supa.rest('PATCH', f'materials?id=eq.{material_id}', {'stock_quantity': new}, prefer='return=minimal')
    stock[material_id] = new


def consume_materials():
    """Verwerkt elke bestelregel één keer: eerst uit "klaar op voorraad" (product_variations.ready_stock, migratie 039),
    de rest wordt gemaakt en dan gaan de materialen van de variant (kostenopbouw x aantal) van de voorraad.
    Geannuleerde/terugbetaalde/mislukte bestellingen geven beide terug. Werkt op de bestellingen in de database,
    dus ook wat via de knop in de beheertool gesynct werd."""
    try:
        since = supa.rest('GET', 'settings?key=eq.stock_tracking_since&select=value') or []
    except Exception as e:   # migratie 038 nog niet uitgevoerd
        print(f'materiaalverbruik overgeslagen: {e}')
        return
    if not since: return
    since = _ts(since[0]['value'])
    orders = [o for o in supa.select_all('wc_orders', 'id,wc_order_id,status,date_created') if _ts(o['date_created']) >= since]
    if not orders: return
    try:
        # geen id-kolom (sleutel = bestelling + regel), dus niet via select_all (die sorteert op id)
        olsr = supa.rest('GET', f'order_line_stock?select=wc_order_id,wc_line_id,variation_id,from_stock&wc_order_id=in.({",".join(str(o["wc_order_id"]) for o in orders)})') or []
        lines_done = {(r['wc_order_id'], r['wc_line_id']): r for r in olsr}
        has_ready = True
    except Exception:        # migratie 039 nog niet uitgevoerd: enkel materialen
        lines_done, has_ready = {}, False
    done = {}
    for r in supa.select_all('material_consumption', 'wc_order_id,wc_line_id,material_id,quantity'):
        done.setdefault(r['wc_order_id'], []).append(r)
    stock = {m['id']: m['stock_quantity'] for m in supa.select_all('materials', 'id,stock_quantity')}
    by_sku, ready = {}, {}
    for v in supa.select_all('product_variations', 'id,sku,cost_inputs' + (',ready_stock' if has_ready else '')):
        mats = [(m['material_id'], float(m.get('quantity') or 0)) for m in ((v.get('cost_inputs') or {}).get('materials') or [])
                if m.get('material_id') in stock and float(m.get('quantity') or 0) > 0]
        if v.get('sku'): by_sku[v['sku']] = (v['id'], mats)
        ready[v['id']] = int(v.get('ready_stock') or 0)
    items = {}
    for it in supa.select_all('wc_order_items', 'order_id,wc_line_id,sku,quantity'):
        items.setdefault(it['order_id'], []).append(it)

    def set_ready(vid, value):
        supa.rest('PATCH', f'product_variations?id=eq.{vid}', {'ready_stock': value}, prefer='return=minimal')
        ready[vid] = value

    used = restored = picked = 0
    for o in orders:
        wid = o['wc_order_id']
        if o['status'] in RESTORES:
            for r in done.get(wid, []):
                _bump(r['material_id'], float(r['quantity']), stock)
                restored += 1
            if done.get(wid):
                supa.rest('DELETE', f'material_consumption?wc_order_id=eq.{wid}', prefer='return=minimal')
            back = [r for (w, _), r in lines_done.items() if w == wid]
            for r in back:
                if r['from_stock'] and r['variation_id'] in ready:
                    set_ready(r['variation_id'], ready[r['variation_id']] + int(r['from_stock']))
                    restored += 1
            if back:
                supa.rest('DELETE', f'order_line_stock?wc_order_id=eq.{wid}', prefer='return=minimal')
            continue
        if o['status'] not in COUNTS: continue
        have = {(r['wc_line_id'], r['material_id']) for r in done.get(wid, [])}
        rows = []
        for it in items.get(o['id'], []):
            lid = it.get('wc_line_id')
            if lid is None: continue
            vid, mats = by_sku.get(it.get('sku') or '', (None, []))
            qty = int(float(it.get('quantity') or 0))
            if has_ready:
                if (wid, lid) in lines_done: continue
                old = any(l == lid for l, _ in have)     # al verwerkt vóór migratie 039
                take = 0 if old or vid is None else min(ready.get(vid, 0), qty)
                supa.rest('POST', 'order_line_stock?on_conflict=wc_order_id,wc_line_id',
                          {'wc_order_id': wid, 'wc_line_id': lid, 'variation_id': vid, 'from_stock': take},
                          prefer='resolution=ignore-duplicates,return=minimal')
                lines_done[(wid, lid)] = {'from_stock': take, 'variation_id': vid}
                if take:
                    set_ready(vid, ready[vid] - take)
                    picked += take
                if old: continue
                qty -= take
            for mid, q in mats:
                if (lid, mid) in have or qty <= 0: continue
                rows.append({'wc_order_id': wid, 'wc_line_id': lid, 'material_id': mid, 'quantity': round(q * qty, 4)})
        if rows:
            supa.rest('POST', 'material_consumption?on_conflict=wc_order_id,wc_line_id,material_id', rows,
                      prefer='resolution=ignore-duplicates,return=minimal')
            for r in rows:
                _bump(r['material_id'], -r['quantity'], stock)
                used += 1
    if used or restored or picked:
        print(f'voorraad: {picked} stuk(s) uit klaar-op-voorraad, {used} materiaalregel(s) afgetrokken, {restored} teruggezet')


if __name__ == '__main__':
    main()
