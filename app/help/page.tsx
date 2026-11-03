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
          <li>Label op een kaartje: <b>Nieuw</b> = nog niet in de shop (nooit gesynchroniseerd); <b>Gewijzigd</b> = na de laatste sync aangepast of met een andere prijs dan in de shop. Geen label = gelijk met de shop. Producten die je uit WooCommerce importeert, gelden meteen als gesynchroniseerd.</li>
          <li><b>Hamburgermenu</b> (☰ op een kaartje of rij): <i>Bewerken</i>, <i>Dupliceer</i>, <i>Publiceren / Depubliceren</i> van dat ene product, <i>Verwijder</i>. (De)publiceren gaat naar de shop bij de volgende synchronisatie.</li>
          <li><b>Synchroniseren met WooCommerce</b>:
            <ul>
              <li><i>Bestaande synchroniseren</i>: stuurt wijzigingen (prijs, tekst, voorraad, ...) door naar producten die al in de shop staan.</li>
              <li><i>Alles sync (+ nieuw)</i>: idem, en maakt producten die nog niet in de shop staan nieuw aan, en ook <b>nieuwe varianten</b> die je hier toevoegde aan een product dat al in de shop staat (sinds 01/11/2026; enkel varianten met een prijs). <i>Bestaande synchroniseren</i> maakt geen varianten aan, die meldt ze als ontbrekend. Ontbrekende categorieën (bv. <i>Resin Printing &gt; Figurines</i>) worden automatisch aangemaakt.</li>
            </ul>
          </li>
          <li><b>Importeren uit WooCommerce</b>: haalt producten die je rechtstreeks in de shop maakte of wijzigde naar hier (naam, beschrijving, categorieën, afbeeldingen, gewicht, verzendklasse). De prijs blijft die van de beheertool.</li>
          <li><b>CSV-export</b>: <i>Alles exporteren</i> of enkel de wijzigingen, voor het actieve tabblad. Handig als backup of voor een handmatige import.</li>
          <li><b>Ster (uitgelicht)</b>: klik op de ster voor de naam (op een kaartje, in de lijst of bovenaan de productpagina) om een product <b>uit te lichten op de homepage</b>, in het blok <i>Populair in de shop</i>. Dat gebeurt meteen in WooCommerce, er is geen sync voor nodig. Het is hetzelfde sterretje als in WP-admin &gt; Producten, dus wat je daar aanklikt, zie je hier ook. Het product moet al in de shop staan. Filter <i>Homepage</i> toont enkel de uitgelichte producten.</li>
        </ul>
        <h3>Een product bewerken</h3>
        <ul>
          <li><b>Basisgegevens</b>: naam, beschrijving (HTML, met voorbeeld), categorieën (bv. <i>Laser Cutting &gt; Decoration</i>; <i>&gt;</i> maakt een subcategorie), afbeeldingen (URL's), gewicht en verzendklasse. <b>Gewicht</b> (kg, inclusief verpakking) bepaalt de verzendkost in de shop. <i>België</i>: tot 0,25 kg brievenbus (€ 3,95), tot 10 kg pakje (€ 8,95), daarboven € 13,95, gratis vanaf € 50. <i>Buurlanden</i> (Nederland, Frankrijk, Duitsland, Luxemburg): tot 0,10 kg € 9,50 en tot 0,25 kg € 15,50 (grote brief), tot 10 kg € 19,95, daarboven € 42,50, gratis vanaf € 100. Een product uit de Catalogus krijgt automatisch een standaardgewicht volgens zijn categorie (sleutelhanger 0,03 kg, onderlegger 0,2, wandbord/klok 0,7, lamp 0,8, de rest 0,3-0,6); laat je het veld leeg, dan stuurt de sync dat standaardgewicht door. Te dik voor de brievenbus? Zet minstens 0,3 kg. <b>Per maat anders?</b> Elke variant heeft een eigen veld <i>Verzendgewicht</i> (boven <i>Klaar op voorraad</i>, bewaart meteen): bv. een flexi in maat S op 0,1 kg (past door de brievenbus) terwijl M en L het pakjesgewicht van het product houden. Leeg = gewicht van het product; de sync zet het op de variant in de shop.</li>
          <li><b>Attributen en varianten</b>: attributen toevoegen en met <i>Varianten genereren</i> alle combinaties aanmaken. Per variant een eigen SKU, afbeelding en prijsberekening; <i>Dupliceer als nieuwe variant</i> kopieert er een.</li>
          <li><b>Kostenopbouw</b> per variant: machinetijd (+ Machine), materialen (+ Materiaal), arbeidstijd met uurloon, overige kosten en de <b>marge</b>. De verkoopprijs wordt daaruit berekend. <i>Marge voor alle varianten wijzigen</i> zet ze in één keer. De prijsgeschiedenis toont vroegere prijzen.</li>
          <li><b>Plugin (personalisatie)</b>: koppelt het product aan een plugin in de shop: <i>Gravure / UV-print</i>, <i>T-shirt</i> of <i>Mok-ontwerper</i>, met per zone (voor/achter) een meerprijs en de printzone in mm.</li>
          <li><b>Eigen gravurezone per variant</b> (sinds 01/11/2026, plugin 3DP Gravure Preview 1.9.0 of nieuwer): bij een product met de gravure-plugin kan je bij elke variant <i>Eigen gravurezone voor deze variant</i> aanvinken, bv. <i>Leisteen rond</i> en <i>Leisteen vierkant</i> in één product. De <b>foto van de variant</b> is dan ook de preview-foto in de shop. Teken de zone en kies de vorm (cirkel of rechthoek), en vul eventueel een andere gravurekleur of een ander maximum aantal tekens in (leeg = zoals het product). Kiest de klant een andere variant, dan wisselt de preview mee en blijven tekst en logo staan. Na <i>Opslaan</i> stuurt de sync de instellingen mee naar WooCommerce. Niet aangevinkt = de variant gebruikt gewoon de zone van het product.</li>
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
          <li><b>Wandklokken</b> (sinds 30/10/2026): geen bouwpakket en geen 3/6 mm-varianten, maar <b>Ø 28 cm met stil uurwerk</b>, met variant <i>MATERIAL</i> <b>Black Acrylic</b> (zwart acryl 3 mm) of <b>Wood</b> (hout 3 mm), in <i>Laser Cutting &gt; Clocks</i>. De agent maakt per klok één snijbestand op 280 mm met een gat van 8 mm voor het uurwerk, en de productfoto's: zwart acryl en hout op een muur (wijzers op 10:10), een close-up en de klok in elke kamerfoto die in de <b>Mockup</b>-generator (tabblad <i>Lasersnijden</i>) op <i>Gebruik voor klokken</i> staat (kader = plaats van de klok op een lege muur). De houtfoto wordt de foto van de variant <i>Wood</i>. Een map met meerdere klokken eerst opsplitsen. Nooit echte LP's laseren (PVC).</li>
          <li><b>Platen en document voor een gekoppeld model</b>: vink een model aan dat al aan een shopproduct gekoppeld is maar nog geen document of (laser) geen snijklare platen heeft; het verschijnt dan bij de agent onder <i>Laat de agent dit verwerken</i>. De agent maakt de platen (M2 + LX2) en een document dat de bestaande shoptekst behoudt.</li>
        </ul>
        <h3>Filters en labels op de kaartjes</h3>
        <ul>
          <li><b>Snijklaar</b>: er zijn al snijplaten (LaserReady). <b>Document</b>: productdocument klaar. <b>Merk</b>: figuur of merk van iemand anders (bv. Marvel) - licentie nakijken voor je verkoopt. <b>In shop #...</b>: gekoppeld aan dat shopproduct.</li>
          <li><b>⧉ Bundel · ~N</b>: de map bevat ongeveer N verschillende modellen (laser: verschillende ontwerpen; 3D-print: submappen met elk een eigen figuur, maat- en supportmappen tellen niet). Klik erop om hem te laten <b>opsplitsen</b> (zie hieronder).</li>
          <li>Vinkjes <i>Enkel snijklaar</i>, <i>Enkel merkfiguren</i> en <i>Enkel bundels</i> om snel te filteren.</li>
        </ul>
        <h3>Koppeling met de shop</h3>
        <p>In het detailvenster, blok <i>Koppeling met de shop</i>: staat een model al in je shop, zoek het (naam, SKU of product-id) en klik <b>Koppel</b>. Dan wordt er geen dubbel product van gemaakt. Vermoedt de agent een match, dan zie je <i>Bekijk #...</i> of <i>Klopt / Klopt niet</i>. <i>Ontkoppelen</i> maakt het ongedaan.</p>
        <p><b>Overnemen in shopproduct</b>: heeft een gekoppeld model een document (bv. een verwerkte klok), dan neem je met deze knop de beschrijving, korte beschrijving, foto&apos;s, categorie en varianten (bv. Black Acrylic / Wood, met kostenopbouw) over in het bestaande product in de beheertool. SKU, publicatiestatus en de naam blijven (vink <i>Naam ook vervangen</i> aan voor de naam uit het document); de oude varianten worden vervangen. Vul daarna de prijzen in en synchroniseer: het blijft hetzelfde WooCommerce-product (zelfde URL, reviews en bestellingen). Was het in de shop een <i>simpel</i> product, dan zet de sync het om naar een variabel product met de nieuwe varianten -- maar pas als elke variant een prijs heeft. Staat het shopproduct nog niet in de beheertool, importeer het dan eerst via Producten &gt; Import.</p>
        <h3>Bundel opsplitsen</h3>
        <p>Sommige mappen zijn eigenlijk een verzameling (bv. <i>3D Dinos Puzzles</i> met 38 dieren). Klik het bundel-label of <i>Bundel opsplitsen</i> in het detailvenster: de agent kopieert de bestanden per model naar een eigen submap (er wordt niets verwijderd), en daarna verschijnt elk model als apart kaartje met "uit bundel ..." in de kop. Bestanden die hij niet kon indelen blijven los staan; dat staat in het resultaat. Staat er geen bundel-label maar weet je dat er meerdere modellen in zitten (bv. <i>clock1</i> t/m <i>clock25</i>: volgnummers tellen als één ontwerp), open dan het model: <i>Bundel opsplitsen</i> staat er altijd bij zolang er nog geen document is.</p>
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
          <li><b>Gravure</b> (sinds 30/10/2026): een gravuremodel (map in <span className="mono">Engraving</span>) wordt één product met attribuut <i>PRODUCT</i> en een variant per soort product waarop je graveert: de gravure-templates met één zone die bij <i>Mockups &gt; Lasergravure</i> op <b>Gebruik voor de agent</b> staan (bv. Snijplank, Onderlegger leisteen rond). Per variant het blanco materiaal met dezelfde naam uit <i>Materialen</i> (ontbreekt het, dan staat dat in de notities) en de XTOOL F2. De agent graveert het ontwerp op elke template-foto (met de gravurekleur van de template); elke variant krijgt de foto van zijn soort. Tip: gebruik scherpe template-foto&apos;s van minstens 1500 px breed.</li>
          <li><b>Sets</b> (bv. 4 onderleggers met elk een ander ontwerp): vink de gravureontwerpen aan die samen horen (de volgorde van de lijst = de volgorde van de zones) en klik <b>Maak set</b> met een naam. De agent maakt de map <span className="mono">Engraving/Sets/&lt;naam&gt;</span> met <span className="mono">set.json</span> (er wordt niets gekopieerd) en een voorbeeldfoto; de set verschijnt als eigen kaartje met het label <i>Set</i>. Vink de set aan en laat hem verwerken: de agent zet de ontwerpen in de zones van de templates met evenveel zones en schrijft het document voor één product.</li>
          <li><b>Wall Art</b>: zet een nieuwe poster (het printbestand) in <span className="mono">_Inbox\UV\Wall-Art</span>. De agent zet hem als ontwerp in <span className="mono">UV-Print</span> en plaatst hem meteen in elke mockup-template die je bij <i>Mockups &gt; UV-print</i> op <b>Gebruik voor Wall Art</b> zette. Die mockups (<span className="mono">mockup_&lt;template&gt;.jpg</span> in de ontwerpmap) worden de productfoto's. Heeft de print een andere verhouding dan het kader, dan wordt ze in het midden bijgesneden (niet uitgerekt). Is de print te klein voor XL (korte zijde onder 1800 px), dan maakt de agent er met de AI-upscaler Real-ESRGAN een 4x vergrote kopie van (<span className="mono">&lt;naam&gt;_upscaled.png</span>, het origineel blijft) en wordt die het printbestand -- kijk tekst en gezichten na voor je print. Mockups voor een poster die al een document heeft: <span className="mono">wallart_mockups.py &quot;UV-Print/...&quot; --update-doc</span> en daarna <span className="mono">publish_docs.py</span> (in de maker-agent).</li>
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
    id: "collecties",
    title: "Collecties",
    href: "/collections",
    body: (
      <>
        <p>
          Thema&apos;s zoals Kerst, Halloween of Moederdag (sinds 01/11/2026). Elke collectie wordt in de shop een eigen pagina: een categorie
          <i> Collecties &gt; naam</i> met de tekst en de banner van de collectie. Een product kan in meerdere collecties zitten en blijft ook in zijn gewone categorie.
        </p>
        <ul>
          <li><b>Nieuwe collectie</b>: naam, tekst, banner (breed beeld, bv. 1600 × 500) en seizoen (dag + maand, zonder jaar: het komt elk jaar terug; mag over nieuwjaar lopen). Met <i>Snel starten</i> vul je een veelgebruikte collectie met een voorstel voor het seizoen in.</li>
          <li><b>Achtergrond van de collectiepagina</b>: een thema (Kerst, Halloween, Valentijn, Pasen, Sinterklaas, Moederdag, Vaderdag of Feest -- een rustig patroon achter de producten), een <i>eigen afbeelding</i> (opladen of URL plakken; rustig beeld, bv. 1920 × 1080) of geen. Met het kleurvakje kies je een andere achtergrondkleur. Het voorbeeld toont hoe het eruitziet achter de productkaartjes. <i>Snel starten</i> kiest het passende thema. Vereist de WordPress-plugin <i>3DP Collecties</i> 1.1.0 of nieuwer.</li>
          <li><b>Zichtbaar in de shop</b>: <i>tijdens het seizoen</i>, <i>altijd</i> of <i>nooit</i>. Enkel een zichtbare collectie staat in het menu, op de pagina Collecties, in de filters en de categorielabels van de producten, en op de homepage in het blok <i>Nu in de kijker</i>. Buiten het seizoen blijft de collectiepagina wel bereikbaar via de rechtstreekse link (handig om ze vooraf na te kijken), en de producten blijven in hun eigen categorie. Bovenaan zie je welke collecties nu zichtbaar zijn. Vereist de WordPress-plugin <i>3DP Collecties</i> 1.3.2 of nieuwer.</li>
          <li><b>Producten toevoegen</b>: via <i>Producten</i> op de collectie (zoeken en klikken), per product met de vinkjes bij <i>Collecties</i> op de productpagina, of in bulk op de pagina Producten: selecteer, kies de collectie en klik <i>Aan collectie toevoegen</i> (of <i>Uit collectie halen</i>).</li>
          <li><b>Status</b> op elk kaartje: <i>In de shop ✓</i>, of wat nog niet in de shop staat (collectie gewijzigd, aantal gewijzigde producten -- hou de muis erop voor de namen). In de productlijst van de collectie staat een oranje bolletje bij producten met wijzigingen; weggehaalde producten staan erboven tot ze gesynct zijn.</li>
          <li><b>Naar de shop</b> (op elke collectie): stuurt <i>enkel wat gewijzigd is</i> naar de shop: de collectiepagina (naam, tekst, banner, seizoen) als die gewijzigd is, en de toegevoegde, weggehaalde of aangepaste producten. Staat alles al in de shop, dan gebeurt er niets. Producten die nog niet in de shop staan, maak je eerst aan via Producten.</li>
          <li>De gewone <b>synchronisatie</b> op Producten neemt collecties ook mee. Gewijzigde producten krijgen het label <i>Gewijzigd</i>.</li>
          <li><b>Verwijderen</b> haalt de collectie en haar pagina in de shop weg; de producten zelf blijven bestaan.</li>
          <li>Collecties staan niet in de lijst van gewone categorieën: beheer ze hier, niet via het categorieveld van een product.</li>
        </ul>
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
          <li><b>Klaar op voorraad</b> (afgewerkte producten, bv. op voorhand geprinte wall art): op de productpagina heeft elke variant boven <i>Materialen</i> een teller. Met <i>+ gemaakt</i> zet je stuks op voorraad en gaan de materialen meteen van de materiaalvoorraad; <i>Corrigeren</i> zet het aantal recht (geteld, kapot, ...) zonder de materialen aan te raken. Een bestelling neemt eerst van deze voorraad: die stuks kosten geen materiaal meer en staan in <i>Productie</i> als <i>Uit voorraad -- enkel inpakken</i> (bestel je meer dan er klaarliggen, dan staat erbij hoeveel er nog te maken zijn). Bij annuleren/terugbetalen komen ze terug op voorraad. In de shop blijft alles bestelbaar, ook bij 0.</li>
          <li><b>Voorraad</b> met een <i>waarschuwing onder</i>-grens (minimum). <b>Bestellingen in de shop verminderen de voorraad vanzelf</b>: elke 10 minuten trekt de agent per bestelregel de materialen van die variant (uit de kostenopbouw) × het aantal af, één keer per regel. Wordt een bestelling geannuleerd, terugbetaald of mislukt, dan komt het materiaal terug. Enkel materialen met een ingevulde voorraad worden bijgehouden (leeg = niet bijhouden), en enkel bestellingen vanaf de start van deze functie tellen mee. Zakt een materiaal op of onder zijn minimum, dan staat het in het tabje <b>Bij te bestellen</b> (ook via de tegel bovenaan): per materiaal de voorraad tegenover het minimum, het verbruik van de laatste 30 dagen, de status (<i>te bestellen</i> of <i>onderweg</i>), een link naar de leverancier en <b>Bestellen</b>, dat het bestelformulier meteen daar opent (standaard als <i>onderweg</i>). Bij ontvangst klik je in hetzelfde tabje <i>Ontvangen / bestellen</i> &gt; <i>Markeer ontvangen</i>; zodra het materiaal boven zijn minimum zit, verdwijnt het uit de lijst.</li>
          <li>Voor UV-inkt: <i>inktverbruik bij volledige dekking (ml/m²)</i>, om de inktkost per print te schatten.</li>
          <li><b>Foto</b> (sinds 01/11/2026): elk materiaal kan een foto krijgen, die op het kaartje staat i.p.v. het icoon. Bij <i>Bewerken</i>: <i>Foto van link ophalen</i> zoekt de productfoto op de link naar de leverancier, <i>Zelf opladen</i> gebruikt je eigen foto, of plak een afbeeldings-URL. Een nieuw materiaal met een link krijgt automatisch een foto. De knop <b>Foto&apos;s ophalen</b> (naast de tabbladen) doet dit voor alle materialen met een link maar nog zonder foto. Ophalen lukt niet bij elke winkel (bv. Amazon en sommige Temu-links): laad dan zelf een foto op. De foto wordt in de opslag van de beheertool bewaard, dus ze blijft ook als de winkel haar pagina wijzigt.</li>
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
      <>
      <p>Na een wijziging aan machines of materialen: <b>Prijzen herberekenen</b> toont welke varianten een andere prijs krijgen (oud &rarr; nieuw). Bevestig om ze bij te werken; de oude prijzen blijven in de prijsgeschiedenis van het product. Synchroniseer daarna naar WooCommerce zodat de shop de nieuwe prijzen toont.</p>
      <p>Pas je de prijs van een materiaal of een machine aan, dan vraagt de beheertool meteen of de prijzen herberekend mogen worden -- <b>enkel voor de varianten die dat materiaal of die machine gebruiken</b> (sinds 01/11/2026). Varianten zonder kostenopbouw (geen materialen, machinetijd, arbeid of andere kosten, bv. geïmporteerde producten met een vaste prijs) worden nooit herberekend, ook niet via <b>Prijzen herberekenen</b>: hun prijs zou anders naar €0 gaan.</p>
      </>
    ),
  },
  {
    id: "bestellingen",
    title: "Bestellingen",
    href: "/orders",
    body: (
      <>
        <p><b>Overzicht:</b> verkoopcijfers uit WooCommerce: omzet en aantal bestellingen per maand, per status en de meest verkochte producten, voor een gekozen periode. Nieuwe bestellingen komen <b>automatisch elke 10 minuten</b> binnen (de agent op de NAS haalt ze op); met <i>Synchroniseer bestellingen</i> haal je ze meteen op.</p>
        <p><b>Productie:</b> de open bestellingen (in verwerking / on hold), gegroepeerd per dag (<i>Vandaag</i>, <i>Gisteren</i>, dan de datum) met standaard de nieuwste bovenaan; met <i>Volgorde</i> zet je de oudste eerst. Per regel zie je het aantal, de gekozen opties (maat, kleur, personalisatie), de opmerking van de klant en de <b>productiebestanden</b>: klap de map open en download een bestand of de hele map als zip, of kopieer het NAS-pad. Bij een <b>gepersonaliseerd</b> product (gravure of UV-print met eigen tekst, logo of foto) zie je ook de <b>bestanden van de klant</b>: het opgeladen logo of de foto en de preview zoals de klant ze zag. Klik op een bestand om het te openen, of download ze samen met <i>Download klantbestanden (zip)</i>. De opties staan onder elkaar met de naam in het vet (Materiaal, Soort, Gravure tekst, Lettertype, ...); tekst op meerdere lijnen staat ook op meerdere lijnen. Bovenaan elke bestelling staan de <b>bedragen</b>: <i>Betaald</i> (totaal van de klant), <i>Producten</i> en <i>Verzending</i> (wat de klant daarvoor betaalde), <i>Kostprijs</i> (de huidige kostprijs van de varianten in de beheertool) en <i>Winst</i> = producten min kostprijs, met de marge in %. De verzending telt niet mee in de winst (die gaat naar de vervoerder). Ontbreekt de kostprijs van een product, dan staat er <i>Winst ≥</i> en "kostprijs onbekend". Vink een regel af als hij gemaakt is.</p>
        <p><b>Status wijzigen</b> (onderaan elke bestelling in <i>Productie</i> en in het tabblad <i>Alle bestellingen</i>): de wijziging gaat meteen naar WooCommerce. Elke knop vraagt eerst <i>Ja, doen</i> / <i>Nee</i>.</p>
        <ul>
          <li><b>Verzonden / voltooid</b>: de klant krijgt de WooCommerce-mail dat de bestelling afgerond is. Vul je het <b>bpost-volgnummer</b> in, dan staat in die mail en bij de bestelling in <i>Mijn account</i> een link <i>Volg je pakje</i> (plugin 3DP Klanten 1.3.0). Zijn alle regels afgevinkt, dan blijft de bestelling in <i>Productie</i> staan met <i>Alles gemaakt -- klaar om te verzenden</i> tot je ze voltooit.</li>
          <li><b>In de wacht</b> / <b>Terug in verwerking</b>: bv. als je op materiaal wacht. In de wacht krijgt de klant een mail van WooCommerce.</li>
          <li><b>Annuleren</b>: de bestelling wordt geannuleerd en de materialen en de klaar-op-voorraad-stuks komen terug (binnen 10 minuten via de agent). <b>Er wordt geen geld teruggestort</b>: dat doe je in WooCommerce bij de bestelling met <i>Terugbetalen</i>, dan gaat het via Stripe/PayPal terug en komt de status vanzelf in de beheertool.</li>
          <li><b>Verwijderen (test)</b>: voor testbestellingen. De bestelling gaat naar de prullenbak in WooCommerce (terug te zetten daar), telt niet meer mee in omzet en topproducten, en het verbruikte materiaal komt terug. Je vindt ze nog onder <i>Alle bestellingen</i> &gt; <i>Verwijderd</i>.</li>
        </ul>
        <p>Waar komen de bestanden vandaan?</p>
        <ul>
          <li>Product gemaakt vanuit de <b>Catalogus</b>: het model met zijn LaserReady- of PrintReady-sets.</li>
          <li>Op <b>Producten</b> zie je per product (kaartjes én lijst) waar de bestanden staan: <i>Catalogus</i> (klik = model openen in de Catalogus), <i>Map</i>, <i>Voorstel?</i> (nog te bevestigen) of <i>Geen bestanden</i>. Met het filter <i>Bestanden</i> zoek je bv. alle producten zonder bestanden.</li>
          <li><b>De regel:</b> de <b>Catalogus</b> is je volledige bibliotheek (<code>Lasercut</code>, <code>3D-Print</code>, <code>Resin-Print</code>, <code>UV-Print</code>, <code>Engraving</code>, <code>Sublimation</code>) -- nieuwe modellen voeg je daar toe (via de Inbox). Bij UV-print, gravure en sublimatie is elk <b>ontwerp</b> een eigen map: het printbestand plus de previews. Voor UV-posters maakt de agent een <i>Wall Art</i>-productdocument (METAL/WOOD × M/XL, zoals je bestaande posters); voor gravure en sublimatie is er nog geen standaardproduct, dus daar maakt hij geen document tenzij je in de opdracht beschrijft wat het moet worden. Bestanden die geen ontwerp zijn (teststrips, laserinstellingen, klantwerk) staan in <code>_Werkbestanden</code>, buiten de catalogus. <b>Alles blijft in de Catalogus</b> (sinds 29/10/2026): de productiebestanden van een shopproduct zijn de map van zijn catalogusmodel, er wordt niets meer gekopieerd. <code>_Shop</code> is enkel nog het oude archief -- zet daar geen nieuwe bestanden meer in, maar gebruik de Inbox.</li>
          <li>Voor een product zonder map stelt de agent elke dag een <b>catalogusmodel</b> voor; op de productpagina onder <i>Productiebestanden</i> bevestig je het voorstel, wijs je het af, of plak je zelf het pad van de juiste map (<i>Map koppelen</i>; ligt het pad in een catalogusmodel, dan wordt dat model gekoppeld). Na het bevestigen koppelt de agent het model ook aan het product in de shop (<i>Al in de shop</i> in de Catalogus).</li>
        </ul>
      </>
    ),
  },
  {
    id: "acties",
    title: "Acties",
    href: "/acties",
    body: (
      <>
        <p>Acties in de shop, via de plugin <b>3DP Acties</b>. Je maakt ze hier; <i>Bewaren en naar de shop</i> zet ze meteen in de shop.</p>
        <ul>
          <li><b>Soorten</b>: <i>X kopen + Y gratis</i> (of aan een %, bv. <i>2e aan halve prijs</i>): per groep van X+Y stuks zijn de Y goedkoopste gratis/afgeprijsd. <i>Vanaf X stuks % korting</i>: zodra er genoeg actieproducten in het mandje zitten, gaat het % van al die stuks af. <i>% korting</i>: de prijs zelf zakt, met doorstreepte prijs in de shop. De knoppen bij <i>Snel kiezen</i> vullen de gangbare acties in.</li>
          <li><b>Producten</b>: standaard de hele shop, en klanten mogen <b>mixen</b> (2 verschillende flexi's + een derde = de goedkoopste gratis). Vink je categorieën of collecties aan, dan geldt de actie enkel daar (subcategorieën horen erbij).</li>
          <li><b>Periode</b>: <i>Vanaf</i> / <i>Tot en met</i> (leeg = meteen / geen einde) en de schakelaar <i>Actief</i>. Buiten de periode of uitgezet is de actie onzichtbaar in de shop.</li>
          <li><b>Meerdere acties</b>: per mandje telt de voordeligste van de mandje-acties (X + Y, vanaf X stuks); een % korting op de prijs komt daar nog bij. Persoonlijke kortingscodes mogen erbovenop.</li>
          <li><b>In de shop</b>: oranje label op de productfoto, kader met uitleg en einddatum op de productpagina, regel <i>Actie: ...</i> met de korting in het mandje, en de pagina <i>Acties</i> (shortcode <span className="mono">[tdp_acties]</span>).</li>
          <li><b>Opvolging</b>: bij elke actie staat in hoeveel bestellingen ze gebruikt werd.</li>
        </ul>
      </>
    ),
  },
  {
    id: "campagnes",
    title: "Campagnes",
    href: "/campaigns",
    body: (
      <>
        <p>Reclamemails naar klanten die <b>toestemming</b> gaven (bij afrekenen, in Mijn account of via de nieuwsbrief), via de plugin <b>3DP Klanten</b> (1.5.0 of nieuwer). Handig bij een nieuwe collectie, een feestdag of een actie. Hou het bij 1 à 2 mails per maand.</p>
        <ul>
          <li><b>Nieuwe campagne</b>: kies een vertrekpunt (<i>Nieuwe collectie</i>, <i>Feestdag</i>, <i>Actie</i> of <i>Leeg</i>) en vul onderwerp, kop en voorbeeldtekst (de korte zin die naast het onderwerp in de inbox staat) in.</li>
          <li><b>Blokken</b>: <i>Titel</i>, <i>Tekst</i> ({'{naam}'} = voornaam), <i>Collectie</i> (foto, beschrijving en knop), <i>Producten</i> (max. 8, met foto en prijs; zoek op naam), <i>Actie</i> (uit de pagina Acties, met label en einddatum), <i>Knop</i>, <i>Afbeelding</i> (adres uit de Mediabibliotheek) en <i>Persoonlijke code</i> (elke ontvanger krijgt een eigen code, enkel voor zijn e-mailadres en 1 keer bruikbaar). Met ↑ ↓ zet je ze in de juiste volgorde. Rechts zie je meteen hoe de mail eruitziet.</li>
          <li><b>Naar wie</b>: iedereen met toestemming, enkel nieuwsbrief-inschrijvers, klanten die al besteld hebben, trouwe klanten, lang niets besteld of nieuwe klanten. Het aantal ontvangers staat eronder. Wie zich intussen afmeldt, wordt overgeslagen.</li>
          <li><b>Versturen</b>: eerst een <i>Testmail</i> naar jezelf, dan <i>Nu versturen</i> of <i>Inplannen</i> op een datum en uur. De shop verstuurt in porties (max. 2 per seconde); de rest volgt via de agent binnen ongeveer 10 minuten. Een ingeplande campagne kan je nog aanpassen of terug een concept maken.</li>
          <li><b>Daglimiet</b>: standaard 90 reclamemails per dag (het gratis plan van Resend laat 100 mails per dag toe, ook bestelmails tellen mee). Zijn er meer ontvangers, dan gaat de rest de volgende dag. Aan te passen onder <i>Instellingen</i>.</li>
          <li><b>Opvolging</b>: per campagne hoeveel mails verstuurd zijn en hoeveel bestellingen (en voor welk bedrag) ontvangers in de 14 dagen erna plaatsten. Een verstuurde campagne kan je niet meer aanpassen; <i>Kopie maken</i> start een nieuwe op basis ervan.</li>
          <li><b>Feestdagenkalender</b> (plugin 1.6.0): Valentijn, Pasen, Moederdag (2e zondag van mei), Vaderdag (2e zondag van juni), Terug naar school, Halloween, Black Friday, Sinterklaas en Kerst. Per feestdag zie je de datum, de voorgestelde verzenddag (bv. Sinterklaas 14 dagen en Kerst 21 dagen vooraf, zodat er tijd is om te maken en te leveren) en wanneer het concept klaarstaat. Aangevinkte feestdagen krijgen vanzelf een <b>concept</b> (standaard 7 dagen voor de verzenddag) met een passende tekst, de collectie waarvan de naam bij de feestdag past (bv. <i>Collecties &gt; Sinterklaas</i>) met de 4 populairste producten, en een knop; je krijgt een mail dat het klaarstaat. <i>Nu concept maken</i> maakt het meteen. Er gaat <b>nooit vanzelf</b> iets naar klanten: jij kijkt het na en klikt <i>Inplannen</i> (de verzenddag om 09:00 staat al ingevuld) of <i>Nu versturen</i>.</li>
        </ul>
      </>
    ),
  },
  {
    id: "klanten",
    title: "Klanten",
    href: "/customers",
    body: (
      <>
        <p>Iedereen die in de shop besteld heeft (ook als gast) of een account heeft, uit de plugin <b>3DP Klanten</b> in de shop. Per klant: naam, e-mail, gemeente, aantal bestellingen, besteed bedrag (min terugbetalingen), eerste en laatste bestelling, verjaardag, account ja/gast en toestemming voor reclame.</p>
        <ul>
          <li><b>Toestemming</b>: bij het afrekenen en in <i>Mijn account &gt; Accountgegevens</i> kan de klant het vakje <i>Ja, stuur me af en toe kortingen en nieuws</i> aanvinken (staat standaard uit). Uitvinken of de afmeldlink gebruiken = <i>afgemeld</i>. Wie geen toestemming gaf, mail je niet met reclame (enkel over hun bestelling).</li>
          <li><b>Verjaardag</b>: vrijwillig veld (dag/maand) bij het afrekenen en in Mijn account.</li>
          <li><b>Nieuwsbrief</b>: het formulier <i>Mis geen enkele actie</i> op de homepagina (en in de footer) schrijft in. De bezoeker krijgt een <b>bevestigingsmail</b>; pas na klikken op de link staat hij op <i>ja (nieuwsbrief)</i>, ervoor op <i>wacht op bevestiging</i> (niet mailen). Tabje <i>Nieuwsbrief</i> toont alle inschrijvers. Afmelden via de afmeldlink haalt hem er ook af.</li>
          <li><b>Tabjes</b>: <i>Jarig deze maand</i>, <i>Jarig volgende maand</i>, <i>Trouwe klanten</i> (min. aantal bestellingen), <i>Grote kopers</i> (min. bedrag), <i>Lang niets besteld</i> (aantal maanden), <i>Nieuw</i>. <i>Enkel met toestemming</i> staat standaard aan.</li>
          <li><b>Kortingscode sturen</b>: vink klanten aan (enkel wie toestemming gaf; het vakje bovenaan kiest iedereen in de selectie) en klik <i>Kortingscode sturen</i>. Kies % korting, € korting of gratis verzending, hoe lang de code geldig is, eventueel een minimum bedrag, en pas onderwerp en tekst aan ({'{naam}'}, {'{code}'}, {'{korting}'}, {'{minimum}'}, {'{geldig_tot}'}, {'{shop}'}). Elke klant krijgt een <b>eigen code</b> (bv. <span className="mono">VOORJOU-SOFIE-7K2Q</span>) die enkel met zijn e-mailadres en maar één keer werkt; de shop mailt ze met de afmeldlink eronder. <i>Voorbeeld naar mij</i> stuurt eerst een testmail naar jezelf.</li>
          <li><b>Automatische kortingscodes</b> (inklapbaar blok bovenaan): <i>Op de verjaardag</i> (standaard 10%, 30 dagen) en <i>Bij de zoveelste bestelling</i> (standaard € 10 bij de 10e bestelling, 60 dagen, vanaf € 25). De shop kijkt elke ochtend vanaf 08:00 (en de agent op de NAS controleert elke 10 minuten of dat gebeurd is); een klant krijgt één verjaardagscode per jaar en de mijlpaalcode maar één keer. Enkel klanten met toestemming.</li>
          <li><b>Codes</b>-kolom: hoeveel codes een klant kreeg en hoeveel gebruikt zijn; klik om ze te zien (waarom, korting, geldig tot, gebruikt). De tegel <i>Codes gebruikt</i> toont het totaal, zo zie je of je acties werken.</li>
          <li><b>Kopieer e-mails</b> kopieert de adressen (enkel met toestemming) om in BCC te plakken. Per klant kopieer je ook de persoonlijke <b>afmeldlink</b>: zet die onderaan elke reclame-mail.</li>
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
        <p>Productfoto's maken door een ontwerp op een foto te plaatsen, met een tabblad per techniek: UV-print, lasergravure en lasersnijden.</p>
        <ul>
          <li><b>Templates</b>: laad een foto (bv. een onderlegger of een kamer met een kader) en sleep de 4 hoekpunten van de printzone; kies de vorm (rechthoek of cirkel). Een template hergebruik je telkens.</li>
          <li><b>Mockup maken</b>: kies een template, laad je ontwerp en/of typ een tekst (lettertype, gravurekleur), verplaats en schaal het (slepen, scrollen) en klik <i>Downloaden als afbeelding</i>.</li>
          <li><b>Batch</b>: kies een bronmap met foto's en een doelmap; voor elke foto wordt automatisch een mockup gemaakt en weggeschreven. Werkt in Chrome, Edge of Brave.</li>
          <li><b>Gebruik voor Wall Art</b> (vinkje op een UV-template): de agent plaatst elke nieuwe poster uit <span className="mono">_Inbox\UV\Wall-Art</span> automatisch in deze template (zie <i>Catalogus &gt; Inbox</i>).</li>
          <li><b>Gebruik voor klokken</b> (vinkje op een template bij <i>Lasersnijden</i>): een kamerfoto met een lege muur; de agent hangt elke nieuwe wandklok in het kader (zie <i>Wandklokken</i> bij de Catalogus).</li>
          <li><b>Lasergravure</b>: geef elke template een <i>soort product</i> (bv. Snijplank, Onderlegger). Met <i>+ Zone</i> maak je een template met meerdere zones, bv. een foto van 4 onderleggers: bij <i>Gravure plaatsen</i> kies je dan per zone een ontwerp, en in batch krijgt elke mockup telkens zoveel foto&apos;s na elkaar uit de map. Gravurekleur, soort afbeelding en lettertype worden bij de template bewaard.</li>
          <li><b>Gebruik voor de agent</b> (vinkje op een gravure-template): de agent maakt met deze template de productfoto&apos;s van nieuwe gravuremodellen, met de gravurekleur en het soort afbeelding van de template.</li>
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
