import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConstraintType, SketchTool, ArmedSketchConstraint } from "@/types";
import { useAppConfig } from "@/config";
import { SketchToolbar } from "./SketchToolbar";
import { CreateToolbar } from "./CreateToolbar";
import { ModifyToolbar } from "./ModifyToolbar";
import { ConstructToolbar } from "./ConstructToolbar";
import { ParametersPanel } from "../ParametersPanel";

const workspaces = ["create", "modify", "construct", "sketch"] as const;
type WorkspaceView = "cad" | "slicer";

interface MenuDropdownItem {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface MenuDropdownProps {
  label: string;
  disabled?: boolean;
  align?: "start" | "end";
  items: MenuDropdownItem[];
  onOpenChange?: (isOpen: boolean) => void;
}

function MenuDropdown({
  label,
  disabled,
  align = "end",
  items,
  onOpenChange,
}: MenuDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Notify parent when dropdown opens/closes so the native Orca window
  // can be hidden/shown to avoid covering the dropdown popup.
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const alignmentClass = align === "start" ? "left-0" : "right-0";

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    function handleOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="cad-ribbon-action"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
      >
        {label}
        <span aria-hidden className="ml-1.5 text-on-surface-dim">
          ▾
        </span>
      </button>
      {isOpen ? (
        <div
          className={`cad-context-menu absolute ${alignmentClass} top-[calc(100%+6px)] z-30 min-w-[180px] rounded-xl p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-xl`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm text-on-surface transition-colors hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent"
              disabled={item.disabled}
              onClick={() => {
                setIsOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SettingsGearIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M9.95 2.35h4.1l.52 2.42c.57.18 1.11.4 1.62.68l2.08-1.33 2.9 2.9-1.33 2.08c.28.51.5 1.05.68 1.62l2.43.52v4.1l-2.43.52c-.18.57-.4 1.11-.68 1.62l1.33 2.08-2.9 2.9-2.08-1.33c-.51.28-1.05.5-1.62.68l-.52 2.43h-4.1l-.52-2.43a8.55 8.55 0 0 1-1.62-.68l-2.08 1.33-2.9-2.9 1.33-2.08a8.55 8.55 0 0 1-.68-1.62l-2.43-.52v-4.1l2.43-.52c.18-.57.4-1.11.68-1.62L2.83 7.02l2.9-2.9 2.08 1.33c.51-.28 1.05-.5 1.62-.68l.52-2.42ZM12 16.95a3.65 3.65 0 1 0 0-7.3 3.65 3.65 0 0 0 0 7.3Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function AiSparkIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        fill="currentColor"
        d="M12 2.5 13.85 8.15 19.5 10 13.85 11.85 12 17.5 10.15 11.85 4.5 10 10.15 8.15 12 2.5ZM18 14l.9 2.6 2.6.9-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9L18 14ZM6 14.5l.65 1.85L8.5 17l-1.85.65L6 19.5l-.65-1.85L3.5 17l1.85-.65L6 14.5Z"
      />
    </svg>
  );
}

interface AppHeaderProps {
  workspaceView: WorkspaceView;
  canOpenSlicerView: boolean;
  canExportToSlicer: boolean;
  onSetWorkspaceView: (view: WorkspaceView) => void;
  onExportToSlicer: () => void;
  status: string;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  activeSketchPlaneId: string | null;
  activeSketchTool: SketchTool | null;
  selectedReferenceId: string | null;
  selectedFaceId: string | null;
  armedSketchConstraint: ArmedSketchConstraint;
  isMirrorToolOpen: boolean;
  // Arc tool's creation mode + setter — see SketchToolbar for the
  // segmented control's behaviour.
  arcToolMode: "three_point" | "center_start_end";
  onSetArcToolMode: (mode: "three_point" | "center_start_end") => void;
  // Rectangle tool's creation mode — split button variant.
  rectangleToolMode: "corner_corner" | "center_point" | "three_point";
  onSetRectangleToolMode: (mode: "corner_corner" | "center_point" | "three_point") => void;
  // Circle tool's creation mode — split button variant.
  circleToolMode: "center_radius" | "two_point" | "three_point" | "tangent_two_lines" | "tangent_three_lines";
  onSetCircleToolMode: (mode: "center_radius" | "two_point" | "three_point" | "tangent_two_lines" | "tangent_three_lines") => void;
  polygonToolMode: "circumscribed" | "inscribed" | "edge";
  onSetPolygonToolMode: (mode: "circumscribed" | "inscribed" | "edge") => void;
  onStart: () => Promise<void>;
  onCreateDocument: () => Promise<void>;
  onExportDocument: () => Promise<void>;
  onExportDocumentStl: () => Promise<void>;
  onSaveDocument: () => Promise<void>;
  onLoadDocument: () => Promise<void>;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  logCount: number;
  errorLogCount: number;
  onOpenLogs: () => void;
  onOpenSettings: () => void;
  showAiAssistant: boolean;
  isAiPanelOpen: boolean;
  onToggleAiPanel: () => void;
  onAddBoxFeature: (
    width: number,
    height: number,
    depth: number,
  ) => Promise<void>;
  onAddCylinderFeature: (radius: number, height: number) => Promise<void>;
  // Extrude lives in the Create ribbon next to Box/Cylinder. The
  // parent owns the gating (a closed profile or planar face must be
  // selected) and the action itself, which is shared with the E
  // hotkey path in App.tsx.
  canExtrude: boolean;
  onExtrude: () => Promise<void>;
  // Modify ribbon (Fillet / Chamfer). Enabled state is owned by the
  // parent so it can match the F-hotkey gating exactly.
  canEdgeOp: boolean;
  onFillet: () => Promise<void>;
  onChamfer: () => Promise<void>;
  // Construct ribbon (Offset Plane). The parent gates the button on
  // "no other floating action is open" — same shape as canEdgeOp.
  canOffsetPlane: boolean;
  onOffsetPlane: () => void;
  onStartSketch: () => Promise<void>;
  onFinishSketch: () => Promise<void>;
  onSetSketchTool: (tool: SketchTool) => Promise<void>;
  onArmSketchConstraint: (constraint: ConstraintType) => Promise<void>;
  onStartMirrorTool: () => Promise<void>;
  onCancelSketchConstraint: () => void;
  onWorkspaceDropdownOpenChange?: (isOpen: boolean) => void;
  // Parameters panel
  parametersPanelOpen: boolean;
  onToggleParametersPanel: () => void;
}

export function AppHeader({
  workspaceView,
  canOpenSlicerView,
  canExportToSlicer,
  onSetWorkspaceView,
  onExportToSlicer,
  status,
  disabled,
  canUndo,
  canRedo,
  activeSketchPlaneId,
  activeSketchTool,
  selectedReferenceId,
  selectedFaceId,
  armedSketchConstraint,
  isMirrorToolOpen,
  arcToolMode,
  onSetArcToolMode,
  rectangleToolMode,
  onSetRectangleToolMode,
  circleToolMode,
  onSetCircleToolMode,
  polygonToolMode,
  onSetPolygonToolMode,
  onStart,
  onCreateDocument,
  onExportDocument,
  onExportDocumentStl,
  onSaveDocument,
  onLoadDocument,
  onUndo,
  onRedo,
  logCount,
  errorLogCount,
  onOpenLogs,
  onOpenSettings,
  showAiAssistant,
  isAiPanelOpen,
  onToggleAiPanel,
  onAddBoxFeature,
  onAddCylinderFeature,
  canExtrude,
  onExtrude,
  canEdgeOp,
  onFillet,
  onChamfer,
  canOffsetPlane,
  onOffsetPlane,
  onStartSketch,
  onFinishSketch,
  onSetSketchTool,
  onArmSketchConstraint,
  onStartMirrorTool,
  onCancelSketchConstraint,
  onWorkspaceDropdownOpenChange,
  parametersPanelOpen,
  onToggleParametersPanel,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const { config, updateConfig } = useAppConfig();
  const [activeCadWorkspace, setActiveCadWorkspace] =
    useState<(typeof workspaces)[number]>("create");
  const [openMenu, setOpenMenu] = useState<"box" | "cylinder" | null>(null);

  useEffect(() => {
    setOpenMenu(null);
  }, [activeCadWorkspace]);

  useEffect(() => {
    if (activeSketchPlaneId) {
      setActiveCadWorkspace("sketch");
    }
  }, [activeSketchPlaneId]);

  return (
    <header className="cad-ribbon relative z-20">
      <div className="flex items-center justify-between gap-5 px-5 py-1">
        <div className="flex items-center gap-6">
          <MenuDropdown
            align="start"
            label={
              workspaceView === "cad"
                ? t("workspace.cad")
                : t("workspace.slicer")
            }
            items={[
              {
                label: t("workspace.cad"),
                onSelect: () => onSetWorkspaceView("cad"),
              },
              {
                label: t("workspace.slicer"),
                disabled: !canOpenSlicerView,
                onSelect: () => onSetWorkspaceView("slicer"),
              },
            ]}
            onOpenChange={onWorkspaceDropdownOpenChange}
          />
          {workspaceView === "cad" ? (
            <nav className="flex items-center gap-1 rounded-full p-0.5 cad-subtle-block">
              {workspaces.map((workspace) => (
                <button
                  key={workspace}
                  className={
                    activeCadWorkspace === workspace
                      ? "cad-ribbon-tab cad-ribbon-tab-active"
                      : "cad-ribbon-tab"
                  }
                  onClick={() => {
                    setActiveCadWorkspace(workspace);
                  }}
                >
                  {t(`header.workspace.${workspace}`)}
                </button>
              ))}
            </nav>
          ) : null}
          {workspaceView === "cad" ? (
            <div className="relative">
              <button
                type="button"
                className={
                  parametersPanelOpen
                    ? "cad-ribbon-tab cad-ribbon-tab-active"
                    : "cad-ribbon-tab"
                }
                onClick={onToggleParametersPanel}
              >
                <span className="normal-case">f(x)</span>
              </button>
              {parametersPanelOpen ? (
                <div className="cad-toolbar-popover absolute left-0 top-[calc(100%+0.75rem)]">
                  <ParametersPanel onClose={onToggleParametersPanel} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {status !== "connected" && status !== "starting" ? (
            // Hidden while the core is mid-launch so a double-click
            // can't kick off a second `start()` (which would race the
            // first one's status-pill flip and confuse the auto-doc
            // effect in App.tsx). The status pill below still shows
            // "Core Offline" so the user has feedback during the few
            // hundred ms it takes the native process to come up.
            <button
              className="cad-ribbon-action cad-ribbon-action-primary"
              onClick={() => void onStart()}
            >
              {t("header.startCore")}
            </button>
          ) : null}
          <MenuDropdown
            label={t("header.file")}
            disabled={disabled}
            items={[
              { label: t("header.new"), onSelect: () => void onCreateDocument() },
              { label: t("header.open"), onSelect: () => void onLoadDocument() },
              { label: t("header.save"), onSelect: () => void onSaveDocument() },
              {
                label: t("header.exportStep"),
                onSelect: () => void onExportDocument(),
              },
              {
                label: t("header.exportStl"),
                onSelect: () => void onExportDocumentStl(),
              },
            ]}
          />
          <MenuDropdown
            label={t("header.edit")}
            disabled={disabled}
            items={[
              {
                label: t("header.undo"),
                disabled: !canUndo,
                onSelect: () => void onUndo(),
              },
              {
                label: t("header.redo"),
                disabled: !canRedo,
                onSelect: () => void onRedo(),
              },
            ]}
          />
          <button type="button" className="cad-ribbon-action" onClick={onOpenLogs}>
            {t("header.logs")}
            <span
              className={`ml-2 rounded-full px-1.5 py-0.5 text-[0.65rem] ${
                errorLogCount > 0
                  ? "bg-danger/20 text-danger"
                  : "bg-white/10 text-on-surface-dim"
              }`}
            >
              {errorLogCount > 0 ? errorLogCount : logCount}
            </span>
          </button>
          <button
            type="button"
            className="cad-ribbon-action h-8 w-8 px-0 py-0 text-[11px] font-semibold uppercase tracking-wider text-on-surface-muted hover:text-on-surface"
            onClick={() =>
              updateConfig((prev) => ({
                ...prev,
                displayUnits:
                  prev.displayUnits === "mm" ? "in" : "mm",
              }))
            }
            aria-label={t("settings.toggleUnits")}
            title={t("settings.toggleUnits", {
              units: config.displayUnits.toUpperCase(),
            })}
          >
            {config.displayUnits}
          </button>
          <button
            type="button"
            className="cad-ribbon-action h-8 w-8 px-0 py-0 text-on-surface-muted hover:text-on-surface"
            onClick={onOpenSettings}
            aria-label={t("header.settings")}
            title={t("header.settings")}
          >
            <SettingsGearIcon />
          </button>
          {showAiAssistant ? (
            <button
              type="button"
              className={
                isAiPanelOpen
                  ? "cad-ribbon-action h-8 w-8 px-0 py-0 text-primary-glow"
                  : "cad-ribbon-action h-8 w-8 px-0 py-0 text-on-surface-muted hover:text-on-surface"
              }
              onClick={onToggleAiPanel}
              aria-label={t("header.aiAssistant")}
              title={t("header.aiAssistant")}
            >
              <AiSparkIcon />
            </button>
          ) : null}
          <div className="cad-status-pill">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                status === "connected"
                  ? "bg-success cad-status-dot-online"
                  : "bg-danger cad-status-dot-offline"
              }`}
            />
            <span>
              {status === "connected"
                ? t("header.localSession")
                : t("header.coreOffline")}
            </span>
          </div>
        </div>
      </div>

      {workspaceView === "cad" ? (
        <div
          className="flex items-center justify-between gap-3 px-4 py-1"
          style={{ borderTop: "1px solid var(--cad-panel-soft-border)" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            {activeCadWorkspace === "create" ? (
              <CreateToolbar
                openMenu={openMenu}
                disabled={disabled}
                setOpenMenu={setOpenMenu}
                onAddBoxFeature={onAddBoxFeature}
                onAddCylinderFeature={onAddCylinderFeature}
                canExtrude={canExtrude}
                onExtrude={onExtrude}
              />
            ) : null}

            {activeCadWorkspace === "modify" ? (
              <ModifyToolbar
                disabled={disabled}
                canEdgeOp={canEdgeOp}
                onFillet={() => void onFillet()}
                onChamfer={() => void onChamfer()}
              />
            ) : null}

            {activeCadWorkspace === "construct" ? (
              <ConstructToolbar
                disabled={disabled}
                canOffsetPlane={canOffsetPlane}
                onOffsetPlane={onOffsetPlane}
              />
            ) : null}

            {activeCadWorkspace === "sketch" ? (
              <SketchToolbar
                activeSketchPlaneId={activeSketchPlaneId}
                activeSketchTool={activeSketchTool}
                selectedReferenceId={selectedReferenceId}
                selectedFaceId={selectedFaceId}
                armedSketchConstraint={armedSketchConstraint}
                isMirrorToolOpen={isMirrorToolOpen}
                arcToolMode={arcToolMode}
                onSetArcToolMode={onSetArcToolMode}
                rectangleToolMode={rectangleToolMode}
                onSetRectangleToolMode={onSetRectangleToolMode}
                circleToolMode={circleToolMode}
                onSetCircleToolMode={onSetCircleToolMode}
                polygonToolMode={polygonToolMode}
                onSetPolygonToolMode={onSetPolygonToolMode}
                onStartSketch={onStartSketch}
                onFinishSketch={onFinishSketch}
                onCancelSketchConstraint={onCancelSketchConstraint}
                onSetSketchTool={onSetSketchTool}
                onArmSketchConstraint={onArmSketchConstraint}
                onStartMirrorTool={onStartMirrorTool}
              />
            ) : null}
          </div>

          {canExportToSlicer ? (
            <button
              type="button"
              className="cad-ribbon-action"
              disabled={disabled}
              onClick={onExportToSlicer}
            >
              {t("workspace.exportToSlicer")}
            </button>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
