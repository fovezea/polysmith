import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ExtrudeMode } from "@/types";

const PREVIEW_DEBOUNCE_MS = 200;

interface ExtrudeTargetBodyOption {
  id: string;
  label: string;
}

interface ExtrudePreviewPanelProps {
  phase?: "pending" | "active";
  initialDepth: number;
  initialMode: ExtrudeMode;
  selectedProfileCount?: number;
  // True if there is at least one prior body that a join/cut can target.
  // When false, the cut/join radio choices are disabled (a non-empty target
  // body is required for boolean composition).
  canCombineWithExistingBody: boolean;
  // Bodies (excluding the in-progress extrude itself) that cut/join can
  // target. When this list has a single entry the picker is hidden;
  // otherwise it appears whenever `mode` is a boolean op.
  availableTargetBodies: ExtrudeTargetBodyOption[];
  initialTargetBodyId: string | null;
  disabled: boolean;
  onPreviewDepth: (depth: number) => Promise<void>;
  onPreviewMode: (mode: ExtrudeMode) => Promise<void>;
  onPreviewTargetBody: (targetBodyId: string | null) => Promise<void>;
  onConfirm: (
    depth: number,
    mode: ExtrudeMode,
    targetBodyId: string | null,
  ) => void | Promise<void>;
  onCancel: () => Promise<void>;
}

// Floating contextual modeling "Edit Feature" panel for the in-progress extrude.
// The native core already created the extrude with the initial depth, so the
// viewport is showing a real preview. Typing here drives update_extrude_depth
// for live updates; Enter/Confirm closes; Escape/Cancel undoes.
export function ExtrudePreviewPanel({
  phase = "active",
  initialDepth,
  initialMode,
  selectedProfileCount = 1,
  canCombineWithExistingBody,
  availableTargetBodies,
  initialTargetBodyId,
  disabled,
  onPreviewDepth,
  onPreviewMode,
  onPreviewTargetBody,
  onConfirm,
  onCancel,
}: ExtrudePreviewPanelProps) {
  const { t } = useTranslation();
  const [depth, setDepth] = useState(String(initialDepth));
  const [mode, setMode] = useState<ExtrudeMode>(initialMode);
  const [targetBodyId, setTargetBodyId] = useState<string | null>(
    initialTargetBodyId,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const lastPreviewedRef = useRef<number>(initialDepth);
  const onPreviewDepthRef = useRef(onPreviewDepth);

  useEffect(() => {
    onPreviewDepthRef.current = onPreviewDepth;
  }, [onPreviewDepth]);

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

  function handleDepthChange(nextValue: string) {
    setDepth(nextValue);
    const parsed = Number(nextValue);
    if (phase === "pending") {
      if (Number.isFinite(parsed) && parsed !== 0) {
        void onPreviewDepthRef.current(parsed);
      }
      return;
    }
    // Signed depth: a negative depth extrudes in the -normal direction.
    // Zero is rejected because it would build a degenerate (volumeless)
    // shape, so we don't fire a preview for it.
    if (!Number.isFinite(parsed) || parsed === 0) {
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
      void onPreviewDepthRef.current(parsed);
    }, PREVIEW_DEBOUNCE_MS);
  }

  // Force-commit the current input value to the core. Used on Confirm so
  // pressing Enter while the debounce timer is still pending does not close
  // the panel before the typed depth has reached the core.
  async function flushPendingDepth() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    const parsed = Number(depth);
    if (!Number.isFinite(parsed) || parsed === 0) {
      return;
    }

    if (parsed === lastPreviewedRef.current) {
      return;
    }

    lastPreviewedRef.current = parsed;
    await onPreviewDepthRef.current(parsed);
  }

  async function handleConfirm() {
    if (phase === "active") {
      await flushPendingDepth();
    }
    const parsed = Number(depth);
    if (!Number.isFinite(parsed) || parsed === 0) {
      return;
    }
    await onConfirm(parsed, mode, targetBodyId);
  }

  return (
    <section className="pointer-events-auto cad-floating-panel px-5 py-5">
      <p className="cad-kicker">{t("common.action")}</p>
      <h2 className="cad-title mt-2">{t("panels.extrude.title")}</h2>
      <div className="mt-3 rounded-md bg-surface-container-low px-3 py-2 text-xs uppercase tracking-[0.16em] text-on-surface-muted">
        {selectedProfileCount === 1
          ? t("panels.extrude.faceSelected", { count: selectedProfileCount })
          : t("panels.extrude.facesSelected", { count: selectedProfileCount })}
      </div>
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <fieldset className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
          <legend className="mb-2">{t("panels.extrude.operation")}</legend>
          <div className="flex gap-2">
            {(
              [
                { value: "new_body", label: t("panels.extrude.newBody") },
                { value: "join", label: t("panels.extrude.join") },
                { value: "cut", label: t("panels.extrude.cut") },
              ] satisfies Array<{ value: ExtrudeMode; label: string }>
            ).map((option) => {
              const isBoolean = option.value !== "new_body";
              const optionDisabled =
                disabled || (isBoolean && !canCombineWithExistingBody);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={
                    mode === option.value
                      ? "cad-action-primary flex-1"
                      : "cad-action-ghost flex-1"
                  }
                  disabled={optionDisabled}
                  onClick={() => {
                    if (mode === option.value) {
                      return;
                    }
                    setMode(option.value);
                    void onPreviewMode(option.value);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {!canCombineWithExistingBody ? (
            <p className="mt-2 text-[10px] tracking-wide text-on-surface-dim normal-case">
              {t("panels.extrude.combineNeedsBody")}
            </p>
          ) : null}
        </fieldset>
        {mode !== "new_body" && availableTargetBodies.length > 1 ? (
          <label className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
            {t("panels.extrude.targetBody")}
            <select
              className="cad-input mt-2"
              value={targetBodyId ?? ""}
              disabled={disabled}
              onChange={(event) => {
                const nextValue = event.target.value || null;
                if (nextValue === targetBodyId) {
                  return;
                }
                setTargetBodyId(nextValue);
                void onPreviewTargetBody(nextValue);
              }}
            >
              {/* Empty value = "most recent body" — keeps single-body
                  workflows working without forcing the user to pick. */}
              <option value="">{t("panels.extrude.mostRecentBody")}</option>
              {availableTargetBodies.map((body) => (
                <option key={body.id} value={body.id}>
                  {body.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block text-xs uppercase tracking-[0.18em] text-on-surface-muted">
          {t("forms.depthMm")}
          <input
            ref={inputRef}
            className="cad-input mt-2"
            type="number"
            step="0.01"
            value={depth}
            disabled={disabled}
            onChange={(event) => {
              handleDepthChange(event.target.value);
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
            disabled={
              disabled ||
              (phase === "pending" && selectedProfileCount === 0) ||
              Number(depth) === 0 ||
              !Number.isFinite(Number(depth))
            }
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
