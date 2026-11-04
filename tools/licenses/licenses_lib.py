"""Gedeelde code voor de licentie-scripts (draait op de NAS, enkel standaardbibliotheek).

Zelfde regels als lib/licenses.ts in de beheertool: merkherkenning en het verwerken van een modellenlijst
(nieuw / bijgewerkt / niet meer online). Gebruikt tools/maker/supa.py voor Supabase."""
import datetime, json, os, re, sys, urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'maker'))
import supa  # noqa: E402

TRADEMARKS = [
    (r'pok[eé]mon|pikachu', 'Pokémon (Nintendo)'),
    (r'crash bandicoot', 'Crash Bandicoot (Activision)'),
    (r'garfield', 'Garfield (Paws Inc.)'),
    (r'godzill|kaiju', 'Godzilla (Toho)'),
    (r'toothless|night fury|light fury', 'How to Train Your Dragon (DreamWorks)'),
    (r'baymax', 'Big Hero 6 (Disney)'),
    (r'grinch', 'The Grinch (Dr. Seuss)'),
    (r'stitch|mickey|minnie|disney|frozen|olaf', 'Disney'),
    (r'mario|luigi|yoshi|zelda|kirby', 'Nintendo'),
    (r'star wars|baby yoda|grogu|mandalorian', 'Star Wars (Disney)'),
    (r'marvel|spider-?man|batman|superman|hello kitty|labubu|minecraft|sonic', 'merk van een ander'),
]


def detect_trademark(title):
    for pat, name in TRADEMARKS:
        if re.search(pat, title, re.I): return name
    return None


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def safe_name(s, n=80):
    s = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip(' .')[:n] or 'model'


def artist_dir(artist):
    return re.sub(r'[^A-Za-z0-9 _-]', '', artist).strip()


def get_license(key):
    """Licentie op id, handle of artiestnaam."""
    q = urllib.parse.quote
    for flt in (f'id=eq.{q(key)}' if re.fullmatch(r'[0-9a-f-]{36}', key) else None,
                f'handle=eq.{q(key.lower().lstrip("@"))}', f'artist=ilike.{q(key)}'):
        if not flt: continue
        rows = supa.rest('GET', f'licenses?{flt}&select=*')
        if rows: return rows[0]
    raise SystemExit(f'geen licentie gevonden voor {key!r}')


def license_models(license_id, extra=''):
    out, start = [], 0
    while True:
        rows = supa._req('GET', f'{supa.URL}/rest/v1/license_models?license_id=eq.{license_id}{extra}&select=*&order=source_id',
                         headers={'Range': f'{start}-{start + 999}'}) or []
        out += rows
        if len(rows) < 1000: return out
        start += 1000


def from_makerworld_hit(h):
    insts = h.get('instances') or []
    inst = next((i for i in insts if i.get('id') == h.get('defaultInstanceId')), insts[0] if insts else {})
    return {'id': str(h['id']), 'title': str(h.get('title') or '').strip(), 'cover': h.get('coverUrl'),
            'dl': h.get('downloadCount') or 0, 'lk': h.get('likeCount') or 0, 'pr': h.get('printCount') or 0,
            'date': (h.get('publishTime') or h.get('createTime') or '')[:10] or None,
            'w': inst.get('weight'), 'tm': inst.get('prediction'), 'ni': h.get('totalInstCnt'), 'tags': (h.get('tags') or [])[:12]}


def parse_payload(data):
    if isinstance(data, dict) and data.get('type') == 'license-import': return data
    hits = data if isinstance(data, list) else data.get('hits') if isinstance(data, dict) else None
    if hits is None: raise SystemExit('geen modellen gevonden in de invoer')
    return {'type': 'license-import', 'platform': 'makerworld', 'items': [from_makerworld_hit(h) for h in hits]}


def import_models(lic, payload, source='claude'):
    """Zelfde als importModels() in lib/licenses.ts: keuzes en catalogus-koppelingen blijven ongemoeid."""
    items = [i for i in payload['items'] if i.get('id') and i.get('title')]
    if not items: raise SystemExit('de lijst is leeg')
    known = {r['source_id']: r['removed_at'] for r in license_models(lic['id'])}
    seen = {i['id'] for i in items}
    ts = now()
    url = (lambda i: f'https://makerworld.com/en/models/{i}') if lic['platform'] == 'makerworld' else (lambda i: '')
    rows = [{
        'license_id': lic['id'], 'source_id': i['id'], 'title': i['title'], 'url': url(i['id']), 'cover_url': i.get('cover'),
        'downloads': i.get('dl') or 0, 'likes': i.get('lk') or 0, 'prints': i.get('pr') or 0, 'published_at': i.get('date') or None,
        'print_minutes': round(i['tm'] / 60) if i.get('tm') is not None else None,
        'weight_g': round(i['w']) if i.get('w') is not None else None, 'profiles': i.get('ni'),
        'tags': i.get('tags') or [], 'trademark': detect_trademark(i['title']), 'last_seen_at': ts, 'removed_at': None,
    } for i in items]
    for k in range(0, len(rows), 300):
        supa.rest('POST', 'license_models?on_conflict=license_id,source_id', rows[k:k + 300],
                  prefer='resolution=merge-duplicates,return=minimal')
    gone = [sid for sid, rem in known.items() if sid not in seen and not rem]
    for k in range(0, len(gone), 200):
        ids = ','.join(f'"{g}"' for g in gone[k:k + 200])
        supa.rest('PATCH', f'license_models?license_id=eq.{lic["id"]}&source_id=in.({ids})', {'removed_at': ts}, prefer='return=minimal')
    added = sum(1 for i in items if i['id'] not in known)
    patch = {'last_refreshed_at': ts, 'updated_at': ts}
    if payload.get('uid') and not lic.get('platform_user_id'): patch['platform_user_id'] = str(payload['uid'])
    if payload.get('handle') and not lic.get('handle'): patch['handle'] = payload['handle']
    supa.rest('PATCH', f'licenses?id=eq.{lic["id"]}', patch, prefer='return=minimal')
    supa.rest('POST', 'license_refreshes', {'license_id': lic['id'], 'source': source, 'total': len(items),
                                           'new_count': added, 'removed_count': len(gone)}, prefer='return=minimal')
    return {'total': len(items), 'added': added, 'removed': len(gone)}


def load_json(path):
    return json.load(open(path, encoding='utf-8'))
