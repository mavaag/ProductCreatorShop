"""agent.py - MakerProducts-agent (draait in de maker-agent container op de NAS).

Schrijft elke minuut een hartslag in maker_agent (met de inhoud van de Inbox), wacht op een opdracht in maker_jobs
en laat Claude Code die afwerken:
  - soort 'models' (knop "Laat de agent dit verwerken"): volgens AGENT_PROMPT.md lasermodellen zonder snijklare platen
    eerst 3 mm-platen geven, dan per model een productdocument schrijven en publiceren;
  - soort 'inbox' (knop "Inbox verwerken"): volgens INBOX_PROMPT.md nieuwe bestanden uit _Inbox in de bibliotheek
    zetten. Wat lukte, verplaatst dit script daarna naar _Inbox/_verwerkt; dat wordt na INBOX_RETENTION_DAYS dagen
    automatisch leeggemaakt (Claude zelf mag niets verplaatsen of verwijderen);
  - daarnaast, los van de opdrachten: elke 10 minuten de WooCommerce-bestellingen ophalen (orders_sync.py) en elke dag
    voorstellen welke map in _Shop bij welk shopproduct hoort (match_shop_files.py);
  - soort 'split' (knop "Bundel opsplitsen"): volgens SPLIT_PROMPT.md een model dat eigenlijk een map met veel losse
    modellen is, opsplitsen in submappen (Claude kopieert enkel). Lukte dat, dan zet dit script de bundel als
    verzamelmap in _catalog/sources.json (met backup), bouwt de catalogus opnieuw en haalt het bundelkaartje weg.
Claude draait in de modus "dontAsk": alleen wat in claude-settings.json toegelaten is mag, de rest wordt geweigerd.
Na één opdracht (of na een uur zonder opdracht) stopt het script; de container start het opnieuw, zodat een
nieuwe versie uit de repo (/src, bijgehouden door auto-deploy) vanzelf gebruikt wordt."""
import datetime, json, os, shutil, subprocess, sys, threading, time
sys.path.insert(0, '/src/tools/maker')
import supa

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser('~')
WORK = os.path.join(HOME, 'work')
LOGS = os.path.join(HOME, 'logs')
INBOX = os.path.join(supa.MAKER_ROOT, '_Inbox')
DONE = os.path.join(INBOX, '_verwerkt')
RETENTION_DAYS = int(os.environ.get('INBOX_RETENTION_DAYS', '14'))
SETTLE_S = 60           # een item dat de laatste minuut nog veranderde, wordt waarschijnlijk nog gekopieerd
IGNORE = {'desktop.ini', 'thumbs.db', '.ds_store'}   # schrijft Windows/macOS zelf, telt niet als kopiëren
POLL_S = 30
IDLE_EXIT_S = 3600
JOB_TIMEOUT_S = 6 * 3600
TAIL_LINES = 60
VERSION = '10'
ORDERS_SYNC_MIN = 10          # bestellingen uit WooCommerce ophalen (orders_sync.py)
MATCH_EVERY_H = 24            # shopproducten <-> mappen in _Shop voorstellen (match_shop_files.py)
# Techniekmappen in de Inbox: zet je iets in _Inbox/Resin, dan weet de agent dat het een resinprint is (enz.).
# Items los in _Inbox blijven werken: dan beslist de agent zelf.
TECH_DIRS = {'fdm': 'fdm', 'resin': 'resin', 'laser': 'laser'}
WORK_KEEP_DAYS = 2   # uitgepakte inbox-archieven in ~/work/inbox (enkel tijdelijk werk van de agent)
CATALOG = os.path.join(supa.MAKER_ROOT, '_catalog')

status = {'text': 'wacht op opdrachten'}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def tree_stats(path):
    """(aantal bestanden, totale grootte, laatste wijziging) van een bestand of map."""
    if os.path.isfile(path):
        st = os.stat(path); return 1, st.st_size, st.st_mtime
    n = size = 0; newest = 0
    for dp, dn, fn in os.walk(path):
        for f in fn:
            if f.lower() in IGNORE: continue
            try: st = os.stat(os.path.join(dp, f))
            except OSError: continue
            n += 1; size += st.st_size; newest = max(newest, st.st_mtime)
    return n, size, newest or os.stat(path).st_mtime


def _inbox_entries(folder):
    return [n for n in sorted(os.listdir(folder)) if not n.startswith(('.', '_', '#')) and n.lower() not in IGNORE]


