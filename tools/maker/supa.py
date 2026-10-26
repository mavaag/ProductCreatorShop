"""Kleine Supabase-helper voor de MakerProducts-scripts (draait op de NAS, enkel standaardbibliotheek).

Leest de service-key en poort uit de .env van de self-hosted Supabase (/volume1/Docker/supabase/.env) zodat er geen
geheimen in deze repo of op een pc terechtkomen. Overschrijfbaar met de omgevingsvariabelen SUPABASE_ENV,
SUPABASE_URL (intern adres, bv. http://localhost:8100) en SUPABASE_SERVICE_ROLE_KEY."""
import json, os, re, urllib.error, urllib.parse, urllib.request

ENV_FILE = os.environ.get('SUPABASE_ENV', '/volume1/Docker/supabase/.env')
MAKER_ROOT = os.environ.get('MAKER_ROOT', '/volume1/MakerProducts')


def _env():
    env = {}
    if os.path.exists(ENV_FILE):
        for k, v in re.findall(r'^([A-Z_]+)=(.*)$', open(ENV_FILE, encoding='utf-8').read(), re.M):
            env[k] = v.strip().strip('"')
    return env


_E = _env()
URL = os.environ.get('SUPABASE_URL') or f"http://localhost:{_E.get('KONG_HTTP_PORT', '8000')}"
KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or _E['SERVICE_ROLE_KEY']
# Publieke basis-URL: daar laadt WooCommerce de productfoto's van, en de browser de thumbnails.
PUBLIC_URL = (os.environ.get('SUPABASE_PUBLIC_URL') or _E.get('SUPABASE_PUBLIC_URL') or URL).rstrip('/')


def _req(method, url, body=None, headers=None, raw=False):
    h = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', **(headers or {})}
    data = body if raw or body is None else json.dumps(body).encode()
    if not raw and body is not None: h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read()
            return json.loads(txt) if txt and r.headers.get('Content-Type', '').startswith('application/json') else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{method} {url.split("?")[0]} -> {e.code}: {e.read()[:300]!r}') from None


def rest(method, path, body=None, prefer=None):
    """PostgREST-aanroep, bv. rest('GET', 'maker_models?select=id')."""
    return _req(method, f'{URL}/rest/v1/{path}', body, {'Prefer': prefer} if prefer else None)


def select_all(table, columns):
    out, start = [], 0
    while True:
        rows = _req('GET', f'{URL}/rest/v1/{table}?select={urllib.parse.quote(columns)}&order=id', headers={'Range': f'{start}-{start + 999}'})
        out += rows or []
        if not rows or len(rows) < 1000: return out
        start += 1000


def upload(bucket, path, data, content_type):
    """Zet een bestand in een storage bucket (overschrijft) en geeft de publieke URL terug."""
    _req('POST', f'{URL}/storage/v1/object/{bucket}/{urllib.parse.quote(path)}', data,
         {'Content-Type': content_type, 'x-upsert': 'true'}, raw=True)
    return public_url(bucket, path)


def public_url(bucket, path):
    return f'{PUBLIC_URL}/storage/v1/object/public/{bucket}/{urllib.parse.quote(path)}'
