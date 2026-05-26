import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const PREVIEW_DEBOUNCE_MS = 200;

interface AnglePlanePanelProps {
  phase: "pick_plane" | "pick_axis" | "active";
  initialAngle: number;
  sourceSummary: string;
  axisSummary: string;
  disabled: boolean;
  onPreviewAngle: (angleDegrees: number) => Promise<void> | void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => Promise<void> | void;
}

export function AnglePlanePanel({
  phase,
  initialAngle,
  sourceSummary,
  axisSummary,
  disabled,
  onPreviewAngle,
  onConfirm,
  onCancel,
}: AnglePlanePanelProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(String(initialAngle));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const lastPreviewedRef = useRef<number>(initialAngle);
  const onPreviewAngleRef = useRef(onPreviewAngle);

  useEffect(() => {
    onPreviewAngleRef.current = onPreviewAngle;
  }, [onPreviewAngle]);

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
      void onPreviewAngleRef.current(parsed);
    }, PREVIEW_DEBOUNCE_MS);
  }

  async function flushPendingValue() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed === lastPreviewedRef.current) {
      return;
    }

    lastPreviewedRef.current = parsed;
    await onPreviewAngleRef.current(parsed);
  }

  async function handleConfirm() {
    if (phase !== "active") {
      return;
    }
    await flushPendingValue();
    await onConfirm();
  }

  const helperText =
    phase === "pick_plane"
      ? t("panels.anglePlane.pickSource")
      : phase === "pick_axis"
        ? t("panels.anglePlane.pickAxis", { source: sourceSummary })
        : t("panels.anglePlane.fromSource", {
            source: sourceSummary,
            axis: axisSummary,
          });

  return (
    <section className="pointer-events-auto cad-floating-panel px-5 py-5">
      <p className="cad-kicker">{t("panels.anglePlane.title")}</p>
      <p className="mt-3 text-xs text-on-surface-muted">{helperText}</p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <label className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
          {t("forms.angleDegrees")}
          <input
            ref={inputRef}
            className="cad-input mt-2"
            type="number"
            step="1"
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
            disabled={disabled || phase !== "active" || !Number.isFinite(Number(value))}
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