def scan_inbox():
    """Items in _Inbox (alles behalve _verwerkt en verborgen bestanden), voor de Catalogus. Wat in een techniekmap
    staat (_Inbox/FDM, _Inbox/Resin, _Inbox/Laser) heet "<map>/<naam>" en krijgt die techniek mee."""
    if not os.path.isdir(INBOX): return []
    out = []
    for name in _inbox_entries(INBOX):
        p = os.path.join(INBOX, name)
        tech = TECH_DIRS.get(name.lower()) if os.path.isdir(p) else None
        for item, path, t in ([(f'{name}/{c}', os.path.join(p, c), tech) for c in _inbox_entries(p)] if tech else [(name, p, '')]):
            n, size, newest = tree_stats(path)
            out.append({'name': item, 'kind': 'folder' if os.path.isdir(path) else 'file', 'files': n, 'size': size,
                        'ready': time.time() - newest > SETTLE_S, 'technique': t})
    return out


def cleanup_done():
    """Items in _Inbox/_verwerkt die langer dan RETENTION_DAYS dagen geleden verwerkt zijn, definitief verwijderen."""
    if not os.path.isdir(DONE): return 0
    removed, limit = 0, time.time() - RETENTION_DAYS * 86400
    for name in os.listdir(DONE):
        p = os.path.join(DONE, name)
        if os.path.realpath(os.path.dirname(p)) != os.path.realpath(DONE): continue   # nooit buiten _verwerkt
        try:
            if os.lstat(p).st_mtime > limit: continue          # mtime = moment van verplaatsen (zie move_done)
            if os.path.isdir(p) and not os.path.islink(p): shutil.rmtree(p)
            else: os.remove(p)
            removed += 1
        except OSError as e:
            print(f'opruimen mislukt voor {name}: {e}', flush=True)
    return removed


def cleanup_work(names=None):
    """Uitgepakte inbox-items in ~/work/inbox weggooien: de opgegeven namen meteen, de rest na WORK_KEEP_DAYS dagen.
    Dat is enkel tijdelijk werk van de agent (de bibliotheek en _Inbox blijven onaangeroerd)."""
    base = os.path.join(WORK, 'inbox')
    if not os.path.isdir(base): return 0
    removed, limit = 0, time.time() - WORK_KEEP_DAYS * 86400
    for name in os.listdir(base):
        p = os.path.join(base, name)
        if os.path.realpath(os.path.dirname(p)) != os.path.realpath(base): continue   # nooit buiten ~/work/inbox
        try:
            if not (names and name in names) and os.lstat(p).st_mtime > limit: continue
            if os.path.isdir(p) and not os.path.islink(p): shutil.rmtree(p)
            else: os.remove(p)
            removed += 1
        except OSError as e:
            print(f'werkmap opruimen mislukt voor {name}: {e}', flush=True)
    return removed


def move_done(name):
    """Verwerkt inbox-item naar _Inbox/_verwerkt/<datum>_<naam> (mtime = nu, zodat het opruimen vanaf nu telt).
    name mag "<techniekmap>/<naam>" zijn; de techniekmap zelf blijft staan."""
    src = os.path.join(INBOX, name)
    parent = os.path.realpath(os.path.dirname(src))
    allowed = {os.path.realpath(INBOX)} | {os.path.realpath(os.path.join(INBOX, d)) for d in os.listdir(INBOX)
                                           if d.lower() in TECH_DIRS}
    if not os.path.exists(src) or parent not in allowed or os.path.basename(src).lower() in TECH_DIRS and parent == os.path.realpath(INBOX):
        return False
    base = os.path.basename(src)
    os.makedirs(DONE, exist_ok=True)
    dst = os.path.join(DONE, f'{datetime.date.today().isoformat()}_{base}')
    k = 2
    while os.path.exists(dst):
        dst = os.path.join(DONE, f'{datetime.date.today().isoformat()}_{k}_{base}'); k += 1
    shutil.move(src, dst)
    os.utime(dst, None)
    return True


