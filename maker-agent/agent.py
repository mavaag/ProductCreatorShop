"""agent.py - MakerProducts-agent (draait in de maker-agent container op de NAS).

Schrijft elke minuut een hartslag in maker_agent, wacht op een opdracht in maker_jobs (knop "Laat de agent dit
verwerken" in de Catalogus), en laat Claude Code die opdracht afwerken volgens AGENT_PROMPT.md: lasermodellen
zonder snijklare platen eerst 3 mm-platen geven, dan per model een productdocument schrijven en publiceren.
Claude draait in de modus "dontAsk": alleen wat in claude-settings.json toegelaten is mag, de rest wordt geweigerd
(geen bestanden verwijderen/verplaatsen, geen netwerk, geen toegang tot /volume1/Docker).
Na één opdracht (of na een uur zonder opdracht) stopt het script; de container start het opnieuw, zodat een
nieuwe versie uit de repo (/src, bijgehouden door auto-deploy) vanzelf gebruikt wordt."""
import datetime, json, os, subprocess, sys, threading, time
sys.path.insert(0, '/src/tools/maker')
import supa

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser('~')
WORK = os.path.join(HOME, 'work')
LOGS = os.path.join(HOME, 'logs')
POLL_S = 30
IDLE_EXIT_S = 3600
JOB_TIMEOUT_S = 6 * 3600
TAIL_LINES = 60
VERSION = '3'

status = {'text': 'wacht op opdrachten'}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def heartbeat_loop():
    while True:
        try:
            supa.rest('POST', 'maker_agent', {'id': 1, 'seen_at': now(), 'status': status['text'], 'version': VERSION},
                      prefer='resolution=merge-duplicates,return=minimal')
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


def run_job(job):
    jid = job['id']
    os.makedirs(WORK, exist_ok=True); os.makedirs(LOGS, exist_ok=True)
    rows = supa.rest('GET', 'maker_models?select=id,title,kind,path,laser_ready,has_doc&id=in.('
                     + ','.join(f'"{m}"' for m in job['model_ids']) + ')') or []
    info = {r['id']: r for r in rows}
    models = [info.get(m, {'id': m}) for m in job['model_ids']]
    prompt = open(os.path.join(HERE, 'AGENT_PROMPT.md'), encoding='utf-8').read()
    prompt += '\n\n## This job\n```json\n' + json.dumps({'job_id': jid, 'note': job['note'], 'models': models},
                                                       indent=2, ensure_ascii=False) + '\n```\n'
    status['text'] = f'bezig met opdracht van {len(models)} model{"" if len(models) == 1 else "len"}'
    tail = []
    cmd = ['claude', '-p', prompt, '--output-format', 'stream-json', '--verbose',
           '--model', os.environ.get('MAKER_AGENT_MODEL', 'opus'), '--permission-mode', 'dontAsk',
           '--add-dir', '/volume1/MakerProducts', '--add-dir', '/src', '--settings', os.path.join(HERE, 'claude-settings.json')]
    env = dict(os.environ, MAKER_JOB_ID=jid)
    print(f'opdracht {jid}: {len(models)} modellen', flush=True)
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

    # vangnet: catalogus + documenten publiceren, ook als Claude dat zelf al deed (beide scripts slaan ongewijzigde over)
    for script in ('sync_catalog.py', 'publish_docs.py'):
        r = subprocess.run(['python3', f'/src/tools/maker/{script}'], capture_output=True, text=True)
        tail.extend((r.stdout + r.stderr).strip().splitlines()[-3:]); del tail[:-TAIL_LINES]

    cur = supa.rest('GET', f'maker_jobs?id=eq.{jid}&select=results,status')[0]
    if cur['status'] == 'cancelled': return
    results = cur['results'] or {}
    ok = sum(1 for r in results.values() if r.get('status') == 'ok')
    failed = code != 0 or not results
    patch_job(jid, status='failed' if failed else 'done', finished_at=now(), log_tail='\n'.join(tail),
              progress=(f'Claude stopte met code {code}' if code else 'Claude gaf geen resultaten terug') if failed
              else f'klaar: {ok} van {len(job["model_ids"])} gelukt')


def main():
    threading.Thread(target=heartbeat_loop, daemon=True).start()
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
