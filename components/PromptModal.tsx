"use client";

import { useEffect, useState } from "react";

/**
 * Modaal invoerscherm in de stijl van de rest van de app (i.p.v. de browser-eigen window.prompt),
 * voor een enkele tekstwaarde met optionele asynchrone validatie (bv. controleren of een SKU al
 * bestaat) voor je de bevestig-actie uitvoert.
 */
export function PromptModal({
  open,
  title,
  message,
  initialValue,
  confirmLabel = "Bevestigen",
  validate,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  initialValue: string;
  confirmLabel?: string;
  /** Geeft een foutmelding terug als de waarde ongeldig is, anders null/undefined. */
  validate?: (value: string) => Promise<string | null | undefined> | string | null | undefined;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setBusy(false);
    }
  }, [open, initialValue]);

  if (!open) return null;

  async function handleConfirm() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Dit veld mag niet leeg zijn.");
      return;
    }
    setBusy(true);
    const validationError = validate ? await validate(trimmed) : null;
    if (validationError) {
      setError(validationError);
      setBusy(false);
      return;
    }
    await onConfirm(trimmed);
    setBusy(false);
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {message && <p className="muted" style={{ marginTop: -8 }}>{message}</p>}
        <input
          autoFocus
          className="mono"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") onCancel();
          }}
        />
        {error && <div className="warning" style={{ marginTop: 10 }}>{error}</div>}
        <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn secondary" type="button" onClick={onCancel} disabled={busy}>
            Annuleren
          </button>
          <button className="btn" type="button" onClick={handleConfirm} disabled={busy}>
            {busy ? "Bezig..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
