"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useAuthGuard } from "@/lib/useAuthGuard";
import { machineHourlyCosts } from "@/lib/pricing";
import { Machine, ProductVariation } from "@/lib/types";
import { offerRecalculation } from "@/lib/recalc";
import { confirmDialog } from "@/components/DialogHost";

const CATEGORIES = [
  { value: "3d_printer", label: "3D-printer" },
  { value: "uv_printer", label: "UV-printer" },
  { value: "laser", label: "Laser" },
  { value: "sublimation_printer", label: "Sublimatieprinter" },
  { value: "heat_press", label: "Heat press" },
  { value: "overig", label: "Overig" },
];

const BLANK_FORM = {
  name: "",
  category: "3d_printer",
  purchase_price: 0,
  expected_lifetime_hours: 4000,
  avg_power_w: 150,
  electricity_price: 0.30,
};

const CATEGORY_COLORS: Record<string, string> = {
  "3d_printer": "var(--cyan)",
  uv_printer: "#b56bff",
  laser: "#ff8a3d",
  sublimation_printer: "var(--magenta)",
  heat_press: "var(--yellow)",
  overig: "var(--ink-soft)",
};
function categoryColor(category: string) {
  return CATEGORY_COLORS[category] ?? "var(--ink-soft)";
}

/** Kleine lijntekening van het type machine (3D-printer, UV-flatbed, lasercutter, inkjet, heat press). */
function MachineIllustration({ category, size = 48 }: { category: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (category) {
    case "3d_printer":
      // Gesloten printer: frame, gantry met printkop, bed met een half geprint object
      return (
        <svg {...common}>
          <rect x="6" y="4" width="36" height="38" />
          <path d="M6 10h36" opacity="0.5" />
          <path d="M9 15h30" />
          <rect x="20" y="13" width="8" height="5" />
          <path d="M22.5 18l1.5 2.5 1.5-2.5" />
          <path d="M10 37h28" />
          <path d="M18 37v-9h12v9M18 31h12M18 34h12" opacity="0.8" />
          <path d="M10 42v2M38 42v2" />
        </svg>
      );
    case "uv_printer":
      // Flatbed: brug met printkop en UV-lamp die op een object op het bed schijnt
      return (
        <svg {...common}>
          <rect x="4" y="27" width="40" height="13" />
          <path d="M8 27V12h32v15" />
          <rect x="19" y="13" width="10" height="6" />
          <path d="M21 21v3M24 21v3M27 21v3" strokeDasharray="1 1.5" />
          <rect x="16" y="24" width="16" height="3" />
          <path d="M9 34h8" opacity="0.6" />
          <circle cx="38" cy="33.5" r="1.5" />
        </svg>
      );
    case "laser":
      // Lasercutter met open deksel, kop en straal op het werkstuk
      return (
        <svg {...common}>
          <path d="M4 20L11 6h33v14" />
          <rect x="4" y="20" width="40" height="20" />
          <path d="M8 24h32" opacity="0.5" />
          <rect x="21" y="23" width="6" height="4" />
          <path d="M24 27v7" strokeDasharray="2 1.5" />
          <path d="M21 35l3-1 3 1M24 34v2" />
          <path d="M9 36h30" opacity="0.6" />
          <circle cx="39" cy="31" r="1" />
        </svg>
      );
    case "sublimation_printer":
      // Bureau-inkjetprinter met papier in de invoer en uitvoerlade
      return (
        <svg {...common}>
          <path d="M14 18V6h20v12" />
          <path d="M18 10h12M18 13h8" opacity="0.6" />
          <rect x="5" y="18" width="38" height="14" />
          <path d="M11 27h22" />
          <rect x="35" y="21" width="5" height="3" />
          <path d="M10 32l-2 8h32l-2-8" />
          <path d="M14 36h20" opacity="0.6" />
        </svg>
      );
    case "heat_press":
      // Clamshell-pers: onderplaat, opengeklapte (hete) bovenplaat met hendel
      return (
        <svg {...common}>
          <rect x="5" y="38" width="34" height="5" />
          <rect x="8" y="33" width="28" height="5" />
          <path d="M39 40h4V30" />
          <circle cx="40" cy="28" r="2.5" />
          <path d="M38 26L12 14l-2 4 26 12" />
          <path d="M38.5 26L44 9" />
          <path d="M42 8l4 1.5" strokeWidth="2.6" />
          <path d="M14 23c1-1 0-2 1-3M20 26c1-1 0-2 1-3M26 29c1-1 0-2 1-3" opacity="0.7" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="24" cy="24" r="6" />
          <path d="M24 8v6M24 34v6M8 24h6M34 24h6M12.7 12.7l4.2 4.2M31.1 31.1l4.2 4.2M12.7 35.3l4.2-4.2M31.1 16.9l4.2-4.2" />
          <circle cx="24" cy="24" r="12" opacity="0.5" />
        </svg>
      );
  }
}

type Usage = { productId: string; productName: string; variations: number };

export default function MachinesPage() {
  const ready = useAuthGuard();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [form, setForm] = useState(BLANK_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [usage, setUsage] = useState<Record<string, Usage[]>>({});
  const [openUsage, setOpenUsage] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("machines").select("*").order("name");
    setMachines(data ?? []);

    // In welke producten wordt elke machine gebruikt? (afgeleid uit de machinetijd van alle varianten)
    const [{ data: variations }, { data: products }] = await Promise.all([
      supabase.from("product_variations").select("id, product_id, cost_inputs"),
      supabase.from("products").select("id, name"),
    ]);
    const names = new Map((products ?? []).map((p: any) => [p.id as string, p.name as string]));
    const perMachine: Record<string, Map<string, Usage>> = {};
    for (const v of (variations ?? []) as Pick<ProductVariation, "id" | "product_id" | "cost_inputs">[]) {
      for (const line of v.cost_inputs?.machine_time ?? []) {
        const byProduct = (perMachine[line.machine_id] ??= new Map());
        const entry = byProduct.get(v.product_id) ?? { productId: v.product_id, productName: names.get(v.product_id) ?? "?", variations: 0 };
        entry.variations++;
        byProduct.set(v.product_id, entry);
      }
    }
    setUsage(Object.fromEntries(Object.entries(perMachine).map(([id, m]) => [id, Array.from(m.values()).sort((a, b) => a.productName.localeCompare(b.productName))])));
  }

  useEffect(() => {
    if (ready) load();
  }, [ready]);

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    await supabase.from("machines").insert(form);
    setForm({ ...BLANK_FORM });
    load();
  }

  function startEdit(m: Machine) {
    setEditingId(m.id);
    setEditForm({
      name: m.name,
      category: m.category,
      purchase_price: m.purchase_price,
      expected_lifetime_hours: m.expected_lifetime_hours,
      avg_power_w: m.avg_power_w,
      electricity_price: m.electricity_price,
    });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    await supabase.from("machines").update(editForm).eq("id", id);
    await offerRecalculation(supabase, "Machinewijziging");
    setSaving(false);
    setEditingId(null);
    load();
  }

  async function deleteMachine(id: string) {
    if (!(await confirmDialog("Deze machine verwijderen? Producten die ernaar verwijzen tonen dan geen prijs meer tot je een andere machine kiest.", { confirmLabel: "Verwijderen", danger: true }))) return;
    await supabase.from("machines").delete().eq("id", id);
    load();
  }

  if (!ready) return null;

  const visibleMachines = filter === "all" ? machines : machines.filter((m) => m.category === filter);
  const totalInvestment = machines.reduce((sum, m) => sum + m.purchase_price, 0);
  const hourlyTotals = machines.map((m) => {
    const c = machineHourlyCosts(m);
    return c.depreciationPerHour + c.powerCostPerHour;
  });
  const avgPerHour = hourlyTotals.length ? hourlyTotals.reduce((a, b) => a + b, 0) / hourlyTotals.length : 0;

  return (
    <div>
      <h1>Machines</h1>
      <p className="sub">Aankoopprijs, levensduur en vermogen -- afschrijving en stroomkosten per uur worden automatisch berekend en meegeteld bij de prijsberekening van je producten.</p>

      <div className="mat-stats" style={{ marginBottom: 20 }}>
        <div className="card stat-tile">
          <div className="stat-label">Machines</div>
          <div className="stat-value">{machines.length}</div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Totale investering</div>
          <div className="stat-value">€{totalInvestment.toFixed(0)}</div>
        </div>
        <div className="card stat-tile">
          <div className="stat-label">Gem. kost per uur</div>
          <div className="stat-value">€{avgPerHour.toFixed(2)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Nieuwe machine</h2>
        <form onSubmit={addMachine}>
          <div className="row">
            <div>
              <label>Naam</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label>Categorie</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="row">
            <div>
              <label>Aankoopprijs (€)</label>
              <input type="number" step="0.01" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label>Verwachte levensduur (u)</label>
              <input type="number" value={form.expected_lifetime_hours} onChange={(e) => setForm({ ...form, expected_lifetime_hours: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="row">
            <div>
              <label>Gemiddeld vermogen (W)</label>
              <input type="number" value={form.avg_power_w} onChange={(e) => setForm({ ...form, avg_power_w: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label>Elektriciteitsprijs (€/kWh)</label>
              <input type="number" step="0.01" value={form.electricity_price} onChange={(e) => setForm({ ...form, electricity_price: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>
          <button className="btn" type="submit" style={{ marginTop: 16 }}>Machine toevoegen</button>
        </form>
      </div>

      <div className="tabs">
        <button type="button" className={`tab${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
          Alles <span className="tab-count">{machines.length}</span>
        </button>
        {CATEGORIES.filter((c) => machines.some((m) => m.category === c.value)).map((c) => (
          <button key={c.value} type="button" className={`tab mat-tab${filter === c.value ? " active" : ""}`} onClick={() => setFilter(c.value)}>
            <MachineIllustration category={c.value} size={18} />
            {c.label} <span className="tab-count">{machines.filter((m) => m.category === c.value).length}</span>
          </button>
        ))}
      </div>

      {visibleMachines.length === 0 && <p className="muted">Geen machines in deze selectie.</p>}

      <div className="mat-grid">
        {visibleMachines.map((m) => {
          const color = categoryColor(m.category);
          if (editingId === m.id) {
            return (
              <div key={m.id} className="mat-card editing" style={{ "--mat-color": color } as React.CSSProperties}>
                <label style={{ marginTop: 0 }}>Naam</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                <label>Categorie</label>
                <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <div className="row">
                  <div>
                    <label>Aankoopprijs (€)</label>
                    <input className="mono" type="number" step="0.01" value={editForm.purchase_price} onChange={(e) => setEditForm({ ...editForm, purchase_price: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label>Levensduur (u)</label>
                    <input className="mono" type="number" value={editForm.expected_lifetime_hours} onChange={(e) => setEditForm({ ...editForm, expected_lifetime_hours: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <label>Vermogen (W)</label>
                    <input className="mono" type="number" value={editForm.avg_power_w} onChange={(e) => setEditForm({ ...editForm, avg_power_w: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div>
                    <label>Elektriciteit (€/kWh)</label>
                    <input className="mono" type="number" step="0.01" value={editForm.electricity_price} onChange={(e) => setEditForm({ ...editForm, electricity_price: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>Kosten per uur worden herberekend na opslaan.</p>
                <div style={{ marginTop: 14 }}>
                  <button className="btn" onClick={() => saveEdit(m.id)} disabled={saving} style={{ marginRight: 6 }}>{saving ? "..." : "Opslaan"}</button>
                  <button className="btn secondary" onClick={() => setEditingId(null)}>Annuleer</button>
                </div>
              </div>
            );
          }
          const { depreciationPerHour, powerCostPerHour } = machineHourlyCosts(m);
          const perHour = depreciationPerHour + powerCostPerHour;
          const depPct = perHour > 0 ? (depreciationPerHour / perHour) * 100 : 0;
          const used = usage[m.id] ?? [];
          return (
            <div key={m.id} className="mat-card" style={{ "--mat-color": color } as React.CSSProperties}>
              <div className="mat-head">
                <div className="mat-icon mach-illus"><MachineIllustration category={m.category} size={48} /></div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="mat-name">{m.name}</div>
                  <div className="mat-cat">{CATEGORIES.find((c) => c.value === m.category)?.label ?? m.category}</div>
                </div>
                <div className="mat-price">
                  <span className="mono">€{perHour.toFixed(2)}</span>
                  <span className="mat-unit">per uur</span>
                </div>
              </div>

              <div className="mach-split" title="Verdeling van de kost per uur">
                <div className="mach-split-dep" style={{ width: `${depPct}%` }} />
                <div className="mach-split-power" style={{ width: `${100 - depPct}%` }} />
              </div>
              <div className="mach-legend">
                <span><i className="mach-dot dep" />Afschrijving <span className="mono">€{depreciationPerHour.toFixed(3)}</span></span>
                <span><i className="mach-dot power" />Stroom <span className="mono">€{powerCostPerHour.toFixed(3)}</span></span>
              </div>

              <div className="mach-specs">
                <div><span>Aankoop</span><strong className="mono">€{m.purchase_price}</strong></div>
                <div><span>Levensduur</span><strong className="mono">{m.expected_lifetime_hours} u</strong></div>
                <div><span>Vermogen</span><strong className="mono">{m.avg_power_w} W</strong></div>
                <div><span>Stroomprijs</span><strong className="mono">€{m.electricity_price}/kWh</strong></div>
              </div>

              {used.length > 0 && (
                <div className="mat-chips">
                  <button type="button" className={`mat-chip${openUsage === m.id ? " active" : ""}`} onClick={() => setOpenUsage(openUsage === m.id ? null : m.id)} title="Gebruikt in producten">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
                    {used.length} product{used.length === 1 ? "" : "en"}
                  </button>
                </div>
              )}
              {openUsage === m.id && used.length > 0 && (
                <ul className="mat-usage">
                  {used.map((u) => (
                    <li key={u.productId}><Link href={`/products/${u.productId}`}>{u.productName}</Link> <span className="muted">({u.variations} var.)</span></li>
                  ))}
                </ul>
              )}

              <div className="mat-actions">
                <button className="icon-btn" onClick={() => startEdit(m)} title="Bewerken" aria-label="Bewerken">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
                </button>
                <button className="icon-btn mat-delete" onClick={() => deleteMachine(m.id)} title="Verwijderen" aria-label="Verwijderen">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Afschrijving en stroom per uur zijn precies de twee kostenposten die per machine-uur meegerekend worden in de kostprijs van elk product dat deze machine gebruikt.
      </p>
    </div>
  );
}
