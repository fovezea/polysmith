#pragma once

#include "core/feature.h"

namespace polysmith::core {

FeatureEntry create_sketch_feature(
    int feature_index,
    const std::string& plane_id,
    std::optional<SketchFeatureParameters::SketchPlaneFrame> plane_frame = std::nullopt);
void set_sketch_tool(FeatureEntry& feature, const std::string& tool);
void update_sketch_line(FeatureEntry& feature,
                        const std::string& line_id,
                        double start_x,
                        double start_y,
                        double end_x,
                        double end_y);
void update_sketch_point(FeatureEntry& feature,
                         const std::string& point_id,
                         double x,
                         double y);
void set_sketch_line_constraint(FeatureEntry& feature,
                                const std::string& line_id,
                                const std::optional<std::string>& constraint);
void set_sketch_equal_length_constraint(
    FeatureEntry& feature,
    const std::string& line_id,
    const std::optional<std::string>& other_line_id);
void set_sketch_perpendicular_constraint(
    FeatureEntry& feature,
    const std::string& line_id,
    const std::optional<std::string>& other_line_id);
void set_sketch_parallel_constraint(
    FeatureEntry& feature,
    const std::string& line_id,
    const std::optional<std::string>& other_line_id);
void set_sketch_coincident_constraint(
    FeatureEntry& feature,
    const std::string& point_id,
    const std::string& other_point_id);
void set_sketch_point_fixed(FeatureEntry& feature,
                            const std::string& point_id,
                            bool is_fixed);
void update_sketch_circle(FeatureEntry& feature,
                          const std::string& circle_id,
                          double center_x,
                          double center_y,
                          double radius);
// Add a new "angle" dimension between two sketch lines that share an
// endpoint. The dimension is stored with `entity_id = first_line_id`,
// `secondary_entity_id = second_line_id`, and `value` initialized to
// the current angle (radians) between their outgoing direction
// vectors. Throws if the two lines do not share an endpoint within
// the coincident tolerance.
void add_sketch_angle_dimension(FeatureEntry& feature,
                                const std::string& first_line_id,
                                const std::string& second_line_id);
void update_sketch_dimension(FeatureEntry& feature,
                             const std::string& dimension_id,
                             double value);
void add_sketch_line(FeatureEntry& feature,
                     int line_index,
                     double start_x,
                     double start_y,
                     double end_x,
                     double end_y,
                     bool is_construction = false);
void add_sketch_rectangle(FeatureEntry& feature,
                          int& next_line_index,
                          double start_x,
                          double start_y,
                          double end_x,
                          double end_y);
// Toggle the construction-line flag on an existing line. Construction
// lines render dashed in the viewport and are filtered out of profile
// detection so they don't seal pickable faces / extrude sources.
void set_sketch_line_construction(FeatureEntry& feature,
                                  const std::string& line_id,
                                  bool is_construction);
// Bind a sketch point to the midpoint of a host line. The point is
// pulled to the line's midpoint immediately and re-pulled on every
// subsequent edit (via `enforce_midpoint_anchors` inside the derived
// state refresh). Pass an empty `host_line_id` to remove an existing
// anchor for the point.
void set_sketch_midpoint_anchor(FeatureEntry& feature,
                                const std::string& point_id,
                                const std::string& host_line_id);
// Bind a sketch point to a host line's body at parametric position
// `t` in [0, 1]. The solver re-projects the bound point on every
// edit so it rides along with the host. Pass an empty
// `host_line_id` to remove an existing anchor for the point.
void set_sketch_point_line_anchor(FeatureEntry& feature,
                                  const std::string& point_id,
                                  const std::string& host_line_id,
                                  double t);

// Constrain a sketch line to be tangent to a circle. The relation
// is one-directional: the line's *end* point is driven onto the
// closer of the two tangent points from its start to the circle.
// Pass an empty `circle_id` to clear any existing tangent relation
// for the line. Throws when the line's start is inside or on the
// circle (no real tangent exists).
void set_sketch_tangent_constraint(FeatureEntry& feature,
                                   const std::string& line_id,
                                   const std::string& circle_id);

void add_sketch_circle(FeatureEntry& feature,
                       int circle_index,
                       double center_x,
                       double center_y,
                       double radius);

// Mirror sketch entities across a sketch line. For each id in
// `entity_ids` (lines and circles supported), a *new* reflected
// entity is created. Existing constraints, dimensions, and
// relations on the source entities are NOT carried over — the
// reflected copies are independent geometry. The source entities
// themselves are unchanged. The mirror line must exist on the
// sketch; passing it as one of `entity_ids` is a no-op (we don't
// mirror the axis to itself).
void mirror_sketch_entities(FeatureEntry& feature,
                            int& next_line_index,
                            int& next_circle_index,
                            const std::string& mirror_line_id,
                            const std::vector<std::string>& entity_ids);

}  // namespace polysmith::core
