import { useEffect } from "react";

interface MirrorToolPanelProps {
  // Live state from the document. The panel is purely reactive:
  // it reads the current selection out of `pending_mirror` and
  // dispatches updates back through the callbacks. No local state
  // beyond which slot is focused.
  axisLineId: string | null;
  objectIds: string[];
  generatedLineCount: number;
  generatedCircleCount: number;
  // Which input slot the next viewport entity click will fill.
  // Owned by the parent (App.tsx) so the click handler in
  // ViewportPanel can read it via the same path the rest of the
  // sketch tools use.
  focusedSlot: "objects" | "axis" | null;
  disabled: boolean;
  onFocusObjects: () => void;
  onFocusAxis: () => void;
  onClearObjects: () => Promise<void>;
  onClearAxis: () => Promise<void>;
  onConfirm: () => Promise<void>;
  onCancel: () => Promise<void>;
}

// Floating Fusion-style panel for the in-progress Mirror tool.
// The native core has already opened a `pending_mirror` on the
// active sketch, and is regenerating preview geometry on every
// `update_mirror_preview_axis` / `update_mirror_preview_objects`
// call. The panel itself is a thin shell over those calls — it
// only owns the *focused slot* (which slot the next entity
// click should land in).
export function MirrorToolPanel({
  axisLineId,
  objectIds,
  generatedLineCount,
  generatedCircleCount,
  focusedSlot,
  disabled,
  onFocusObjects,
  onFocusAxis,
  onClearObjects,
  onClearAxis,
  onConfirm,
  onCancel,
}: MirrorToolPanelProps) {
  // Esc / Enter shortcuts when the panel has focus. Global hotkeys
  // (when focus is in the canvas) live in App.tsx — those take
  // precedence and call the same callbacks.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        void onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void onConfirm();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel, onConfirm]);

  const totalGenerated = generatedLineCount + generatedCircleCount;
  // Apply requires both slots to be filled. Mirroring with no
  // objects (or no axis) wouldn't produce geometry, so we gate
  // the button rather than letting the user commit a no-op.
  const canApply = axisLineId !== null && objectIds.length > 0 && !disabled;

  return (
    <section className="pointer-events-auto cad-floating-panel px-5 py-5 w-72">
      <p className="cad-kicker">Sketch · Action</p>
      <h2 className="cad-title mt-2">Mirror</h2>
      <p className="mt-1 text-xs text-on-surface-muted">
        Pick objects to reflect, then a line as the mirror axis.
      </p>

      <div className="mt-4 space-y-3">
        {/* Objects slot. Clicking the slot focuses it; viewport
            entity clicks then add to the list (and clicking an
            already-included entity removes it — handled in App). */}
        <button
          type="button"
          className={
            focusedSlot === "objects"
              ? "cad-input cad-input-active w-full text-left"
              : "cad-input w-full text-left"
          }
          disabled={disabled}
          onClick={onFocusObjects}
        >
          <span className="block text-[11px] uppercase tracking-[0.16em] text-on-surface-muted">
            Objects
          </span>
          <span className="mt-1 block text-sm">
            {objectIds.length === 0
              ? "Click to select…"
              : `${objectIds.length} selected`}
          </span>
        </button>
        {objectIds.length > 0 ? (
          <button
            type="button"
            className="cad-link-button text-[11px] uppercase tracking-[0.16em]"
            disabled={disabled}
            onClick={() => {
              void onClearObjects();
            }}
          >
            Clear objects
          </button>
        ) : null}

        {/* Axis slot. Same focus pattern; viewport line clicks set
            the axis. Picking a circle is rejected by the core
            (it can't be a mirror axis). */}
        <button
          type="button"
          className={
            focusedSlot === "axis"
              ? "cad-input cad-input-active w-full text-left"
              : "cad-input w-full text-left"
          }
          disabled={disabled}
          onClick={onFocusAxis}
        >
          <span className="block text-[11px] uppercase tracking-[0.16em] text-on-surface-muted">
            Mirror line
          </span>
          <span className="mt-1 block text-sm">
            {/* Never expose internal ids in the UI — the user
                only needs to know whether something is selected. */}
            {axisLineId ? "1 selected" : "Click to select…"}
          </span>
        </button>
        {axisLineId !== null ? (
          <button
            type="button"
            className="cad-link-button text-[11px] uppercase tracking-[0.16em]"
            disabled={disabled}
            onClick={() => {
              void onClearAxis();
            }}
          >
            Clear axis
          </button>
        ) : null}
      </div>

      <p className="mt-4 text-[11px] text-on-surface-dim">
        Preview: {totalGenerated} entit{totalGenerated === 1 ? "y" : "ies"}
      </p>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="cad-action-primary flex-1"
          disabled={!canApply}
          onClick={() => {
            void onConfirm();
          }}
        >
          Apply
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
      <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-on-surface-dim">
        Enter to apply · Esc to cancel
      </p>
    </section>
  );
}
