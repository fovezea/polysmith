import { ConstraintType, SketchTool, ArmedSketchConstraint } from "@/types";
import { ConstraintIcon, SketchToolIcon } from "./ToolBarIcons";

interface SketchToolbarProps {
  disabled?: boolean;
  activeSketchPlaneId: string | null;
  activeSketchTool: SketchTool | null;
  selectedReferenceId: string | null;
  selectedFaceId: string | null;
  armedSketchConstraint: ArmedSketchConstraint;
  // Mirror tool is a Fusion-style action with its own panel, not
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
  label: string;
  shortcut?: string;
  enabled: boolean;
}> = [
  { id: "select", label: "Select", enabled: true },
  { id: "line", label: "Line", shortcut: "L", enabled: true },
  { id: "dimension", label: "Dimension (D)", shortcut: "D", enabled: true },
  { id: "rectangle", label: "Rectangle", shortcut: "R", enabled: true },
  { id: "circle", label: "Circle", shortcut: "C", enabled: true },
  { id: "arc", label: "Arc", enabled: true },
  { id: "fillet", label: "Fillet", enabled: true },
  // Modal Project tool. While active, viewport face / edge / vertex
  // clicks are routed to `project_*_into_sketch` instead of the
  // normal selection. Toggling the button (or pressing P / Esc /
  // picking another tool) deactivates it. See App.tsx click intercept.
  { id: "project", label: "Project (P)", shortcut: "P", enabled: true },
  { id: "trim", label: "Trim", enabled: false },
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
  // selectedFaceId is no longer required by the toolbar (the modal
  // Project tool now picks faces from the viewport while active),
  // but we keep it on the props for parity with future face-aware
  // tools (e.g. dimension targets). Reference here silences the
  // unused-arg lint without changing behaviour.
  void selectedFaceId;
  return (
    <>
      <button
        className={
          activeSketchPlaneId
            ? "cad-tool-button cad-tool-button-active"
            : "cad-tool-button"
        }
        onClick={() => {
          void (activeSketchPlaneId ? onFinishSketch() : onStartSketch());
        }}
        disabled={disabled || (!activeSketchPlaneId && !selectedReferenceId)}
      >
        {activeSketchPlaneId ? "Finish Sketch" : "Start Sketch"}
      </button>
      {sketchTools.map((tool) => (
        <button
          key={tool.id}
          className={
            activeSketchPlaneId && activeSketchTool === tool.id
              ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
              : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
          }
          data-tooltip={tool.label}
          aria-label={tool.label}
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
          aria-label="Arc creation mode"
          className="ml-1 flex items-center rounded-md border border-white/10 bg-black/20 p-0.5 text-xs"
        >
          <button
            type="button"
            className={
              arcToolMode === "three_point"
                ? "rounded px-2 py-1 bg-white/15 text-on-surface"
                : "rounded px-2 py-1 text-on-surface-dim hover:text-on-surface"
            }
            data-tooltip="Three-point arc: click start, end, then a point on the arc"
            onClick={() => onSetArcToolMode("three_point")}
          >
            3-point
          </button>
          <button
            type="button"
            className={
              arcToolMode === "center_start_end"
                ? "rounded px-2 py-1 bg-white/15 text-on-surface"
                : "rounded px-2 py-1 text-on-surface-dim hover:text-on-surface"
            }
            data-tooltip="Center + start + end: click center, start, then end"
            onClick={() => onSetArcToolMode("center_start_end")}
          >
            Center
          </button>
        </div>
      ) : null}
      <div className="h-8 w-px bg-white/10" />
      <div className="cad-tool-group-label">Constraints</div>
      <button
        className={
          activeSketchPlaneId && armedSketchConstraint?.kind === "horizontal"
            ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
            : "cad-icon-button cad-icon-tool h-9 w-9 p-0"
        }
        data-tooltip="Horizontal"
        aria-label="Horizontal"
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
        data-tooltip="Vertical"
        aria-label="Vertical"
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
        data-tooltip="Clear"
        aria-label="Clear Constraint"
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
        data-tooltip="Coincident"
        aria-label="Coincident"
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
        data-tooltip="Equal Length"
        aria-label="Equal Length"
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
        data-tooltip="Perpendicular"
        aria-label="Perpendicular"
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
        data-tooltip="Parallel"
        aria-label="Parallel"
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
        data-tooltip="Mirror"
        aria-label="Mirror"
        disabled={!activeSketchPlaneId}
        onClick={() => {
          void onStartMirrorTool();
        }}
      >
        <ConstraintIcon kind="mirror" />
      </button>
      {armedSketchConstraint ? (
        <p className="text-xs uppercase tracking-[0.14em] text-on-surface-dim">
          {armedSketchConstraint.kind === "coincident"
            ? armedSketchConstraint.firstPointId
              ? "Coincident: click second point"
              : "Coincident: click first point"
            : armedSketchConstraint.kind === "equal_length" ||
                armedSketchConstraint.kind === "perpendicular" ||
                armedSketchConstraint.kind === "parallel"
              ? armedSketchConstraint.firstLineId
                ? `${armedSketchConstraint.kind === "equal_length" ? "Equal length" : armedSketchConstraint.kind === "perpendicular" ? "Perpendicular" : "Parallel"}: click second line`
                : `${armedSketchConstraint.kind === "equal_length" ? "Equal length" : armedSketchConstraint.kind === "perpendicular" ? "Perpendicular" : "Parallel"}: click first line`
              : `${armedSketchConstraint.kind}: click line`}
        </p>
      ) : null}
    </>
  );
}
