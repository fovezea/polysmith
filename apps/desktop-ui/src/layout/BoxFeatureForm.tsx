import { useEffect, useState } from "react";

interface BoxFeatureFormProps {
  disabled: boolean;
  onSubmit: (width: number, height: number, depth: number) => Promise<void>;
  variant?: "panel" | "toolbar";
  // When `mode` is "edit", the form is editing an existing feature and
  // the submit button reads "Apply". `initialValues` prefills the inputs;
  // they're tracked by-reference so re-opening the editor on a different
  // feature reseeds the local state.
  mode?: "create" | "edit";
  initialValues?: { width: number; height: number; depth: number };
}

export function BoxFeatureForm({
  disabled,
  onSubmit,
  variant = "panel",
  mode = "create",
  initialValues,
}: BoxFeatureFormProps) {
  const [width, setWidth] = useState(() =>
    initialValues ? String(initialValues.width) : "20",
  );
  const [height, setHeight] = useState(() =>
    initialValues ? String(initialValues.height) : "20",
  );
  const [depth, setDepth] = useState(() =>
    initialValues ? String(initialValues.depth) : "20",
  );

  // Reseed when the caller swaps the feature being edited (e.g. user
  // double-clicks a different box in the timeline without closing the
  // panel). We deliberately key on the numeric values rather than the
  // object identity so the user's in-flight edits aren't blown away by
  // an unrelated parent re-render.
  useEffect(() => {
    if (!initialValues) {
      return;
    }
    setWidth(String(initialValues.width));
    setHeight(String(initialValues.height));
    setDepth(String(initialValues.depth));
  }, [initialValues?.width, initialValues?.height, initialValues?.depth]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await onSubmit(Number(width), Number(height), Number(depth));
  }

  return (
    <section
      className={variant === "toolbar" ? "px-4 py-4" : "cad-panel px-5 py-5"}
    >
      <p className="cad-kicker">
        {mode === "edit" ? "Edit Feature" : "Create Primitive"}
      </p>
      <h2
        className={
          variant === "toolbar"
            ? "mt-2 font-display text-base tracking-[0.06em] text-on-surface"
            : "cad-title mt-2"
        }
      >
        {mode === "edit" ? "Edit Box Feature" : "Add Box Feature"}
      </h2>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className={
          variant === "toolbar"
            ? "mt-4 grid grid-cols-2 gap-4"
            : "mt-5 flex flex-wrap items-end gap-4"
        }
      >
        <label className="min-w-[96px] flex-1 text-xs uppercase tracking-[0.2em] text-on-surface-muted">
          Width
          <input
            className="cad-input mt-2"
            type="number"
            min="0.01"
            step="0.01"
            value={width}
            onChange={(event) => {
              setWidth(event.target.value);
            }}
            disabled={disabled}
          />
        </label>
        <label className="min-w-[96px] flex-1 text-xs uppercase tracking-[0.2em] text-on-surface-muted">
          Height
          <input
            className="cad-input mt-2"
            type="number"
            min="0.01"
            step="0.01"
            value={height}
            onChange={(event) => {
              setHeight(event.target.value);
            }}
            disabled={disabled}
          />
        </label>
        <label className="min-w-[96px] flex-1 text-xs uppercase tracking-[0.2em] text-on-surface-muted">
          Depth
          <input
            className="cad-input mt-2"
            type="number"
            min="0.01"
            step="0.01"
            value={depth}
            onChange={(event) => {
              setDepth(event.target.value);
            }}
            disabled={disabled}
          />
        </label>
        <button
          className={
            variant === "toolbar"
              ? "cad-action-primary col-span-2 min-w-[140px]"
              : "cad-action-primary min-w-[140px]"
          }
          type="submit"
          disabled={disabled}
        >
          {mode === "edit" ? "Apply" : "Add Box"}
        </button>
      </form>
    </section>
  );
}
