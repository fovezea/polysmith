import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const PREVIEW_DEBOUNCE_MS = 200;

interface RevolvePreviewPanelProps {
  phase: "pending" | "active";
  initialAngle: number;
  profileLabel: string | null;
  axisLabel: string | null;
  disabled: boolean;
  canConfirm: boolean;
  onPreviewAngle: (angleDegrees: number) => Promise<void>;
  onConfirm: (angleDegrees: number) => void | Promise<void>;
  onCancel: () => Promise<void>;
}

export function RevolvePreviewPanel({
  phase,
  initialAngle,
  profileLabel,
  axisLabel,
  disabled,
  canConfirm,
  onPreviewAngle,
  onConfirm,
  onCancel,
}: RevolvePreviewPanelProps) {
  const { t } = useTranslation();
  const [angle, setAngle] = useState(String(initialAngle));
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

  useEffect(() => {
    setAngle(String(initialAngle));
    lastPreviewedRef.current = initialAngle;
  }, [initialAngle]);

  function parseAngle(value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 360) {
      return null;
    }
    return parsed;
  }

  function handleAngleChange(nextValue: string) {
    setAngle(nextValue);
    const parsed = parseAngle(nextValue);
    if (parsed === null) {
      return;
    }
    if (phase === "pending") {
      lastPreviewedRef.current = parsed;
      void onPreviewAngleRef.current(parsed);
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

  async function flushPendingAngle() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    const parsed = parseAngle(angle);
    if (parsed === null || parsed === lastPreviewedRef.current) {
      return parsed;
    }
    lastPreviewedRef.current = parsed;
    await onPreviewAngleRef.current(parsed);
    return parsed;
  }

  async function handleConfirm() {
    const parsed =
      phase === "active" ? await flushPendingAngle() : parseAngle(angle);
    if (parsed === null) {
      return;
    }
    await onConfirm(parsed);
  }

  return (
    <section className="pointer-events-auto cad-floating-panel box-border w-80 max-w-[calc(100vw-2rem)] overflow-hidden px-5 py-5">
      <p className="cad-kicker">{t("panels.revolve.title")}</p>
      <div className="mt-3 space-y-2 rounded-md bg-surface-container-low px-3 py-2 text-xs uppercase tracking-[0.16em] text-on-surface-muted">
        <div className="flex items-center justify-between gap-3">
          <span>{t("panels.revolve.profile")}</span>
          <span className="min-w-0 truncate text-on-surface">
            {profileLabel ?? t("panels.revolve.pickProfile")}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>{t("panels.revolve.axis")}</span>
          <span className="min-w-0 truncate text-on-surface">
            {axisLabel ?? t("panels.revolve.pickAxis")}
          </span>
        </div>
      </div>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <label className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
          {t("panels.revolve.angle")}
          <input
            ref={inputRef}
            className="cad-input mt-2"
            type="number"
            min="0.01"
            max="360"
            step="1"
            value={angle}
            disabled={disabled}
            onChange={(event) => handleAngleChange(event.target.value)}
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
            disabled={disabled || !canConfirm || parseAngle(angle) === null}
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
          {t("panels.revolve.pickHint")}
        </p>
      </form>
    </section>
  );
}
