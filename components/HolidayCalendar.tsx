"use client";

import { useState } from "react";

// Feestdagenkalender (plugin "3DP Klanten" 1.6.0): de shop zet een tijdje voor elke feestdag een concept-campagne
// klaar (tekst, passende collectie + producten, knop) en mailt de winkel. Er gaat nooit vanzelf iets naar klanten.

export type HolidayRow = {
  key: string; label: string; enabled: boolean; date: string; send: string; prepare: string; year: number; campaign_id: string | null;
};
export type Calendar = { holidays: HolidayRow[]; settings: { prepare_days: number; notify: boolean } };

function day(ymd: string) {
  const d = new Date(ymd + "T12:00:00");
  return d.toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function HolidayCalendar({ calendar, busy, onSave, onDraft, onOpen }: {
  calendar: Calendar; busy: boolean;
  onSave: (c: { enabled: Record<string, boolean>; prepare_days: number; notify: boolean }) => void;
  onDraft: (key: string) => void;
  onOpen: (campaignId: string) => void;
}) {
  const [prep, setPrep] = useState(calendar.settings.prepare_days);
  const [notify, setNotify] = useState(calendar.settings.notify);
  const today = new Date().toISOString().slice(0, 10);
  const save = (enabled: Record<string, boolean>) => onSave({ enabled, prepare_days: prep, notify });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>Feestdagenkalender</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Voor elke aangevinkte feestdag zet de shop een <b>concept</b> klaar (tekst, de passende collectie met een paar producten en een knop),
        {" "}{prep} dagen voor de voorgestelde verzenddag, en {notify ? "mailt je dat het klaarstaat" : "toont het hier"}. Je kijkt het na en klikt zelf op
        {" "}<i>Inplannen</i> of <i>Nu versturen</i> -- er gaat nooit vanzelf iets naar klanten.
      </p>
      <div className="table-wrap">
        <table className="cal-table">
          <thead>
            <tr><th></th><th>Feestdag</th><th>Datum</th><th>Verzenden rond</th><th>Concept klaar op</th><th></th></tr>
          </thead>
          <tbody>
            {calendar.holidays.map((h) => (
              <tr key={h.key} className={h.enabled ? "" : "cal-off"}>
                <td><input type="checkbox" style={{ width: "auto" }} checked={h.enabled} disabled={busy} title={h.enabled ? "Uitzetten" : "Aanzetten"}
                  onChange={(e) => save({ [h.key]: e.target.checked })} /></td>
                <td><b>{h.label}</b></td>
                <td>{day(h.date)}</td>
                <td>{day(h.send)}</td>
                <td>{h.campaign_id ? <span className="pill cyan">klaar</span> : h.enabled ? (h.prepare <= today ? <span className="pill yellow">vandaag</span> : day(h.prepare)) : <span className="muted">uit</span>}</td>
                <td style={{ textAlign: "right" }}>
                  {h.campaign_id
                    ? <button type="button" className="btn secondary" onClick={() => onOpen(h.campaign_id as string)}>Concept openen</button>
                    : <button type="button" className="btn secondary" disabled={busy} onClick={() => onDraft(h.key)}>Nu concept maken</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ alignItems: "end", marginTop: 12, maxWidth: 700 }}>
        <div>
          <label>Concept klaarzetten (dagen voor verzenden)</label>
          <input className="mono" type="number" min={1} max={60} value={prep} onChange={(e) => setPrep(parseInt(e.target.value) || 7)} />
        </div>
        <label className="customers-check" style={{ flex: "0 0 auto", marginBottom: 8 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Mail me als een concept klaarstaat
        </label>
        <div style={{ flex: "0 0 auto" }}>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => save({})}>Bewaren</button>
        </div>
      </div>
    </div>
  );
}
