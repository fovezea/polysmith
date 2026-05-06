import type { ReactElement } from "react";
import {
  ConstructAxisIcon,
  ConstructPointIcon,
  MidplaneIcon,
  OffsetPlaneIcon,
} from "./ToolBarIcons";

interface ConstructToolbarProps {
  disabled: boolean;
  // True when the Offset Plane button can be clicked. Driven by the
  // parent so it knows the difference between "no document yet" and
  // "an offset-plane session is already in flight" (both disable the
  // button, but only the second case is also gated by other panels
  // being closed).
  canOffsetPlane: boolean;
  onOffsetPlane: () => void;
}

// See `CreateToolbar.tsx` — same icon-button base so the ribbon
// matches the Create / Sketch tabs visually.
const ICON_BUTTON_BASE = "cad-icon-button cad-icon-tool h-9 w-9 p-0";

// Items in the Construct ribbon that aren't wired to a real action
// yet. Kept as disabled icon buttons so the user can see what's
// coming. Removed from this list as each action lands.
const placeholderTools: Array<{
  label: string;
  Icon: () => ReactElement;
}> = [
  { label: "Midplane", Icon: MidplaneIcon },
  { label: "Axis", Icon: ConstructAxisIcon },
  { label: "Point", Icon: ConstructPointIcon },
];

export function ConstructToolbar({
  disabled,
  canOffsetPlane,
  onOffsetPlane,
}: ConstructToolbarProps) {
  return (
    <>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip="Offset Plane"
        aria-label="Offset Plane"
        disabled={disabled || !canOffsetPlane}
        onClick={onOffsetPlane}
      >
        <OffsetPlaneIcon />
      </button>
      {placeholderTools.map(({ label, Icon }) => (
        <button
          key={label}
          type="button"
          className={ICON_BUTTON_BASE}
          data-tooltip={label}
          aria-label={label}
          disabled
        >
          <Icon />
        </button>
      ))}
    </>
  );
}
