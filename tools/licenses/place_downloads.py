"""Gedownloade modellen van een licentie in de bibliotheek zetten en aan de Catalogus koppelen (draait op de NAS).

Gebruik:  python3 tools/licenses/place_downloads.py <licentie: id | handle | artiest> [--job <maker_jobs-id>] [--dry-run]

1. Bestanden en mappen in _Inbox/_Licenties/<artiest>/ koppelen aan de modellen die op "Overnemen" staan:
   - exact als de naam met het MakerWorld-id begint ("1634871 - ...") of "[MW1634871]" / "[SF4560]" (STLFlix) bevat;
   - anders op gelijkenis met de titel (minstens 0,6 en duidelijk beter dan het tweede beste model).
   .3mf blijft heel (dat is zelf een zip); een gewone .zip wordt uitgepakt.
2. Elk gekoppeld item verhuist naar <map van de licentie>/<titel> [MW<id>]/ (STLFlix: [SF<id>]) met _technique.txt (fdm),
   _source.json (licentie, artiest, link) en de coverfoto van het platform (wordt de thumbnail in de Catalogus).
3. build_catalog.py + sync_catalog.py, daarna license_models.maker_model_id invullen op basis van "[MW<id>]" in het pad.
Vooraf: bestanden die de extensie MakerWorld-hulp via de beheertool klaarzette in de bucket license-inbox
(<licentie>/<model-id>/<naam>.partNNN + <naam>.done) worden samengevoegd tot "_Inbox/_Licenties/<artiest>/<id> <naam>"
en daarna uit de bucket verwijderd. Onvolledige uploads (zonder .done) blijven staan en worden gemeld.
Wat niet te koppelen is, blijft in de Inbox staan en komt in het resultaat. Met --job worden voortgang en resultaat
in maker_jobs gezet (knop "Gedownloade bestanden in de Catalogus zetten" op de licentiepagina)."""
import difflib, json, os, re, shutil, subprocess, sys, urllib.parse, urllib.request, zipfile
import licenses_lib as L

supa = L.supa
ROOT = supa.MAKER_ROOT
CATALOG = os.path.join(ROOT, '_catalog')
IGNORE = {'desktop.ini', 'thumbs.db', '.ds_store'}
MW = re.compile(r'\[(?:MW|SF|ID)(\d+)\]')   # model-id van het platform in een map- of bestandsnaam
PREFIX = {'makerworld': 'MW', 'stlflix': 'SF'}


def prefix(lic):
    return PREFIX.get(lic.get('platform'), 'ID')


def norm(s):
    s = os.path.splitext(s)[0] if re.search(r'\.(3mf|stl|zip|step|stp|obj)$', s, re.I) else s
    s = re.sub(r'_[0-9a-f]{10}$', '', s, flags=re.I)        # STLFlix: "Vault_Tower_2b1971f242.zip"
    s = re.sub(r'[_\-–—.,!()&+\'’]+', ' ', s.lower())
    s = re.sub(r'\b(by )?pinky ?wings\b|\bstl ?flix\b|\b(v\d+|final|plate ?\d*|model|files?)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def match(name, candidates):
    """(source_id, uitleg) of (None, reden)."""
    m = re.match(r'^(\d{5,9})\b', name) or MW.search(name)
    if m:
        sid = m.group(1)
        return (sid, 'id in de naam') if sid in candidates else (None, f'id {sid} staat niet op Overnemen')
    n = norm(name)
    scores = sorted(((difflib.SequenceMatcher(None, n, norm(t)).ratio(), sid) for sid, t in candidates.items()), reverse=True)
    if not scores: return None, 'geen modellen meer op Overnemen'
    best, sid = scores[0]
    second = scores[1][0] if len(scores) > 1 else 0
    if best >= 0.6 and best - second >= 0.08: return sid, f'naam lijkt op de titel ({best:.2f})'
    return None, f'twijfel: lijkt het meest op "{candidates[sid]}" ({best:.2f})'


def fetch_cover(url, dest_dir):
    if not url: return False
    ext = os.path.splitext(url.split('?')[0])[1].lower() or '.jpg'
    if ext not in ('.png', '.jpg', '.jpeg', '.webp'): ext = '.jpg'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'AnyPrintsForYou-catalog/1.0'})
        data = urllib.request.urlopen(req, timeout=60).read()
        open(os.path.join(dest_dir, 'cover' + ext), 'wb').write(data)
        return True
    except Exception as e:
        print(f'  cover niet opgehaald: {e}')
        return False


