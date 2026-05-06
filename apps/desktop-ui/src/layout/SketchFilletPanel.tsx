import { useEffect, useRef, useState } from "react";

const PREVIEW_DEBOUNCE_MS = 200;

interface SketchFilletPanelProps {
  // Initial radius for the panel session. Used as the default for
  // every fillet created through this session and as the starting
  // value of the radius input.
  initialValue: number;
  disabled: boolean;
  // Number of fillets created so far in this panel session. Drives
  // the subtitle (so the user sees the picker react as they click
  // corners) and gates the Confirm button: with no fillets
  // created, Confirm is a no-op and disabled, matching the
  // `EdgeOpPreviewPanel` (3D fillet) contract.
  count: number;
  // Live-preview hook. Called on every debounced numeric change;
  // App is responsible for fanning the new radius out across all
  // created fillets via `update_sketch_fillet_radius`.
  onPreviewValue: (value: number) => Promise<void>;
  onConfirm: () => void | Promise<void>;
  // Cancel = discard the session. App calls
  // `delete_sketch_fillet` for every fillet it tracks, restoring
  // each corner.
  onCancel: () => Promise<void>;
}

// Fusion-style floating panel for the 2D sketch Fillet tool.
// Mirrors `EdgeOpPreviewPanel` (3D fillet/chamfer) one-to-one:
// pending phase (count === 0) prompts the user to click a corner;
// each click adds a fillet at the panel's current radius; the
// numeric input drives a debounced fan-out update across every
// fillet in the session.
export function SketchFilletPanel({
  initialValue,
  disabled,
  count,
  onPreviewValue,
  onConfirm,
  onCancel,
}: SketchFilletPanelProps) {
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

  // Force-commit the current input to the core before confirming so
  // that hitting Enter while the debounce is still pending doesn't
  // close the panel with a stale value.
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
      <h2 className="cad-title mt-2">Sketch Fillet</h2>
      <p className="mt-1 text-xs text-on-surface-muted">
        {count === 0
          ? "Click a corner to fillet"
          : `${count} corner${count === 1 ? "" : "s"} · click a corner to add another`}
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <label className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
          Radius (mm)
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
            disabled={disabled || Number(value) <= 0 || count === 0}
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
