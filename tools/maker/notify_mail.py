"""Mail versturen vanuit de maker-agent (licentieherinneringen, overzicht na het verwerken van de Inbox).

Mailinstellingen komen uit dezelfde notify.env als de deploy- en back-upmails (SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASS, MAIL_FROM, NOTIFY_TO), in de container gemount op /run/notify.env (zie maker-agent/docker-compose.yml)."""
import os, re, smtplib
from email.message import EmailMessage

ENV = os.environ.get('NOTIFY_ENV', '/run/notify.env')


def notify_env():
    """De mailinstellingen, of None als ze ontbreken (dan stuurt de aanroeper niets)."""
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


def mail(subject, body):
    """Versturen als de instellingen er zijn; geeft True terug als het verstuurd is."""
    env = notify_env()
    if not env: return False
    send(env, subject, body)
    return True
