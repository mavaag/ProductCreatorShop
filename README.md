# 3D-shop productbeheer

Eén app voor al je technieken (3D-printen, UV-printen, laser engraving/cutting, sublimatie):
- Machines en materialen beheer je centraal (net als je Excel-tabbladen)
- Per product/variant vul je de prijsberekening in (materialen, machinetijd, arbeid, marge)
- De **prijsberekening blijft altijd bewaard** in de database -- je kan een product later
  terug opzoeken, de berekening aanpassen, en gewoon opnieuw exporteren
- De **WooCommerce-export bevat enkel de velden die WooCommerce nodig heeft**
  (Type, SKU, Name, Published, Regular price, attributen, Parent) -- de rekendetails
  (materiaallijnen, machine-uren, marge, ...) worden nooit mee geëxporteerd

## 1. Supabase-project opzetten (de database)

1. Ga naar [supabase.com](https://supabase.com) en open je project (je had al een account).
2. Klik links op **SQL Editor** > **New query**.
3. Open het bestand `supabase/schema.sql` uit dit project, kopieer de volledige inhoud,
   plak die in de SQL Editor en klik op **Run**.
   - Dit maakt de tabellen `machines`, `materials`, `products` en `product_variations` aan,
     zet de beveiliging (Row Level Security) aan zodat enkel ingelogde gebruikers erbij kunnen,
     en zet er wat voorbeeld-machines/materialen in (mag je aanpassen of verwijderen).
4. Ga naar **Authentication** > **Users** > **Add user** en maak jezelf aan:
   - Vul je e-mailadres en een wachtwoord in
   - Vink **Auto Confirm User** aan
   - Klik op **Create user**

   Dit project gebruikt inloggen met e-mail + wachtwoord (niet met een magic link). Dat is bewust zo: de
   gratis Supabase-tier laat maar een handvol e-mails per uur toe, en een magic link stuurt er bij elke
   login één -- je loopt daar snel tegen een "email rate limit exceeded"-foutmelding aan. Met een account
   dat je zelf via de dashboard aanmaakt (met "Auto Confirm User") wordt er nooit een e-mail verstuurd.
5. Ga naar **Settings** > **API**. Daar vind je twee waarden die je zo nodig hebt:
   - **Project URL**
   - **anon public** key

## 2. Project lokaal opzetten

1. Zorg dat [Node.js](https://nodejs.org) geïnstalleerd is (versie 18 of hoger).
2. Open een terminal in deze projectmap en installeer de dependencies:
   ```
   npm install
   ```
3. Kopieer `.env.local.example` naar `.env.local`:
   ```
   cp .env.local.example .env.local
   ```
4. Open `.env.local` en vul je eigen Supabase **Project URL** en **anon public key** in
   (uit stap 1.5).
5. Start de app lokaal om te testen:
   ```
   npm run dev
   ```
   Ga naar `http://localhost:3000` -- je wordt naar de inlogpagina gestuurd. Log in met het
   e-mailadres/wachtwoord dat je in stap 1.4 hebt aangemaakt.

## 3. Online zetten via Vercel

1. Zet dit project in een GitHub-repository (als dat nog niet zo is):
   ```
   git init
   git add .
   git commit -m "Eerste versie productbeheer-app"
   ```
   Maak een nieuwe repo aan op GitHub en push je code ernaartoe.
2. Ga naar [vercel.com](https://vercel.com) (je had al een account) en klik op
   **Add New** > **Project**.
3. Kies je GitHub-repository. Vercel herkent automatisch dat het een Next.js-project is.
4. Bij **Environment Variables** voeg je dezelfde twee waarden toe als in je `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Klik op **Deploy**. Na een minuutje krijg je een live URL (bv. `jouw-project.vercel.app`).
   Log in met hetzelfde e-mailadres/wachtwoord als lokaal -- je hoeft niets bij te stellen in
   Supabase, want er wordt geen redirect-URL gebruikt bij deze inlogmethode.

## 4. Hoe je de app gebruikt

1. **Machines** en **Materialen**: vul deze eerst in (net als de tabbladen in je Excel-bestanden).
2. **Producten** > **+ Nieuw product**: geef naam, SKU, techniek en het kenmerk waarop
   varianten verschillen (bv. "Grootte" of "Materiaal").
3. Op de productpagina voeg je per variant (bv. S/M/L) een prijsberekening toe:
   materialen + hoeveelheid, machines + uren, arbeidstijd, uurloon, overige kosten en marge.
   De kostprijs en verkoopprijs verschijnen automatisch.
4. Klik op **Opslaan** per variant.
5. Wanneer je klaar bent: klik bovenaan de productenlijst op **Exporteer WooCommerce CSV**.
   Dat bestand bevat enkel wat WooCommerce nodig heeft en kan je direct importeren via
   **Producten > Alles importeren** in WordPress.
6. Wil je later een prijs aanpassen? Zoek het product op, pas de berekening aan, sla op,
   en exporteer opnieuw -- je hoeft niets van je vorige werk over te typen.

## Projectstructuur

```
app/
  products/          Productenlijst, nieuw product, product bewerken (incl. prijsberekening)
  machines/           Machinebeheer
  materials/          Materiaalbeheer
  login/              Inloggen (e-mail + wachtwoord)
  api/export/         Genereert de WooCommerce CSV (server-side)
lib/
  pricing.ts          Prijsberekeningslogica (herbruikt voor alle technieken)
  types.ts            Gedeelde TypeScript-types
  supabaseClient.ts    Supabase-verbinding
  useAuthGuard.ts      Stuurt niet-ingelogde gebruikers naar /login
supabase/
  schema.sql           Databasestructuur -- voer dit uit in de Supabase SQL Editor
```
