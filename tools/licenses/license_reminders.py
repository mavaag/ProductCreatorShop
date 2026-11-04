"""Herinneringsmail voor licenties die binnen 30 dagen vervallen (of al vervallen zijn). Draait dagelijks in de
maker-agent (agent.py, background_loop); één mail per licentie per vervaldatum (licenses.reminder_sent_for).

Mailinstellingen komen uit dezelfde notify.env als de deploy- en back-upmails (SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASS, MAIL_FROM, NOTIFY_TO), in de container gemount op /run/notify.env (zie maker-agent/docker-compose.yml).
Zonder dat bestand stuurt het script niets en zegt het dat; de melding bovenaan de beheertool werkt dan nog wel.
`python3 license_reminders.py --dry-run` toont wat er gemaild zou worden."""
import datetime, os, re, smtplib, sys
from email.message import EmailMessage
import licenses_lib as L

supa = L.supa
REMIND_DAYS = 30
ENV = os.environ.get('NOTIFY_ENV', '/run/notify.env')
TOOL = 'https://products.anyprintsforyou.be/licenses'


def notify_env():
    if not os.path.isfile(ENV): return None   # ontbreekt de kopie, dan maakt docker er een lege map van
    env = {}
    for k, v in re.findall(r'^([A-Z_]+)=(.*)$', open(ENV, encoding='utf-8').read(), re.M):
        env[k] = v.strip().strip('"').strip("'")
    return env if all(env.get(k) for k in ('SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM', 'NOTIFY_TO')) else None


def send(env, subject, body):
    msg = EmailMessage()
    msg['From'] = f'Any Prints For You <{env["MAIL_FROM"]}>'; msg['To'] = env['NOTIFY_TO']; msg['Subject'] = subject
    msg.set_content(body)
    port = int(env['SMTP_PORT'])
    if port == 465:
        s = smtplib.SMTP_SSL(env['SMTP_HOST'], port, timeout=60)
    else:
        s = smtplib.SMTP(env['SMTP_HOST'], port, timeout=60); s.starttls()
    with s:
        if env.get('SMTP_USER'): s.login(env['SMTP_USER'], env.get('SMTP_PASS', ''))
        s.send_message(msg)


def fmt(iso):
    y, m, d = iso.split('-'); return f'{d}/{m}/{y}'


def main():
    dry = '--dry-run' in sys.argv
    today = datetime.date.today()
    limit = (today + datetime.timedelta(days=REMIND_DAYS)).isoformat()
    rows = supa.rest('GET', f'licenses?valid_until=lte.{limit}&select=id,artist,platform,profile_url,valid_until,price,currency,reminder_sent_for') or []
    due = [r for r in rows if r['reminder_sent_for'] != r['valid_until']]
    if not due:
        print('licenties: geen herinneringen nodig'); return
    lines = []
    for r in due:
        days = (datetime.date.fromisoformat(r['valid_until']) - today).days
        when = f'verloopt over {days} dag{"" if days == 1 else "en"} ({fmt(r["valid_until"])})' if days > 0 else \
               'verloopt vandaag' if days == 0 else f'is verlopen sinds {fmt(r["valid_until"])}'
        price = f', vorige keer {r["price"]} {r["currency"]}' if r.get('price') is not None else ''
        lines.append(f'- {r["artist"]} ({r["platform"]}) {when}{price}\n  {r["profile_url"]}'.rstrip())
    body = ('Deze licentie' + ('s' if len(due) > 1 else '') + ' moet' + ('en' if len(due) > 1 else '') + ' vernieuwd worden:\n\n'
            + '\n'.join(lines) + f'\n\nNa het betalen: klik in de beheertool bij Licenties op "Verlengd" ({TOOL}).\n'
            'Zonder geldige licentie mag je nieuwe prints van deze modellen niet meer verkopen.')
    subject = '[Any Prints For You] Licentie vernieuwen: ' + ', '.join(r['artist'] for r in due)
    if dry:
        print(subject); print(body); return
    env = notify_env()
    if not env:
        print(f'licenties: {len(due)} herinnering(en) nodig, maar geen mailinstellingen in {ENV}'); return
    send(env, subject, body)
    for r in due:
        supa.rest('PATCH', f'licenses?id=eq.{r["id"]}', {'reminder_sent_for': r['valid_until']}, prefer='return=minimal')
    print(f'licenties: herinnering gemaild voor {", ".join(r["artist"] for r in due)}')


if __name__ == '__main__':
    main()
