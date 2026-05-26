import type { DocumentState, FeatureEntry } from "@/types";

// Walk the feature history and return every feature that references the
// given `featureId` directly. Used by the Delete confirmation flow so
// users get told "this will break N downstream features" before they
// blow away a base sketch or a body that has fillets on it.
//
// Reference rules (matched against the C++ shape builders):
//   - extrude.sketch_feature_id  → its source sketch
//   - extrude.target_body_id     → join/cut target
//   - loft.sections[].sketch_feature_id → source sketches
//   - revolve.sketch_feature_id / axis_sketch_feature_id → source sketches
//   - sweep.sketch_feature_id / path_sketch_feature_id → source sketches
//   - fillet.target_body_id      → body being filleted
//   - chamfer.target_body_id     → body being chamfered
//   - shell.target_body_id       → body being shelled
//   - sketch.plane_id            → plane / construction plane / face
//                                  the sketch was placed on
//   - construction_plane.source_plane_id / source_plane_ids / source_axis_id
//     → construction plane chain
//
// We intentionally return the dependents in `feature_history` order
// (newest last) so the UI can render a stable list.
export function findDependents(
  document: DocumentState,
  featureId: string,
): FeatureEntry[] {
  const dependents: FeatureEntry[] = [];
  const targetFeature = document.feature_history.find(
    (feature) => feature.feature_id === featureId,
  );
  for (const feature of document.feature_history) {
    if (feature.feature_id === featureId) {
      continue;
    }
    const sketchPlaneId = feature.sketch_parameters?.plane_id ?? null;
    const constructionSourceId =
      feature.construction_plane_parameters?.source_plane_id ?? null;
    const constructionSourceIds =
      feature.construction_plane_parameters?.source_plane_ids ?? [];
    const constructionAxisId =
      feature.construction_plane_parameters?.source_axis_id ?? null;
    const constructionAxisOwnedByTarget =
      constructionAxisId != null &&
      (targetFeature?.sketch_parameters?.lines.some(
        (line) => line.line_id === constructionAxisId,
      ) ??
        false);
    if (
      feature.extrude_parameters?.sketch_feature_id === featureId ||
      feature.extrude_parameters?.target_body_id === featureId ||
      feature.loft_parameters?.sections.some(
        (section) => section.sketch_feature_id === featureId,
      ) ||
      feature.revolve_parameters?.sketch_feature_id === featureId ||
      feature.revolve_parameters?.axis_sketch_feature_id === featureId ||
      feature.sweep_parameters?.sketch_feature_id === featureId ||
      feature.sweep_parameters?.path_sketch_feature_id === featureId ||
      feature.fillet_parameters?.target_body_id === featureId ||
      feature.chamfer_parameters?.target_body_id === featureId ||
      feature.shell_parameters?.target_body_id === featureId ||
      sketchPlaneId === featureId ||
      constructionSourceId === featureId ||
      constructionAxisId === featureId ||
      constructionAxisOwnedByTarget ||
      constructionSourceIds.includes(featureId)
    ) {
      dependents.push(feature);
    }
  }
  return dependents;
}
