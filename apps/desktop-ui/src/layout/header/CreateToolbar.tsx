import { BoxFeatureForm } from "../BoxFeatureForm";
import { CylinderFeatureForm } from "../CylinderFeatureForm";
import { BoxIcon, CylinderIcon, ExtrudeIcon } from "./ToolBarIcons";
import { formatHotkey, useAppConfig } from "@/config";

export interface CreateToolbarProps {
  openMenu: "box" | "cylinder" | null;
  disabled: boolean;
  setOpenMenu: React.Dispatch<React.SetStateAction<"box" | "cylinder" | null>>;
  onAddBoxFeature: (
    width: number,
    height: number,
    depth: number,
  ) => Promise<void>;
  onAddCylinderFeature: (radius: number, height: number) => Promise<void>;
  // Whether a new Extrude action can be started. A profile/face does
  // not need to be preselected; invoking Extrude can arm profile
  // picking first.
  canExtrude: boolean;
  onExtrude: () => Promise<void>;
}

// Flat icon-only button shared by every action in the Create ribbon.
// Bigger glyph + chromeless rest state matches the sketch toolbar so
// the user can scan tools at a glance; hover / active reveal the
// button-like surface. Tooltip is just the tool name (set via
// `data-tooltip`) — no shortcut suffixes.
const ICON_BUTTON_BASE = "cad-icon-button cad-icon-tool h-9 w-9 p-0";
const ICON_BUTTON_ACTIVE =
  "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0";

export function CreateToolbar({
  openMenu,
  disabled,
  setOpenMenu,
  onAddBoxFeature,
  onAddCylinderFeature,
  canExtrude,
  onExtrude,
}: CreateToolbarProps) {
  const { config } = useAppConfig();
  return (
    <>
      <div className="relative flex items-center gap-1.5">
        <button
          className={openMenu === "box" ? ICON_BUTTON_ACTIVE : ICON_BUTTON_BASE}
          data-tooltip="Box"
          aria-label="Box"
          onClick={() => {
            setOpenMenu((current) => (current === "box" ? null : "box"));
          }}
          disabled={disabled}
        >
          <BoxIcon />
        </button>
        <button
          className={
            openMenu === "cylinder" ? ICON_BUTTON_ACTIVE : ICON_BUTTON_BASE
          }
          data-tooltip="Cylinder"
          aria-label="Cylinder"
          onClick={() => {
            setOpenMenu((current) =>
              current === "cylinder" ? null : "cylinder",
            );
          }}
          disabled={disabled}
        >
          <CylinderIcon />
        </button>
        <button
          className={ICON_BUTTON_BASE}
          data-tooltip={`Extrude (${formatHotkey(config.hotkeys.toolbar.extrude)})`}
          aria-label="Extrude"
          onClick={() => {
            void onExtrude();
          }}
          disabled={disabled || !canExtrude}
        >
          <ExtrudeIcon />
        </button>
        {openMenu === "box" ? (
          <div className="cad-toolbar-popover absolute left-0 top-[calc(100%+0.75rem)] w-[360px]">
            <BoxFeatureForm
              disabled={disabled}
              onSubmit={async (width, height, depth) => {
                await onAddBoxFeature(width, height, depth);
                setOpenMenu(null);
              }}
              variant="toolbar"
            />
          </div>
        ) : null}
        {openMenu === "cylinder" ? (
          <div className="cad-toolbar-popover absolute left-[3.25rem] top-[calc(100%+0.75rem)] w-[320px]">
            <CylinderFeatureForm
              disabled={disabled}
              onSubmit={async (radius, height) => {
                await onAddCylinderFeature(radius, height);
                setOpenMenu(null);
              }}
              variant="toolbar"
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