BUCKET = 'license-inbox'


def storage_list(prefix):
    out, offset = [], 0
    while True:
        rows = supa._req('POST', f'{supa.URL}/storage/v1/object/list/{BUCKET}',
                         {'prefix': prefix, 'limit': 1000, 'offset': offset, 'sortBy': {'column': 'name', 'order': 'asc'}}) or []
        out += rows
        if len(rows) < 1000: return out
        offset += 1000


def storage_get(path):
    req = urllib.request.Request(f'{supa.URL}/storage/v1/object/authenticated/{BUCKET}/{urllib.parse.quote(path)}',
                                 headers={'apikey': supa.KEY, 'Authorization': f'Bearer {supa.KEY}'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def storage_delete(paths):
    for k in range(0, len(paths), 100):
        supa._req('DELETE', f'{supa.URL}/storage/v1/object/{BUCKET}', {'prefixes': paths[k:k + 100]})


def pull_uploads(lic, inbox, say, dry):
    """Bestanden van de extensie (via de beheertool) uit de bucket naar de Inbox op de NAS."""
    try:
        folders = [f['name'] for f in storage_list(f'{lic["id"]}/') if f.get('id') is None]
    except Exception as e:
        say(f'opslag van de extensie niet te lezen: {e}'); return 0
    pulled = 0
    for sid in folders:
        names = [f['name'] for f in storage_list(f'{lic["id"]}/{sid}/') if f.get('id')]
        complete = [n[:-5] for n in names if n.endswith('.done')]
        for base in complete:
            parts = sorted(n for n in names if n.startswith(base + '.part'))
            if not parts: continue
            dest = os.path.join(inbox, f'[{prefix(lic)}{sid}] {L.safe_name(base, 150)}')
            if dry:
                say(f'- {sid} {base}: klaar in de opslag ({len(parts)} stuk(ken))'); pulled += 1; continue
            os.makedirs(inbox, exist_ok=True)
            tmp = dest + '.tmp'
            with open(tmp, 'wb') as fh:
                for n in parts: fh.write(storage_get(f'{lic["id"]}/{sid}/{n}'))
            os.replace(tmp, dest)
            storage_delete([f'{lic["id"]}/{sid}/{n}' for n in parts + [base + '.done']])
            pulled += 1
        rest = [n for n in names if not any(n.startswith(b + '.') for b in complete)]
        if rest: say(f'- {sid}: onvolledige upload in de opslag ({len(rest)} stuk(ken)); download het model opnieuw in de beheertool')
    if pulled: say(f'{pulled} bestand(en) van de extensie {"gevonden" if dry else "in de Inbox gezet"}')
    return pulled


def place(src, dest, dry):
    if dry: return
    os.makedirs(dest, exist_ok=True)
    if os.path.isfile(src) and src.lower().endswith('.zip'):
        with zipfile.ZipFile(src) as z:
            for info in z.infolist():
                target = os.path.realpath(os.path.join(dest, info.filename))
                if not target.startswith(os.path.realpath(dest) + os.sep): continue   # geen paden buiten de map
                if info.is_dir(): os.makedirs(target, exist_ok=True); continue
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with z.open(info) as fi, open(target, 'wb') as fo: shutil.copyfileobj(fi, fo)
        os.remove(src)
    elif os.path.isdir(src):
        for name in os.listdir(src):
            shutil.move(os.path.join(src, name), os.path.join(dest, name))
        os.rmdir(src)
    else:
        shutil.move(src, os.path.join(dest, os.path.basename(src)))


def link_catalog(lic, folder):
    """maker_model_id invullen voor elk model met "[MW<id>]" (STLFlix "[SF<id>]") in het pad onder de map van de licentie."""
    q = urllib_quote(folder + '/%')
    rows = supa.rest('GET', f'maker_models?path=like.{q}&select=id,path') or []
    linked = 0
    for r in rows:
        m = MW.search(r['path'])
        if not m: continue
        supa.rest('PATCH', f'license_models?license_id=eq.{lic["id"]}&source_id=eq.{m.group(1)}',
                  {'maker_model_id': r['id']}, prefer='return=minimal')
        linked += 1
    return linked


def urllib_quote(s):
    import urllib.parse
    return urllib.parse.quote(s, safe='')


def main():
    args = sys.argv[1:]
    dry = '--dry-run' in args
    job = args[args.index('--job') + 1] if '--job' in args else None
    key = next(a for a in args if not a.startswith('--') and a != job)
    lic = L.get_license(key)
    folder = (lic.get('folder') or f'3D-Print/{L.artist_dir(lic["artist"])}').strip('/')
    inbox = os.path.join(ROOT, '_Inbox', '_Licenties', L.artist_dir(lic['artist']))
    todo = {m['source_id']: m for m in L.license_models(lic['id'], '&pick=eq.yes&maker_model_id=is.null&removed_at=is.null')}
    candidates = {sid: m['title'] for sid, m in todo.items()}
    results, log = {}, []

    def say(s):
        print(s, flush=True); log.append(s)
        if job: supa.rest('PATCH', f'maker_jobs?id=eq.{job}', {'progress': s[:300], 'log_tail': '\n'.join(log[-60:])}, prefer='return=minimal')

    pull_uploads(lic, inbox, say, dry)
    items = sorted(n for n in os.listdir(inbox) if n.lower() not in IGNORE and not n.startswith('.')) if os.path.isdir(inbox) else []
    say(f'{lic["artist"]}: {len(items)} item(s) in _Inbox/_Licenties/{L.artist_dir(lic["artist"])}, {len(todo)} model(len) op Overnemen zonder Catalogus')
    for name in items:
        sid, why = match(name, candidates)
        if not sid:
            results[name] = {'status': 'skipped', 'note': why}; say(f'- {name}: niet gekoppeld ({why})'); continue
        m = todo[sid]
        dest = os.path.join(ROOT, folder, f'{L.safe_name(m["title"])} [{prefix(lic)}{sid}]')
        try:
            place(os.path.join(inbox, name), dest, dry)
            if not dry:
                open(os.path.join(dest, '_technique.txt'), 'w', encoding='utf-8').write('fdm\n')
                json.dump({'license_id': lic['id'], 'artist': lic['artist'], 'platform': lic['platform'], 'source_id': sid,
                           'title': m['title'], 'url': m['url'], 'trademark': m.get('trademark')},
                          open(os.path.join(dest, '_source.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
                if not any(f.lower().startswith('cover.') for f in os.listdir(dest)): fetch_cover(m.get('cover_url'), dest)
            results[sid] = {'status': 'ok', 'note': f'{name} -> {folder}/{os.path.basename(dest)} ({why})'}
            candidates.pop(sid, None)
            say(f'- {name}: {m["title"]} ({why})')
        except Exception as e:
            results[name] = {'status': 'failed', 'note': str(e)[:200]}; say(f'- {name}: mislukt ({e})')

    placed = sum(1 for r in results.values() if r['status'] == 'ok')
    if placed and not dry:
        say('Catalogus opnieuw bouwen...')
        for cmd in (['python3', os.path.join(CATALOG, 'tools', 'build_catalog.py')],
                    ['python3', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'maker', 'sync_catalog.py')]):
            r = subprocess.run(cmd, capture_output=True, text=True)
            for line in (r.stdout + r.stderr).strip().splitlines()[-2:]: say('  ' + line)
    linked = link_catalog(lic, folder) if not dry else 0
    summary = f'klaar: {placed} model(len) in de bibliotheek gezet, {linked} gekoppeld aan de Catalogus' + \
              (f', {len(items) - placed} item(s) blijven in de Inbox' if len(items) - placed else '')
    say(summary)
    if job:
        supa.rest('PATCH', f'maker_jobs?id=eq.{job}', {'status': 'done', 'finished_at': L.now(), 'progress': summary,
                                                    'results': results, 'log_tail': '\n'.join(log[-60:])}, prefer='return=minimal')


if __name__ == '__main__':
    main()
