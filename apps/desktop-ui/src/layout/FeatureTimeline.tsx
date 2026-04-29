import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DocumentState } from "@/types";
import { FeatureKindIcon } from "./header/ToolBarIcons";

interface FeatureTimelineProps {
  document: DocumentState | null;
  onSelectFeature: (featureId: string) => Promise<void>;
  // Optional double-click handler. The parent decides which feature
  // kinds are editable; the timeline just forwards the id and lets the
  // parent decide whether to mount an editor. Kept optional so the
  // timeline stays renderable in contexts where editing isn't wired
  // (e.g. read-only previews).
  onEditFeature?: (featureId: string) => void;
  // Optional context-menu actions. The timeline only renders the menu
  // entries whose handlers are provided, so callers can opt into a
  // subset (e.g. read-only previews can omit Suppress + Delete).
  onSuppressFeature?: (featureId: string, suppressed: boolean) => void;
  onDeleteFeature?: (featureId: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  featureId: string;
  featureName: string;
  kind: string;
  suppressed: boolean;
}

// Compact icon-only timeline. Each feature is rendered as a square
// `cad-icon-button` with the feature kind's icon and a tooltip showing
// the full name + kind. The previous version used circle nodes plus
// text labels separated by horizontal bars; that stopped scaling once
// documents grew past ~6 features. Icons are uniform 32×32 with 4px
// gaps so we get ~30 features per 1280px ribbon before the timeline
// has to scroll.
// Kinds that the parent's `onEditFeature` actually opens a panel for.
// The menu still surfaces the entry but disables it (greyed out) for
// non-editable kinds so the user discovers what's coming, rather than
// being silently ignored on click.
const EDITABLE_KINDS = new Set(["box", "cylinder"]);

export function FeatureTimeline({
  document,
  onSelectFeature,
  onEditFeature,
  onSuppressFeature,
  onDeleteFeature,
}: FeatureTimelineProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Global dismiss: clicking anywhere outside the menu closes it. We
  // also close on `Escape` so keyboard users don't get trapped.
  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const dismiss = () => setContextMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", dismiss);
    window.addEventListener("contextmenu", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("contextmenu", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  if (!document) {
    return null;
  }

  const canEdit = contextMenu ? EDITABLE_KINDS.has(contextMenu.kind) : false;
  const canSuppress = contextMenu ? contextMenu.kind !== "root_part" : false;
  const canDelete = canSuppress;

  return (
    <div className="cad-timeline pointer-events-auto px-4 py-2.5">
      <div className="cad-scrollbar flex items-center gap-1 overflow-x-auto pb-1">
        {document.feature_history
          // The synthetic `root_part` entry exists in the document so
          // every other feature has a parent to chain off of, but it
          // isn't user-actionable (can't be edited / suppressed /
          // deleted) so showing it just adds visual noise. Hide it
          // here while keeping it in the document model.
          .filter((feature) => feature.kind !== "root_part")
          .map((feature) => {
            const active = feature.feature_id === document.selected_feature_id;
            const suppressed = feature.suppressed === true;
            // Tooltip carries both the human-readable name (e.g. "Box 2")
            // and the kind, plus a (suppressed) suffix so the user knows
            // why the feature is missing from the viewport.
            const baseTooltip =
              feature.name && feature.name !== feature.kind
                ? `${feature.name} (${feature.kind})`
                : feature.kind;
            const tooltip = suppressed
              ? `${baseTooltip} — suppressed`
              : baseTooltip;
            return (
              <button
                key={feature.feature_id}
                type="button"
                onClick={() => {
                  void onSelectFeature(feature.feature_id);
                }}
                onDoubleClick={() => {
                  onEditFeature?.(feature.feature_id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    featureId: feature.feature_id,
                    featureName: feature.name,
                    kind: feature.kind,
                    suppressed,
                  });
                }}
                className={
                  (active
                    ? "cad-icon-button cad-icon-tool cad-icon-tool-active h-9 w-9 p-0"
                    : "cad-icon-button cad-icon-tool h-9 w-9 p-0") +
                  (suppressed ? " opacity-40" : "")
                }
                data-tooltip={tooltip}
                aria-label={tooltip}
              >
                <FeatureKindIcon kind={feature.kind} />
              </button>
            );
          })}
      </div>
      {contextMenu
        ? createPortal(
            <div
              // Portaled to document.body so the fixed positioning
              // resolves against the viewport, not against a parent
              // with `backdrop-filter` (same reason the hierarchy
              // panel's menu is portaled).
              className="cad-context-menu fixed z-30 min-w-[160px] rounded-xl p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-xl"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                disabled={!canEdit || !onEditFeature}
                className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm text-on-surface transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-on-surface-dim disabled:hover:bg-transparent"
                onClick={() => {
                  const id = contextMenu.featureId;
                  setContextMenu(null);
                  onEditFeature?.(id);
                }}
              >
                Edit
              </button>
              {onSuppressFeature ? (
                <button
                  type="button"
                  disabled={!canSuppress}
                  className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm text-on-surface transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-on-surface-dim disabled:hover:bg-transparent"
                  onClick={() => {
                    const { featureId, suppressed } = contextMenu;
                    setContextMenu(null);
                    onSuppressFeature(featureId, !suppressed);
                  }}
                >
                  {contextMenu.suppressed ? "Unsuppress" : "Suppress"}
                </button>
              ) : null}
              {onDeleteFeature ? (
                <button
                  type="button"
                  disabled={!canDelete}
                  className="flex w-full items-center rounded-lg px-3 py-1.5 text-left text-sm text-red-300 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:text-on-surface-dim disabled:hover:bg-transparent"
                  onClick={() => {
                    const id = contextMenu.featureId;
                    setContextMenu(null);
                    onDeleteFeature(id);
                  }}
                >
                  Delete
                </button>
              ) : null}
            </div>,
            window.document.body,
          )
        : null}
    </div>
  );
}
