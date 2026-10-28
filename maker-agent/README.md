# MakerProducts-agent

Een Docker-container op de NAS die de knop **"Laat de agent dit verwerken"** in de Catalogus afhandelt. Claude Code
maakt daarin voor geselecteerde lasermodellen zonder snijklare platen de 3 mm-platen (xTool M2 + LaserPecker LX2),
schrijft voor elk geselecteerd model het productdocument en publiceert alles naar Supabase. Daarna klik je in de
Catalogus op **Maak product**.

- `agent.py`: wacht op opdrachten in `maker_jobs`, start Claude Code, schrijft hartslag (`maker_agent`), voortgang en logboek terug.
- `AGENT_PROMPT.md`: de instructies voor Claude (verwijst naar het runbook `_catalog/WORKFLOW-CATALOG.md` op de NAS).
- `jobctl.py`: waarmee Claude per model zijn voortgang en resultaat meldt.
- `claude-settings.json`: wat Claude mag. Modus `dontAsk`: alleen de toegelaten acties, de rest wordt geweigerd.
  Geen `rm`/`mv`, geen netwerk (curl, git), geen docker/sudo, geen toegang tot `/volume1/Docker`.

De container mount enkel `MakerProducts`, de Supabase-`.env` (alleen-lezen, voor de service-key) en de repo
(alleen-lezen). Agent-code en prompt komen uit de repo die auto-deploy bijhoudt: na een merge op master gebruikt de
agent bij de volgende opdracht vanzelf de nieuwe versie. Alleen bij een wijziging aan de `Dockerfile` moet je de
container opnieuw bouwen (stap 5).

## Eenmalig installeren

1. **Database**: voer `supabase/migration_019_maker_agent.sql` uit in Supabase Studio (SQL Editor).
2. **Token maken** (op je pc, in PowerShell): `claude setup-token`. Log in met je Claude-account en kopieer het token
   (`sk-ant-oat01-...`). Het werkt via je abonnement, je hebt geen API-sleutel nodig.
3. **Token op de NAS zetten**, zonder dat het in een logboek of in de chat belandt. Voer dit uit in PowerShell,
   plak dan het token en druk op Enter:
   ```powershell
   ssh mavaag@192.168.50.10 "umask 077; read -r T; printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' \"`$T\" > /volume1/Docker/maker-agent/agent.env"
   ```
4. **Shoplijst (optioneel, aangeraden)**: maak in WooCommerce > Instellingen > Geavanceerd > REST API een sleutel met
   enkel **Lezen**-rechten en zet die in dezelfde `agent.env` (op de NAS, via `ssh` en `read -r`, zoals het token):
   `WOO_URL=https://3dprintforyou.be`, `WOO_KEY=ck_...`, `WOO_SECRET=cs_...`. Voor elke opdracht haalt de agent dan
   de actuele productlijst op (`woo_export.py` -> `_catalog/woo_products.json`), zodat hij ziet wat al in de shop staat.
5. **Container bouwen en starten** (vraagt je NAS-wachtwoord voor sudo):
   ```powershell
   ssh -t mavaag@192.168.50.10 "sudo docker compose -f /volume1/Docker/product-app/src/maker-agent/docker-compose.yml up -d --build"
   ```
   De eerste keer duurt dat enkele minuten. Daarna zie je in de Catalogus "Agent actief".
   Opnieuw bouwen (zelfde commando) is nodig na een wijziging aan `Dockerfile` of `docker-compose.yml`, bv. voor de
   AI-upscaler Real-ESRGAN (`tools/maker/upscale_print.py`, gebruikt de Intel-GPU via `/dev/dri`).

## Inbox
Nieuwe modellen (bestanden, mappen, zip/rar) zet je in `\\NASMAT\MakerProducts\_Inbox`. De agent toont ze in de
Catalogus (blok Agent > Inbox); met **Inbox verwerken** zet Claude ze op de juiste plek in de bibliotheek
(`INBOX_PROMPT.md`), bouwt de catalogus opnieuw en synchroniseert. Optioneel maakt hij daarna meteen platen en
documenten. Claude kopieert alleen; `agent.py` verplaatst daarna de gelukte items naar `_Inbox/_verwerkt`, en ruimt
die map automatisch op: items die er langer dan `INBOX_RETENTION_DAYS` dagen (standaard 14) staan, worden verwijderd.
Mislukte items blijven in de Inbox staan. Migratie: `supabase/migration_020_maker_inbox.sql`.

## Beheer
- Logboek van de container: `sudo docker logs -f maker-agent`, of Portainer > Containers > maker-agent > Logs.
- Volledige log per opdracht: `/volume1/Docker/maker-agent/home/logs/<opdracht-id>.log`.
- Stoppen: `sudo docker stop maker-agent`. Starten: `sudo docker start maker-agent`.
- Nieuw token (het verloopt na een jaar): stap 2 en 3 opnieuw, dan `sudo docker restart maker-agent`.