def background_loop():
    """Los van de opdrachten: bestellingen synchroniseren en (dagelijks) bestanden bij shopproducten voorstellen."""
    stamp = os.path.join(LOGS, 'last_match_shop_files')
    while True:
        for script, due in (('orders_sync.py', True),
                            ('match_shop_files.py', not os.path.exists(stamp) or time.time() - os.path.getmtime(stamp) > MATCH_EVERY_H * 3600)):
            if not due: continue
            try:
                r = subprocess.run(['python3', f'/src/tools/maker/{script}'], capture_output=True, text=True, timeout=1800)
                out = (r.stdout + r.stderr).strip().splitlines()
                if out: print(f'{script}: {out[-1]}', flush=True)
                if script == 'match_shop_files.py' and r.returncode == 0:
                    os.makedirs(LOGS, exist_ok=True); open(stamp, 'w').close()
            except Exception as e:
                print(f'{script} mislukt: {e}', flush=True)
        time.sleep(ORDERS_SYNC_MIN * 60)


def heartbeat_loop():
    last_cleanup = 0
    while True:
        try:
            if time.time() - last_cleanup > 6 * 3600:
                n = cleanup_done(); last_cleanup = time.time()
                if n: print(f'_verwerkt: {n} items ouder dan {RETENTION_DAYS} dagen verwijderd', flush=True)
                w = cleanup_work()
                if w: print(f'~/work/inbox: {w} uitgepakte items ouder dan {WORK_KEEP_DAYS} dagen verwijderd', flush=True)
            done = len(os.listdir(DONE)) if os.path.isdir(DONE) else 0
            info = f'_verwerkt: {done} item{"" if done == 1 else "s"}, worden na {RETENTION_DAYS} dagen automatisch verwijderd'
            beat = {'id': 1, 'seen_at': now(), 'status': status['text'], 'version': VERSION}
            try:
                supa.rest('POST', 'maker_agent', {**beat, 'inbox': scan_inbox(), 'inbox_info': info},
                          prefer='resolution=merge-duplicates,return=minimal')
            except RuntimeError:   # migratie 020 nog niet uitgevoerd: hartslag zonder inbox
                supa.rest('POST', 'maker_agent', beat, prefer='resolution=merge-duplicates,return=minimal')
        except Exception as e:
            print(f'hartslag mislukt: {e}', flush=True)
        time.sleep(60)


def patch_job(job_id, **fields):
    supa.rest('PATCH', f'maker_jobs?id=eq.{job_id}', fields, prefer='return=minimal')


def claim_next():
    """Oudste opdracht in de wachtrij op 'running' zetten; None als er geen is (of een andere agent sneller was)."""
    rows = supa.rest('GET', 'maker_jobs?status=eq.queued&order=created_at&limit=1&select=*')
    if not rows: return None
    job = rows[0]
    got = supa.rest('PATCH', f'maker_jobs?id=eq.{job["id"]}&status=eq.queued',
                    {'status': 'running', 'started_at': now(), 'progress': 'gestart'}, prefer='return=representation')
    return got[0] if got else None


def describe(event):
    """Eén leesbare logregel per stream-json-gebeurtenis van Claude Code (of None)."""
    t = event.get('type')
    if t == 'assistant':
        out = []
        for c in event.get('message', {}).get('content', []):
            if c.get('type') == 'text' and c.get('text', '').strip():
                out.append(c['text'].strip())
            elif c.get('type') == 'tool_use':
                inp = c.get('input', {})
                arg = inp.get('command') or inp.get('file_path') or inp.get('pattern') or ''
                out.append(f'> {c.get("name")}: {str(arg)[:200]}')
        return '\n'.join(out) or None
    if t == 'result':
        return f'== einde: {event.get("subtype")} (beurten: {event.get("num_turns")}, duur: {round((event.get("duration_ms") or 0) / 60000)} min)'
    return None


