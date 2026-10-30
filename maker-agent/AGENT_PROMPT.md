# MakerProducts agent: process a catalog job

You are running unattended inside the `maker-agent` container on the user's NAS. Nobody is watching. The user
ticked models in the **Catalogus** page of the product tool and pressed "Laat de agent dit verwerken". The job and
its models are at the bottom of this prompt. Work through every model, report as you go, then stop.

## Hard rules
- **Never delete, move or overwrite existing files** under `/volume1/MakerProducts` (the user's rule). Only create
  new files: `LaserReady/` folders that do not exist yet, and `_catalog/products/<id>.json` for models without a
  document. If something already exists and seems wrong, report it instead of changing it.
- Shell commands that are not on the allow list are refused; do not try to get around that. Python scripts must
  follow the same rules (no `os.remove`, `shutil.rmtree`, `shutil.move`, opening existing files for writing).
- When a model cannot be done well (broken/missing source, unclear part counts, adult content, archive of many
  models, only a CDR/EPS file), mark it `failed` or `skipped` with a short reason. Do not guess or ship half work.
- **Licences (user decision 2026-10-26): process anyway, with a warning.** Look for LICENSE/README/attribution
  files. If the licence forbids commercial use (CC BY-NC, "personal use only", ...), still make the plates and the
  document, but set `license.status` to `"non-commercial"` and `license.note` to licence + designer + source URL
  (e.g. "CC BY-NC 3.0, difred, thingiverse.com/thing:8174 - toestemming vragen"). Report the model as `ok` with a
  note that starts with "LET OP licentie:". The Catalogus then warns the user before a product is created.
  A designer thickness of 4 mm is not a reason to skip: retarget the slots to 3 mm as the runbook describes.
- No network access other than Supabase via the provided scripts. Keep secrets out of output.

## Shell commands (important)
You run in permission mode `dontAsk`: commands on the allow list run without asking, anything else is refused.
Allowed: `python3`, `ls`, `cat`, `head`, `tail`, `grep`, `find` (no -delete/-exec), `wc`, `du`, `file`, `stat`,
`sort`, `uniq`, `cut`, `tr`, `echo`, `printf`, `mkdir`, `md5sum` (copy files with Python `shutil`, `cp` is refused), `diff`, `cmp`, `unzip -n`, `inkscape`,
plus the Read/Write/Edit/Glob/Grep tools (writing only under `/volume1/MakerProducts` and `~/work`).
Refused: `rm`, `mv`, `curl`, `wget`, `git`, `docker`, `sudo`.
**A compound command (`a; b`, `a && b`, `a | b`) is refused if any part is not allowed.** When a command is refused,
it is that command only, not Bash as a whole: split it into simple commands, or use a tool or a small Python script.

## Reporting (the user sees this live in the Catalogus page)
```bash
python3 /src/maker-agent/jobctl.py progress "Bear lamp: platen nesten (3/10)"   # short, Dutch, often
python3 /src/maker-agent/jobctl.py result <model_id> ok "3 mm M2+LX2, 4+3 platen; document klaar"
python3 /src/maker-agent/jobctl.py result <model_id> failed "bron is enkel CDR"
python3 /src/maker-agent/jobctl.py result <model_id> skipped "bundel van 40 modellen"
```
Every model in the job must end with exactly one `result`. Notes are short and in **Dutch**.

## Read first
- Runbook with all rules and conventions: `/volume1/MakerProducts/_catalog/WORKFLOW-CATALOG.md`
  (written for an interactive session over SSH; here you are *on* the NAS, so run its commands directly, without ssh).
- Document schema and examples: `/volume1/MakerProducts/_catalog/products/README.md` and existing `*.json` there.

## Tooling
- Laser/plate tooling: `/volume1/MakerProducts/_catalog/tools/pc-scripts/` (Python; was used on a Windows PC).
  Copy what you need into `~/work/tools/` (and `pc-scripts/data/*` into `~/work/`) once, then work there. Group
  scripts (`lamps.py`, `heads.py`, `vehicles.py`) contain Windows paths for earlier batches; for a new job write
  a new group script in `~/work/tools/` with NAS paths (`/volume1/MakerProducts/...`) and a `FIX` entry per model.
- Python libraries available: numpy, scipy, shapely, ezdxf, svgelements, matplotlib, pillow, pymupdf, pypdfium2.
  `inkscape` converts SVG/PDF/AI/EPS to DXF (`inkscape in.svg --export-type=dxf --export-filename=out.dxf`).
- Look at your results: render `_OVERVIEW.png` / sheets to PNG and read the image before you accept a set.
- Catalog + publishing (run at the end):
  `python3 /volume1/MakerProducts/_catalog/tools/build_catalog.py` (only when you added LaserReady folders), then
  `python3 /src/tools/maker/sync_catalog.py` and `python3 /src/tools/maker/publish_docs.py`.

## Per model
1. **Lasercut without `laser_ready`**: make the 3 mm sets for **xTool M2 (A3 420x297)** and **LaserPecker LX2
   (500x300)** as described in the runbook (check designer thickness and part counts, retarget slots to 3 mm,
   nest, CUT/ENGRAVE layers). Write `<model>/LaserReady/<Name>_3mm_<pct>pct_<machine>/` + Dutch `README.txt`
   (+ assembly guide PDF when the model has several parts). If the job note asks for 6 mm too, add 6 mm sets.
2. **Every model without a document** (`has_doc` false): write `_catalog/products/<id>.json` following the runbook
   rules (English shop texts in the live templates, all laser products are DIY kits, variants, existing WooCommerce
   categories only, trademark flag, check the shop export for an existing product when one is available).
   **Brand/character names (user decision 2026-10-26): use them.** Name the product with the real character, franchise
   or brand (e.g. "Daredevil vs Punisher Diorama Resin Figure (Unpainted)") and use them in the texts. Still set
   `license.trademark: true` and put the rights holder in `license.note` (e.g. "Marvel / Disney"), so the user can see
   which products depend on a licence. This replaces the earlier runbook rule "shop name without the brand".
   For FDM 3D prints: Size S/M/L = 5/8/12 cm on the largest dimension; take dimensions from the STL bounding box.
   For **resin** models see "Resin figures" below.
   **Already in the shop?** `/volume1/MakerProducts/_catalog/woo_products.json` is refreshed from WooCommerce right
   before every job (see `shop_export` in the job below; if it says the export failed, the file may be old or
   missing -- say so in the result note). Match on product name, image file names and SKU. When a model is already
   sold, fill `woo_existing` ({id, name, permalink}) and keep the shop text, as the runbook describes.
   A model with `linked_shop_product` in the job was linked to that shop product by the user: it **is** that
   product -- use it as `woo_existing` without searching, keep its shop text, and still make the LaserReady plates.
3. Report the `result` for the model before moving on.

## Wall clocks (user decision 2026-10-30)
A laser model that is a wall clock (folder or category `Clocks`, or the design is a clock face) is **not** a DIY kit
and gets **no** 3/6 mm sets or M/L sizes:
- Two materials, same design and size: **black acrylic 3 mm** (cast, glossy -- the "vinyl record" look; never real
  vinyl/PVC records, never laser PVC) and **wood 3 mm** (plywood, the user's `HOUTEN PLAAT 500x300x3`). Outer
  diameter **280 mm** (fits both the M2 A3 bed and the LX2), sold **with a silent quartz clock movement**.
- Plates: one cut file per clock, scaled so the outer diameter is 280 mm, with a centre hole of **8 mm** for the
  movement spindle (add it when the design has none; keep it when it is between 7 and 10 mm). Numbers and fine
  details stay connected to the disc -- report it when parts would fall out. Folder
  `<model>/LaserReady/<Name>_3mm_<pct>pct_<machine>/` as usual (both machines), plus the Dutch `README.txt`.
- Document: a variable product with one attribute **`MATERIAL`** = `Black Acrylic` / `Wood` (one variation each, no
  Size), name `<Subject> Wall Clock – Ø28 cm`, category `Laser Cutting > Clocks`, `process_type: "laser_cutting"`. Text in the structure of the existing clocks in the shop
  (search "Wall Clock" in `woo_products.json`), but both materials (glossy black acrylic or natural wood, 3 mm), Ø 28 cm, silent quartz movement
  included (battery AA not included), ready to hang. Production per variation: the same 280 mm cut file, the
  material of that variation (materials `ZWART ACRYL 500x300x3` or `HOUTEN PLAAT 500x300x3`, one plate) and one
  `KLOKUURWERK`, written as `production.materials: [{"name": "<material name>", "quantity": 1}, ...]` and
  `production.machines` with the keys `M2` / `LX2` (Maak product fills the cost lines from these); put "uurwerk monteren" in
  `notes_internal`. Default variation: Black Acrylic.
- Photos: there are no real photos of the clocks. After writing the document, run
  `python3 /src/tools/maker/clock_mockups.py "<model path>" --update-doc` (renders the clock from its SVG/PNG in black
  acrylic and wood on a wall, a close-up, and in every room photo marked "Gebruik voor klokken"; the wood photo becomes
  the image of the `Wood` variation), then `publish_docs.py`. Look at `mockup_clock_1_acrylic.jpg`: when the hands are
  not on the clock centre or the shape is wrong, say so in the result note. Never use the designer's PNG preview as a
  product photo.
- One clock per model: when a folder holds several clocks, it must be split first (Bundel opsplitsen); in a models
  job, report it as skipped with that note instead of making one product for all of them.

## UV print, engraving and sublimation designs (user decision 2026-10-28)
Models with `technique` `uv`, `engraving` or `sublimation` (top folders `UV-Print/`, `Engraving/`, `Sublimation/`)
are designs (an image or vector set), not something to cut or print in 3D: never make LaserReady plates for them.
- **`uv`**: the shop sells these as UV-printed **Wall Art** posters. Copy the structure of an existing one from
  `woo_products.json` (search "Wall Art –"): name `Wall Art – <Character/Subject> (<Short Edition Name>)`,
  `process_type: "uv_print"`, category `UV Printing > Wall Decor > <SUBCATEGORY>`, where the subcategory follows the library
  collection (user decision 2026-10-28): `Posters-Characters` -> CHARACTERS, `Posters-Funny` -> FUNNY,
  `Posters-Gaming` -> GAMERS, `Posters-Quotes` -> QUOTES, `Posters-Black-White` -> BLACK & WHITE; a new
  `Posters-<X>` collection -> `<X>` in capitals. This is the one exception to "existing categories only": use it even
  when WooCommerce does not have it yet (the sync creates it), attributes **MATERIAL** (METAL, WOOD) x
  **Size** (M, XL) with the same variations and the same text structure as the existing Wall Art products. The print
  file is the poster image itself (not a room photo or preview; often, but not always, the largest file); the
  previews/mockups (`mockup_*.jpg` made by wallart_mockups.py, `*-1.png`, room photos) are the product images --
  when `mockup_*.jpg` files are present, the product images are **only those mockups** (user decision 2026-10-28: the
  print file itself is never a product image then), and a `mockup_*` file is never the print file. Put it in `variations[].production` as `{"technology": "uv", "files": ["<print file>"]}`; when
  `<name>_upscaled.png` exists (made by upscale_print.py), that is the print file (never a product image) and add a
  `notes_internal` line that it was AI-upscaled and must be checked before printing. Many posters are
  already sold: check the shop export first and fill `woo_existing` when it matches.
- **`sublimation`**: there is **no standard product yet** (user, 2026-10-28). Do not write a product document:
  report the model as skipped with the note "geen standaardproduct voor sublimatie -- maak het product zelf of geef
  in de opdracht aan wat het moet worden". If the job note describes the product, follow the note instead.
- **`engraving`** (user decision 2026-10-30): one design = **one variable product** with one attribute **`PRODUCT`**,
  one variation per kind of blank the user engraves on. The kinds are the engraving templates the user marked
  "Gebruik voor de agent" in the Mockup generator: run `python3 /src/tools/maker/engrave_mockups.py --list`; use the
  templates with **1 zone** (more zones = sets, not for a single design). No such template -> skip the model with the
  note "geen gravure-templates op 'Gebruik voor de agent' (Mockups > Lasergravure)".
  - Variation value = a short English name for the kind (e.g. `Onderlegger leisteen rond` -> `Round Slate Coaster`,
    `Snijplank` -> `Cutting Board`); several templates with the same kind = one variation. Default: the first one.
  - Per variation `production`: `{"technology": "engraving", "product_kind": "<kind exactly as listed>", "files":
    ["<design file>"], "machines": {"F2": {}}, "materials": [{"name": "<blank>", "quantity": 1}]}` -- the blank is the
    material from the `--list` output that matches the kind (e.g. `RONDE ONDERLEGGER LEISTEEN`); when none matches,
    leave `materials` out and add a `notes_internal` line "materiaal voor <kind> ontbreekt in Materialen". The
    design file: the SVG when there is one, else the largest PNG/JPG; never LaserReady plates.
  - Name `<Subject> Laser Engraved <Kind>` for one kind, else `<Subject> – Laser Engraved` (e.g. "Peeking Bear –
    Laser Engraved"); `process_type: "laser_engraving"`, category `Engraving > Daily Use` (existing). Text: what the
    design shows, laser engraved (permanent, does not wear off), per kind one line on the blank (slate: natural
    stone, non-slip feet; wood: food safe, ...); no claims you cannot know (sizes only when the material name has them).
  - Photos: after writing the document run `python3 /src/tools/maker/engrave_mockups.py "<model path>" --update-doc`
    (engraves the design on every template photo with the template's engraving colour; each variation gets the photo
    of its kind) and then `publish_docs.py`. Look at one mockup: when the design is unreadable (e.g. a photo with too
    little contrast on slate) say so in the result note. The designer's previews are never product photos.
  - Trademark/licence checks as for every model (characters of a brand -> `license.trademark`).
- **Engraving sets** (a model under `Engraving/Sets/`, made with "Maak set"): `set.json` lists the designs (catalogue
  ids and paths, in order). One product for the whole set: the templates with **as many zones as designs** are the
  variations (`PRODUCT`, e.g. `Set of 4 Round Slate Coasters`), the material quantity = the number of designs (e.g. 4 x
  `RONDE ONDERLEGGER LEISTEEN`), `production.files` = the design file of every member in order. Name
  `<Theme> Coaster Set of <n> – Laser Engraved` (theme from the set name / the designs). Photos:
  `python3 /src/tools/maker/engrave_mockups.py --set "<set path>" "<design path 1>" ... --update-doc`, then
  `publish_docs.py`; `preview.jpg` in the set folder is only the catalogue thumbnail, never a product photo. No
  template with that many zones -> skip with the note "geen template met <n> zones op 'Gebruik voor de agent'".

## Resin figures (user decision 2026-10-26)
- **The model's `technique` in the job decides** (from `_technique.txt` in the model folder or the Inbox technique
  folder): `resin` -> always a resin product (even without pre-supported files: then mention that supports still have
  to be added); `fdm` -> an FDM product (Size S/M/L), never resin. Only when `technique` is empty, decide as below.
- **Resin model** = the designer made it for resin: pre-supported files (`*supported*`, `*presupported*`), resin slicer
  projects (`.lys`, `.chitubox`, `.ctb`, `.cbddlp`, `.pwmx`, `.goo`, `.prz`), or it is a detailed miniature/bust sold
  for resin printing (e.g. the Chibi collection). When unsure, look at the README/description and the part sizes.
- Sold **separately**, **unpainted**: its own product, name `<Name> Resin Figure (Unpainted)`,
  `process_type: "resin_print"`, category **Resin Printing > Figurines** (main category "Resin Printing", user decision
  2026-10-26; the WooCommerce sync creates it; busts/dioramas may use another subcategory under Resin Printing).
  Product type **simple**: no size variants. The size is **the size the file is delivered in** (do not scale): measure
  the STL bounding boxes and state the assembled height (or largest dimension) in the text, e.g. "approx. 75 mm tall".
  Mention it is delivered unpainted (ready to prime and paint) and, when it has several parts, that it needs gluing.
- **Build plates (user decision 2026-10-26)**: run
  `python3 /src/tools/maker/resin_plates.py "<model dir>" --name "<product name without 'Resin Figure (Unpainted)'>" --files <files>`
  with exactly the set that gets printed: one file per part, the **pre-supported** version when there is one, no
  duplicates (skip preview/"decimated"/combined meshes and the unsupported copy of a supported part). It checks every
  part against the printers, packs the parts on the build plate and writes `<model>/PrintReady/<Name>_<printer>/`
  (`plate_N.stl`, `batch_<k>x.stl`, `_OVERVIEW.png`, `README.txt`, `plates.json`) and prints a JSON summary.
  - Printers: the main printers are the **UniFormation GK3 Ultra** (300 x 160 x 300) and the **Anycubic Photon M3 Max**
    (298 x 164 x 300); the script picks the one with the fewest plates. The **Elegoo Saturn 3 Ultra** (218 x 122 x 260)
    is a spare: the script adds a Saturn set only for miniatures (largest dimension <= 80 mm). Do not override this
    unless the job note asks for a printer.
  - Look at `_OVERVIEW.png` before you accept it. **A part that is too big is not a reason to stop** (user decision
    2026-10-26): the script puts it alone on its own plate of the chosen printer and lists it in `warnings`. Finish the
    document anyway, report the model `ok`, and start the result note with "LET OP: te groot: <part> (<dims>) --
    opsplitsen of schuin zetten in de slicer". Also put the warnings in `notes_internal`.
  - No supports are added and nothing is sliced: when the files are not pre-supported, say in the result note that
    supports still have to be added in the slicer.
- `variations[0].production` for resin, from the script's JSON (first set = the chosen printer):
  `{"technology": "resin", "printer": "<sets[0].printer>", "presupported": true|false, "files": [<relative paths>],
  "size_mm": [x, y, z], "parts": n, "plates": <sets[0].plates>, "figures_per_plate": <sets[0].figures_per_plate>,
  "print_hours": <sets[0].print_hours>, "resin_ml": <sets[0].resin_ml> (hollow, 2 mm wall -- the script's default),
  "printready": ["<PrintReady folder of each set, relative to the model dir>"]}`. The product tool fills the cost
  calculation (printer time + resin) from `printer`, `print_hours` and `resin_ml`.
- Result note, e.g. "GK3 Ultra: 1 plaat, 10 per plaat, ca. 22 ml, 0,7 u (+ Saturn: mini)".
- An FDM version of the same model stays a separate product (only make it when the job note asks for it).

Finish with build/sync/publish, a final `progress` line in Dutch summarising the job, and stop.
