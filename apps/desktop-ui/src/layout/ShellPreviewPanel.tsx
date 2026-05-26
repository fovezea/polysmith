import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const PREVIEW_DEBOUNCE_MS = 200;

interface ShellPreviewPanelProps {
  isPending: boolean;
  initialThickness: number;
  faceSummary: string;
  disabled: boolean;
  onPreviewThickness: (thickness: number) => Promise<void> | void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => Promise<void> | void;
}

export function ShellPreviewPanel({
  isPending,
  initialThickness,
  faceSummary,
  disabled,
  onPreviewThickness,
  onConfirm,
  onCancel,
}: ShellPreviewPanelProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(String(initialThickness));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const lastPreviewedRef = useRef<number>(initialThickness);
  const onPreviewThicknessRef = useRef(onPreviewThickness);

  useEffect(() => {
    onPreviewThicknessRef.current = onPreviewThickness;
  }, [onPreviewThickness]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (previewTimerRef.current !== null) {
        window.clearTimeout(previewTimerRef.current);
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
      void onPreviewThicknessRef.current(parsed);
    }, PREVIEW_DEBOUNCE_MS);
  }

  async function flushPendingValue() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    const parsed = Number(value);
    if (
      !Number.isFinite(parsed) ||
      parsed <= 0 ||
      parsed === lastPreviewedRef.current
    ) {
      return;
    }
    lastPreviewedRef.current = parsed;
    await onPreviewThicknessRef.current(parsed);
  }

  async function handleConfirm() {
    if (isPending) {
      return;
    }
    await flushPendingValue();
    await onConfirm();
  }

  return (
    <section className="pointer-events-auto cad-floating-panel px-5 py-5">
      <p className="cad-kicker">{t("panels.shell.title")}</p>
      <p className="mt-3 text-xs text-on-surface-muted">
        {isPending
          ? t("panels.shell.pickFace")
          : faceSummary
            ? t("panels.shell.fromFace", { face: faceSummary })
            : t("panels.shell.adjustThickness")}
      </p>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <label className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
          {t("forms.thicknessMm")}
          <input
            ref={inputRef}
            className="cad-input mt-2"
            type="number"
            min="0.1"
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
            disabled={disabled || isPending || Number(value) <= 0}
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
