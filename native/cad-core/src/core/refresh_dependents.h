#pragma once

namespace polysmith::core {

struct DocumentState;

// Walk `document.feature_history` in order and refresh every feature
// whose geometry is derived from upstream features:
//
//   * Face-based sketches (sketch.plane_id of the form
//     "<body_id>:face:<index>") get their `plane_frame` re-resolved
//     against the body geometry compiled from features earlier in the
//     history. If the upstream face is no longer present, the frame
//     stays at its last value and `dependency_broken` is set on the
//     feature so the UI can surface the warning.
//
//   * Extrudes copy their owning sketch's freshly-refreshed frame into
//     `extrude_parameters.plane_frame`, so the body compiler will
//     rebuild the extrude geometry on the new plane.
//
// The walk is single-pass: by the time we process feature K, every
// earlier sketch / extrude has already been refreshed, so face
// resolution at K sees the up-to-date upstream bodies. This naturally
// propagates N-level cascades (sketch -> extrude -> sketch on its
// face -> extrude -> ...).
//
// Mutators in `DocumentManager` should call this *after* applying their
// edit and *before* returning the document state, so consumers always
// see refreshed downstream features.
void refresh_history_dependencies(DocumentState& document);

}  // namespace polysmith::core
