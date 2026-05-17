import { ConstraintType, SketchTool, ArmedSketchConstraint } from "@/types";
import { formatHotkey, useAppConfig } from "@/config";
import type { AppHotkeys, CrosshairMode } from "@/config";
import { Dropdown } from "@/lib";
import { ConstraintIcon, SketchToolIcon } from "./ToolBarIcons";
import { useTranslation } from "react-i18next";

interface SketchToolbarProps {
  disabled?: boolean;
  activeSketchPlaneId: string | null;
  activeSketchTool: SketchTool | null;
  selectedReferenceId: string | null;
  selectedFaceId: string | null;
  armedSketchConstraint: ArmedSketchConstraint;
  // Mirror tool is a contextual modeling action with its own panel, not
  // an armed constraint. The toolbar uses this flag only to
  // light up the Mirror button while the panel is open.
  isMirrorToolOpen: boolean;
  // Arc tool's creation mode. Lifted from App.tsx so the toolbar can
  // render a small segmented control next to the Arc button when the
  // arc tool is active. v1 supports two modes; the toolbar passes
  // the user's choice back through `onSetArcToolMode`.
  arcToolMode: "three_point" | "center_start_end";

  onStartSketch: () => Promise<void>;
  onFinishSketch: () => Promise<void>;
  onCancelSketchConstraint: () => void;
  onSetSketchTool: (tool: SketchTool) => Promise<void>;
  onArmSketchConstraint: (constraint: ConstraintType) => Promise<void>;
  onStartMirrorTool: () => Promise<void>;
  onSetArcToolMode: (mode: "three_point" | "center_start_end") => void;
}

const sketchTools: Array<{
  id: SketchTool;
  labelKey: string;
  hotkey?: keyof AppHotkeys["sketchToolbar"] | "project";
  enabled: boolean;
}> = [
  { id: "select", labelKey: "toolbar.select", enabled: true },
  { id: "line", labelKey: "toolbar.line", hotkey: "line", enabled: true },
  { id: "dimension", labelKey: "toolbar.dimension", hotkey: "dimension", enabled: true },
  { id: "rectangle", labelKey: "toolbar.rectangle", hotkey: "rectangle", enabled: true },
  { id: "circle", labelKey: "toolbar.circle", hotkey: "circle", enabled: true },
  { id: "arc", labelKey: "toolbar.arc", enabled: true },
  { id: "fillet", labelKey: "toolbar.fillet", enabled: true },
  // Modal Project tool. While active, viewport face / edge / vertex
  // clicks are routed to `project_*_into_sketch` instead of the
  // normal selection. Toggling the button (or pressing P / Esc /
  // picking another tool) deactivates it. See App.tsx click intercept.
  { id: "project", labelKey: "toolbar.project", hotkey: "project", enabled: true },
];

const crosshairOptions: Array<{ id: CrosshairMode; labelKey?: string; label?: string }> = [
  { id: "default", labelKey: "crosshair.default" },
  { id: "viewport-25", label: "25%" },
  { id: "viewport-50", label: "50%" },
  { id: "viewport-75", label: "75%" },
  { id: "infinite", labelKey: "crosshair.infinite" },
];

