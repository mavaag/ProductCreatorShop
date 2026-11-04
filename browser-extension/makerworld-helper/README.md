# MakerWorld-hulp (Chrome-extensie)

Hiermee werkt de knop **Nieuwste modellen ophalen** bij Licenties in de beheertool. MakerWorld laat geen opvragingen
van servers toe, dus de extensie haalt de modellenlijst op in je eigen Chrome, met je eigen MakerWorld-login, zoals
wanneer je zelf het profiel van de artiest opent. De lijst gaat rechtstreeks terug naar de beheertool.

- Werkt alleen op `https://products.anyprintsforyou.be` (en `http://localhost:3000` voor ontwikkeling).
- Praat enkel met `makerworld.com`. Geen andere websites, geen gegevens naar derden.
- Als het rechtstreeks ophalen niet lukt, opent de extensie het profiel even in een achtergrondtabblad en sluit het daarna weer.

## Installeren (eenmalig, per pc)
1. Zorg dat je de laatste versie van de repo hebt (`git pull`), of kopieer de map `browser-extension/makerworld-helper`.
2. Open `chrome://extensions` in Chrome en zet rechtsboven **Ontwikkelaarsmodus** aan.
3. Klik **Uitgepakte extensie laden** en kies de map `browser-extension/makerworld-helper`.
4. Herlaad de beheertool. Bij Licenties > Modellen staat nu **Nieuwste modellen ophalen**.

Wees ingelogd op makerworld.com in dezelfde Chrome. Na een wijziging aan de extensie: in `chrome://extensions` op
het herlaad-icoon van de extensie klikken.
