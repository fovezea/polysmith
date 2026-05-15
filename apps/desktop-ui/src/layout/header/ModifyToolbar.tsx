import type { ReactElement } from "react";
import {
  ChamferIcon,
  FilletIcon,
  MoveIcon,
  PressPullIcon,
  ShellIcon,
} from "./ToolBarIcons";
import { formatHotkey, useAppConfig } from "@/config";

interface ModifyToolbarProps {
  disabled: boolean;
  // True when at least one body edge is selected and no other
  // floating action is in flight. Drives whether Fillet / Chamfer
  // are clickable. The action handlers themselves are no-ops in
  // every other case, so this prop just controls visual affordance.
  canEdgeOp: boolean;
  onFillet: () => void;
  onChamfer: () => void;
}

// Match the Create ribbon's icon-button styling so the Modify ribbon
// reads as part of the same visual family. See `CreateToolbar.tsx`
// for the rationale on the chromeless rest state + tooltip-on-hover.
const ICON_BUTTON_BASE = "cad-icon-button cad-icon-tool h-9 w-9 p-0";

// Disabled placeholder tools. Each is rendered as an icon button so
// the user can see what's coming on the roadmap; the buttons stay
// non-interactive until each action is wired up.
const placeholderTools: Array<{
  label: string;
  Icon: () => ReactElement;
}> = [
  { label: "Press Pull", Icon: PressPullIcon },
  { label: "Shell", Icon: ShellIcon },
  { label: "Move", Icon: MoveIcon },
];

export function ModifyToolbar({
  disabled,
  canEdgeOp,
  onFillet,
  onChamfer,
}: ModifyToolbarProps) {
  const { config } = useAppConfig();
  const edgeOpDisabled = disabled || !canEdgeOp;
  return (
    <>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip={`Fillet (${formatHotkey(config.hotkeys.toolbar.fillet)})`}
        aria-label="Fillet"
        disabled={edgeOpDisabled}
        onClick={onFillet}
      >
        <FilletIcon />
      </button>
      <button
        type="button"
        className={ICON_BUTTON_BASE}
        data-tooltip="Chamfer"
        aria-label="Chamfer"
        disabled={edgeOpDisabled}
        onClick={onChamfer}
      >
        <ChamferIcon />
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
