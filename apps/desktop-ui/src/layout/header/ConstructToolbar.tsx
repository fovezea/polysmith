import type { ReactElement } from "react";
import {
  ConstructAxisIcon,
  ConstructPointIcon,
  MidplaneIcon,
  OffsetPlaneIcon,
} from "./ToolBarIcons";
import { useTranslation } from "react-i18next";

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
  labelKey: string;
  Icon: () => ReactElement;
}> = [
  { labelKey: "toolbar.midplane", Icon: MidplaneIcon },
  { labelKey: "toolbar.axis", Icon: ConstructAxisIcon },
  { labelKey: "toolbar.constructPoint", Icon: ConstructPointIcon },
];

export function ConstructToolbar({
  disabled,
  canOffsetPlane,
  onOffsetPlane,
}: ConstructToolbarProps) {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip={t("toolbar.offsetPlane")}
        aria-label={t("toolbar.offsetPlane")}
        disabled={disabled || !canOffsetPlane}
        onClick={onOffsetPlane}
      >
        <OffsetPlaneIcon />
      </button>
      {placeholderTools.map(({ labelKey, Icon }) => (
        <button
          key={labelKey}
          type="button"
          className={ICON_BUTTON_BASE}
          data-tooltip={t(labelKey)}
          aria-label={t(labelKey)}
          disabled
        >
          <Icon />
        </button>
      ))}
    </>
  );
}
