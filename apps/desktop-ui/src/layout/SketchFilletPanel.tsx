import { useEffect, useRef, useState } from "react";

const PREVIEW_DEBOUNCE_MS = 200;

interface SketchFilletPanelProps {
  // The fillet has already been created by the time the panel opens
  // (so the viewport shows a real preview); `initialValue` reflects
  // that committed radius. Typing here drives
  // `update_sketch_fillet_radius` for live previews.
  initialValue: number;
  disabled: boolean;
  onPreviewValue: (value: number) => Promise<void>;
  onConfirm: () => void | Promise<void>;
  // Cancel undoes the create — i.e. the panel is responsible for
  // calling `delete_sketch_fillet` to restore the original corner.
  onCancel: () => Promise<void>;
}

// Fusion-style floating panel for a 2D sketch fillet. Mirrors
// `EdgeOpPreviewPanel` (3D fillet/chamfer) but is intentionally a
// separate component because the 2D fillet's input model is
// different: it's anchored to a single corner, not a multi-edge
// selection. The numeric input drives the same debounced live
// preview though, so the body uses the same debounce + flush
// pattern to make Enter-after-typing reliable.
export function SketchFilletPanel({
  initialValue,
  disabled,
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
        Tangent arc replaces the corner; lines trim to fit the radius.
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
