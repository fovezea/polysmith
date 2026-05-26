import type { ReactElement } from "react";
import {
  ConstructAxisIcon,
  AnglePlaneIcon,
  ConstructPointIcon,
  MidplaneIcon,
  OffsetPlaneIcon,
  TangentPlaneIcon,
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
  canMidplane: boolean;
  canTangentPlane: boolean;
  canAnglePlane: boolean;
  onOffsetPlane: () => void;
  onMidplane: () => void;
  onTangentPlane: () => void;
  onAnglePlane: () => void;
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
  { labelKey: "toolbar.axis", Icon: ConstructAxisIcon },
  { labelKey: "toolbar.constructPoint", Icon: ConstructPointIcon },
];

export function ConstructToolbar({
  disabled,
  canOffsetPlane,
  canMidplane,
  canTangentPlane,
  canAnglePlane,
  onOffsetPlane,
  onMidplane,
  onTangentPlane,
  onAnglePlane,
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
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip={t("toolbar.midplane")}
        aria-label={t("toolbar.midplane")}
        disabled={disabled || !canMidplane}
        onClick={onMidplane}
      >
        <MidplaneIcon />
      </button>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip={t("toolbar.tangentPlane")}
        aria-label={t("toolbar.tangentPlane")}
        disabled={disabled || !canTangentPlane}
        onClick={onTangentPlane}
      >
        <TangentPlaneIcon />
      </button>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip={t("toolbar.anglePlane")}
        aria-label={t("toolbar.anglePlane")}
        disabled={disabled || !canAnglePlane}
        onClick={onAnglePlane}
      >
        <AnglePlaneIcon />
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
