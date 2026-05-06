#pragma once

#include "core/feature.h"

namespace polysmith::core {

// Build a fresh "construction_plane" FeatureEntry from a
// caller-supplied source plane frame and an offset along the source's
// normal. The caller (DocumentManager) is responsible for resolving
// the source's frame from the document state — we deliberately keep
// this module free of upstream-resolution logic so it can be reused
// from any callsite that already has a frame in hand.
FeatureEntry create_construction_plane_feature(
    int feature_index,
    const std::string& source_plane_id,
    double offset,
    const PlaneFrame& source_frame);

// Update an existing construction_plane feature's offset and
// re-derive its cached frame from `source_frame`. Throws when the
// feature is not a construction_plane.
void update_construction_plane(FeatureEntry& feature,
                               double offset,
                               const PlaneFrame& source_frame);

// Helper exposed for the dependency walker. Slides `source_frame`
// along its own normal by `offset`, leaving the basis vectors
// intact. The returned frame is what the construction-plane feature
// stores in its parameters.
PlaneFrame derive_offset_frame(const PlaneFrame& source_frame, double offset);

}  // namespace polysmith::core