export function SketchToolbar({
  disabled = false,
  activeSketchPlaneId,
  activeSketchTool,
  selectedReferenceId,
  selectedFaceId,
  armedSketchConstraint,
  isMirrorToolOpen,
  arcToolMode,
  onStartSketch,
  onFinishSketch,
  onCancelSketchConstraint,
  onSetSketchTool,
  onArmSketchConstraint,
  onStartMirrorTool,
  onSetArcToolMode,
}: SketchToolbarProps) {
  const { config, updateConfig } = useAppConfig();
  const { t } = useTranslation();
  const canCreateSketch = Boolean(selectedReferenceId || selectedFaceId);
  const toolLabel = (tool: (typeof sketchTools)[number]) => {
    const label = t(tool.labelKey);
    if (!tool.hotkey) {
      return label;
    }
    const binding =
      tool.hotkey === "project"
        ? config.hotkeys.toolbar.project
        : config.hotkeys.sketchToolbar[tool.hotkey];
    return `${label} (${formatHotkey(binding)})`;
  };
  return (
    <>
      <button
        className={
          activeSketchPlaneId
            ? "cad-tool-button cad-tool-button-active"
            : "cad-tool-button"
        }
        data-tooltip={
          activeSketchPlaneId
            ? t("toolbar.finishSketch")
            : `${t("toolbar.createSketch")} (${formatHotkey(config.hotkeys.sketchToolbar.createSketch)})`
        }
        onClick={() => {
          void (activeSketchPlaneId ? onFinishSketch() : onStartSketch());
        }}
        disabled={disabled || (!activeSketchPlaneId && !canCreateSketch)}
      >
        {activeSketchPlaneId ? t("toolbar.finishSketch") : t("toolbar.createSketch")}
      </button>
      {sketchTools.map((tool) => (
        <button
          key={tool.id}
          className={
            activeSketchPlaneId && activeSketchTool === tool.id
              ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
              : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
          }
          data-tooltip={toolLabel(tool)}
          aria-label={t(tool.labelKey)}
          disabled={!activeSketchPlaneId || !tool.enabled}
          onClick={() => {
            if (
              !activeSketchPlaneId ||
              !tool.enabled ||
              (tool.id !== "select" &&
                tool.id !== "line" &&
                tool.id !== "rectangle" &&
                tool.id !== "circle" &&
                tool.id !== "arc" &&
                tool.id !== "fillet" &&
                tool.id !== "project" &&
                tool.id !== "dimension")
            ) {
              return;
            }

            onCancelSketchConstraint();
            // Toggle behaviour for the modal Project tool: clicking it
            // again while it's already active turns it off (returns to
            // Select). For non-modal tools the second click is a
            // no-op because `onSetSketchTool` would fire the same id
            // — harmless but skipped here for clarity.
            if (tool.id === "project" && activeSketchTool === "project") {
              void onSetSketchTool("select");
              return;
            }
            void onSetSketchTool(tool.id);
          }}
        >
          <SketchToolIcon tool={tool.id} />
        </button>
      ))}
      {activeSketchPlaneId && activeSketchTool === "arc" ? (
        // Arc creation mode toggle. Visible only while the arc tool
        // is active so the toolbar stays compact otherwise. Three-
        // point is the default; user can flip to center+start+end
        // mid-sketch without leaving the tool.
        <div
          role="group"
          aria-label={t("toolbar.arcCreationMode")}
          className="ml-1 flex items-center rounded-md border border-white/10 bg-black/20 p-0.5 text-xs"
        >
          <button
            type="button"
            className={
              arcToolMode === "three_point"
                ? "rounded px-2 py-1 bg-white/15 text-on-surface"
                : "rounded px-2 py-1 text-on-surface-dim hover:text-on-surface"
            }
            data-tooltip={t("toolbar.arcThreePointTooltip")}
            onClick={() => onSetArcToolMode("three_point")}
          >
            {t("toolbar.arcThreePoint")}
          </button>
          <button
            type="button"
            className={
              arcToolMode === "center_start_end"
                ? "rounded px-2 py-1 bg-white/15 text-on-surface"
                : "rounded px-2 py-1 text-on-surface-dim hover:text-on-surface"
            }
            data-tooltip={t("toolbar.arcCenterTooltip")}
            onClick={() => onSetArcToolMode("center_start_end")}
          >
            {t("toolbar.arcCenter")}
          </button>
        </div>
      ) : null}
      <div className="h-8 w-px bg-white/10" />
      <button
        className={
          activeSketchPlaneId && armedSketchConstraint?.kind === "horizontal"
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip={t("toolbar.horizontal")}
        aria-label={t("toolbar.horizontal")}
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onArmSketchConstraint("horizontal");
        }}
      >
        <ConstraintIcon kind="horizontal" />
      </button>
      <button
        className={
          activeSketchPlaneId && armedSketchConstraint?.kind === "vertical"
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip={t("toolbar.vertical")}
        aria-label={t("toolbar.vertical")}
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onArmSketchConstraint("vertical");
        }}
      >
        <ConstraintIcon kind="vertical" />
      </button>
      <button
        className={
          activeSketchPlaneId && armedSketchConstraint?.kind === "clear"
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip={t("toolbar.clearConstraint")}
        aria-label={t("toolbar.clearConstraint")}
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onArmSketchConstraint("clear");
        }}
      >
        <ConstraintIcon kind="clear" />
      </button>
      <button
        className={
          activeSketchPlaneId && armedSketchConstraint?.kind === "coincident"
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip={t("toolbar.coincident")}
        aria-label={t("toolbar.coincident")}
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onArmSketchConstraint("coincident");
        }}
      >
        <ConstraintIcon kind="coincident" />
      </button>
      <button
        className={
          activeSketchPlaneId && armedSketchConstraint?.kind === "equal_length"
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip={t("toolbar.equalLength")}
        aria-label={t("toolbar.equalLength")}
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onArmSketchConstraint("equal_length");
        }}
      >
        <ConstraintIcon kind="equal_length" />
      </button>
      <button
        className={
          activeSketchPlaneId && armedSketchConstraint?.kind === "perpendicular"
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip={t("toolbar.perpendicular")}
        aria-label={t("toolbar.perpendicular")}
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onArmSketchConstraint("perpendicular");
        }}
      >
        <ConstraintIcon kind="perpendicular" />
      </button>
      <button
        className={
          activeSketchPlaneId && armedSketchConstraint?.kind === "parallel"
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip={t("toolbar.parallel")}
        aria-label={t("toolbar.parallel")}
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onArmSketchConstraint("parallel");
        }}
      >
        <ConstraintIcon kind="parallel" />
      </button>
      <button
        className={
          activeSketchPlaneId && isMirrorToolOpen
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip={t("toolbar.mirror")}
        aria-label={t("toolbar.mirror")}
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onStartMirrorTool();
        }}
      >
        <ConstraintIcon kind="mirror" />
      </button>
      <div className="h-8 w-px bg-white/10" />
      <Dropdown
        label={t("toolbar.sketchCrosshair")}
        className="w-[104px]"
        buttonClassName="h-9"
        value={config.viewport.crosshair}
        options={crosshairOptions.map((option) => ({
          value: option.id,
          label: option.labelKey ? t(option.labelKey) : option.label,
        }))}
        onChange={(crosshair) => {
          updateConfig((current) => ({
            ...current,
            viewport: {
              ...current.viewport,
              crosshair,
            },
          }));
        }}
      />
      {armedSketchConstraint ? (
        <p className="text-xs uppercase tracking-[0.14em] text-on-surface-dim">
          {armedSketchConstraint.kind === "coincident"
            ? armedSketchConstraint.firstPointId
              ? t("constraints.coincidentSecondPointColon")
              : t("constraints.coincidentFirstPointColon")
            : armedSketchConstraint.kind === "equal_length" ||
                armedSketchConstraint.kind === "perpendicular" ||
                armedSketchConstraint.kind === "parallel"
              ? armedSketchConstraint.firstLineId
                ? t("constraints.lineSecondColon", {
                    label:
                      armedSketchConstraint.kind === "equal_length"
                        ? t("toolbar.equalLength")
                        : armedSketchConstraint.kind === "perpendicular"
                          ? t("toolbar.perpendicular")
                          : t("toolbar.parallel"),
                  })
                : t("constraints.lineFirstColon", {
                    label:
                      armedSketchConstraint.kind === "equal_length"
                        ? t("toolbar.equalLength")
                        : armedSketchConstraint.kind === "perpendicular"
                          ? t("toolbar.perpendicular")
                          : t("toolbar.parallel"),
                  })
              : t("constraints.clickLineColon", {
                  kind: armedSketchConstraint.kind,
                })}
        </p>
      ) : null}
    </>
  );
}
