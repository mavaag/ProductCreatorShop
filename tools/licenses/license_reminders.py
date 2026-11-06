"""Herinneringsmail voor licenties die binnen 30 dagen vervallen (of al vervallen zijn). Draait dagelijks in de
maker-agent (agent.py, background_loop); één mail per licentie per vervaldatum (licenses.reminder_sent_for).

Mailinstellingen komen uit dezelfde notify.env als de deploy- en back-upmails (SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASS, MAIL_FROM, NOTIFY_TO), in de container gemount op /run/notify.env (zie maker-agent/docker-compose.yml).
Zonder dat bestand stuurt het script niets en zegt het dat; de melding bovenaan de beheertool werkt dan nog wel.
`python3 license_reminders.py --dry-run` toont wat er gemaild zou worden."""
import datetime, os, sys
import licenses_lib as L
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'maker'))
from notify_mail import ENV, notify_env, send  # noqa: E402

supa = L.supa
REMIND_DAYS = 30
TOOL = 'https://products.anyprintsforyou.be/licenses'


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
