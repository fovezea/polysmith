import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const PREVIEW_DEBOUNCE_MS = 200;

interface OffsetPlanePanelProps {
  // True while the user hasn't picked a source plane yet. The panel
  // shows the offset input but no live preview is happening; the
  // typed value is captured in a ref so the next plane click creates
  // the feature with the latest value. Mirrors the
  // `EdgeOpPreviewPanel` pending-phase pattern.
  isPending: boolean;
  initialOffset: number;
  // Human-friendly description of what the user just clicked
  // (e.g. "XY plane", "Top face"). Empty during the pending phase.
  // Never an internal id — see AGENTS.md UI Copy Rules.
  sourceSummary: string;
  disabled: boolean;
  // Fires (debounced) on every typed value. During the pending phase
  // the parent stashes it in a ref; during the active phase it
  // dispatches `update_offset_plane` for live preview.
  onPreviewOffset: (offset: number) => Promise<void> | void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => Promise<void> | void;
}

// Floating contextual modeling "Offset Plane" panel. Two phases:
//
//   * Pending: panel is open, no feature yet. The user picks a plane
//     in the viewport; the parent's click handler reads the typed
//     offset and dispatches `create_offset_plane`. Enter / Confirm is
//     a no-op until a source has been picked.
//   * Active: feature exists in the document; typing here drives
//     `update_offset_plane` (debounced) for live preview. Enter
//     confirms; Escape calls `undo` to drop the feature.
export function OffsetPlanePanel({
  isPending,
  initialOffset,
  sourceSummary,
  disabled,
  onPreviewOffset,
  onConfirm,
  onCancel,
}: OffsetPlanePanelProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(String(initialOffset));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const lastPreviewedRef = useRef<number>(initialOffset);
  const onPreviewOffsetRef = useRef(onPreviewOffset);

  useEffect(() => {
    onPreviewOffsetRef.current = onPreviewOffset;
  }, [onPreviewOffset]);

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
    // Offsets can be negative (the plane slides backward along the
    // source's normal). Zero is a valid frame too — it just sits on
    // top of the source — but the core's create path will accept it
    // and the user can see what they've got.
    if (!Number.isFinite(parsed)) {
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
      void onPreviewOffsetRef.current(parsed);
    }, PREVIEW_DEBOUNCE_MS);
  }

  async function flushPendingValue() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    if (parsed === lastPreviewedRef.current) {
      return;
    }

    lastPreviewedRef.current = parsed;
    await onPreviewOffsetRef.current(parsed);
  }

  async function handleConfirm() {
    if (isPending) {
      // Nothing to confirm yet — the user still needs to click a plane.
      return;
    }
    await flushPendingValue();
    await onConfirm();
  }

  return (
    <section className="pointer-events-auto cad-floating-panel px-5 py-5">
      <p className="cad-kicker">{t("common.construction")}</p>
      <h2 className="cad-title mt-2">{t("panels.offsetPlane.title")}</h2>
      <p className="mt-1 text-xs text-on-surface-muted">
        {isPending
          ? t("panels.offsetPlane.pickSource")
          : sourceSummary
            ? t("panels.offsetPlane.fromSource", { source: sourceSummary })
            : t("panels.offsetPlane.adjustOffset")}
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <label className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
          {t("forms.offsetMm")}
          <input
            ref={inputRef}
            className="cad-input mt-2"
            type="number"
            step="0.1"
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
            disabled={disabled || isPending || !Number.isFinite(Number(value))}
          >
            {t("common.confirm")}
          </button>
          <button
            type="button"
            className="cad-action-ghost flex-1"
            disabled={disabled}
            onClick={() => {
              void onCancel();
            }}
          >
            {t("common.cancel")}
          </button>
        </div>
        <p className="text-[11px] uppercase tracking-[0.16em] text-on-surface-dim">
          {t("panels.shortcutHint.confirm")}
        </p>
      </form>
    </section>
  );
}
