#pragma once

#include <optional>
#include <string>
#include <vector>

namespace polysmith::core {

struct SketchProfilePoint {
  double x;
  double y;
};

struct BoxFeatureParameters {
  double width;
  double height;
  double depth;
};

struct CylinderFeatureParameters {
  double radius;
  double height;
};

struct PlaneFrame {
  double origin_x;
  double origin_y;
  double origin_z;
  double x_axis_x;
  double x_axis_y;
  double x_axis_z;
  double y_axis_x;
  double y_axis_y;
  double y_axis_z;
  double normal_x;
  double normal_y;
  double normal_z;
};

struct ExtrudeFeatureParameters {
  std::string sketch_feature_id;
  std::string profile_id;
  std::string plane_id;
  std::optional<PlaneFrame> plane_frame;
  std::string profile_kind;
  double start_x;
  double start_y;
  double width;
  double height;
  double radius;
  std::vector<SketchProfilePoint> profile_points;
  double depth;
  // "new_body" (default): produces an independent solid body.
  // "join": fuses the extrude with `target_body_id` if set, else the
  //         most recent existing body.
  // "cut":  subtracts the extrude from the same target choice as "join".
  std::string mode = "new_body";
  // Optional explicit target body for boolean modes. Stored as the root
  // feature id of the target body (the same id reported in
  // `viewport_state.bodies`). Empty / unset means "most recent body" so
  // single-body workflows keep working without UI changes.
  std::optional<std::string> target_body_id;
};

// Edge-modifying body operation. `target_body_id` is the body root feature
// id whose edges are being filleted/chamfered. `edge_ids` mirrors the
// `<body_id>:edge:<index>` strings emitted by viewport_state.edges so the
// body_compiler can re-resolve the edges via TopExp::MapShapes on the
// target body shape at the moment the feature is replayed.
struct FilletFeatureParameters {
  std::string target_body_id;
  std::vector<std::string> edge_ids;
  double radius;
};

struct ChamferFeatureParameters {
  std::string target_body_id;
  std::vector<std::string> edge_ids;
  // Symmetric chamfer distance from the edge along both adjacent faces.
  double distance;
};

struct SketchLine {
  std::string id;
  std::string start_point_id;
  std::string end_point_id;
  double start_x;
  double start_y;
  double end_x;
  double end_y;
  std::optional<std::string> constraint;
};

struct SketchCircle {
  std::string id;
  double center_x;
  double center_y;
  double radius;
};

struct SketchPoint {
  std::string id;
  std::string kind;
  double x;
  double y;
  bool is_fixed;
};

struct SketchDimension {
  std::string id;
  std::string kind;
  std::string entity_id;
  double value;
};

struct SketchLineRelation {
  std::string id;
  std::string kind;
  std::string first_line_id;
  std::string second_line_id;
};

struct SketchProfileRegion {
  std::string id;
  std::string kind;
  std::vector<std::string> point_ids;
  std::vector<std::string> line_ids;
  std::vector<SketchProfilePoint> points;
  std::optional<std::string> source_circle_id;
  double center_x;
  double center_y;
  double radius;
};

struct SketchFeatureParameters {
  struct SketchPlaneFrame {
    double origin_x;
    double origin_y;
    double origin_z;
    double x_axis_x;
    double x_axis_y;
    double x_axis_z;
    double y_axis_x;
    double y_axis_y;
    double y_axis_z;
    double normal_x;
    double normal_y;
    double normal_z;
  };

  std::string plane_id;
  std::optional<SketchPlaneFrame> plane_frame;
  std::string active_tool;
  std::vector<SketchLine> lines;
  std::vector<SketchCircle> circles;
  std::vector<SketchPoint> points;
  std::vector<SketchDimension> dimensions;
  std::vector<SketchLineRelation> line_relations;
  std::vector<SketchProfileRegion> profiles;
};

struct FeatureEntry {
  std::string id;
  std::string kind;
  std::string name;
  std::string status;
  std::string parameters_summary;
  // When true, the feature is excluded from body compilation and from
  // legacy primitive emission. The feature still appears in the
  // timeline / hierarchy (rendered dimmed by the UI) and can be
  // unsuppressed later. Downstream features that reference a
  // suppressed parent (e.g. an extrude whose sketch is suppressed)
  // silently no-op via the existing "missing input" fallbacks.
  bool suppressed = false;
  // Set by `refresh_history_dependencies` when this feature references
  // upstream geometry (a face-based sketch plane, an extrude on a
  // sketch, etc.) that can no longer be resolved against the current
  // document state — e.g. the original face was consumed by a later
  // boolean cut. The frame stays at its last-known value so the UI
  // still has something to render; the timeline surfaces the warning
  // via this flag plus the message below.
  bool dependency_broken = false;
  // Human-readable explanation of the broken dependency (shown as the
  // tooltip on the warning-coloured timeline button). Empty when
  // `dependency_broken` is false.
  std::string dependency_warning;
  std::optional<BoxFeatureParameters> box_parameters;
  std::optional<CylinderFeatureParameters> cylinder_parameters;
  std::optional<ExtrudeFeatureParameters> extrude_parameters;
  std::optional<SketchFeatureParameters> sketch_parameters;
  std::optional<FilletFeatureParameters> fillet_parameters;
  std::optional<ChamferFeatureParameters> chamfer_parameters;
};

}  // namespace polysmith::core
