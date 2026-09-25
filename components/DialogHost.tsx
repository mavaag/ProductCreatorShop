"use client";

import { useEffect, useState } from "react";

/**
 * Themed vervanging voor window.confirm()/window.alert(). Eén host-component (gerenderd in de root
 * layout) toont het actieve dialoogscherm; confirmDialog()/alertDialog() zijn overal aanroepbare
 * async functies (net als hun browser-eigen tegenhangers) die een promise teruggeven.
 */
type DialogState =
  | { kind: "confirm"; message: string; confirmLabel: string; danger: boolean; resolve: (value: boolean) => void }
  | { kind: "alert"; message: string; resolve: () => void };

let show: ((state: DialogState) => void) | null = null;

export function confirmDialog(message: string, opts?: { confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) {
      resolve(window.confirm(message)); // veiligheidsnet als de host nog niet gemount is
      return;
    }
    show({ kind: "confirm", message, confirmLabel: opts?.confirmLabel ?? "Bevestigen", danger: opts?.danger ?? false, resolve });
  });
}

export function alertDialog(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (!show) {
      window.alert(message);
      resolve();
      return;
    }
    show({ kind: "alert", message, resolve });
  });
}

export function DialogHost() {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    show = setDialog;
    return () => {
      show = null;
    };
  }, []);

  if (!dialog) return null;

  function close() {
    setDialog(null);
  }
  function respondConfirm(value: boolean) {
    if (dialog?.kind === "confirm") dialog.resolve(value);
    close();
  }
  function respondAlert() {
    if (dialog?.kind === "alert") dialog.resolve();
    close();
  }
  const dismiss = () => (dialog.kind === "confirm" ? respondConfirm(false) : respondAlert());

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div className="modal-panel card" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <p className="mono" style={{ marginTop: 0, marginBottom: 0, whiteSpace: "pre-line" }}>
          {dialog.message}
        </p>
        <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {dialog.kind === "confirm" && (
            <button className="btn secondary" type="button" onClick={() => respondConfirm(false)}>
              Annuleren
            </button>
          )}
          <button
            className={dialog.kind === "confirm" && dialog.danger ? "btn danger" : "btn"}
            type="button"
            onClick={() => (dialog.kind === "confirm" ? respondConfirm(true) : respondAlert())}
            autoFocus
          >
            {dialog.kind === "confirm" ? dialog.confirmLabel : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
