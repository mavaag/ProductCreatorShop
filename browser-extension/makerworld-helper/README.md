# MakerWorld-hulp (Chrome-extensie)

Hiermee werken bij Licenties in de beheertool de knoppen **Nieuwste modellen ophalen** en
**Downloaden en in de Catalogus zetten** (vanaf versie 1.1.0). MakerWorld laat geen opvragingen
van servers toe, dus de extensie haalt de modellenlijst op in je eigen Chrome, met je eigen MakerWorld-login, zoals
wanneer je zelf het profiel van de artiest opent. De lijst gaat rechtstreeks terug naar de beheertool.

- Werkt alleen op `https://products.anyprintsforyou.be` (en `http://localhost:3000` voor ontwikkeling).
- Downloads: per model de 3MF van het standaard-printprofiel (of het eerste profiel dat wel lukt), zoals de knop
  "Download 3MF". Het bestand gaat in stukken naar de beheertool, niet naar je map Downloads.
- Praat enkel met `makerworld.com`, hun bestandsserver `*.bblmw.com`, `platform.stlflix.com` en `static.stlflix.com`. Geen andere websites, geen gegevens naar derden.
- **STLFlix** (vanaf 1.2.0): haalt de modellenlijst van de hele bibliotheek op (zoals "See all products", pagina per
  pagina, met je eigen STLFlix-login). Downloaden (vanaf 1.3.0): de tool opent per model de pagina op STLFlix, jij klikt
  **Download Files > FILES** (STLFlix heeft bij elke download een botcontrole, die blijft bij jou), de extensie vangt die
  download van `static.stlflix.com` op, stuurt het bestand naar de tool en sluit het tabblad. Er komt niets in je map
  Downloads. Tabblad sluiten = model overslaan.
- Als het rechtstreeks ophalen niet lukt, opent de extensie het profiel even in een achtergrondtabblad en sluit het daarna weer.

## Installeren (eenmalig, per pc)
1. Zorg dat je de laatste versie van de repo hebt (`git pull`), of kopieer de map `browser-extension/makerworld-helper`.
2. Open `chrome://extensions` in Chrome en zet rechtsboven **Ontwikkelaarsmodus** aan.
3. Klik **Uitgepakte extensie laden** en kies de map `browser-extension/makerworld-helper`.
4. Herlaad de beheertool. Bij Licenties > Modellen staat nu **Nieuwste modellen ophalen**.

Wees ingelogd op makerworld.com (en voor STLFlix op platform.stlflix.com) in dezelfde Chrome. Na een wijziging aan de extensie: in `chrome://extensions` op
het herlaad-icoon van de extensie klikken.
