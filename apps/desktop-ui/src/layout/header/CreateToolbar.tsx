import { BoxFeatureForm } from "../BoxFeatureForm";
import { CylinderFeatureForm } from "../CylinderFeatureForm";
import {
  BoxIcon,
  CylinderIcon,
  ExtrudeIcon,
  LoftIcon,
  PatternIcon,
  SphereIcon,
} from "./ToolBarIcons";

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
  // Whether the Extrude action has a valid input selected (a closed
  // sketch profile or a planar body face). The toolbar disables the
  // button when neither is selected so the user gets a tooltip and a
  // greyed-out icon rather than a silent no-op.
  canExtrude: boolean;
  onExtrude: () => Promise<void>;
}

// Square icon button used for every primitive / action in the Create
// ribbon. Keeps the look consistent with the sketch toolbar (h-9 w-9
// chrome + tooltip via `data-tooltip`).
const ICON_BUTTON_BASE = "cad-icon-button cad-tool-button h-9 w-9 px-0";
const ICON_BUTTON_ACTIVE =
  "cad-icon-button cad-tool-button cad-tool-button-active h-9 w-9 px-0";

export function CreateToolbar({
  openMenu,
  disabled,
  setOpenMenu,
  onAddBoxFeature,
  onAddCylinderFeature,
  canExtrude,
  onExtrude,
}: CreateToolbarProps) {
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
          data-tooltip={
            canExtrude
              ? "Extrude (E)"
              : "Extrude (E) — select a closed profile or planar face"
          }
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
      <div className="cad-tool-group-label">Primitives</div>
      <button
        className={ICON_BUTTON_BASE}
        data-tooltip="Sphere"
        aria-label="Sphere"
        disabled
      >
        <SphereIcon />
      </button>
      <button
        className={ICON_BUTTON_BASE}
        data-tooltip="Loft"
        aria-label="Loft"
        disabled
      >
        <LoftIcon />
      </button>
      <button
        className={ICON_BUTTON_BASE}
        data-tooltip="Pattern"
        aria-label="Pattern"
        disabled
      >
        <PatternIcon />
      </button>
    </>
  );
}