def build_prompt(job, shop_note):
    """(prompt, aantal, 'item'/'model') voor deze opdracht."""
    jid = job['id']
    if job.get('kind') == 'inbox':
        items = [i for i in scan_inbox() if i['name'] in job['items']]
        missing = [n for n in job['items'] if n not in {i['name'] for i in items}]
        prompt = open(os.path.join(HERE, 'INBOX_PROMPT.md'), encoding='utf-8').read()
        if job.get('then_process'):
            prompt += '\n\n---\n\n' + open(os.path.join(HERE, 'AGENT_PROMPT.md'), encoding='utf-8').read()
        data = {'job_id': jid, 'note': job['note'], 'then_process': job.get('then_process', False), 'inbox': INBOX,
                'shop_export': shop_note, 'items': items, 'missing_items': missing}
        return prompt + '\n\n## This job\n```json\n' + json.dumps(data, indent=2, ensure_ascii=False) + '\n```\n', len(items), 'item'
    rows = supa.rest('GET', 'maker_models?select=id,title,kind,technique,collection,category,path,laser_ready,has_doc&id=in.('
                     + ','.join(f'"{m}"' for m in job['model_ids']) + ')') or []
    info = {r['id']: r for r in rows}
    models = [info.get(m, {'id': m}) for m in job['model_ids']]
    if job.get('kind') == 'split':
        prompt = open(os.path.join(HERE, 'SPLIT_PROMPT.md'), encoding='utf-8').read()
        data = {'job_id': jid, 'note': job['note'], 'root': supa.MAKER_ROOT, 'bundles': models}
        return prompt + '\n\n## This job\n```json\n' + json.dumps(data, indent=2, ensure_ascii=False) + '\n```\n', len(models), 'bundel'
    prompt = open(os.path.join(HERE, 'AGENT_PROMPT.md'), encoding='utf-8').read()
    data = {'job_id': jid, 'note': job['note'], 'shop_export': shop_note, 'models': models}
    return prompt + '\n\n## This job\n```json\n' + json.dumps(data, indent=2, ensure_ascii=False) + '\n```\n', len(models), 'model'


def register_bundle(model):
    """Bundel als verzamelmap in sources.json zetten (de submappen worden de modellen) en het bundelkaartje weghalen.
    Geeft een korte melding terug. Raakt geen bestanden in de bibliotheek aan, enkel sources.json (met backup)."""
    rel = model['path']; base = os.path.join(supa.MAKER_ROOT, rel)
    subs = sorted(d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d)) and not d.startswith(('_', '.')))
    if len(subs) < 2: return f'{rel}: maar {len(subs)} submap(pen), niet als bundel ingesteld'
    src = os.path.join(CATALOG, 'sources.json')
    sources = json.load(open(src, encoding='utf-8'))
    backup = f'{src}.bak-{datetime.date.today():%Y%m%d}'
    if not os.path.exists(backup): shutil.copy2(src, backup)
    if rel not in sources.setdefault('_containers', []): sources['_containers'].append(rel)
    category = model.get('category') or ''
    for d in subs:
        sources.setdefault(f'{rel}/{d}', {'collection': model.get('collection') or 'Vectors', 'category': category,
                                          'bundle': model.get('title') or os.path.basename(rel)})
    tmp = src + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: json.dump(sources, f, ensure_ascii=False, indent=1)
    os.replace(tmp, src)
    # het bundelkaartje zelf verdwijnt uit de catalogus; ook uit Supabase halen als er niets aan hangt
    mid = model['id']
    pick = supa.rest('GET', f'maker_picks?model_id=eq.{mid}&select=product_id') or []
    if not model.get('has_doc') and not any(p.get('product_id') for p in pick):
        supa.rest('DELETE', f'maker_picks?model_id=eq.{mid}', prefer='return=minimal')
        supa.rest('DELETE', f'maker_models?id=eq.{mid}', prefer='return=minimal')
    return f'{rel}: {len(subs)} modellen als aparte kaartjes in de catalogus'


