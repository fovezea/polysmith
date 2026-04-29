#include "core/viewport.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <utility>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp_Face.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Poly_Triangulation.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "core/body_compiler.h"
#include "core/feature_shape.h"
#include "core/sketch_profile.h"

namespace polysmith::core {
namespace {

constexpr double kBoxSpacing = 10.0;
constexpr double kReferencePlaneSize = 120.0;
constexpr double kSketchPlaneOffset = 0.2;
constexpr double kLineDimensionOffset = 6.0;
constexpr double kCircleDimensionOffset = 4.0;
constexpr double kConstraintBadgeOffset = 3.5;

struct WorldPoint {
  double x;
  double y;
  double z;
};

struct WorldVector {
  double x;
  double y;
  double z;
};

WorldVector subtract_points(const WorldPoint& left, const WorldPoint& right) {
  return WorldVector{
      .x = left.x - right.x,
      .y = left.y - right.y,
      .z = left.z - right.z,
  };
}

WorldVector cross_product(const WorldVector& left, const WorldVector& right) {
  return WorldVector{
      .x = left.y * right.z - left.z * right.y,
      .y = left.z * right.x - left.x * right.z,
      .z = left.x * right.y - left.y * right.x,
  };
}

double vector_length(const WorldVector& vector) {
  return std::sqrt(vector.x * vector.x + vector.y * vector.y +
                   vector.z * vector.z);
}

WorldVector normalize_vector(const WorldVector& vector) {
  const double length = vector_length(vector);
  if (length <= 0.0) {
    return WorldVector{.x = 0.0, .y = 0.0, .z = 0.0};
  }

  return WorldVector{
      .x = vector.x / length,
      .y = vector.y / length,
      .z = vector.z / length,
  };
}

ViewportSolidFace make_solid_face(
    const std::string& owner_id,
    const std::string& owner_kind,
    const std::string& face_suffix,
    const std::string& label,
    const std::string& sketchability,
    double center_x,
    double center_y,
    double center_z,
    double normal_x,
    double normal_y,
    double normal_z,
    const ViewportSolidFace::PlaneFrame& plane_frame,
    double width,
    double height,
    double radius,
    bool is_selected) {
  return ViewportSolidFace{
      .face_id = owner_id + ":face:" + face_suffix,
      .owner_id = owner_id,
      .owner_kind = owner_kind,
      .label = label,
      .sketchability = sketchability,
      .center_x = center_x,
      .center_y = center_y,
      .center_z = center_z,
      .normal_x = normal_x,
      .normal_y = normal_y,
      .normal_z = normal_z,
      .plane_frame = plane_frame,
      .width = width,
      .height = height,
      .radius = radius,
      .is_selected = is_selected,
  };
}

ViewportSolidFace::PlaneFrame make_plane_frame(double origin_x,
                                               double origin_y,
                                               double origin_z,
                                               double x_axis_x,
                                               double x_axis_y,
                                               double x_axis_z,
                                               double y_axis_x,
                                               double y_axis_y,
                                               double y_axis_z,
                                               double normal_x,
                                               double normal_y,
                                               double normal_z) {
  return ViewportSolidFace::PlaneFrame{
      .origin_x = origin_x,
      .origin_y = origin_y,
      .origin_z = origin_z,
      .x_axis_x = x_axis_x,
      .x_axis_y = x_axis_y,
      .x_axis_z = x_axis_z,
      .y_axis_x = y_axis_x,
      .y_axis_y = y_axis_y,
      .y_axis_z = y_axis_z,
      .normal_x = normal_x,
      .normal_y = normal_y,
      .normal_z = normal_z,
  };
}

ViewportSolidFace::PlaneFrame make_plane_frame(
    const SketchFeatureParameters::SketchPlaneFrame& frame) {
  return make_plane_frame(frame.origin_x,
                          frame.origin_y,
                          frame.origin_z,
                          frame.x_axis_x,
                          frame.x_axis_y,
                          frame.x_axis_z,
                          frame.y_axis_x,
                          frame.y_axis_y,
                          frame.y_axis_z,
                          frame.normal_x,
                          frame.normal_y,
                          frame.normal_z);
}

ViewportSketchPlaneFrame make_sketch_plane_frame(
    const SketchFeatureParameters::SketchPlaneFrame& frame) {
  return ViewportSketchPlaneFrame{
      .origin_x = frame.origin_x,
      .origin_y = frame.origin_y,
      .origin_z = frame.origin_z,
      .x_axis_x = frame.x_axis_x,
      .x_axis_y = frame.x_axis_y,
      .x_axis_z = frame.x_axis_z,
      .y_axis_x = frame.y_axis_x,
      .y_axis_y = frame.y_axis_y,
      .y_axis_z = frame.y_axis_z,
      .normal_x = frame.normal_x,
      .normal_y = frame.normal_y,
      .normal_z = frame.normal_z,
  };
}

ViewportSketchPlaneFrame make_sketch_plane_frame(
    const PlaneFrame& frame) {
  return ViewportSketchPlaneFrame{
      .origin_x = frame.origin_x,
      .origin_y = frame.origin_y,
      .origin_z = frame.origin_z,
      .x_axis_x = frame.x_axis_x,
      .x_axis_y = frame.x_axis_y,
      .x_axis_z = frame.x_axis_z,
      .y_axis_x = frame.y_axis_x,
      .y_axis_y = frame.y_axis_y,
      .y_axis_z = frame.y_axis_z,
      .normal_x = frame.normal_x,
      .normal_y = frame.normal_y,
      .normal_z = frame.normal_z,
  };
}

WorldPoint to_world_point(const std::string& plane_id,
                          double local_x,
                          double local_y,
                          double offset = kSketchPlaneOffset) {
  if (plane_id == "ref-plane-xy") {
    return WorldPoint{.x = local_x, .y = offset, .z = local_y};
  }

  if (plane_id == "ref-plane-yz") {
    return WorldPoint{.x = offset, .y = local_x, .z = local_y};
  }

  return WorldPoint{.x = local_x, .y = local_y, .z = offset};
}

WorldPoint to_world_point(const SketchFeatureParameters& parameters,
                          double local_x,
                          double local_y,
                          double offset = kSketchPlaneOffset) {
  if (parameters.plane_frame.has_value()) {
    const auto& frame = parameters.plane_frame.value();
    return WorldPoint{
        .x = frame.origin_x + frame.x_axis_x * local_x +
             frame.y_axis_x * local_y + frame.normal_x * offset,
        .y = frame.origin_y + frame.x_axis_y * local_x +
             frame.y_axis_y * local_y + frame.normal_y * offset,
        .z = frame.origin_z + frame.x_axis_z * local_x +
             frame.y_axis_z * local_y + frame.normal_z * offset,
    };
  }

  return to_world_point(parameters.plane_id, local_x, local_y, offset);
}

WorldPoint to_world_point(const SketchFeatureParameters::SketchPlaneFrame& frame,
                          double local_x,
                          double local_y,
                          double offset = 0.0) {
  return WorldPoint{
      .x = frame.origin_x + frame.x_axis_x * local_x +
           frame.y_axis_x * local_y + frame.normal_x * offset,
      .y = frame.origin_y + frame.x_axis_y * local_x +
           frame.y_axis_y * local_y + frame.normal_y * offset,
      .z = frame.origin_z + frame.x_axis_z * local_x +
           frame.y_axis_z * local_y + frame.normal_z * offset,
  };
}

WorldPoint to_world_point(const PlaneFrame& frame,
                          double local_x,
                          double local_y,
                          double offset = 0.0) {
  return WorldPoint{
      .x = frame.origin_x + frame.x_axis_x * local_x +
           frame.y_axis_x * local_y + frame.normal_x * offset,
      .y = frame.origin_y + frame.x_axis_y * local_x +
           frame.y_axis_y * local_y + frame.normal_y * offset,
      .z = frame.origin_z + frame.x_axis_z * local_x +
           frame.y_axis_z * local_y + frame.normal_z * offset,
  };
}

ViewportSolidFace::PlaneFrame make_face_frame_for_plane(const std::string& plane_id,
                                                        double origin_x,
                                                        double origin_y,
                                                        double origin_z) {
  if (plane_id == "ref-plane-xy") {
    return make_plane_frame(origin_x,
                            origin_y,
                            origin_z,
                            1.0,
                            0.0,
                            0.0,
                            0.0,
                            0.0,
                            1.0,
                            0.0,
                            1.0,
                            0.0);
  }

  if (plane_id == "ref-plane-yz") {
    return make_plane_frame(origin_x,
                            origin_y,
                            origin_z,
                            0.0,
                            1.0,
                            0.0,
                            0.0,
                            0.0,
                            1.0,
                            1.0,
                            0.0,
                            0.0);
  }

  return make_plane_frame(origin_x,
                          origin_y,
                          origin_z,
                          1.0,
                          0.0,
                          0.0,
                          0.0,
                          1.0,
                          0.0,
                          0.0,
                          0.0,
                          1.0);
}

ViewportSketchLinePrimitive make_sketch_line_primitive(const SketchLine& line,
                                                       const SketchFeatureParameters& parameters,
                                                       bool is_selected) {
  const WorldPoint start = to_world_point(parameters, line.start_x, line.start_y);
  const WorldPoint end = to_world_point(parameters, line.end_x, line.end_y);

  return ViewportSketchLinePrimitive{
      .line_id = line.id,
      .start_point_id = line.start_point_id,
      .end_point_id = line.end_point_id,
      .plane_id = parameters.plane_id,
      .start_x = start.x,
      .start_y = start.y,
      .start_z = start.z,
      .end_x = end.x,
      .end_y = end.y,
      .end_z = end.z,
      .is_selected = is_selected,
      .constraint = line.constraint,
  };
}

ViewportSketchCirclePrimitive make_sketch_circle_primitive(
    const SketchCircle& circle,
    const SketchFeatureParameters& parameters,
    bool is_selected) {
  const WorldPoint center = to_world_point(parameters, circle.center_x, circle.center_y);

  return ViewportSketchCirclePrimitive{
      .circle_id = circle.id,
      .plane_id = parameters.plane_id,
      .center_x = center.x,
      .center_y = center.y,
      .center_z = center.z,
      .radius = circle.radius,
      .is_selected = is_selected,
  };
}

ViewportSketchPointPrimitive make_sketch_point_primitive(
    const SketchPoint& point,
    const SketchFeatureParameters& parameters,
    bool is_selected) {
  const WorldPoint world = to_world_point(parameters, point.x, point.y);

  return ViewportSketchPointPrimitive{
      .point_id = point.id,
      .plane_id = parameters.plane_id,
      .kind = point.kind,
      .position_x = world.x,
      .position_y = world.y,
      .position_z = world.z,
      .is_fixed = point.is_fixed,
      .is_selected = is_selected,
  };
}

ViewportSketchDimensionPrimitive make_line_dimension_primitive(
    const SketchLine& line,
    const SketchDimension& dimension,
    const SketchFeatureParameters& parameters,
    bool is_selected) {
  const double dx = line.end_x - line.start_x;
  const double dy = line.end_y - line.start_y;
  const double length = std::sqrt(dx * dx + dy * dy);
  const double normal_x = length > 0.0 ? -dy / length : 0.0;
  const double normal_y = length > 0.0 ? dx / length : 1.0;
  const WorldPoint anchor_start = to_world_point(parameters, line.start_x, line.start_y);
  const WorldPoint anchor_end = to_world_point(parameters, line.end_x, line.end_y);
  const WorldPoint dimension_start = to_world_point(
      parameters,
      line.start_x + normal_x * kLineDimensionOffset,
      line.start_y + normal_y * kLineDimensionOffset);
  const WorldPoint dimension_end = to_world_point(
      parameters,
      line.end_x + normal_x * kLineDimensionOffset,
      line.end_y + normal_y * kLineDimensionOffset);
  const WorldPoint label = to_world_point(
      parameters,
      (line.start_x + line.end_x) / 2.0 + normal_x * (kLineDimensionOffset + 1.5),
      (line.start_y + line.end_y) / 2.0 + normal_y * (kLineDimensionOffset + 1.5));

  return ViewportSketchDimensionPrimitive{
      .dimension_id = dimension.id,
      .plane_id = parameters.plane_id,
      .kind = "line_length",
      .entity_id = line.id,
      .label = std::to_string(std::round(dimension.value * 100.0) / 100.0) + " mm",
      .is_selected = is_selected,
      .anchor_start_x = anchor_start.x,
      .anchor_start_y = anchor_start.y,
      .anchor_start_z = anchor_start.z,
      .anchor_end_x = anchor_end.x,
      .anchor_end_y = anchor_end.y,
      .anchor_end_z = anchor_end.z,
      .dimension_start_x = dimension_start.x,
      .dimension_start_y = dimension_start.y,
      .dimension_start_z = dimension_start.z,
      .dimension_end_x = dimension_end.x,
      .dimension_end_y = dimension_end.y,
      .dimension_end_z = dimension_end.z,
      .label_x = label.x,
      .label_y = label.y,
      .label_z = label.z,
  };
}

ViewportSketchDimensionPrimitive make_circle_dimension_primitive(
    const SketchCircle& circle,
    const SketchDimension& dimension,
    const SketchFeatureParameters& parameters,
    bool is_selected) {
  const WorldPoint center = to_world_point(parameters, circle.center_x, circle.center_y);
  const WorldPoint dimension_end = to_world_point(
      parameters,
      circle.center_x + circle.radius,
      circle.center_y);
  const WorldPoint label = to_world_point(
      parameters,
      circle.center_x + circle.radius + kCircleDimensionOffset,
      circle.center_y);

  return ViewportSketchDimensionPrimitive{
      .dimension_id = dimension.id,
      .plane_id = parameters.plane_id,
      .kind = "circle_radius",
      .entity_id = circle.id,
      .label =
          "R " + std::to_string(std::round(dimension.value * 100.0) / 100.0) + " mm",
      .is_selected = is_selected,
      .anchor_start_x = center.x,
      .anchor_start_y = center.y,
      .anchor_start_z = center.z,
      .anchor_end_x = dimension_end.x,
      .anchor_end_y = dimension_end.y,
      .anchor_end_z = dimension_end.z,
      .dimension_start_x = center.x,
      .dimension_start_y = center.y,
      .dimension_start_z = center.z,
      .dimension_end_x = dimension_end.x,
      .dimension_end_y = dimension_end.y,
      .dimension_end_z = dimension_end.z,
      .label_x = label.x,
      .label_y = label.y,
      .label_z = label.z,
  };
}

ViewportSketchConstraintPrimitive make_line_constraint_primitive(
    const SketchLine& line,
    const std::string& plane_id,
    const std::string& kind,
    const std::string& label,
    bool is_selected,
    const std::optional<std::string>& related_entity_id = std::nullopt) {
  const double dx = line.end_x - line.start_x;
  const double dy = line.end_y - line.start_y;
  const double length = std::sqrt(dx * dx + dy * dy);
  const double normal_x = length > 0.0 ? -dy / length : 0.0;
  const double normal_y = length > 0.0 ? dx / length : 1.0;
  const WorldPoint position = to_world_point(
      plane_id,
      (line.start_x + line.end_x) / 2.0 + normal_x * kConstraintBadgeOffset,
      (line.start_y + line.end_y) / 2.0 + normal_y * kConstraintBadgeOffset);

  return ViewportSketchConstraintPrimitive{
      .constraint_id =
          (kind == "equal_length" || kind == "perpendicular") &&
                  related_entity_id.has_value()
              ? "constraint-" + kind + "-" + line.id + "-" + related_entity_id.value()
              : "constraint-" + kind + "-" + line.id,
      .plane_id = plane_id,
      .kind = kind,
      .entity_id = line.id,
      .related_entity_id = related_entity_id,
      .label = label,
      .is_selected = is_selected,
      .position_x = position.x,
      .position_y = position.y,
      .position_z = position.z,
  };
}

ViewportSketchConstraintPrimitive make_point_constraint_primitive(
    const SketchPoint& point,
    const SketchFeatureParameters& parameters,
    bool is_selected) {
  const WorldPoint position = to_world_point(
      parameters, point.x, point.y, kSketchPlaneOffset + kConstraintBadgeOffset);

  return ViewportSketchConstraintPrimitive{
      .constraint_id = "constraint-fixed-" + point.id,
      .plane_id = parameters.plane_id,
      .kind = "fixed",
      .entity_id = point.id,
      .related_entity_id = std::nullopt,
      .label = "FIX",
      .is_selected = is_selected,
      .position_x = position.x,
      .position_y = position.y,
      .position_z = position.z,
  };
}

ViewportSketchProfilePrimitive make_rectangle_profile_primitive(
    const PolygonSketchProfile& profile, bool is_selected) {
  return ViewportSketchProfilePrimitive{
      .profile_id = profile.id,
      .plane_id = profile.plane_id,
      .plane_frame = profile.plane_frame.has_value()
                         ? std::optional<ViewportSketchPlaneFrame>(
                               make_sketch_plane_frame(profile.plane_frame.value()))
                         : std::nullopt,
      .profile_kind = "polygon",
      .profile_points = profile.points,
      .start_x = 0.0,
      .start_y = 0.0,
      .width = 0.0,
      .height = 0.0,
      .radius = 0.0,
      .is_selected = is_selected,
  };
}

ViewportSketchProfilePrimitive make_circle_profile_primitive(
    const CircleSketchProfile& profile, bool is_selected) {
  return ViewportSketchProfilePrimitive{
      .profile_id = profile.id,
      .plane_id = profile.plane_id,
      .plane_frame = profile.plane_frame.has_value()
                         ? std::optional<ViewportSketchPlaneFrame>(
                               make_sketch_plane_frame(profile.plane_frame.value()))
                         : std::nullopt,
      .profile_kind = "circle",
      .profile_points = {},
      .start_x = profile.center_x,
      .start_y = profile.center_y,
      .width = 0.0,
      .height = 0.0,
      .radius = profile.radius,
      .is_selected = is_selected,
  };
}

void include_world_point_for_plane(const std::string& plane_id,
                                   double local_x,
                                   double local_y,
                                   double depth,
                                   double& min_x,
                                   double& max_x,
                                   double& min_y,
                                   double& max_y,
                                   double& min_z,
                                   double& max_z) {
  const auto include_point =
      [&](double world_x, double world_y, double world_z) {
        min_x = std::min(min_x, world_x);
        max_x = std::max(max_x, world_x);
        min_y = std::min(min_y, world_y);
        max_y = std::max(max_y, world_y);
        min_z = std::min(min_z, world_z);
        max_z = std::max(max_z, world_z);
      };

  if (plane_id == "ref-plane-xy") {
    include_point(local_x, 0.0, local_y);
    include_point(local_x, depth, local_y);
    return;
  }

  if (plane_id == "ref-plane-yz") {
    include_point(0.0, local_x, local_y);
    include_point(depth, local_x, local_y);
    return;
  }

  include_point(local_x, local_y, 0.0);
  include_point(local_x, local_y, depth);
}

void include_world_point_for_frame(
    const PlaneFrame& frame,
    double local_x,
    double local_y,
    double depth,
    double& min_x,
    double& max_x,
    double& min_y,
    double& max_y,
    double& min_z,
    double& max_z) {
  const auto include_point =
      [&](double world_x, double world_y, double world_z) {
        min_x = std::min(min_x, world_x);
        max_x = std::max(max_x, world_x);
        min_y = std::min(min_y, world_y);
        max_y = std::max(max_y, world_y);
        min_z = std::min(min_z, world_z);
        max_z = std::max(max_z, world_z);
      };

  const auto to_world = [&](double offset) {
    return WorldPoint{
        .x = frame.origin_x + frame.x_axis_x * local_x +
             frame.y_axis_x * local_y + frame.normal_x * offset,
        .y = frame.origin_y + frame.x_axis_y * local_x +
             frame.y_axis_y * local_y + frame.normal_y * offset,
        .z = frame.origin_z + frame.x_axis_z * local_x +
             frame.y_axis_z * local_y + frame.normal_z * offset,
    };
  };

  const WorldPoint start = to_world(0.0);
  const WorldPoint end = to_world(depth);
  include_point(start.x, start.y, start.z);
  include_point(end.x, end.y, end.z);
}

// Sample a single OCCT edge into a flat polyline (x0, y0, z0, x1, ...).
// Straight segments stay 2-point; everything else uses
// GCPnts_QuasiUniformDeflection with a small fixed deflection so curves
// look smooth in the viewport without ballooning the wire payload.
void sample_edge(const TopoDS_Edge& edge,
                 std::vector<double>& points,
                 std::string& kind) {
  points.clear();
  kind = "curve";

  if (edge.IsNull()) {
    return;
  }

  // BRepAdaptor_Curve internally pulls the curve from the edge and
  // applies the edge's location, so the sampled points are already in
  // world space relative to the body.
  BRepAdaptor_Curve adaptor;
  try {
    adaptor.Initialize(edge);
  } catch (const std::exception&) {
    return;
  }

  const GeomAbs_CurveType curve_type = adaptor.GetType();
  if (curve_type == GeomAbs_Line) {
    kind = "line";
    const double first = adaptor.FirstParameter();
    const double last = adaptor.LastParameter();
    const gp_Pnt start = adaptor.Value(first);
    const gp_Pnt end = adaptor.Value(last);
    points.push_back(start.X());
    points.push_back(start.Y());
    points.push_back(start.Z());
    points.push_back(end.X());
    points.push_back(end.Y());
    points.push_back(end.Z());
    return;
  }

  if (curve_type == GeomAbs_Circle) {
    kind = "circle";
  }

  // Generic curve sampler. The deflection of 0.05mm matches the
  // body_compiler tessellation budget closely enough that selectable
  // edges hug the rendered solid surface.
  try {
    GCPnts_QuasiUniformDeflection sampler(adaptor, /*Deflection=*/0.05);
    if (!sampler.IsDone() || sampler.NbPoints() < 2) {
      // Fall back to the curve's parametric endpoints so the edge is
      // at least pickable as a chord.
      const double first = adaptor.FirstParameter();
      const double last = adaptor.LastParameter();
      const gp_Pnt start = adaptor.Value(first);
      const gp_Pnt end = adaptor.Value(last);
      points.push_back(start.X());
      points.push_back(start.Y());
      points.push_back(start.Z());
      points.push_back(end.X());
      points.push_back(end.Y());
      points.push_back(end.Z());
      return;
    }
    for (int i = 1; i <= sampler.NbPoints(); ++i) {
      const gp_Pnt p = sampler.Value(i);
      points.push_back(p.X());
      points.push_back(p.Y());
      points.push_back(p.Z());
    }
  } catch (const std::exception&) {
    points.clear();
  }
}

// Append every unique edge of `body_shape` to `out`, owned by `body_id`.
// Edge ids match the format expected by DocumentManager::select_edge.
void enumerate_body_edges(const TopoDS_Shape& body_shape,
                          const std::string& body_id,
                          const std::optional<std::string>& selected_edge_id,
                          std::vector<ViewportEdgePrimitive>& out) {
  if (body_shape.IsNull()) {
    return;
  }

  TopTools_IndexedMapOfShape edge_map;
  TopExp::MapShapes(body_shape, TopAbs_EDGE, edge_map);

  for (int i = 1; i <= edge_map.Extent(); ++i) {
    const TopoDS_Edge edge = TopoDS::Edge(edge_map(i));
    ViewportEdgePrimitive primitive{};
    primitive.id = body_id + ":edge:" + std::to_string(i - 1);
    primitive.owner_body_id = body_id;
    sample_edge(edge, primitive.points, primitive.kind);
    if (primitive.points.size() < 6) {
      // Degenerate edges (fewer than 2 sample points) cannot be picked
      // or rendered; skip them rather than emit dead entries.
      continue;
    }
    primitive.is_selected =
        selected_edge_id.has_value() && selected_edge_id.value() == primitive.id;
    out.push_back(std::move(primitive));
  }
}

// Append every unique vertex of `body_shape` to `out`, owned by `body_id`.
// Vertex ids match the format expected by DocumentManager::select_vertex.
void enumerate_body_vertices(
    const TopoDS_Shape& body_shape,
    const std::string& body_id,
    const std::optional<std::string>& selected_vertex_id,
    std::vector<ViewportVertexPrimitive>& out) {
  if (body_shape.IsNull()) {
    return;
  }

  TopTools_IndexedMapOfShape vertex_map;
  TopExp::MapShapes(body_shape, TopAbs_VERTEX, vertex_map);

  for (int i = 1; i <= vertex_map.Extent(); ++i) {
    const TopoDS_Vertex vertex = TopoDS::Vertex(vertex_map(i));
    if (vertex.IsNull()) {
      continue;
    }
    gp_Pnt position;
    try {
      position = BRep_Tool::Pnt(vertex);
    } catch (const std::exception&) {
      continue;
    }
    ViewportVertexPrimitive primitive{};
    primitive.id = body_id + ":vertex:" + std::to_string(i - 1);
    primitive.owner_body_id = body_id;
    primitive.x = position.X();
    primitive.y = position.Y();
    primitive.z = position.Z();
    primitive.is_selected =
        selected_vertex_id.has_value() &&
        selected_vertex_id.value() == primitive.id;
    out.push_back(std::move(primitive));
  }
}

// Build a plane frame for `face` by reading the underlying surface's plane
// (when planar) and the face center. For non-planar faces, return a
// representative frame oriented around the face center + face normal at
// that point — picking still works, sketch-on-face is rejected via the
// returned `is_planar` flag.
struct FaceFrameInfo {
  ViewportSolidFace::PlaneFrame frame;
  double center_x;
  double center_y;
  double center_z;
  double normal_x;
  double normal_y;
  double normal_z;
  bool is_planar;
};

FaceFrameInfo derive_face_frame(const TopoDS_Face& face) {
  FaceFrameInfo info{};
  info.is_planar = false;
  // Sensible defaults; these are overwritten below.
  info.frame = ViewportSolidFace::PlaneFrame{
      .origin_x = 0.0, .origin_y = 0.0, .origin_z = 0.0,
      .x_axis_x = 1.0, .x_axis_y = 0.0, .x_axis_z = 0.0,
      .y_axis_x = 0.0, .y_axis_y = 1.0, .y_axis_z = 0.0,
      .normal_x = 0.0, .normal_y = 0.0, .normal_z = 1.0,
  };

  try {
    BRepAdaptor_Surface surface(face);
    const GeomAbs_SurfaceType type = surface.GetType();

    // Compute the face's parametric mid-point so we can sample a
    // representative (point, normal) regardless of surface type.
    const double u_mid = 0.5 * (surface.FirstUParameter() + surface.LastUParameter());
    const double v_mid = 0.5 * (surface.FirstVParameter() + surface.LastVParameter());

    BRepGProp_Face prop(face);
    gp_Pnt center;
    gp_Vec normal;
    prop.Normal(u_mid, v_mid, center, normal);
    if (normal.Magnitude() > 0.0) {
      normal.Normalize();
    } else {
      normal = gp_Vec(0.0, 0.0, 1.0);
    }
    // Honor the face's orientation flag so the emitted normal is the
    // outward-pointing one consumers expect.
    if (face.Orientation() == TopAbs_REVERSED) {
      normal.Reverse();
    }

    info.center_x = center.X();
    info.center_y = center.Y();
    info.center_z = center.Z();
    info.normal_x = normal.X();
    info.normal_y = normal.Y();
    info.normal_z = normal.Z();

    if (type == GeomAbs_Plane) {
      info.is_planar = true;
      const gp_Pln plane = surface.Plane();
      const gp_Ax3 ax = plane.Position();
      const gp_Pnt origin = ax.Location();
      gp_Dir x_axis = ax.XDirection();
      gp_Dir y_axis = ax.YDirection();
      gp_Dir z_axis = ax.Direction();
      // Mirror the orientation flag onto the plane axes too — a reversed
      // face has its "outward" normal flipped, and the y-axis is flipped
      // to keep the frame right-handed.
      if (face.Orientation() == TopAbs_REVERSED) {
        z_axis.Reverse();
        y_axis.Reverse();
      }
      info.frame = ViewportSolidFace::PlaneFrame{
          .origin_x = origin.X(),
          .origin_y = origin.Y(),
          .origin_z = origin.Z(),
          .x_axis_x = x_axis.X(),
          .x_axis_y = x_axis.Y(),
          .x_axis_z = x_axis.Z(),
          .y_axis_x = y_axis.X(),
          .y_axis_y = y_axis.Y(),
          .y_axis_z = y_axis.Z(),
          .normal_x = z_axis.X(),
          .normal_y = z_axis.Y(),
          .normal_z = z_axis.Z(),
      };
      // Override center/normal with the plane axes for consistency.
      info.normal_x = z_axis.X();
      info.normal_y = z_axis.Y();
      info.normal_z = z_axis.Z();
    } else {
      // Non-planar face: synthesize a frame at the sampled center with
      // the sampled normal so the UI can still place a label / preview
      // marker. Sketch-on-face is rejected via `is_planar = false`.
      gp_Vec arbitrary = std::abs(normal.X()) < 0.9
                             ? gp_Vec(1.0, 0.0, 0.0)
                             : gp_Vec(0.0, 1.0, 0.0);
      gp_Vec x_axis = arbitrary.Crossed(normal);
      if (x_axis.Magnitude() > 0.0) {
        x_axis.Normalize();
      }
      gp_Vec y_axis = normal.Crossed(x_axis);
      if (y_axis.Magnitude() > 0.0) {
        y_axis.Normalize();
      }
      info.frame = ViewportSolidFace::PlaneFrame{
          .origin_x = center.X(),
          .origin_y = center.Y(),
          .origin_z = center.Z(),
          .x_axis_x = x_axis.X(),
          .x_axis_y = x_axis.Y(),
          .x_axis_z = x_axis.Z(),
          .y_axis_x = y_axis.X(),
          .y_axis_y = y_axis.Y(),
          .y_axis_z = y_axis.Z(),
          .normal_x = normal.X(),
          .normal_y = normal.Y(),
          .normal_z = normal.Z(),
      };
    }
  } catch (const std::exception&) {
    // Bad surface: leave defaults, mark non-planar.
    info.is_planar = false;
  }

  return info;
}

// Append every unique face of `body_shape` to `out`, owned by `body_id`.
// Each face is fully tessellated in world space so the UI can build a
// real BufferGeometry and the picker hits the actual face geometry.
// Face ids match the format expected by DocumentManager::select_face
// ("<owner_id>:face:<index>"), with index coming from
// TopExp::MapShapes(TopAbs_FACE).
void enumerate_body_faces(const TopoDS_Shape& body_shape,
                          const std::string& body_id,
                          const std::string& body_kind,
                          const std::optional<std::string>& selected_face_id,
                          std::vector<ViewportSolidFace>& out) {
  if (body_shape.IsNull()) {
    return;
  }

  // BRepMesh_IncrementalMesh deflection mirrors body_compiler so the
  // face triangulation matches the body mesh that's already on screen.
  // Skipping this would leave faces without per-face triangulation when
  // body_compiler hasn't tessellated this body (legacy non-boolean path).
  try {
    BRepMesh_IncrementalMesh mesher(body_shape,
                                    /*deflection=*/0.1,
                                    /*isRelative=*/false,
                                    /*angularDeflection=*/0.5,
                                    /*isInParallel=*/true);
    if (!mesher.IsDone()) {
      return;
    }
  } catch (const std::exception&) {
    return;
  }

  TopTools_IndexedMapOfShape face_map;
  TopExp::MapShapes(body_shape, TopAbs_FACE, face_map);

  for (int i = 1; i <= face_map.Extent(); ++i) {
    const TopoDS_Face face = TopoDS::Face(face_map(i));
    if (face.IsNull()) {
      continue;
    }

    const std::string face_id =
        body_id + ":face:" + std::to_string(i - 1);

    TopLoc_Location location;
    const Handle(Poly_Triangulation) triangulation =
        BRep_Tool::Triangulation(face, location);
    if (triangulation.IsNull()) {
      // No tessellation for this face — skip rather than emit a face
      // that can't be picked or rendered.
      continue;
    }

    const FaceFrameInfo frame_info = derive_face_frame(face);

    ViewportSolidFace primitive{};
    primitive.face_id = face_id;
    primitive.owner_id = body_id;
    primitive.owner_kind = body_kind;
    primitive.label = "Face " + std::to_string(i);
    primitive.sketchability = frame_info.is_planar ? "planar" : "non-planar";
    primitive.center_x = frame_info.center_x;
    primitive.center_y = frame_info.center_y;
    primitive.center_z = frame_info.center_z;
    primitive.normal_x = frame_info.normal_x;
    primitive.normal_y = frame_info.normal_y;
    primitive.normal_z = frame_info.normal_z;
    primitive.plane_frame = frame_info.frame;
    primitive.is_selected = selected_face_id.has_value() &&
                            selected_face_id.value() == face_id;

    // Append per-face triangulation (positions in world space, indices
    // local to this face's positions array).
    const gp_Trsf transform = location.Transformation();
    const bool reversed = face.Orientation() == TopAbs_REVERSED;
    const int node_count = triangulation->NbNodes();
    primitive.triangle_positions.reserve(static_cast<size_t>(node_count) * 3);
    for (int node_index = 1; node_index <= node_count; ++node_index) {
      gp_Pnt node = triangulation->Node(node_index);
      node.Transform(transform);
      primitive.triangle_positions.push_back(node.X());
      primitive.triangle_positions.push_back(node.Y());
      primitive.triangle_positions.push_back(node.Z());
    }

    const int triangle_count = triangulation->NbTriangles();
    primitive.triangle_indices.reserve(static_cast<size_t>(triangle_count) * 3);
    for (int tri_index = 1; tri_index <= triangle_count; ++tri_index) {
      const Poly_Triangle& triangle = triangulation->Triangle(tri_index);
      int n1 = 0;
      int n2 = 0;
      int n3 = 0;
      triangle.Get(n1, n2, n3);
      if (reversed) {
        std::swap(n2, n3);
      }
      primitive.triangle_indices.push_back(n1 - 1);
      primitive.triangle_indices.push_back(n2 - 1);
      primitive.triangle_indices.push_back(n3 - 1);
    }

    if (primitive.triangle_positions.empty() ||
        primitive.triangle_indices.empty()) {
      continue;
    }

    out.push_back(std::move(primitive));
  }
}

// Tessellate `shape` into flat positions/normals/indices arrays. Used
// for the cut-preview emission below, which renders a translucent
// "this is what's about to be cut" volume so the user can see exactly
// which material the cut extrude will remove.
//
// The output is intentionally minimal compared to body_compiler's
// tessellate_shape: per-vertex normals are computed in a single pass
// (one normal per vertex, summed across triangles) without seam-
// splitting. The cut preview is a UI overlay so visual fidelity is
// less important than getting it on screen at all.
void tessellate_shape_to_arrays(const TopoDS_Shape& shape,
                                std::vector<double>& positions,
                                std::vector<double>& normals,
                                std::vector<int>& indices) {
  if (shape.IsNull()) {
    return;
  }
  try {
    BRepMesh_IncrementalMesh mesher(shape,
                                    /*deflection=*/0.1,
                                    /*isRelative=*/false,
                                    /*angularDeflection=*/0.5,
                                    /*isInParallel=*/true);
    if (!mesher.IsDone()) {
      return;
    }
  } catch (const std::exception&) {
    return;
  }

  for (TopExp_Explorer face_explorer(shape, TopAbs_FACE);
       face_explorer.More();
       face_explorer.Next()) {
    const TopoDS_Face face = TopoDS::Face(face_explorer.Current());
    TopLoc_Location location;
    const Handle(Poly_Triangulation) triangulation =
        BRep_Tool::Triangulation(face, location);
    if (triangulation.IsNull()) {
      continue;
    }
    const gp_Trsf transform = location.Transformation();
    const bool reversed = face.Orientation() == TopAbs_REVERSED;
    const int base_index = static_cast<int>(positions.size() / 3);
    const int node_count = triangulation->NbNodes();
    for (int i = 1; i <= node_count; ++i) {
      gp_Pnt node = triangulation->Node(i);
      node.Transform(transform);
      positions.push_back(node.X());
      positions.push_back(node.Y());
      positions.push_back(node.Z());
      normals.push_back(0.0);
      normals.push_back(0.0);
      normals.push_back(0.0);
    }
    const int triangle_count = triangulation->NbTriangles();
    for (int t = 1; t <= triangle_count; ++t) {
      const Poly_Triangle& triangle = triangulation->Triangle(t);
      int n1 = 0;
      int n2 = 0;
      int n3 = 0;
      triangle.Get(n1, n2, n3);
      if (reversed) {
        std::swap(n2, n3);
      }
      const int i1 = base_index + (n1 - 1);
      const int i2 = base_index + (n2 - 1);
      const int i3 = base_index + (n3 - 1);
      indices.push_back(i1);
      indices.push_back(i2);
      indices.push_back(i3);
      // Accumulate per-triangle normal onto each vertex so the simple
      // viewer flat-shading pass has something to work with.
      const double ax = positions[3 * i1 + 0];
      const double ay = positions[3 * i1 + 1];
      const double az = positions[3 * i1 + 2];
      const double bx = positions[3 * i2 + 0];
      const double by = positions[3 * i2 + 1];
      const double bz = positions[3 * i2 + 2];
      const double cx = positions[3 * i3 + 0];
      const double cy = positions[3 * i3 + 1];
      const double cz = positions[3 * i3 + 2];
      const double ux = bx - ax;
      const double uy = by - ay;
      const double uz = bz - az;
      const double vx = cx - ax;
      const double vy = cy - ay;
      const double vz = cz - az;
      const double nx = uy * vz - uz * vy;
      const double ny = uz * vx - ux * vz;
      const double nz = ux * vy - uy * vx;
      const double length = std::sqrt(nx * nx + ny * ny + nz * nz);
      const double inv = length > 0.0 ? 1.0 / length : 0.0;
      const double nxn = nx * inv;
      const double nyn = ny * inv;
      const double nzn = nz * inv;
      for (int idx : {i1, i2, i3}) {
        normals[3 * idx + 0] += nxn;
        normals[3 * idx + 1] += nyn;
        normals[3 * idx + 2] += nzn;
      }
    }
  }
}

}  // namespace

ViewportState build_viewport_state(const std::optional<DocumentState>& document) {
  if (!document.has_value()) {
    return ViewportState{
        .has_active_document = false,
        .boxes = {},
        .cylinders = {},
        .polygon_extrudes = {},
        .solid_faces = {},
        .reference_planes = {},
        .reference_axes = {},
        .sketch_lines = {},
        .sketch_circles = {},
        .sketch_points = {},
        .sketch_dimensions = {},
        .sketch_constraints = {},
        .sketch_profiles = {},
        .meshes = {},
        .cut_previews = {},
        .bodies = {},
        .edges = {},
        .vertices = {},
        .scene_width = 0.0,
        .scene_height = 0.0,
        .scene_depth = 0.0,
        .scene_bounds =
            ViewportSceneBounds{
                .center_x = 0.0,
                .center_y = 0.0,
                .center_z = 0.0,
                .width = 0.0,
                .height = 0.0,
                .depth = 0.0,
                .max_dimension = 0.0,
            },
    };
  }

  std::vector<ViewportBoxPrimitive> boxes;
  std::vector<ViewportCylinderPrimitive> cylinders;
  std::vector<ViewportPolygonExtrudePrimitive> polygon_extrudes;
  std::vector<ViewportSolidFace> solid_faces;
  std::vector<ViewportReferencePlane> reference_planes;
  std::vector<ViewportReferenceAxis> reference_axes;
  std::vector<ViewportSketchLinePrimitive> sketch_lines;
  std::vector<ViewportSketchCirclePrimitive> sketch_circles;
  std::vector<ViewportSketchPointPrimitive> sketch_points;
  std::vector<ViewportSketchDimensionPrimitive> sketch_dimensions;
  std::vector<ViewportSketchConstraintPrimitive> sketch_constraints;
  std::vector<ViewportSketchProfilePrimitive> sketch_profiles;
  std::vector<ViewportMeshPrimitive> meshes;
  std::vector<ViewportCutPreview> cut_previews;
  std::vector<ViewportBodySummary> bodies;
  std::vector<ViewportEdgePrimitive> edges;
  std::vector<ViewportVertexPrimitive> vertices;
  double current_x_offset = 0.0;
  double scene_width = 0.0;
  double max_height = 0.0;
  double max_depth = 0.0;

  // Walk the feature history once with boolean operators applied so we
  // know which features get consumed by Fuse/Cut and which bodies need
  // to be tessellated as mesh primitives. Features in the resulting
  // `consumed_feature_ids` set must be skipped by the legacy primitive
  // emission below to avoid double-rendering. Failures in OCCT booleans
  // produce empty meshes — see body_compiler.cpp — so legacy fallback
  // still renders something.
  CompiledBodies compiled_bodies = compile_bodies(document.value());
  for (const auto& body_mesh : compiled_bodies.meshes) {
    ViewportMeshPrimitive mesh{};
    mesh.id = body_mesh.body_id;
    mesh.positions = body_mesh.vertices;
    mesh.normals = body_mesh.normals;
    mesh.indices = body_mesh.indices;
    mesh.is_selected =
        document->selected_feature_id.has_value() &&
        document->selected_feature_id.value() == body_mesh.body_id;
    meshes.push_back(std::move(mesh));
  }
  const std::set<std::string>& consumed = compiled_bodies.consumed_feature_ids;

  // Cut preview overlay: when the user has a cut extrude selected (i.e.
  // the floating Extrude panel is open and editing it), emit a
  // translucent red mesh of the cutter volume so they can see exactly
  // what's about to be removed. This is a UI overlay only — the
  // booleaned body itself already renders the post-cut shape via
  // `meshes`. We only emit the preview while the feature is the
  // currently-selected one to avoid clutter on saved documents.
  if (document->selected_feature_id.has_value()) {
    for (const auto& feature : document->feature_history) {
      if (feature.id != document->selected_feature_id.value()) {
        continue;
      }
      if (feature.kind != "extrude" ||
          !feature.extrude_parameters.has_value() ||
          feature.extrude_parameters->mode != "cut") {
        break;
      }
      try {
        const TopoDS_Shape cutter =
            build_extrude_shape(feature.extrude_parameters.value());
        if (cutter.IsNull()) {
          break;
        }
        ViewportCutPreview preview{};
        preview.id = feature.id;
        tessellate_shape_to_arrays(cutter,
                                   preview.positions,
                                   preview.normals,
                                   preview.indices);
        if (!preview.positions.empty() && !preview.indices.empty()) {
          cut_previews.push_back(std::move(preview));
        }
      } catch (const std::exception&) {
        // Cutter build failures shouldn't break the rest of the
        // viewport; just skip the preview for this snapshot.
      }
      break;
    }
  }

  // Build the body summary list for the UI's target picker. The body's
  // root id maps 1:1 to a feature id, so we look up the human-readable
  // name from feature_history; missing or empty names degrade to the id
  // itself so the picker is always populated.
  for (const auto& body : compiled_bodies.bodies) {
    std::string label = body.id;
    for (const auto& feature : document->feature_history) {
      if (feature.id == body.id && !feature.name.empty()) {
        label = feature.name;
        break;
      }
    }
    bodies.push_back(ViewportBodySummary{.id = body.id, .label = label});
    enumerate_body_edges(body.shape,
                         body.id,
                         document->selected_edge_id,
                         edges);
    enumerate_body_vertices(body.shape,
                            body.id,
                            document->selected_vertex_id,
                            vertices);
    // Look up the body's owning feature kind so the face's owner_kind
    // stays useful to consumers (the UI uses it to label faces).
    std::string body_kind;
    for (const auto& feature : document->feature_history) {
      if (feature.id == body.id) {
        body_kind = feature.kind;
        break;
      }
    }
    // Legacy box/cylinder features render at a `current_x_offset` that
    // body_compiler doesn't know about (their shapes are built at the
    // origin). Body-derived faces would therefore land away from the
    // visual primitive — keep their analytical faces (emitted below in
    // the per-feature loop) and skip body-derived faces for them.
    if (body_kind != "box" && body_kind != "cylinder") {
      enumerate_body_faces(body.shape,
                           body.id,
                           body_kind,
                           document->selected_face_id,
                           solid_faces);
    }
  }

  for (const auto& feature : document->feature_history) {
    const bool is_selected =
        document->selected_feature_id.has_value() &&
        document->selected_feature_id.value() == feature.id;
    const bool feature_consumed_by_boolean =
        consumed.find(feature.id) != consumed.end();

    if (feature.kind == "box" && feature.box_parameters.has_value()) {
      if (feature_consumed_by_boolean) {
        continue;
      }
      const auto& parameters = feature.box_parameters.value();
      boxes.push_back(ViewportBoxPrimitive{
          .id = feature.id,
          .label = feature.name,
          .width = parameters.width,
          .height = parameters.height,
          .depth = parameters.depth,
          .x_offset = current_x_offset,
          .center_x = current_x_offset + parameters.width / 2.0,
          .center_y = parameters.height / 2.0,
          .center_z = parameters.depth / 2.0,
          .is_selected = is_selected,
      });
      solid_faces.push_back(make_solid_face(
          feature.id,
          feature.kind,
          "top",
          "Top",
          "planar",
          current_x_offset + parameters.width / 2.0,
          parameters.height,
          parameters.depth / 2.0,
          0.0,
          1.0,
          0.0,
          make_plane_frame(current_x_offset + parameters.width / 2.0,
                           parameters.height,
                           parameters.depth / 2.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0,
                           0.0,
                           1.0,
                           0.0),
          parameters.width,
          parameters.depth,
          0.0,
          document->selected_face_id.has_value() &&
              document->selected_face_id.value() == feature.id + ":face:top"));
      solid_faces.push_back(make_solid_face(
          feature.id,
          feature.kind,
          "bottom",
          "Bottom",
          "planar",
          current_x_offset + parameters.width / 2.0,
          0.0,
          parameters.depth / 2.0,
          0.0,
          -1.0,
          0.0,
          make_plane_frame(current_x_offset + parameters.width / 2.0,
                           0.0,
                           parameters.depth / 2.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0,
                           0.0,
                           -1.0,
                           0.0),
          parameters.width,
          parameters.depth,
          0.0,
          document->selected_face_id.has_value() &&
              document->selected_face_id.value() == feature.id + ":face:bottom"));
      solid_faces.push_back(make_solid_face(
          feature.id,
          feature.kind,
          "front",
          "Front",
          "planar",
          current_x_offset + parameters.width / 2.0,
          parameters.height / 2.0,
          parameters.depth,
          0.0,
          0.0,
          1.0,
          make_plane_frame(current_x_offset + parameters.width / 2.0,
                           parameters.height / 2.0,
                           parameters.depth,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0),
          parameters.width,
          parameters.height,
          0.0,
          document->selected_face_id.has_value() &&
              document->selected_face_id.value() == feature.id + ":face:front"));
      solid_faces.push_back(make_solid_face(
          feature.id,
          feature.kind,
          "back",
          "Back",
          "planar",
          current_x_offset + parameters.width / 2.0,
          parameters.height / 2.0,
          0.0,
          0.0,
          0.0,
          -1.0,
          make_plane_frame(current_x_offset + parameters.width / 2.0,
                           parameters.height / 2.0,
                           0.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           -1.0),
          parameters.width,
          parameters.height,
          0.0,
          document->selected_face_id.has_value() &&
              document->selected_face_id.value() == feature.id + ":face:back"));
      solid_faces.push_back(make_solid_face(
          feature.id,
          feature.kind,
          "right",
          "Right",
          "planar",
          current_x_offset + parameters.width,
          parameters.height / 2.0,
          parameters.depth / 2.0,
          1.0,
          0.0,
          0.0,
          make_plane_frame(current_x_offset + parameters.width,
                           parameters.height / 2.0,
                           parameters.depth / 2.0,
                           0.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0,
                           1.0,
                           0.0,
                           0.0),
          parameters.height,
          parameters.depth,
          0.0,
          document->selected_face_id.has_value() &&
              document->selected_face_id.value() == feature.id + ":face:right"));
      solid_faces.push_back(make_solid_face(
          feature.id,
          feature.kind,
          "left",
          "Left",
          "planar",
          current_x_offset,
          parameters.height / 2.0,
          parameters.depth / 2.0,
          -1.0,
          0.0,
          0.0,
          make_plane_frame(current_x_offset,
                           parameters.height / 2.0,
                           parameters.depth / 2.0,
                           0.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0,
                           -1.0,
                           0.0,
                           0.0),
          parameters.height,
          parameters.depth,
          0.0,
          document->selected_face_id.has_value() &&
              document->selected_face_id.value() == feature.id + ":face:left"));

      current_x_offset += parameters.width + kBoxSpacing;
      scene_width = std::max(scene_width, current_x_offset - kBoxSpacing);
      if (parameters.height > max_height) {
        max_height = parameters.height;
      }
      if (parameters.depth > max_depth) {
        max_depth = parameters.depth;
      }
      continue;
    }

    if (feature.kind == "cylinder" && feature.cylinder_parameters.has_value()) {
      if (feature_consumed_by_boolean) {
        continue;
      }
      const auto& parameters = feature.cylinder_parameters.value();
      const double diameter = parameters.radius * 2.0;

      cylinders.push_back(ViewportCylinderPrimitive{
          .id = feature.id,
          .label = feature.name,
          .radius = parameters.radius,
          .height = parameters.height,
          .x_offset = current_x_offset,
          .center_x = current_x_offset + diameter / 2.0,
          .center_y = parameters.height / 2.0,
          .center_z = diameter / 2.0,
          .is_selected = is_selected,
      });
      solid_faces.push_back(make_solid_face(
          feature.id,
          feature.kind,
          "top",
          "Top",
          "planar",
          current_x_offset + diameter / 2.0,
          parameters.height,
          diameter / 2.0,
          0.0,
          1.0,
          0.0,
          make_plane_frame(current_x_offset + diameter / 2.0,
                           parameters.height,
                           diameter / 2.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0,
                           0.0,
                           1.0,
                           0.0),
          diameter,
          diameter,
          parameters.radius,
          document->selected_face_id.has_value() &&
              document->selected_face_id.value() == feature.id + ":face:top"));
      solid_faces.push_back(make_solid_face(
          feature.id,
          feature.kind,
          "bottom",
          "Bottom",
          "planar",
          current_x_offset + diameter / 2.0,
          0.0,
          diameter / 2.0,
          0.0,
          -1.0,
          0.0,
          make_plane_frame(current_x_offset + diameter / 2.0,
                           0.0,
                           diameter / 2.0,
                           1.0,
                           0.0,
                           0.0,
                           0.0,
                           0.0,
                           1.0,
                           0.0,
                           -1.0,
                           0.0),
          diameter,
          diameter,
          parameters.radius,
          document->selected_face_id.has_value() &&
              document->selected_face_id.value() == feature.id + ":face:bottom"));

      current_x_offset += diameter + kBoxSpacing;
      scene_width = std::max(scene_width, current_x_offset - kBoxSpacing);
      if (parameters.height > max_height) {
        max_height = parameters.height;
      }
      if (diameter > max_depth) {
        max_depth = diameter;
      }
      continue;
    }

    if (feature.kind == "extrude" && feature.extrude_parameters.has_value()) {
      if (feature_consumed_by_boolean) {
        continue;
      }
      const auto& parameters = feature.extrude_parameters.value();

      if (parameters.profile_kind == "rectangle") {
        double face_center_x = 0.0;
        double face_center_y = 0.0;
        double face_center_z = 0.0;
        double face_normal_x = 0.0;
        double face_normal_y = 0.0;
        double face_normal_z = 0.0;
        double face_width = parameters.width;
        double face_height = parameters.height;
        double face_origin_x = 0.0;
        double face_origin_y = 0.0;
        double face_origin_z = 0.0;

        if (parameters.plane_frame.has_value()) {
          const auto& frame = parameters.plane_frame.value();
          polygon_extrudes.push_back(ViewportPolygonExtrudePrimitive{
              .id = feature.id,
              .label = feature.name,
              .plane_id = parameters.plane_id,
              .plane_frame = std::optional<ViewportSketchPlaneFrame>(
                  make_sketch_plane_frame(frame)),
              .profile_points = {
                  SketchProfilePoint{.x = parameters.start_x, .y = parameters.start_y},
                  SketchProfilePoint{.x = parameters.start_x + parameters.width,
                                     .y = parameters.start_y},
                  SketchProfilePoint{.x = parameters.start_x + parameters.width,
                                     .y = parameters.start_y + parameters.height},
                  SketchProfilePoint{.x = parameters.start_x,
                                     .y = parameters.start_y + parameters.height},
              },
              .depth = parameters.depth,
              .is_selected = is_selected,
          });

          const auto top_center = to_world_point(
              frame,
              parameters.start_x + parameters.width / 2.0,
              parameters.start_y + parameters.height / 2.0,
              parameters.depth);
          const auto base_center = to_world_point(
              frame,
              parameters.start_x + parameters.width / 2.0,
              parameters.start_y + parameters.height / 2.0,
              0.0);

          face_center_x = top_center.x;
          face_center_y = top_center.y;
          face_center_z = top_center.z;
          face_normal_x = frame.normal_x;
          face_normal_y = frame.normal_y;
          face_normal_z = frame.normal_z;
          face_origin_x = top_center.x;
          face_origin_y = top_center.y;
          face_origin_z = top_center.z;

          solid_faces.push_back(make_solid_face(
              feature.id,
              feature.kind,
              "base",
              "Base",
              "planar",
              base_center.x,
              base_center.y,
              base_center.z,
              -frame.normal_x,
              -frame.normal_y,
              -frame.normal_z,
              make_plane_frame(base_center.x,
                               base_center.y,
                               base_center.z,
                               frame.x_axis_x,
                               frame.x_axis_y,
                               frame.x_axis_z,
                               frame.y_axis_x,
                               frame.y_axis_y,
                               frame.y_axis_z,
                               -frame.normal_x,
                               -frame.normal_y,
                               -frame.normal_z),
              face_width,
              face_height,
              0.0,
              document->selected_face_id.has_value() &&
                  document->selected_face_id.value() == feature.id + ":face:base"));
        } else if (parameters.plane_id == "ref-plane-xy") {
          boxes.push_back(ViewportBoxPrimitive{
              .id = feature.id,
              .label = feature.name,
              .width = parameters.width,
              .height = parameters.depth,
              .depth = parameters.height,
              .x_offset = parameters.start_x,
              .center_x = parameters.start_x + parameters.width / 2.0,
              .center_y = parameters.depth / 2.0,
              .center_z = parameters.start_y + parameters.height / 2.0,
              .is_selected = is_selected,
          });
          face_center_x = parameters.start_x + parameters.width / 2.0;
          face_center_y = parameters.depth;
          face_center_z = parameters.start_y + parameters.height / 2.0;
          face_normal_y = 1.0;
          face_origin_x = face_center_x;
          face_origin_y = face_center_y;
          face_origin_z = face_center_z;
          max_height = std::max(max_height, parameters.depth);
          max_depth = std::max(max_depth, parameters.start_y + parameters.height);
          scene_width = std::max(scene_width, parameters.start_x + parameters.width);
        } else if (parameters.plane_id == "ref-plane-yz") {
          boxes.push_back(ViewportBoxPrimitive{
              .id = feature.id,
              .label = feature.name,
              .width = parameters.depth,
              .height = parameters.width,
              .depth = parameters.height,
              .x_offset = 0.0,
              .center_x = parameters.depth / 2.0,
              .center_y = parameters.start_x + parameters.width / 2.0,
              .center_z = parameters.start_y + parameters.height / 2.0,
              .is_selected = is_selected,
          });
          face_center_x = parameters.depth;
          face_center_y = parameters.start_x + parameters.width / 2.0;
          face_center_z = parameters.start_y + parameters.height / 2.0;
          face_normal_x = 1.0;
          face_origin_x = face_center_x;
          face_origin_y = face_center_y;
          face_origin_z = face_center_z;
          max_height = std::max(max_height, parameters.start_x + parameters.width);
          max_depth = std::max(max_depth, parameters.start_y + parameters.height);
          scene_width = std::max(scene_width, parameters.depth);
        } else {
          boxes.push_back(ViewportBoxPrimitive{
              .id = feature.id,
              .label = feature.name,
              .width = parameters.width,
              .height = parameters.height,
              .depth = parameters.depth,
              .x_offset = parameters.start_x,
              .center_x = parameters.start_x + parameters.width / 2.0,
              .center_y = parameters.start_y + parameters.height / 2.0,
              .center_z = parameters.depth / 2.0,
              .is_selected = is_selected,
          });
          face_center_x = parameters.start_x + parameters.width / 2.0;
          face_center_y = parameters.start_y + parameters.height / 2.0;
          face_center_z = parameters.depth;
          face_normal_z = 1.0;
          face_origin_x = face_center_x;
          face_origin_y = face_center_y;
          face_origin_z = face_center_z;
          max_height = std::max(max_height, parameters.start_y + parameters.height);
          max_depth = std::max(max_depth, parameters.depth);
          scene_width = std::max(scene_width, parameters.start_x + parameters.width);
        }
        solid_faces.push_back(make_solid_face(
            feature.id,
            feature.kind,
            "top",
            "Top",
            "planar",
            face_center_x,
            face_center_y,
            face_center_z,
            face_normal_x,
            face_normal_y,
            face_normal_z,
            parameters.plane_frame.has_value()
                ? make_plane_frame(face_origin_x,
                                   face_origin_y,
                                   face_origin_z,
                                   parameters.plane_frame->x_axis_x,
                                   parameters.plane_frame->x_axis_y,
                                   parameters.plane_frame->x_axis_z,
                                   parameters.plane_frame->y_axis_x,
                                   parameters.plane_frame->y_axis_y,
                                   parameters.plane_frame->y_axis_z,
                                   parameters.plane_frame->normal_x,
                                   parameters.plane_frame->normal_y,
                                   parameters.plane_frame->normal_z)
                : make_face_frame_for_plane(
                      parameters.plane_id, face_origin_x, face_origin_y, face_origin_z),
            face_width,
            face_height,
            0.0,
            document->selected_face_id.has_value() &&
                document->selected_face_id.value() == feature.id + ":face:top"));

        if (parameters.plane_frame.has_value()) {
          const auto& frame = parameters.plane_frame.value();
          const auto make_side_frame = [&](double origin_x,
                                           double origin_y,
                                           double origin_z,
                                           double normal_x,
                                           double normal_y,
                                           double normal_z,
                                           bool along_x_axis) {
            return make_plane_frame(origin_x,
                                    origin_y,
                                    origin_z,
                                    along_x_axis ? frame.y_axis_x : frame.x_axis_x,
                                    along_x_axis ? frame.y_axis_y : frame.x_axis_y,
                                    along_x_axis ? frame.y_axis_z : frame.x_axis_z,
                                    frame.normal_x,
                                    frame.normal_y,
                                    frame.normal_z,
                                    normal_x,
                                    normal_y,
                                    normal_z);
          };

          const auto left_center = to_world_point(frame, 0.0, parameters.height / 2.0, parameters.depth / 2.0);
          const auto right_center = to_world_point(frame, parameters.width, parameters.height / 2.0, parameters.depth / 2.0);
          const auto front_center = to_world_point(frame, parameters.width / 2.0, 0.0, parameters.depth / 2.0);
          const auto back_center = to_world_point(frame, parameters.width / 2.0, parameters.height, parameters.depth / 2.0);

          solid_faces.push_back(make_solid_face(
              feature.id,
              feature.kind,
              "left",
              "Left",
              "planar",
              left_center.x,
              left_center.y,
              left_center.z,
              -frame.x_axis_x,
              -frame.x_axis_y,
              -frame.x_axis_z,
              make_side_frame(left_center.x,
                              left_center.y,
                              left_center.z,
                              -frame.x_axis_x,
                              -frame.x_axis_y,
                              -frame.x_axis_z,
                              true),
              parameters.height,
              parameters.depth,
              0.0,
              document->selected_face_id.has_value() &&
                  document->selected_face_id.value() == feature.id + ":face:left"));

          solid_faces.push_back(make_solid_face(
              feature.id,
              feature.kind,
              "right",
              "Right",
              "planar",
              right_center.x,
              right_center.y,
              right_center.z,
              frame.x_axis_x,
              frame.x_axis_y,
              frame.x_axis_z,
              make_side_frame(right_center.x,
                              right_center.y,
                              right_center.z,
                              frame.x_axis_x,
                              frame.x_axis_y,
                              frame.x_axis_z,
                              true),
              parameters.height,
              parameters.depth,
              0.0,
              document->selected_face_id.has_value() &&
                  document->selected_face_id.value() == feature.id + ":face:right"));

          solid_faces.push_back(make_solid_face(
              feature.id,
              feature.kind,
              "front",
              "Front",
              "planar",
              front_center.x,
              front_center.y,
              front_center.z,
              -frame.y_axis_x,
              -frame.y_axis_y,
              -frame.y_axis_z,
              make_side_frame(front_center.x,
                              front_center.y,
                              front_center.z,
                              -frame.y_axis_x,
                              -frame.y_axis_y,
                              -frame.y_axis_z,
                              false),
              parameters.width,
              parameters.depth,
              0.0,
              document->selected_face_id.has_value() &&
                  document->selected_face_id.value() == feature.id + ":face:front"));

          solid_faces.push_back(make_solid_face(
              feature.id,
              feature.kind,
              "back",
              "Back",
              "planar",
              back_center.x,
              back_center.y,
              back_center.z,
              frame.y_axis_x,
              frame.y_axis_y,
              frame.y_axis_z,
              make_side_frame(back_center.x,
                              back_center.y,
                              back_center.z,
                              frame.y_axis_x,
                              frame.y_axis_y,
                              frame.y_axis_z,
                              false),
              parameters.width,
              parameters.depth,
              0.0,
              document->selected_face_id.has_value() &&
                  document->selected_face_id.value() == feature.id + ":face:back"));
        }
      } else if (parameters.profile_kind == "polygon") {
        polygon_extrudes.push_back(ViewportPolygonExtrudePrimitive{
            .id = feature.id,
            .label = feature.name,
            .plane_id = parameters.plane_id,
            .plane_frame = parameters.plane_frame.has_value()
                               ? std::optional<ViewportSketchPlaneFrame>(
                                     make_sketch_plane_frame(parameters.plane_frame.value()))
                               : std::nullopt,
            .profile_points = parameters.profile_points,
            .depth = parameters.depth,
            .is_selected = is_selected,
        });

        double min_x = std::numeric_limits<double>::max();
        double max_x = std::numeric_limits<double>::lowest();
        double min_y = std::numeric_limits<double>::max();
        double max_y = std::numeric_limits<double>::lowest();
        double min_z = std::numeric_limits<double>::max();
        double max_z = std::numeric_limits<double>::lowest();

        for (const auto& point : parameters.profile_points) {
          if (parameters.plane_frame.has_value()) {
            include_world_point_for_frame(parameters.plane_frame.value(),
                                          point.x,
                                          point.y,
                                          parameters.depth,
                                          min_x,
                                          max_x,
                                          min_y,
                                          max_y,
                                          min_z,
                                          max_z);
            continue;
          }

          include_world_point_for_plane(parameters.plane_id,
                                       point.x,
                                       point.y,
                                       parameters.depth,
                                       min_x,
                                       max_x,
                                       min_y,
                                       max_y,
                                       min_z,
                                       max_z);
        }

        if (!parameters.profile_points.empty()) {
          scene_width = std::max(scene_width, max_x);
          max_height = std::max(max_height, max_y);
          max_depth = std::max(max_depth, max_z);
        }

        double face_center_x = (min_x + max_x) / 2.0;
        double face_center_y = parameters.depth;
        double face_center_z = (min_z + max_z) / 2.0;
        double face_width = max_x - min_x;
        double face_height = max_z - min_z;
        double face_normal_x = 0.0;
        double face_normal_y = 1.0;
        double face_normal_z = 0.0;
        if (parameters.plane_frame.has_value()) {
          const auto& frame = parameters.plane_frame.value();
          const double local_center_x = (min_x + max_x) / 2.0;
          const double local_center_y = (min_z + max_z) / 2.0;
          const auto base_center =
              to_world_point(frame, local_center_x, local_center_y, 0.0);
          const auto top_center =
              to_world_point(frame, local_center_x, local_center_y, parameters.depth);
          face_center_x = top_center.x;
          face_center_y = top_center.y;
          face_center_z = top_center.z;
          face_normal_x = frame.normal_x;
          face_normal_y = frame.normal_y;
          face_normal_z = frame.normal_z;

          solid_faces.push_back(make_solid_face(
              feature.id,
              feature.kind,
              "base",
              "Base",
              "planar",
              base_center.x,
              base_center.y,
              base_center.z,
              -frame.normal_x,
              -frame.normal_y,
              -frame.normal_z,
              make_plane_frame(base_center.x,
                               base_center.y,
                               base_center.z,
                               frame.x_axis_x,
                               frame.x_axis_y,
                               frame.x_axis_z,
                               frame.y_axis_x,
                               frame.y_axis_y,
                               frame.y_axis_z,
                               -frame.normal_x,
                               -frame.normal_y,
                               -frame.normal_z),
              face_width,
              face_height,
              0.0,
              document->selected_face_id.has_value() &&
                  document->selected_face_id.value() == feature.id + ":face:base"));
        } else if (parameters.plane_id == "ref-plane-yz") {
          face_center_x = parameters.depth;
          face_center_y = (min_y + max_y) / 2.0;
          face_center_z = (min_z + max_z) / 2.0;
          face_width = max_y - min_y;
          face_height = max_z - min_z;
          face_normal_x = 1.0;
          face_normal_y = 0.0;
        } else if (parameters.plane_id == "ref-plane-xz") {
          face_center_x = (min_x + max_x) / 2.0;
          face_center_y = (min_y + max_y) / 2.0;
          face_center_z = parameters.depth;
          face_width = max_x - min_x;
          face_height = max_y - min_y;
          face_normal_y = 0.0;
          face_normal_z = 1.0;
        }

        solid_faces.push_back(make_solid_face(
            feature.id,
            feature.kind,
            "top",
            "Top",
            "planar",
            face_center_x,
            face_center_y,
            face_center_z,
            face_normal_x,
            face_normal_y,
            face_normal_z,
            parameters.plane_frame.has_value()
                ? make_plane_frame(face_center_x,
                                   face_center_y,
                                   face_center_z,
                                   parameters.plane_frame->x_axis_x,
                                   parameters.plane_frame->x_axis_y,
                                   parameters.plane_frame->x_axis_z,
                                   parameters.plane_frame->y_axis_x,
                                   parameters.plane_frame->y_axis_y,
                                   parameters.plane_frame->y_axis_z,
                                   parameters.plane_frame->normal_x,
                                   parameters.plane_frame->normal_y,
                                   parameters.plane_frame->normal_z)
                : make_face_frame_for_plane(
                      parameters.plane_id, face_center_x, face_center_y, face_center_z),
            face_width,
            face_height,
            0.0,
            document->selected_face_id.has_value() &&
                document->selected_face_id.value() == feature.id + ":face:top"));

        if (parameters.plane_frame.has_value() &&
            parameters.profile_points.size() >= 3) {
          const auto& frame = parameters.plane_frame.value();
          for (size_t index = 0; index < parameters.profile_points.size(); ++index) {
            const auto& start = parameters.profile_points[index];
            const auto& end = parameters.profile_points[(index + 1) %
                                                       parameters.profile_points.size()];

            const auto base_start = to_world_point(frame, start.x, start.y, 0.0);
            const auto base_end = to_world_point(frame, end.x, end.y, 0.0);
            const auto top_start = to_world_point(frame, start.x, start.y, parameters.depth);
            const auto top_end = to_world_point(frame, end.x, end.y, parameters.depth);

            const WorldVector edge_vector = subtract_points(base_end, base_start);
            const WorldVector depth_vector = subtract_points(top_start, base_start);
            const double edge_length = vector_length(edge_vector);
            const WorldVector face_normal = normalize_vector(cross_product(edge_vector, depth_vector));
            if (edge_length <= 0.0 ||
                vector_length(face_normal) <= 0.0) {
              continue;
            }

            const WorldPoint center{
                .x = (base_start.x + base_end.x + top_start.x + top_end.x) / 4.0,
                .y = (base_start.y + base_end.y + top_start.y + top_end.y) / 4.0,
                .z = (base_start.z + base_end.z + top_start.z + top_end.z) / 4.0,
            };

            const WorldVector edge_axis = normalize_vector(edge_vector);
            const WorldVector depth_axis = normalize_vector(depth_vector);

            solid_faces.push_back(make_solid_face(
                feature.id,
                feature.kind,
                "side-" + std::to_string(index),
                "Side",
                "planar",
                center.x,
                center.y,
                center.z,
                face_normal.x,
                face_normal.y,
                face_normal.z,
                make_plane_frame(center.x,
                                 center.y,
                                 center.z,
                                 edge_axis.x,
                                 edge_axis.y,
                                 edge_axis.z,
                                 depth_axis.x,
                                 depth_axis.y,
                                 depth_axis.z,
                                 face_normal.x,
                                 face_normal.y,
                                 face_normal.z),
                edge_length,
                parameters.depth,
                0.0,
                document->selected_face_id.has_value() &&
                    document->selected_face_id.value() ==
                        feature.id + ":face:side-" + std::to_string(index)));
          }
        }
      } else if (parameters.profile_kind == "circle") {
        if (parameters.plane_id != "ref-plane-xy") {
          continue;
        }

        if (parameters.plane_id == "ref-plane-xy") {
          cylinders.push_back(ViewportCylinderPrimitive{
              .id = feature.id,
              .label = feature.name,
              .radius = parameters.radius,
              .height = parameters.depth,
              .x_offset = parameters.start_x - parameters.radius,
              .center_x = parameters.start_x,
              .center_y = parameters.depth / 2.0,
              .center_z = parameters.start_y,
              .is_selected = is_selected,
          });
          max_height = std::max(max_height, parameters.depth);
          max_depth = std::max(max_depth, parameters.start_y + parameters.radius);
          scene_width = std::max(scene_width, parameters.start_x + parameters.radius);
        } else {
          cylinders.push_back(ViewportCylinderPrimitive{
              .id = feature.id,
              .label = feature.name,
              .radius = parameters.radius,
              .height = parameters.depth,
              .x_offset = parameters.start_x - parameters.radius,
              .center_x = parameters.start_x,
              .center_y = parameters.depth / 2.0,
              .center_z = parameters.start_y,
              .is_selected = is_selected,
          });
          max_height = std::max(max_height, parameters.depth);
          max_depth = std::max(max_depth, parameters.start_y + parameters.radius);
          scene_width = std::max(scene_width, parameters.start_x + parameters.radius);
        }
        solid_faces.push_back(make_solid_face(
            feature.id,
            feature.kind,
            "top",
            "Top",
            "planar",
            parameters.start_x,
            parameters.depth,
            parameters.start_y,
            0.0,
            1.0,
            0.0,
            make_face_frame_for_plane(
                parameters.plane_id,
                parameters.start_x,
                parameters.depth,
                parameters.start_y),
            parameters.radius * 2.0,
            parameters.radius * 2.0,
            parameters.radius,
            document->selected_face_id.has_value() &&
                document->selected_face_id.value() == feature.id + ":face:top"));
      }
      continue;
    }

    if (feature.kind == "sketch" && feature.sketch_parameters.has_value()) {
      const auto profiles = detect_sketch_profiles(feature);

      for (const auto& line : feature.sketch_parameters->lines) {
        const bool is_selected_sketch_entity =
            document->selected_sketch_entity_id.has_value() &&
            document->selected_sketch_entity_id.value() == line.id;
        sketch_lines.push_back(
            make_sketch_line_primitive(line,
                                       *feature.sketch_parameters,
                                       is_selected_sketch_entity));
        if (document->active_sketch_feature_id.has_value() &&
            document->active_sketch_feature_id.value() == feature.id) {
          const auto dimension_it = std::find_if(
              feature.sketch_parameters->dimensions.begin(),
              feature.sketch_parameters->dimensions.end(),
              [&](const SketchDimension& dimension) {
                return dimension.kind == "line_length" &&
                       dimension.entity_id == line.id;
              });
          if (dimension_it != feature.sketch_parameters->dimensions.end()) {
            const bool is_selected_dimension =
                document->selected_sketch_dimension_id.has_value() &&
                document->selected_sketch_dimension_id.value() == dimension_it->id;
            sketch_dimensions.push_back(make_line_dimension_primitive(
                line,
                *dimension_it,
                *feature.sketch_parameters,
                is_selected_dimension));
          }

          if (line.constraint.has_value()) {
            sketch_constraints.push_back(make_line_constraint_primitive(
                line,
                feature.sketch_parameters->plane_id,
                line.constraint.value(),
                line.constraint.value() == "horizontal" ? "H" : "V",
                is_selected_sketch_entity));
          }
        }
      }

      if (document->active_sketch_feature_id.has_value() &&
          document->active_sketch_feature_id.value() == feature.id) {
        for (const auto& relation : feature.sketch_parameters->line_relations) {
          if (relation.kind != "equal_length" &&
              relation.kind != "perpendicular" &&
              relation.kind != "parallel") {
            continue;
          }

          const auto first_line_it = std::find_if(
              feature.sketch_parameters->lines.begin(),
              feature.sketch_parameters->lines.end(),
              [&](const SketchLine& line) { return line.id == relation.first_line_id; });
          const auto second_line_it = std::find_if(
              feature.sketch_parameters->lines.begin(),
              feature.sketch_parameters->lines.end(),
              [&](const SketchLine& line) {
                return line.id == relation.second_line_id;
              });

          if (first_line_it == feature.sketch_parameters->lines.end() ||
              second_line_it == feature.sketch_parameters->lines.end()) {
            continue;
          }

          const bool first_is_selected =
              document->selected_sketch_entity_id.has_value() &&
              document->selected_sketch_entity_id.value() == first_line_it->id;
          const bool second_is_selected =
              document->selected_sketch_entity_id.has_value() &&
              document->selected_sketch_entity_id.value() == second_line_it->id;

          sketch_constraints.push_back(make_line_constraint_primitive(
              *first_line_it,
              feature.sketch_parameters->plane_id,
              relation.kind,
              relation.kind == "equal_length"
                  ? "="
                  : relation.kind == "perpendicular" ? "P" : "//",
              first_is_selected,
              relation.second_line_id));
          sketch_constraints.push_back(make_line_constraint_primitive(
              *second_line_it,
              feature.sketch_parameters->plane_id,
              relation.kind,
              relation.kind == "equal_length"
                  ? "="
                  : relation.kind == "perpendicular" ? "P" : "//",
              second_is_selected,
              relation.first_line_id));
        }
      }

      for (const auto& circle : feature.sketch_parameters->circles) {
        const bool is_selected_sketch_entity =
            document->selected_sketch_entity_id.has_value() &&
            document->selected_sketch_entity_id.value() == circle.id;
        sketch_circles.push_back(make_sketch_circle_primitive(
            circle,
            *feature.sketch_parameters,
            is_selected_sketch_entity));
        if (document->active_sketch_feature_id.has_value() &&
            document->active_sketch_feature_id.value() == feature.id) {
          const auto dimension_it = std::find_if(
              feature.sketch_parameters->dimensions.begin(),
              feature.sketch_parameters->dimensions.end(),
              [&](const SketchDimension& dimension) {
                return dimension.kind == "circle_radius" &&
                       dimension.entity_id == circle.id;
              });
          if (dimension_it != feature.sketch_parameters->dimensions.end()) {
            const bool is_selected_dimension =
                document->selected_sketch_dimension_id.has_value() &&
                document->selected_sketch_dimension_id.value() == dimension_it->id;
            sketch_dimensions.push_back(make_circle_dimension_primitive(
                circle,
                *dimension_it,
                *feature.sketch_parameters,
                is_selected_dimension));
          }
        }
      }

      if (document->active_sketch_feature_id.has_value() &&
          document->active_sketch_feature_id.value() == feature.id) {
        for (const auto& point : feature.sketch_parameters->points) {
          const bool is_selected_point =
              document->selected_sketch_point_id.has_value() &&
              document->selected_sketch_point_id.value() == point.id;
          sketch_points.push_back(make_sketch_point_primitive(
              point, *feature.sketch_parameters, is_selected_point));
          if (point.is_fixed) {
            sketch_constraints.push_back(make_point_constraint_primitive(
                point, *feature.sketch_parameters, is_selected_point));
          }
        }
      }

      for (const auto& rectangle : profiles.polygons) {
        const bool is_selected_profile =
            document->selected_sketch_profile_id.has_value() &&
            document->selected_sketch_profile_id.value() == rectangle.id;
        sketch_profiles.push_back(
            make_rectangle_profile_primitive(rectangle, is_selected_profile));
      }

      for (const auto& circle_profile : profiles.circles) {
        const bool is_selected_profile =
            document->selected_sketch_profile_id.has_value() &&
            document->selected_sketch_profile_id.value() == circle_profile.id;
        sketch_profiles.push_back(
            make_circle_profile_primitive(circle_profile, is_selected_profile));
      }
    }
  }

  scene_width = std::max(
      scene_width,
      (boxes.empty() && cylinders.empty()) ? 0.0 : current_x_offset - kBoxSpacing);
  const double reference_extent =
      std::max({kReferencePlaneSize, scene_width, max_height, max_depth, 1.0});
  const double scene_width_with_references = std::max(scene_width, reference_extent);
  const double scene_height_with_references = std::max(max_height, reference_extent);
  const double scene_depth_with_references = std::max(max_depth, reference_extent);

  reference_planes.push_back(ViewportReferencePlane{
      .id = "ref-plane-xy",
      .label = "XY Plane",
      .orientation = "xy",
      .center_x = reference_extent / 2.0,
      .center_y = 0.0,
      .center_z = reference_extent / 2.0,
      .width = reference_extent,
      .height = reference_extent,
      .is_selected = document->selected_reference_id.has_value() &&
                     document->selected_reference_id.value() == "ref-plane-xy",
      .is_active_sketch_plane = document->active_sketch_plane_id.has_value() &&
                                document->active_sketch_plane_id.value() ==
                                    "ref-plane-xy",
  });
  reference_planes.push_back(ViewportReferencePlane{
      .id = "ref-plane-yz",
      .label = "YZ Plane",
      .orientation = "yz",
      .center_x = 0.0,
      .center_y = reference_extent / 2.0,
      .center_z = reference_extent / 2.0,
      .width = reference_extent,
      .height = reference_extent,
      .is_selected = document->selected_reference_id.has_value() &&
                     document->selected_reference_id.value() == "ref-plane-yz",
      .is_active_sketch_plane = document->active_sketch_plane_id.has_value() &&
                                document->active_sketch_plane_id.value() ==
                                    "ref-plane-yz",
  });
  reference_planes.push_back(ViewportReferencePlane{
      .id = "ref-plane-xz",
      .label = "XZ Plane",
      .orientation = "xz",
      .center_x = reference_extent / 2.0,
      .center_y = reference_extent / 2.0,
      .center_z = 0.0,
      .width = reference_extent,
      .height = reference_extent,
      .is_selected = document->selected_reference_id.has_value() &&
                     document->selected_reference_id.value() == "ref-plane-xz",
      .is_active_sketch_plane = document->active_sketch_plane_id.has_value() &&
                                document->active_sketch_plane_id.value() ==
                                    "ref-plane-xz",
  });

  reference_axes.push_back(ViewportReferenceAxis{
      .id = "ref-axis-x",
      .label = "X",
      .axis = "x",
      .start_x = 0.0,
      .start_y = 0.0,
      .start_z = 0.0,
      .end_x = reference_extent,
      .end_y = 0.0,
      .end_z = 0.0,
  });
  reference_axes.push_back(ViewportReferenceAxis{
      .id = "ref-axis-y",
      .label = "Y",
      .axis = "y",
      .start_x = 0.0,
      .start_y = 0.0,
      .start_z = 0.0,
      .end_x = 0.0,
      .end_y = reference_extent,
      .end_z = 0.0,
  });
  reference_axes.push_back(ViewportReferenceAxis{
      .id = "ref-axis-z",
      .label = "Z",
      .axis = "z",
      .start_x = 0.0,
      .start_y = 0.0,
      .start_z = 0.0,
      .end_x = 0.0,
      .end_y = 0.0,
      .end_z = reference_extent,
  });

  // Drop legacy named-suffix analytical faces for extrude features
  // (e.g. "<id>:face:top", "<id>:face:base", "<id>:face:side-N"). The
  // per-feature loop above still emits those for backwards
  // compatibility with the old tests / serialization paths, but every
  // extrude body now also gets accurate body-derived faces from
  // `enumerate_body_faces` (with numeric suffixes "<id>:face:0",
  // "<id>:face:1", ...). When both are present they overlap as
  // transparent meshes at nearly-identical world positions, producing
  // a "ghost plane" the user can't easily click through. Body-derived
  // faces always win because they handle filleting, plane-frame
  // rotations, and booleaned topology correctly — analytical ones
  // only ever matched on the simple new-body case.
  {
    auto is_named_suffix_for_extrude =
        [&](const ViewportSolidFace& face) -> bool {
      if (face.owner_kind != "extrude") {
        return false;
      }
      // Find the suffix after the last ":face:" delimiter and check
      // whether it parses as a non-negative integer. Numeric -> body-
      // derived (keep). Non-numeric -> legacy analytical (drop).
      const std::string separator = ":face:";
      const auto pos = face.face_id.rfind(separator);
      if (pos == std::string::npos) {
        return false;
      }
      const std::string suffix =
          face.face_id.substr(pos + separator.size());
      if (suffix.empty()) {
        return false;
      }
      for (const char ch : suffix) {
        if (ch < '0' || ch > '9') {
          return true;
        }
      }
      return false;
    };
    solid_faces.erase(std::remove_if(solid_faces.begin(),
                                     solid_faces.end(),
                                     is_named_suffix_for_extrude),
                      solid_faces.end());
  }

  const ViewportSceneBounds scene_bounds = {
      .center_x = scene_width_with_references / 2.0,
      .center_y = scene_height_with_references / 2.0,
      .center_z = scene_depth_with_references / 2.0,
      .width = scene_width_with_references,
      .height = scene_height_with_references,
      .depth = scene_depth_with_references,
      .max_dimension = std::max({scene_width_with_references,
                                 scene_height_with_references,
                                 scene_depth_with_references}),
  };

  return ViewportState{
      .has_active_document = true,
      .boxes = boxes,
      .cylinders = cylinders,
      .polygon_extrudes = polygon_extrudes,
      .solid_faces = solid_faces,
      .reference_planes = reference_planes,
      .reference_axes = reference_axes,
      .sketch_lines = sketch_lines,
      .sketch_circles = sketch_circles,
      .sketch_points = sketch_points,
      .sketch_dimensions = sketch_dimensions,
      .sketch_constraints = sketch_constraints,
      .sketch_profiles = sketch_profiles,
      .meshes = meshes,
      .cut_previews = cut_previews,
      .bodies = bodies,
      .edges = edges,
      .vertices = vertices,
      .scene_width = scene_width_with_references,
      .scene_height = scene_height_with_references,
      .scene_depth = scene_depth_with_references,
      .scene_bounds = scene_bounds,
  };
}

}  // namespace polysmith::core
