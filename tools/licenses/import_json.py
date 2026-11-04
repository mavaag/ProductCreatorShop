"""Modellenlijst van een licentie importeren uit een JSON-bestand (voor Claude of met de hand).

Gebruik (op de NAS):  python3 tools/licenses/import_json.py <licentie: id | handle | artiest> <bestand.json>
Het bestand is de lijst van de bladwijzer "Modellen ophalen" (type license-import) of de ruwe MakerWorld-API
({"hits": [...]} of een lijst hits). Keuzes en koppelingen met de Catalogus blijven behouden."""
import sys
import licenses_lib as L

if len(sys.argv) != 3:
    raise SystemExit(__doc__)
lic = L.get_license(sys.argv[1])
r = L.import_models(lic, L.parse_payload(L.load_json(sys.argv[2])), source='claude')
print(f'{lic["artist"]}: {r["total"]} modellen, {r["added"]} nieuw, {r["removed"]} niet meer online')