def run_job(job):
    jid = job['id']; inbox_job = job.get('kind') == 'inbox'; split_job = job.get('kind') == 'split'
    os.makedirs(WORK, exist_ok=True); os.makedirs(LOGS, exist_ok=True)
    # actuele shoplijst, zodat de agent kan nakijken of een model al in de shop staat
    r = subprocess.run(['python3', os.path.join(HERE, 'woo_export.py')], capture_output=True, text=True)
    shop_note = ((r.stdout + r.stderr).strip().splitlines()[-1:] or ['woo_export: geen uitvoer'])[0]
    prompt, n, what = build_prompt(job, shop_note)
    status['text'] = f'bezig met {"inbox-" if inbox_job else "opsplits-" if split_job else ""}opdracht ({n} {what}{"" if n == 1 else "s"})'
    tail = []
    cmd = ['claude', '-p', prompt, '--output-format', 'stream-json', '--verbose',
           '--model', os.environ.get('MAKER_AGENT_MODEL', 'opus'), '--permission-mode', 'dontAsk',
           '--add-dir', '/volume1/MakerProducts', '--add-dir', '/src', '--settings', os.path.join(HERE, 'claude-settings.json')]
    env = dict(os.environ, MAKER_JOB_ID=jid)
    print(f'opdracht {jid} ({job.get("kind", "models")}): {n} {what}s', flush=True)
    started = time.time(); last_push = 0
    with open(os.path.join(LOGS, f'{jid}.log'), 'a', encoding='utf-8') as log:
        p = subprocess.Popen(cmd, cwd=WORK, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        timer = threading.Timer(JOB_TIMEOUT_S, p.kill); timer.start()
        for line in p.stdout:
            log.write(line); log.flush()
            try: msg = describe(json.loads(line))
            except ValueError: msg = line.strip() or None
            if msg:
                tail.extend(msg.splitlines()); del tail[:-TAIL_LINES]
            if time.time() - last_push > 20:
                try: patch_job(jid, log_tail='\n'.join(tail)); last_push = time.time()
                except Exception: pass
        code = p.wait(); timer.cancel()
    if time.time() - started >= JOB_TIMEOUT_S: tail.append('== afgebroken: opdracht duurde langer dan 6 uur')

    if split_job:   # gelukte bundels als verzamelmap instellen en de catalogus opnieuw bouwen
        res = (supa.rest('GET', f'maker_jobs?id=eq.{jid}&select=results')[0]['results']) or {}
        bundles = supa.rest('GET', 'maker_models?select=id,title,collection,category,path,has_doc&id=in.('
                            + ','.join(f'"{m}"' for m in job['model_ids']) + ')') or []
        done = [b for b in bundles if res.get(b['id'], {}).get('status') == 'ok']
        for b in done:
            try: tail.append(register_bundle(b))
            except Exception as e: tail.append(f'bundel {b["path"]} instellen mislukt: {e}')
        if done:
            r = subprocess.run(['python3', os.path.join(CATALOG, 'tools', 'build_catalog.py')], capture_output=True, text=True)
            tail.extend((r.stdout + r.stderr).strip().splitlines()[-2:])

    # vangnet: catalogus + documenten publiceren, ook als Claude dat zelf al deed (beide scripts slaan ongewijzigde over)
    for script in ('sync_catalog.py', 'publish_docs.py'):
        r = subprocess.run(['python3', f'/src/tools/maker/{script}'], capture_output=True, text=True)
        tail.extend((r.stdout + r.stderr).strip().splitlines()[-3:]); del tail[:-TAIL_LINES]

    cur = supa.rest('GET', f'maker_jobs?id=eq.{jid}&select=results,status')[0]
    if cur['status'] == 'cancelled': return
    results = cur['results'] or {}

    if inbox_job:   # gelukte inbox-items naar _verwerkt; mislukte blijven staan zodat je ze kan nakijken
        moved = 0
        for name in job['items']:
            if results.get(name, {}).get('status') == 'ok':
                try: moved += move_done(name)
                except OSError as e: tail.append(f'verplaatsen van {name} mislukt: {e}')
        tail.append(f'{moved} inbox-item{"" if moved == 1 else "s"} verplaatst naar _Inbox/_verwerkt')
        done_names = [n for n in job['items'] if results.get(n, {}).get('status') == 'ok']
        cleanup_work([os.path.basename(n) for n in done_names])   # uitgepakte kopie in ~/work/inbox is niet meer nodig

    keys = job['items'] if inbox_job else job['model_ids']
    ok = sum(1 for k in keys if results.get(k, {}).get('status') == 'ok')
    failed = code != 0 or not results
    patch_job(jid, status='failed' if failed else 'done', finished_at=now(), log_tail='\n'.join(tail[-TAIL_LINES:]),
              progress=(f'Claude stopte met code {code}' if code else 'Claude gaf geen resultaten terug') if failed
              else f'klaar: {ok} van {len(keys)} gelukt')


def main():
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    threading.Thread(target=background_loop, daemon=True).start()
    if not os.environ.get('CLAUDE_CODE_OAUTH_TOKEN') and not os.environ.get('ANTHROPIC_API_KEY'):
        status['text'] = 'geen CLAUDE_CODE_OAUTH_TOKEN ingesteld (zie maker-agent/README.md)'
        time.sleep(300); return
    idle = time.time()
    while time.time() - idle < IDLE_EXIT_S:
        try:
            job = claim_next()
        except Exception as e:
            print(f'wachtrij lezen mislukt: {e}', flush=True); job = None
        if job:
            try:
                run_job(job)
            except Exception as e:
                patch_job(job['id'], status='failed', finished_at=now(), progress=f'agent-fout: {e}'[:300])
            status['text'] = 'wacht op opdrachten'
            return  # opnieuw starten met de nieuwste code
        time.sleep(POLL_S)


if __name__ == '__main__':
    main()
