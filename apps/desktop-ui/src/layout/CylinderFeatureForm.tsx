import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface CylinderFeatureFormProps {
  disabled: boolean;
  onSubmit: (radius: number, height: number) => Promise<void>;
  variant?: "panel" | "toolbar";
  // "edit" turns this into a parameter editor for an existing cylinder
  // feature. `initialValues` prefills the inputs; they reseed when the
  // values change so swapping the edited feature works without
  // remounting the form.
  mode?: "create" | "edit";
  initialValues?: { radius: number; height: number };
}

export function CylinderFeatureForm({
  disabled,
  onSubmit,
  variant = "panel",
  mode = "create",
  initialValues,
}: CylinderFeatureFormProps) {
  const { t } = useTranslation();
  const [radius, setRadius] = useState(() =>
    initialValues ? String(initialValues.radius) : "10",
  );
  const [height, setHeight] = useState(() =>
    initialValues ? String(initialValues.height) : "24",
  );

  useEffect(() => {
    if (!initialValues) {
      return;
    }
    setRadius(String(initialValues.radius));
    setHeight(String(initialValues.height));
  }, [initialValues?.radius, initialValues?.height]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(Number(radius), Number(height));
  }

  return (
    <section
      className={variant === "toolbar" ? "px-4 py-4" : "cad-panel px-5 py-5"}
    >
      <p className="cad-kicker">
        {mode === "edit" ? t("forms.editFeature") : t("forms.createPrimitive")}
      </p>
      <h2
        className={
          variant === "toolbar"
            ? "mt-2 font-display text-base tracking-[0.06em] text-on-surface"
            : "cad-title mt-2"
        }
      >
        {mode === "edit"
          ? t("forms.editCylinderFeature")
          : t("forms.addCylinderFeature")}
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
          {t("forms.radius")}
          <input
            className="cad-input mt-2"
            type="number"
            min="0.01"
            step="0.01"
            value={radius}
            onChange={(event) => {
              setRadius(event.target.value);
            }}
            disabled={disabled}
          />
        </label>
        <label className="min-w-[96px] flex-1 text-xs uppercase tracking-[0.2em] text-on-surface-muted">
          {t("forms.height")}
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
        <button
          className={
            variant === "toolbar"
              ? "cad-action-primary col-span-2 min-w-[160px]"
              : "cad-action-primary min-w-[160px]"
          }
          type="submit"
          disabled={disabled}
        >
          {mode === "edit" ? t("common.apply") : t("forms.addCylinder")}
        </button>
      </form>
    </section>
  );
}
