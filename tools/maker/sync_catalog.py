"""sync_catalog.py - zet de MakerProducts-catalogus (_catalog/catalog.json + thumbnails) in Supabase.

Draai op de NAS na elke rebuild van de catalogus:
    python3 sync_catalog.py            # nieuwe/gewijzigde modellen + ontbrekende thumbnails
    python3 sync_catalog.py --thumbs   # alle thumbnails opnieuw opladen
Raakt het productdocument (doc) en de selectie (maker_picks) niet aan; modellen die uit de catalogus verdwenen zijn
worden enkel gemeld, niet verwijderd."""
import datetime, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supa

COLUMNS = ('id', 'title', 'kind', 'collection', 'category', 'path', 'formats', 'thicknesses', 'laser_ready', 'files', 'designs', 'bundle')


def main():
    all_thumbs = '--thumbs' in sys.argv
    items = json.load(open(os.path.join(supa.MAKER_ROOT, '_catalog', 'catalog.json'), encoding='utf-8'))['items']
    existing = {r['id']: r for r in supa.select_all('maker_models', 'id,thumb_url')}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rows, uploaded = [], 0
    for it in items:
        row = {c: it.get(c) for c in COLUMNS}
        row['title'] = row['title'] or it['id']
        row['category'] = row['category'] or ''
        row['collection'] = row['collection'] or ''
        row['designs'] = row['designs'] or 0
        row['bundle'] = row['bundle'] or ''
        row['formats'] = row['formats'] or {}
        row['thicknesses'] = row['thicknesses'] or []
        row['laser_ready'] = row['laser_ready'] or []
        row['files'] = row['files'] or 0
        row['updated_at'] = now
        thumb = existing.get(it['id'], {}).get('thumb_url')
        if it.get('thumb') and (all_thumbs or not thumb):
            fn = os.path.join(supa.MAKER_ROOT, '_catalog', it['thumb'])
            if os.path.exists(fn):
                thumb = supa.upload('maker-thumbs', os.path.basename(it['thumb']), open(fn, 'rb').read(), 'image/jpeg')
                uploaded += 1
        row['thumb_url'] = thumb
        rows.append(row)
    for i in range(0, len(rows), 500):
        supa.rest('POST', 'maker_models?on_conflict=id', rows[i:i + 500], prefer='resolution=merge-duplicates,return=minimal')
    gone = sorted(set(existing) - {it['id'] for it in items})
    print(f'{len(rows)} modellen gesynchroniseerd, {uploaded} thumbnails opgeladen'
          + (f', {len(gone)} niet meer in de catalogus: {", ".join(gone[:10])}' if gone else ''))


if __name__ == '__main__':
    main()
