"use client";

import Link from "next/link";
import { useAuthGuard } from "@/lib/useAuthGuard";

// Handleiding van de beheertool: per pagina wat je er kan doen, plus de werkwijze van idee tot product in de shop.
// Hou dit bij wanneer een pagina of knop verandert (zoek op de knoptekst).

type Section = { id: string; title: string; href?: string; body: React.ReactNode };

const SECTIONS: Section[] = [
  {
    id: "overzicht",
    title: "Zo werkt het geheel",
    body: (
      <>
        <p>De beheertool is de plek waar je producten voorbereidt, de kostprijs berekent en alles naar WooCommerce (de shop op 3dprintforyou.be) stuurt. Er zijn drie lagen:</p>
        <ol>
          <li><b>Bibliotheek op de NAS</b> (<span className="mono">/volume1/MakerProducts</span>): alle lasercut- en 3D-printbestanden, met de map <span className="mono">_Inbox</span> voor nieuwe bestanden.</li>
          <li><b>Catalogus</b>: toont die bibliotheek als kaartjes. Daar kies je wat je wil verkopen en laat je de <b>agent</b> (Claude op de NAS) het werk doen: snijplaten maken, productteksten schrijven, bundels opsplitsen.</li>
          <li><b>Producten</b>: de echte producten met varianten en prijzen. Van hieruit synchroniseer je naar de shop.</li>
        </ol>
        <p><b>Van bestand tot product in de shop</b>, in het kort:</p>
        <ol>
          <li>Nieuwe bestanden in <span className="mono">_Inbox</span> zetten &rarr; Catalogus &gt; <i>Inbox verwerken</i>.</li>
          <li>In de Catalogus modellen <b>selecteren</b> &rarr; <i>Laat de agent dit verwerken</i>. De agent maakt (voor laser) 3 mm-platen voor de xTool M2 en LaserPecker LX2 en schrijft een productdocument.</li>
          <li>Tab <b>Klaar om aan te maken</b>: aanvinken &rarr; <i>Maak N producten</i>. Ze komen als concept in Producten.</li>
          <li>In <b>Producten</b>: per product machinetijd en materialen invullen (de kostprijs en verkoopprijs volgen), controleren.</li>
          <li><b>Synchroniseren</b> naar WooCommerce en daar (of hier) publiceren.</li>
        </ol>
      </>
    ),
  },
  {
    id: "producten",
    title: "Producten",
    href: "/products",
    body: (
      <>
        <p>Lijst van alle producten, met tabbladen per techniek (3D-printen, Resin-printen, Lasercutting, UV-printen, Sublimatie, ...). Bovenaan zoeken, filteren op categorie en publicatiestatus en sorteren.</p>
        <ul>
          <li><b>+ Nieuw product</b>: naam, techniek, parent-SKU en eventueel attributen (bv. Size, Thickness). Zonder attributen wordt het een simpel product.</li>
          <li><b>Selecteren</b> (vinkje op een kaartje) geeft bulkacties: <i>Publiceren / Depubliceren</i>, <i>Marge toepassen</i>, <i>Categorie instellen</i>, <i>Synchroniseer geselecteerde</i>, <i>Verwijderen</i>. Verwijderen gebeurt enkel in de beheertool, niet in de shop.</li>
          <li><b>Hamburgermenu</b> (☰ op een kaartje of rij): <i>Bewerken</i>, <i>Dupliceer</i>, <i>Publiceren / Depubliceren</i> van dat ene product, <i>Verwijder</i>. (De)publiceren gaat naar de shop bij de volgende synchronisatie.</li>
          <li><b>Synchroniseren met WooCommerce</b>:
            <ul>
              <li><i>Bestaande synchroniseren</i>: stuurt wijzigingen (prijs, tekst, voorraad, ...) door naar producten die al in de shop staan.</li>
              <li><i>Alles sync (+ nieuw)</i>: idem, en maakt producten die nog niet in de shop staan nieuw aan. Ontbrekende categorieën (bv. <i>Resin Printing &gt; Figurines</i>) worden automatisch aangemaakt.</li>
            </ul>
          </li>
          <li><b>Importeren uit WooCommerce</b>: haalt producten die je rechtstreeks in de shop maakte of wijzigde naar hier (naam, beschrijving, categorieën, afbeeldingen, gewicht, verzendklasse). De prijs blijft die van de beheertool.</li>
          <li><b>CSV-export</b>: <i>Alles exporteren</i> of enkel de wijzigingen, voor het actieve tabblad. Handig als backup of voor een handmatige import.</li>
        </ul>
        <h3>Een product bewerken</h3>
        <ul>
          <li><b>Basisgegevens</b>: naam, beschrijving (HTML, met voorbeeld), categorieën (bv. <i>Laser Cutting &gt; Decoration</i>; <i>&gt;</i> maakt een subcategorie), afbeeldingen (URL's), gewicht en verzendklasse.</li>
          <li><b>Attributen en varianten</b>: attributen toevoegen en met <i>Varianten genereren</i> alle combinaties aanmaken. Per variant een eigen SKU, afbeelding en prijsberekening; <i>Dupliceer als nieuwe variant</i> kopieert er een.</li>
          <li><b>Kostenopbouw</b> per variant: machinetijd (+ Machine), materialen (+ Materiaal), arbeidstijd met uurloon, overige kosten en de <b>marge</b>. De verkoopprijs wordt daaruit berekend. <i>Marge voor alle varianten wijzigen</i> zet ze in één keer. De prijsgeschiedenis toont vroegere prijzen.</li>
          <li><b>Plugin (personalisatie)</b>: koppelt het product aan een plugin in de shop: <i>Gravure / UV-print</i>, <i>T-shirt</i> of <i>Mok-ontwerper</i>, met per zone (voor/achter) een meerprijs en de printzone in mm.</li>
          <li><b>Product dupliceren</b> maakt een kopie (handig voor een gelijkaardig product); <b>Product verwijderen</b> haalt het enkel uit de beheertool.</li>
        </ul>
      </>
    ),
  },
  {
    id: "catalogus",
    title: "Catalogus",
    href: "/catalog",
    body: (
      <>
        <p>Alle modellen uit de bibliotheek op de NAS als kaartjes. Klik op een kaartje voor de details (foto's, varianten, notities, licentie).</p>
        <h3>Tabbladen</h3>
        <ul>
          <li><b>Alle</b> - de hele bibliotheek.</li>
          <li><b>Geselecteerd</b> - alle modellen die je aanvinkte, in welke fase ook.</li>
          <li><b>Wacht op document</b> - geselecteerd, maar de agent heeft er nog geen productdocument voor gemaakt.</li>
          <li><b>Klaar om aan te maken</b> - document klaar, nog geen product. Vink aan en klik <i>Maak N producten</i>. In het detailvenster kan je eerst de <b>WooCommerce-categorie</b> aanpassen (standaard die van de agent).</li>
          <li><b>Product gemaakt</b> - je hebt het product vanuit de Catalogus aangemaakt (<i>Open product</i>).</li>
          <li><b>Al in de shop</b> - alle modellen die in de shop zitten: zelf aangemaakt (kaartje: <i>Product gemaakt</i>) én gekoppeld aan of herkend als een bestaand shopproduct (kaartje: <i>Gekoppeld aan shopproduct</i>). Je andere shopproducten (die niet uit de bibliotheek komen) staan enkel op <b>Producten</b>.</li>
        </ul>
        <h3>Filters en labels op de kaartjes</h3>
        <ul>
          <li><b>Snijklaar</b>: er zijn al snijplaten (LaserReady). <b>Document</b>: productdocument klaar. <b>Merk</b>: figuur of merk van iemand anders (bv. Marvel) - licentie nakijken voor je verkoopt. <b>In shop #...</b>: gekoppeld aan dat shopproduct.</li>
          <li><b>⧉ Bundel · ~N</b>: de map bevat ongeveer N verschillende modellen (laser: verschillende ontwerpen; 3D-print: submappen met elk een eigen figuur, maat- en supportmappen tellen niet). Klik erop om hem te laten <b>opsplitsen</b> (zie hieronder).</li>
          <li>Vinkjes <i>Enkel snijklaar</i>, <i>Enkel merkfiguren</i> en <i>Enkel bundels</i> om snel te filteren.</li>
        </ul>
        <h3>Koppeling met de shop</h3>
        <p>In het detailvenster, blok <i>Koppeling met de shop</i>: staat een model al in je shop, zoek het (naam, SKU of product-id) en klik <b>Koppel</b>. Dan wordt er geen dubbel product van gemaakt. Vermoedt de agent een match, dan zie je <i>Bekijk #...</i> of <i>Klopt / Klopt niet</i>. <i>Ontkoppelen</i> maakt het ongedaan.</p>
        <h3>Bundel opsplitsen</h3>
        <p>Sommige mappen zijn eigenlijk een verzameling (bv. <i>3D Dinos Puzzles</i> met 38 dieren). Klik het bundel-label of <i>Bundel opsplitsen</i> in het detailvenster: de agent kopieert de bestanden per model naar een eigen submap (er wordt niets verwijderd), en daarna verschijnt elk model als apart kaartje met "uit bundel ..." in de kop. Bestanden die hij niet kon indelen blijven los staan; dat staat in het resultaat.</p>
        <h3>Licenties</h3>
        <p>Een model met een niet-commerciële licentie wordt wel verwerkt, maar krijgt een gele waarschuwing en je moet bevestigen bij het aanmaken. Verkoop pas met toestemming van de ontwerper.</p>
      </>
    ),
  },
  {
    id: "agent",
    title: "De agent (Catalogus > Agent)",
    href: "/catalog",
    body: (
      <>
        <p>De agent is Claude in een Docker-container op de NAS (<span className="mono">maker-agent</span>). Het paneel bovenaan de Catalogus toont altijd zijn status (online, versie, waar hij mee bezig is) en de laatste opdrachten met <i>Details</i> (resultaat per model en het verloop).</p>
        <ul>
          <li><b>Laat de agent dit verwerken</b>: voor alle geselecteerde modellen zonder document. Lasermodellen zonder snijplaten krijgen eerst 3 mm-platen (xTool M2 = A3, LaserPecker LX2 = 500x300 mm); daarna schrijft hij per model een Engels productdocument met varianten, beschrijving, categorie en productie-info. Je kan een notitie meegeven (bv. "maak ook een 6 mm-versie").</li>
          <li><b>Inbox verwerken</b>: zet nieuwe bestanden uit <span className="mono">_Inbox</span> (ook zip/rar) op de juiste plaats in de bibliotheek. Zet ze bij voorkeur in een <b>techniekmap</b>: <span className="mono">_Inbox\FDM</span>, <span className="mono">_Inbox\Resin</span>, <span className="mono">_Inbox\Laser</span>, <span className="mono">_Inbox\UV</span>, <span className="mono">_Inbox\Engraving</span> of <span className="mono">_Inbox\Sublimation</span>. Dan volgt de agent jouw keuze (een resinmodel wordt een resinproduct met bouwplaten, ook zonder voorgesupporte bestanden) en staat de techniek op het kaartje (<i>Laser</i>, <i>3D-print FDM</i>, <i>3D-print Resin</i>, <i>UV-print</i>, <i>Gravure</i> of <i>Sublimatie</i>; ook te filteren via <i>Techniek</i>) (bewaard als <span className="mono">_technique.txt</span> in de modelmap). Los in de Inbox beslist de agent zelf. Met <i>Daarna meteen productdocumenten maken</i> maakt hij er in dezelfde beurt ook documenten van. Verwerkte items gaan naar <span className="mono">_Inbox/_verwerkt</span> en worden na 14 dagen automatisch verwijderd. Een item dat nog gekopieerd wordt, wacht tot het een minuut niet meer verandert.</li>
          <li><b>Bundel opsplitsen</b>: zie Catalogus.</li>
          <li><b>Resin-figuren</b> worden een apart product "... Resin Figure (Unpainted)" op de maat van het bestand, in <i>Resin Printing &gt; Figurines</i>. De agent maakt <b>bouwplaten</b> in <span className="mono">PrintReady/</span> naast het model: per plaat een STL met alle onderdelen al op hun plaats (open je zo in de slicer), een overzichtsafbeelding, en <span className="mono">batch_Nx.stl</span> met zoveel figuren als er op één plaat passen. Printer: de GK3 Ultra of de Photon M3 Max (die met de minste platen); bij een miniatuur (tot 80 mm) komt er ook een set voor de Saturn 3 Ultra bij. Een onderdeel dat niet (of maar krap) past, stopt de verwerking niet: het staat alleen op een eigen plaat, rood gemarkeerd in het overzicht, met een "LET OP" in het resultaat en de README; dat los je in de slicer op (opsplitsen of schuin zetten). Supports en slicen doe je zelf. Bij <i>Maak product</i> worden printer, printtijd en resin al ingevuld in de kostenopbouw (de resin enkel als er bij Materialen een materiaal met &quot;resin&quot; in de naam bestaat).</li>
          <li>Voor elke opdracht haalt de agent de actuele productlijst van de shop op, zodat hij dubbels herkent.</li>
          <li>Een opdracht die nog <i>in de wachtrij</i> staat kan je <i>Annuleren</i>. Opdrachten gebruiken je Claude-abonnement; grote bundels kunnen lang duren.</li>
        </ul>
        <p className="muted">Staat de agent offline? Herstart hem op de NAS: <span className="mono">ssh -t mavaag@192.168.50.10 &quot;sudo docker restart maker-agent&quot;</span>. Na een wijziging aan de Dockerfile: <span className="mono">sudo docker compose -f /volume1/Docker/product-app/src/maker-agent/docker-compose.yml up -d --build</span>.</p>
      </>
    ),
  },
  {
    id: "machines",
    title: "Machines",
    href: "/machines",
    body: (
      <>
        <p>Je printers, lasers en persen, per categorie (3D-printer, Resin-printer, Laser, UV-printer, Sublimatieprinter, Warmtepers). Per machine: aankoopprijs, verwachte levensduur in uren, gemiddeld vermogen en elektriciteitsprijs. Daaruit volgt een <b>kost per uur</b> (afschrijving + stroom) die in de prijsberekening van elk product gebruikt wordt.</p>
        <p>Pas je hier iets aan, ga dan naar <Link href="/prices">Prijzen</Link> om de productprijzen opnieuw te berekenen.</p>
      </>
    ),
  },
  {
    id: "materialen",
    title: "Materialen",
    href: "/materials",
    body: (
      <>
        <p>Filament, resin, hout/plaat, inkt, blanks, verpakking, ... met prijs per eenheid. Die prijs gebruikt de kostenopbouw van de producten.</p>
        <ul>
          <li><b>Bestellingen</b> per materiaal: aantal verpakkingen, inhoud, totale prijs, leverancier en link. De prijs per eenheid volgt uit je aankopen; met <i>Markeer ontvangen</i> komt de hoeveelheid bij de voorraad.</li>
          <li><b>Voorraad</b> met een <i>waarschuwing onder</i>-grens: je ziet wanneer je moet bijbestellen.</li>
          <li>Voor UV-inkt: <i>inktverbruik bij volledige dekking (ml/m²)</i>, om de inktkost per print te schatten.</li>
        </ul>
      </>
    ),
  },
  {
    id: "marges",
    title: "Marges",
    href: "/margins",
    body: (
      <p>Overzicht van alle varianten met kostprijs, verkoopprijs, marge, winst (excl. btw) en winst per machine-uur. Stel een <b>minimale marge</b> in: varianten eronder vallen op. Sorteer om je minst of meest winstgevende producten te vinden. Aanpassen doe je in het product zelf, of in bulk via Producten &gt; <i>Marge toepassen</i>.</p>
    ),
  },
  {
    id: "prijzen",
    title: "Prijzen",
    href: "/prices",
    body: (
      <p>Na een wijziging aan machines of materialen: <b>Prijzen herberekenen</b> toont welke varianten een andere prijs krijgen (oud &rarr; nieuw). Bevestig om ze bij te werken; de oude prijzen blijven in de prijsgeschiedenis van het product. Synchroniseer daarna naar WooCommerce zodat de shop de nieuwe prijzen toont.</p>
    ),
  },
  {
    id: "bestellingen",
    title: "Bestellingen",
    href: "/orders",
    body: (
      <>
        <p><b>Overzicht:</b> verkoopcijfers uit WooCommerce: omzet en aantal bestellingen per maand, per status en de meest verkochte producten, voor een gekozen periode. Nieuwe bestellingen komen <b>automatisch elke 10 minuten</b> binnen (de agent op de NAS haalt ze op); met <i>Synchroniseer bestellingen</i> haal je ze meteen op.</p>
        <p><b>Productie:</b> de open bestellingen (in verwerking / on hold), oudste eerst. Per regel zie je het aantal, de gekozen opties (maat, kleur, personalisatie), de opmerking van de klant en de <b>productiebestanden</b>: klap de map open en download een bestand of de hele map als zip, of kopieer het NAS-pad. Vink een regel af als hij gemaakt is.</p>
        <p>Waar komen de bestanden vandaan?</p>
        <ul>
          <li>Product gemaakt vanuit de <b>Catalogus</b>: het model met zijn LaserReady- of PrintReady-sets.</li>
          <li>Op <b>Producten</b> zie je per product (kaartjes én lijst) waar de bestanden staan: <i>Catalogus</i> (klik = model openen in de Catalogus), <i>Map</i>, <i>Voorstel?</i> (nog te bevestigen) of <i>Geen bestanden</i>. Met het filter <i>Bestanden</i> zoek je bv. alle producten zonder bestanden.</li>
          <li><b>De regel:</b> de <b>Catalogus</b> is je volledige bibliotheek (<code>Lasercut</code>, <code>3D-Print</code>, <code>Resin-Print</code>, <code>UV-Print</code>, <code>Engraving</code>, <code>Sublimation</code>) -- nieuwe modellen voeg je daar toe (via de Inbox). Bij UV-print, gravure en sublimatie is elk <b>ontwerp</b> een eigen map: het printbestand plus de previews. Voor UV-posters maakt de agent een <i>Wall Art</i>-productdocument (METAL/WOOD × M/XL, zoals je bestaande posters); voor gravure en sublimatie is er nog geen standaardproduct, dus daar maakt hij geen document tenzij je in de opdracht beschrijft wat het moet worden. Bestanden die geen ontwerp zijn (teststrips, laserinstellingen, klantwerk) staan in <code>_Werkbestanden</code>, buiten de catalogus. <code>{"\\\\NASMAT\\MakerProducts\\_Shop"}</code> bevat enkel wat in de shop staat: zodra je een product uit de Catalogus <b>publiceert</b>, kopieert de agent het model naar <code>_Shop/&lt;techniek&gt;/&lt;categorie&gt;/&lt;naam&gt;</code> (techniek = LaserCutting, 3DPrinting, ResinPrinting, UVPrinting, Engraving of Sublimatie). Het origineel blijft in de catalogus; een product offline halen verwijdert niets uit _Shop.</li>
          <li>Je oudere producten stonden al in <code>_Shop</code> (vroeger de map PRODUCTS op de pc); hun laser-, 3D- en resinmappen staan intussen ook als model in de Catalogus. Voor die producten stelt de agent een map voor; op de productpagina onder <i>Productiebestanden</i> bevestig je het voorstel, wijs je het af, of plak je zelf het pad van de juiste map. Na het bevestigen koppelt de agent ook het model in de Catalogus aan het product (<i>Al in de shop</i>).</li>
        </ul>
      </>
    ),
  },
  {
    id: "mockup",
    title: "Mockup",
    href: "/mockup",
    body: (
      <>
        <p>Productfoto's maken door een ontwerp op een foto te plaatsen, voor UV-print en lasergravure.</p>
        <ul>
          <li><b>Templates</b>: laad een foto (bv. een onderlegger of een kamer met een kader) en sleep de 4 hoekpunten van de printzone; kies de vorm (rechthoek of cirkel). Een template hergebruik je telkens.</li>
          <li><b>Mockup maken</b>: kies een template, laad je ontwerp en/of typ een tekst (lettertype, gravurekleur), verplaats en schaal het (slepen, scrollen) en klik <i>Downloaden als afbeelding</i>.</li>
          <li><b>Batch</b>: kies een bronmap met foto's en een doelmap; voor elke foto wordt automatisch een mockup gemaakt en weggeschreven. Werkt in Chrome, Edge of Brave.</li>
        </ul>
      </>
    ),
  },
  {
    id: "nas",
    title: "Achter de schermen (NAS en updates)",
    body: (
      <>
        <ul>
          <li>De beheertool, Supabase (database) en de agent draaien in Docker op de Asustor NAS (192.168.50.10).</li>
          <li><b>Updates</b>: wijzigingen gaan via een pull request op GitHub (<span className="mono">mavaag/ProductCreatorShop</span>). Na het mergen in <span className="mono">master</span> zet de auto-deploy de nieuwe versie binnen ongeveer een minuut online. Herlaad dan de pagina met Ctrl+F5.</li>
          <li>Een PR met een <span className="mono">supabase/migration_...sql</span>-bestand: voer die SQL eerst uit in Supabase Studio (SQL Editor), dan pas mergen.</li>
          <li>De werkwijze van de catalogus staat ook in <span className="mono">_catalog/WORKFLOW-CATALOG.md</span> op de NAS.</li>
          <li>Na een stroomonderbreking start alles vanzelf opnieuw; een deploy die bezig was, wordt opnieuw uitgevoerd.</li>
        </ul>
      </>
    ),
  },
];

export default function HelpPage() {
  const ready = useAuthGuard();
  if (!ready) return null;

  return (
    <div className="help-page">
      <h1>Handleiding</h1>
      <p className="muted">Wat je op elke pagina kan doen. Klik op een titel om er meteen naartoe te gaan.</p>

      <div className="card">
        <h2>Inhoud</h2>
        <ol className="help-toc">
          {SECTIONS.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}
        </ol>
      </div>

      {SECTIONS.map((s) => (
        <section key={s.id} id={s.id} className="card help-section">
          <h2>
            {s.title}
            {s.href && <Link href={s.href} className="help-open">open &rarr;</Link>}
          </h2>
          {s.body}
          <p className="help-top"><a href="#">naar boven</a></p>
        </section>
      ))}
    </div>
  );
}
