import type { DocumentState } from "@/types";
import { FeatureKindIcon } from "./header/ToolBarIcons";

interface FeatureTimelineProps {
  document: DocumentState | null;
  onSelectFeature: (featureId: string) => Promise<void>;
}

// Compact icon-only timeline. Each feature is rendered as a square
// `cad-icon-button` with the feature kind's icon and a tooltip showing
// the full name + kind. The previous version used circle nodes plus
// text labels separated by horizontal bars; that stopped scaling once
// documents grew past ~6 features. Icons are uniform 32×32 with 4px
// gaps so we get ~30 features per 1280px ribbon before the timeline
// has to scroll.
export function FeatureTimeline({
  document,
  onSelectFeature,
}: FeatureTimelineProps) {
  if (!document) {
    return null;
  }

  return (
    <div className="cad-timeline pointer-events-auto px-4 py-2.5">
      <div className="cad-scrollbar flex items-center gap-1 overflow-x-auto pb-1">
        {document.feature_history.map((feature) => {
          const active = feature.feature_id === document.selected_feature_id;
          // Tooltip carries both the human-readable name (e.g. "Box 2")
          // and the kind, so a renamed feature still tells the user
          // what it is.
          const tooltip =
            feature.name && feature.name !== feature.kind
              ? `${feature.name} (${feature.kind})`
              : feature.kind;
          return (
            <button
              key={feature.feature_id}
              type="button"
              onClick={() => {
                void onSelectFeature(feature.feature_id);
              }}
              className={
                active
                  ? "cad-icon-button cad-tool-button cad-tool-button-active h-8 w-8 px-0"
                  : "cad-icon-button cad-tool-button h-8 w-8 px-0"
              }
              data-tooltip={tooltip}
              aria-label={tooltip}
            >
              <FeatureKindIcon kind={feature.kind} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
