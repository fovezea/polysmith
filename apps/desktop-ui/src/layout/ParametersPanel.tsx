import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCadCoreStore } from "@/state";
import { useCadCore } from "@/hooks";
import { useAppConfig } from "@/config";
import { mmToDisplay, displayToMm } from "@/utils/units";
import { Dropdown } from "@/lib";
import type { DropdownOption } from "@/lib";
import type { ParameterEntry } from "@/types";

interface EditingRow {
  index: number;
  name: string;
  expression: string;
  kind: "length" | "angle";
  isNew: boolean;
}

export function ParametersPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const document = useCadCoreStore((s) => s.document);
  const { config } = useAppConfig();
  const { addParameter, updateParameter, deleteParameter } = useCadCore();

  const [editing, setEditing] = useState<EditingRow | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const exprRef = useRef<HTMLInputElement | null>(null);

  const parameters: ParameterEntry[] = document?.parameters ?? [];

  // Detect a plain numeric expression (no letters, no operators) so we
  // can convert from the display unit to mm. Formulas like "width * 2"
  // are sent as-is — the user is responsible for unit consistency there.
  const PLAIN_NUMBER_RE = /^[0-9.,]+$/;

  const commitEdit = useCallback(async () => {
    if (!editing) return;
    const { index, name, expression, kind, isNew } = editing;

    if (!name.trim()) {
      setEditing(null);
      return;
    }

    const rawExpression = expression.trim();

    // When creating a new length parameter in inch mode, convert a
    // plain numeric expression from inches to mm so the stored value
    // is always in the core's native unit.  Once stored, the expression
    // lives in mm — subsequent edits in any display mode are already in
    // mm and should not be re-converted.  Angle parameters are unitless.
    let finalExpression = rawExpression;
    if (
      isNew &&
      kind === "length" &&
      config.displayUnits === "in" &&
      PLAIN_NUMBER_RE.test(rawExpression)
    ) {
      const normalized = rawExpression.replace(",", ".");
      const num = parseFloat(normalized);
      if (!isNaN(num) && num > 0) {
        finalExpression = String(displayToMm(num, "in"));
      }
    }

    try {
      if (isNew) {
        await addParameter(name.trim(), finalExpression, kind);
      } else {
        const prev = parameters[index];
        if (
          prev &&
          prev.name === name.trim() &&
          prev.expression === rawExpression &&
          prev.kind === kind
        ) {
          setEditing(null);
          return;
        }
        await updateParameter(name.trim(), finalExpression, kind);
      }
    } catch {
      // Error surfaced through document round-trip (has_error field)
    }
    setEditing(null);
  }, [editing, parameters, config.displayUnits, addParameter, updateParameter]);

  // Auto-focus the name field only when entering edit mode (editing
  // transitions from null to a non-null value). Tracking via a ref
  // avoids re-focus (and thus blur on the expression field) on every
  // keystroke, which would otherwise trigger a premature commit.
  const prevEditingRef = useRef<EditingRow | null>(null);
  useEffect(() => {
    if (editing && editing !== prevEditingRef.current) {
      // Only focus when switching to a different row or entering edit
      if (!prevEditingRef.current || prevEditingRef.current.index !== editing.index || prevEditingRef.current.isNew !== editing.isNew) {
        nameRef.current?.focus();
      }
    }
    prevEditingRef.current = editing;
  }, [editing]);

  const startAdd = () => {
    setEditing({ index: -1, name: "", expression: "", kind: "length", isNew: true });
  };

  const startEdit = (index: number) => {
    const p = parameters[index];
    if (!p) return;
    setEditing({
      index,
      name: p.name,
      expression: p.expression,
      kind: p.kind,
      isNew: false,
    });
  };

  const KIND_OPTIONS = useMemo<DropdownOption<"length" | "angle">[]>(
    () => [
      { value: "length", label: t("parameters.kindLength") },
      { value: "angle", label: t("parameters.kindAngle") },
    ],
    [t],
  );

  const displayValue = (param: ParameterEntry): string => {
    if (param.kind === "angle") {
      return param.resolved_value.toFixed(2) + "\u00b0";
    }
    const display = mmToDisplay(param.resolved_value, config.displayUnits);
    const prec = config.displayUnits === "in" ? 3 : 2;
    return display.toFixed(prec) + " " + config.displayUnits;
  };

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    isExpression: boolean,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isExpression) {
        commitEdit();
      } else {
        exprRef.current?.focus();
      }
    }
    if (e.key === "Escape") {
      setEditing(null);
    }
  };

  return (
    <>
      {/* Invisible backdrop: clicking anywhere outside the panel closes it */}
      {onClose ? (
        <div
          className="fixed inset-0 z-40"
          onPointerDown={onClose}
        />
      ) : null}
      <section className="pointer-events-auto cad-floating-panel relative z-50 w-[420px] px-5 py-5">
        <p className="cad-kicker">{t("parameters.title")}</p>

      <div className="mt-3 max-h-[320px] overflow-visible">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-on-surface-dim text-left">
              <th className="pb-1.5 pr-2 font-medium">
                {t("parameters.name")}
              </th>
              <th className="pb-1.5 pr-2 font-medium">
                {t("parameters.expression")}
              </th>
              <th className="pb-1.5 pr-2 font-medium">
                {t("parameters.kind")}
              </th>
              <th className="pb-1.5 pr-2 font-medium">
                {t("parameters.value")}
              </th>
              <th className="w-6 pb-1.5" />
            </tr>
          </thead>
          <tbody>
            {parameters.map((param, index) => {
              const isEditing =
                editing !== null &&
                !editing.isNew &&
                editing.index === index;

              return (
                <tr
                  key={param.name}
                  className={`group border-t border-white/5 ${
                    param.has_error ? "text-danger" : "text-on-surface"
                  }`}
                >
                  {isEditing ? (
                    <>
                      <td className="py-1.5 pr-2">
                        <input
                          ref={nameRef}
                          className="cad-text-input w-full text-xs"
                          value={editing.name}
                          onChange={(e) =>
                            setEditing({ ...editing, name: e.target.value })
                          }
                          onKeyDown={(e) => handleKeyDown(e, false)}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          ref={exprRef}
                          className="cad-text-input w-full text-xs"
                          value={editing.expression}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              expression: e.target.value,
                            })
                          }
                          onKeyDown={(e) => handleKeyDown(e, true)}
                          onBlur={commitEdit}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Dropdown
                          value={editing.kind}
                          options={KIND_OPTIONS}
                          label={t("parameters.kind")}
                          onChange={(kind) =>
                            setEditing({ ...editing, kind })
                          }
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td
                        className="cursor-pointer py-1.5 pr-2 font-mono"
                        onClick={() => startEdit(index)}
                      >
                        {param.name}
                      </td>
                      <td
                        className="cursor-pointer py-1.5 pr-2 font-mono"
                        onClick={() => startEdit(index)}
                      >
                        {param.expression}
                      </td>
                      <td
                        className="cursor-pointer py-1.5 pr-2 font-mono"
                        onClick={() => startEdit(index)}
                      >
                        {param.kind === "angle"
                          ? t("parameters.kindAngle")
                          : t("parameters.kindLength")}
                      </td>
                    </>
                  )}
                  <td className="py-1.5 pr-2 font-mono">
                    {param.has_error ? (
                      <span
                        className="text-danger"
                        title={param.error_message}
                      >
                        {param.error_message || "Error"}
                      </span>
                    ) : (
                      displayValue(param)
                    )}
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      className="invisible ml-auto block text-on-surface-dim hover:text-danger group-hover:visible"
                      title={t("parameters.deleteParameter")}
                      onClick={() => void deleteParameter(param.name)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}

            {editing?.isNew ? (
              <tr className="border-t border-white/10">
                <td className="py-1.5 pr-2">
                  <input
                    ref={nameRef}
                    className="cad-text-input w-full text-xs"
                    placeholder={t("parameters.name")}
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                    onKeyDown={(e) => handleKeyDown(e, false)}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    ref={exprRef}
                    className="cad-text-input w-full text-xs"
                    placeholder="e.g. 50 or width * 2"
                    value={editing.expression}
                    onChange={(e) =>
                      setEditing({ ...editing, expression: e.target.value })
                    }
                    onKeyDown={(e) => handleKeyDown(e, true)}
                    onBlur={commitEdit}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Dropdown
                    value={editing.kind}
                    options={KIND_OPTIONS}
                    label={t("parameters.kind")}
                    onChange={(kind) =>
                      setEditing({ ...editing, kind })
                    }
                  />
                </td>
                <td />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        className="cad-ribbon-action mt-3 w-full py-1.5 text-xs"
        onClick={startAdd}
      >
        + {t("parameters.addParameter")}
      </button>
      </section>
    </>
  );
}
