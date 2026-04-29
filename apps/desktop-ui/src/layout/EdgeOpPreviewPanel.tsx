import { useEffect, useRef, useState } from "react";

const PREVIEW_DEBOUNCE_MS = 200;

interface EdgeOpPreviewPanelProps {
  // "Fillet" or "Chamfer" — the only label that differs between the
  // two, so we keep the panel itself shared.
  title: string;
  // The numeric input label, e.g. "Radius (mm)" or "Distance (mm)".
  valueLabel: string;
  initialValue: number;
  disabled: boolean;
  // Live count of edges currently in the feature, so the user sees
  // the picker react as they shift-click in the viewport. The panel
  // doesn't drive the count itself — it just reflects the document.
  edgeCount: number;
  onPreviewValue: (value: number) => Promise<void>;
  onConfirm: () => void | Promise<void>;
  onCancel: () => Promise<void>;
}

// Floating Fusion-style "Edit Feature" panel for the in-progress fillet
// or chamfer. The native core has already created the feature with the
// initial value, so the viewport is showing a real preview. Typing here
// drives update_fillet_radius / update_chamfer_distance for live
// updates; Enter/Confirm closes; Escape/Cancel undoes.
export function EdgeOpPreviewPanel({
  title,
  valueLabel,
  initialValue,
  disabled,
  edgeCount,
  onPreviewValue,
  onConfirm,
  onCancel,
}: EdgeOpPreviewPanelProps) {
  const [value, setValue] = useState(String(initialValue));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const lastPreviewedRef = useRef<number>(initialValue);
  const onPreviewValueRef = useRef(onPreviewValue);

  useEffect(() => {
    onPreviewValueRef.current = onPreviewValue;
  }, [onPreviewValue]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }
    };
  }, []);

  function handleValueChange(nextValue: string) {
    setValue(nextValue);
    const parsed = Number(nextValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
    }

    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      if (parsed === lastPreviewedRef.current) {
        return;
      }
      lastPreviewedRef.current = parsed;
      void onPreviewValueRef.current(parsed);
    }, PREVIEW_DEBOUNCE_MS);
  }

  // Force-commit the current input value to the core. Used on Confirm so
  // pressing Enter while the debounce timer is still pending doesn't close
  // the panel before the typed value has reached the core.
  async function flushPendingValue() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }

    if (parsed === lastPreviewedRef.current) {
      return;
    }

    lastPreviewedRef.current = parsed;
    await onPreviewValueRef.current(parsed);
  }

  async function handleConfirm() {
    await flushPendingValue();
    await onConfirm();
  }

  return (
    <section className="pointer-events-auto cad-floating-panel px-5 py-5">
      <p className="cad-kicker">Action</p>
      <h2 className="cad-title mt-2">{title}</h2>
      <p className="mt-1 text-xs text-on-surface-muted">
        {edgeCount} edge{edgeCount === 1 ? "" : "s"} · click an edge to add /
        remove
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <label className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
          {valueLabel}
          <input
            ref={inputRef}
            className="cad-input mt-2"
            type="number"
            min="0.01"
            step="0.01"
            value={value}
            disabled={disabled}
            onChange={(event) => {
              handleValueChange(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                void onCancel();
              }
            }}
          />
        </label>
        <div className="flex gap-3">
          <button
            type="submit"
            className="cad-action-primary flex-1"
            disabled={disabled || Number(value) <= 0}
          >
            Confirm
          </button>
          <button
            type="button"
            className="cad-action-ghost flex-1"
            disabled={disabled}
            onClick={() => {
              void onCancel();
            }}
          >
            Cancel
          </button>
        </div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-on-surface-dim">
          Enter to confirm · Esc to cancel
        </p>
      </form>
    </section>
  );
}
