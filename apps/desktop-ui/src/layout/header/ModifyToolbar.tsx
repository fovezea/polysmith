import type { ReactElement } from "react";
import {
  ChamferIcon,
  FilletIcon,
  MoveIcon,
  PressPullIcon,
  ShellIcon,
} from "./ToolBarIcons";
import { formatHotkey, useAppConfig } from "@/config";
import { useTranslation } from "react-i18next";

interface ModifyToolbarProps {
  disabled: boolean;
  // True when at least one body edge is selected and no other
  // floating action is in flight. Drives whether Fillet / Chamfer
  // are clickable. The action handlers themselves are no-ops in
  // every other case, so this prop just controls visual affordance.
  canEdgeOp: boolean;
  canShell: boolean;
  onFillet: () => void;
  onChamfer: () => void;
  onShell: () => void;
}

// Match the Create ribbon's icon-button styling so the Modify ribbon
// reads as part of the same visual family. See `CreateToolbar.tsx`
// for the rationale on the chromeless rest state + tooltip-on-hover.
const ICON_BUTTON_BASE = "cad-icon-button cad-icon-tool h-9 w-9 p-0";

// Disabled placeholder tools. Each is rendered as an icon button so
// the user can see what's coming on the roadmap; the buttons stay
// non-interactive until each action is wired up.
const placeholderTools: Array<{
  labelKey: string;
  Icon: () => ReactElement;
}> = [
  { labelKey: "toolbar.pressPull", Icon: PressPullIcon },
  { labelKey: "toolbar.move", Icon: MoveIcon },
];

export function ModifyToolbar({
  disabled,
  canEdgeOp,
  canShell,
  onFillet,
  onChamfer,
  onShell,
}: ModifyToolbarProps) {
  const { config } = useAppConfig();
  const { t } = useTranslation();
  const edgeOpDisabled = disabled || !canEdgeOp;
  return (
    <>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip={`${t("toolbar.fillet")} (${formatHotkey(config.hotkeys.toolbar.fillet)})`}
        aria-label={t("toolbar.fillet")}
        disabled={edgeOpDisabled}
        onClick={onFillet}
      >
        <FilletIcon />
      </button>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip={t("toolbar.chamfer")}
        aria-label={t("toolbar.chamfer")}
        disabled={edgeOpDisabled}
        onClick={onChamfer}
      >
        <ChamferIcon />
      </button>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip={t("toolbar.shell")}
        aria-label={t("toolbar.shell")}
        disabled={disabled || !canShell}
        onClick={onShell}
      >
        <ShellIcon />
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
