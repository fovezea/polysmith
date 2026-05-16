import type { ReactNode } from "react";

interface ToolbarTooltipProps {
  label: string;
  children: ReactNode;
}

export function ToolbarTooltip({ label, children }: ToolbarTooltipProps) {
  return (
    <span className="cad-tooltip-trigger inline-flex" data-tooltip={label}>
      {children}
    </span>
  );
}
