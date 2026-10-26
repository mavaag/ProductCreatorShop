"""jobctl.py - laat Claude tijdens een opdracht zijn voortgang en resultaten terugschrijven naar maker_jobs.
    python3 /src/maker-agent/jobctl.py progress "Bear lamp: platen nesten (3/10)"
    python3 /src/maker-agent/jobctl.py result <model_id> ok|failed|skipped "korte uitleg"
    python3 /src/maker-agent/jobctl.py show            # de opdracht (modellen, instructies, resultaten tot nu toe)
De opdracht komt uit de omgevingsvariabele MAKER_JOB_ID (gezet door agent.py)."""
import json, os, sys
sys.path.insert(0, '/src/tools/maker')
import supa

JOB = os.environ.get('MAKER_JOB_ID')


def job():
    rows = supa.rest('GET', f'maker_jobs?id=eq.{JOB}&select=*')
    if not rows: sys.exit(f'opdracht {JOB} niet gevonden')
    return rows[0]


def main():
    if not JOB: sys.exit('MAKER_JOB_ID ontbreekt')
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'show'
    if cmd == 'progress' and len(sys.argv) == 3:
        supa.rest('PATCH', f'maker_jobs?id=eq.{JOB}', {'progress': sys.argv[2][:300]}, prefer='return=minimal')
    elif cmd == 'result' and len(sys.argv) in (4, 5) and sys.argv[3] in ('ok', 'failed', 'skipped'):
        j = job(); mid = sys.argv[2]
        if mid not in j['model_ids']: sys.exit(f'{mid} hoort niet bij deze opdracht')
        res = dict(j['results'] or {}); res[mid] = {'status': sys.argv[3], 'note': (sys.argv[4] if len(sys.argv) == 5 else '')[:500]}
        supa.rest('PATCH', f'maker_jobs?id=eq.{JOB}', {'results': res}, prefer='return=minimal')
    elif cmd == 'show':
        print(json.dumps(job(), indent=2, ensure_ascii=False))
    else:
        sys.exit(__doc__)
    print('ok')


if __name__ == '__main__':
    main()
