#include "core/feature_shape.h"

#include <algorithm>
#include <cmath>
#include <optional>
#include <stdexcept>

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>
#include <Geom_Plane.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Wire.hxx>

namespace polysmith::core {
namespace {

constexpr double kPi = 3.14159265358979323846;

gp_Pnt to_world_point(const std::string& plane_id, double local_x, double local_y) {
  if (plane_id == "ref-plane-xy") {
    return gp_Pnt(local_x, 0.0, local_y);
  }

  if (plane_id == "ref-plane-yz") {
    return gp_Pnt(0.0, local_x, local_y);
  }

  if (plane_id == "ref-plane-xz") {
    return gp_Pnt(local_x, local_y, 0.0);
  }

  throw std::runtime_error("Unsupported sketch plane for shape: " + plane_id);
}

gp_Pnt to_world_point(const PlaneFrame& frame, double local_x, double local_y) {
  return gp_Pnt(frame.origin_x + frame.x_axis_x * local_x +
                    frame.y_axis_x * local_y,
                frame.origin_y + frame.x_axis_y * local_x +
                    frame.y_axis_y * local_y,
                frame.origin_z + frame.x_axis_z * local_x +
                    frame.y_axis_z * local_y);
}

gp_Pnt to_world_point(const ExtrudeFeatureParameters& parameters,
                      double local_x,
                      double local_y) {
  if (parameters.plane_frame.has_value()) {
    return to_world_point(parameters.plane_frame.value(), local_x, local_y);
  }
  return to_world_point(parameters.plane_id, local_x, local_y);
}

gp_Pnt to_world_point(const LoftSectionParameters& section,
                      double local_x,
                      double local_y) {
  if (section.plane_frame.has_value()) {
    return to_world_point(section.plane_frame.value(), local_x, local_y);
  }
  return to_world_point(section.plane_id, local_x, local_y);
}

gp_Pnt to_world_point(const RevolveFeatureParameters& parameters,
                      double local_x,
                      double local_y) {
  if (parameters.plane_frame.has_value()) {
    return to_world_point(parameters.plane_frame.value(), local_x, local_y);
  }
  return to_world_point(parameters.plane_id, local_x, local_y);
}

gp_Dir plane_normal(const ExtrudeFeatureParameters& parameters) {
  if (parameters.plane_frame.has_value()) {
    const auto& frame = parameters.plane_frame.value();
    return gp_Dir(frame.normal_x, frame.normal_y, frame.normal_z);
  }
  if (parameters.plane_id == "ref-plane-xy") {
    return gp_Dir(0.0, 1.0, 0.0);
  }
  if (parameters.plane_id == "ref-plane-yz") {
    return gp_Dir(1.0, 0.0, 0.0);
  }
  if (parameters.plane_id == "ref-plane-xz") {
    return gp_Dir(0.0, 0.0, 1.0);
  }
  throw std::runtime_error("Unsupported sketch plane for shape: " +
                           parameters.plane_id);
}

gp_Dir profile_wire_normal(const LoftSectionParameters& section) {
  if (section.plane_frame.has_value()) {
    const auto& frame = section.plane_frame.value();
    const double x = frame.x_axis_y * frame.y_axis_z -
                     frame.x_axis_z * frame.y_axis_y;
    const double y = frame.x_axis_z * frame.y_axis_x -
                     frame.x_axis_x * frame.y_axis_z;
    const double z = frame.x_axis_x * frame.y_axis_y -
                     frame.x_axis_y * frame.y_axis_x;
    return gp_Dir(x, y, z);
  }
  if (section.plane_id == "ref-plane-xy") {
    return gp_Dir(0.0, -1.0, 0.0);
  }
  if (section.plane_id == "ref-plane-yz") {
    return gp_Dir(1.0, 0.0, 0.0);
  }
  if (section.plane_id == "ref-plane-xz") {
    return gp_Dir(0.0, 0.0, 1.0);
  }
  throw std::runtime_error("Unsupported sketch plane for loft: " +
                           section.plane_id);
}

gp_Dir profile_wire_normal(const ExtrudeFeatureParameters& parameters) {
  if (parameters.plane_frame.has_value()) {
    const auto& frame = parameters.plane_frame.value();
    const double x = frame.x_axis_y * frame.y_axis_z -
                     frame.x_axis_z * frame.y_axis_y;
    const double y = frame.x_axis_z * frame.y_axis_x -
                     frame.x_axis_x * frame.y_axis_z;
    const double z = frame.x_axis_x * frame.y_axis_y -
                     frame.x_axis_y * frame.y_axis_x;
    return gp_Dir(x, y, z);
  }
  if (parameters.plane_id == "ref-plane-xy") {
    // Sketch-local coordinates on XY are mapped as (x, z) in world space.
    // The local wire normal is therefore X x Z = -Y, while extrusion still
    // uses +Y. Exact circle wires must follow the local wire orientation so
    // hole reversal matches polygon loops built from the same sketch points.
    return gp_Dir(0.0, -1.0, 0.0);
  }
  if (parameters.plane_id == "ref-plane-yz") {
    return gp_Dir(1.0, 0.0, 0.0);
  }
  if (parameters.plane_id == "ref-plane-xz") {
    return gp_Dir(0.0, 0.0, 1.0);
  }
  throw std::runtime_error("Unsupported sketch plane for shape: " +
                           parameters.plane_id);
}

gp_Dir profile_wire_normal(const RevolveFeatureParameters& parameters) {
  if (parameters.plane_frame.has_value()) {
    const auto& frame = parameters.plane_frame.value();
    const double x = frame.x_axis_y * frame.y_axis_z -
                     frame.x_axis_z * frame.y_axis_y;
    const double y = frame.x_axis_z * frame.y_axis_x -
                     frame.x_axis_x * frame.y_axis_z;
    const double z = frame.x_axis_x * frame.y_axis_y -
                     frame.x_axis_y * frame.y_axis_x;
    return gp_Dir(x, y, z);
  }
  if (parameters.plane_id == "ref-plane-xy") {
    return gp_Dir(0.0, -1.0, 0.0);
  }
  if (parameters.plane_id == "ref-plane-yz") {
    return gp_Dir(1.0, 0.0, 0.0);
  }
  if (parameters.plane_id == "ref-plane-xz") {
    return gp_Dir(0.0, 0.0, 1.0);
  }
  throw std::runtime_error("Unsupported sketch plane for revolve: " +
                           parameters.plane_id);
}

gp_Vec extrusion_vector(const std::string& plane_id, double depth) {
  if (plane_id == "ref-plane-xy") {
    return gp_Vec(0.0, depth, 0.0);
  }

  if (plane_id == "ref-plane-yz") {
    return gp_Vec(depth, 0.0, 0.0);
  }

  if (plane_id == "ref-plane-xz") {
    return gp_Vec(0.0, 0.0, depth);
  }

  throw std::runtime_error("Unsupported sketch plane for shape: " + plane_id);
}

gp_Vec extrusion_vector(const PlaneFrame& frame, double depth) {
  return gp_Vec(frame.normal_x * depth,
                frame.normal_y * depth,
                frame.normal_z * depth);
}

gp_Vec extrusion_vector(const ExtrudeFeatureParameters& parameters,
                        double depth) {
  return parameters.plane_frame.has_value()
             ? extrusion_vector(parameters.plane_frame.value(), depth)
             : extrusion_vector(parameters.plane_id, depth);
}

gp_Vec extrusion_normal_vector(const ExtrudeFeatureParameters& parameters) {
  return extrusion_vector(parameters, 1.0);
}

TopoDS_Shape translate_shape(const TopoDS_Shape& shape, const gp_Vec& offset) {
  if (shape.IsNull() || offset.SquareMagnitude() <= 1.0e-18) {
    return shape;
  }
  gp_Trsf transform;
  transform.SetTranslation(offset);
  return BRepBuilderAPI_Transform(shape, transform, true).Shape();
}

TopoDS_Shape fuse_shapes(const TopoDS_Shape& first, const TopoDS_Shape& second) {
  if (first.IsNull()) {
    return second;
  }
  if (second.IsNull()) {
    return first;
  }
  const TopoDS_Shape fused = BRepAlgoAPI_Fuse(first, second).Shape();
  return fused.IsNull() ? first : fused;
}

TopoDS_Shape apply_draft_angle(const TopoDS_Shape& shape,
                               const ExtrudeFeatureParameters& parameters,
                               double side_sign,
                               double angle_degrees,
                               double start_offset) {
  if (shape.IsNull() || std::abs(angle_degrees) <= 1.0e-9) {
    return shape;
  }

  const gp_Vec normal_vec = extrusion_normal_vector(parameters);
  gp_Dir direction(normal_vec.X() * side_sign,
                   normal_vec.Y() * side_sign,
                   normal_vec.Z() * side_sign);
  gp_Pnt plane_origin =
      parameters.plane_frame.has_value()
          ? gp_Pnt(parameters.plane_frame->origin_x,
                   parameters.plane_frame->origin_y,
                   parameters.plane_frame->origin_z)
          : to_world_point(parameters.plane_id, 0.0, 0.0);
  plane_origin.Translate(gp_Vec(direction) * start_offset);
  const gp_Pln neutral_plane(plane_origin, direction);

  try {
    BRepOffsetAPI_DraftAngle draft(shape);
    bool any_face = false;
    for (TopExp_Explorer explorer(shape, TopAbs_FACE); explorer.More();
         explorer.Next()) {
      const TopoDS_Face face = TopoDS::Face(explorer.Current());
      const Handle(Geom_Plane) surface =
          Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(face));
      if (surface.IsNull()) {
        continue;
      }
      const gp_Dir face_normal = surface->Pln().Axis().Direction();
      if (!face_normal.IsNormal(direction, 1.0e-5)) {
        continue;
      }
      draft.Add(face, direction, angle_degrees * kPi / 180.0, neutral_plane);
      if (draft.AddDone()) {
        any_face = true;
      } else {
        draft.Remove(face);
      }
    }
    if (!any_face) {
      return shape;
    }
    const TopoDS_Shape drafted = draft.Shape();
    if (drafted.IsNull()) {
      throw std::runtime_error(
          "Extrude taper failed. Reduce the taper angle, increase the distance, "
          "or use a wider profile.");
    }
    return drafted;
  } catch (const Standard_Failure&) {
    throw std::runtime_error(
        "Extrude taper failed. Reduce the taper angle, increase the distance, "
        "or use a wider profile.");
  }
}

struct CircleLoop {
  double center_x;
  double center_y;
  double radius;
};

std::optional<CircleLoop> detect_circle_loop(
    const std::vector<SketchProfilePoint>& points) {
  if (points.size() < 16) {
    return std::nullopt;
  }

  double center_x = 0.0;
  double center_y = 0.0;
  for (const auto& point : points) {
    center_x += point.x;
    center_y += point.y;
  }
  center_x /= static_cast<double>(points.size());
  center_y /= static_cast<double>(points.size());

  double radius = 0.0;
  for (const auto& point : points) {
    const double dx = point.x - center_x;
    const double dy = point.y - center_y;
    radius += std::sqrt(dx * dx + dy * dy);
  }
  radius /= static_cast<double>(points.size());
  if (radius <= 0.0) {
    return std::nullopt;
  }

  const double tolerance = std::max(0.05, radius * 0.01);
  for (const auto& point : points) {
    const double dx = point.x - center_x;
    const double dy = point.y - center_y;
    const double distance = std::sqrt(dx * dx + dy * dy);
    if (std::abs(distance - radius) > tolerance) {
      return std::nullopt;
    }
  }

  return CircleLoop{.center_x = center_x, .center_y = center_y, .radius = radius};
}

std::optional<TopoDS_Wire> make_circle_wire(
    const ExtrudeFeatureParameters& parameters,
    const CircleLoop& circle) {
  const gp_Pnt center =
      to_world_point(parameters, circle.center_x, circle.center_y);
  const gp_Circ curve(gp_Ax2(center, profile_wire_normal(parameters)),
                      circle.radius);
  BRepBuilderAPI_MakeEdge edge_builder(curve);
  if (!edge_builder.IsDone()) {
    return std::nullopt;
  }
  BRepBuilderAPI_MakeWire wire_builder(edge_builder.Edge());
  if (!wire_builder.IsDone()) {
    return std::nullopt;
  }
  return wire_builder.Wire();
}

TopoDS_Wire make_profile_wire(
    const ExtrudeFeatureParameters& parameters,
    const std::vector<SketchProfilePoint>& points) {
  if (const auto circle = detect_circle_loop(points)) {
    if (const auto wire = make_circle_wire(parameters, circle.value())) {
      return wire.value();
    }
  }

  BRepBuilderAPI_MakePolygon polygon_builder;
  for (const auto& point : points) {
    polygon_builder.Add(to_world_point(parameters, point.x, point.y));
  }
  polygon_builder.Close();

  if (!polygon_builder.IsDone()) {
    throw std::runtime_error("Failed to build polygon wire");
  }
  return polygon_builder.Wire();
}

TopoDS_Wire make_profile_wire(
    const LoftSectionParameters& section,
    const std::vector<SketchProfilePoint>& points) {
  if (const auto circle = detect_circle_loop(points)) {
    const gp_Pnt center =
        to_world_point(section, circle->center_x, circle->center_y);
    const gp_Circ curve(gp_Ax2(center, profile_wire_normal(section)),
                        circle->radius);
    BRepBuilderAPI_MakeEdge edge_builder(curve);
    if (edge_builder.IsDone()) {
      BRepBuilderAPI_MakeWire wire_builder(edge_builder.Edge());
      if (wire_builder.IsDone()) {
        return wire_builder.Wire();
      }
    }
  }

  BRepBuilderAPI_MakePolygon polygon_builder;
  for (const auto& point : points) {
    polygon_builder.Add(to_world_point(section, point.x, point.y));
  }
  polygon_builder.Close();

  if (!polygon_builder.IsDone()) {
    throw std::runtime_error("Failed to build loft profile wire");
  }
  return polygon_builder.Wire();
}

TopoDS_Wire make_profile_wire(
    const RevolveFeatureParameters& parameters,
    const std::vector<SketchProfilePoint>& points) {
  if (const auto circle = detect_circle_loop(points)) {
    const gp_Pnt center =
        to_world_point(parameters, circle->center_x, circle->center_y);
    const gp_Circ curve(gp_Ax2(center, profile_wire_normal(parameters)),
                        circle->radius);
    BRepBuilderAPI_MakeEdge edge_builder(curve);
    if (edge_builder.IsDone()) {
      BRepBuilderAPI_MakeWire wire_builder(edge_builder.Edge());
      if (wire_builder.IsDone()) {
        return wire_builder.Wire();
      }
    }
  }

  BRepBuilderAPI_MakePolygon polygon_builder;
  for (const auto& point : points) {
    polygon_builder.Add(to_world_point(parameters, point.x, point.y));
  }
  polygon_builder.Close();

  if (!polygon_builder.IsDone()) {
    throw std::runtime_error("Failed to build revolve profile wire");
  }
  return polygon_builder.Wire();
}

TopoDS_Shape make_profile_face(
    const RevolveFeatureParameters& parameters,
    const std::vector<SketchProfilePoint>& outer_points,
    const std::vector<std::vector<SketchProfilePoint>>& inner_loops) {
  BRepBuilderAPI_MakeFace face_builder(
      make_profile_wire(parameters, outer_points));
  for (const auto& loop : inner_loops) {
    if (loop.size() < 3) {
      continue;
    }
    TopoDS_Wire hole_wire = make_profile_wire(parameters, loop);
    hole_wire.Reverse();
    face_builder.Add(hole_wire);
  }

  const TopoDS_Shape face = face_builder.Shape();
  if (face.IsNull()) {
    throw std::runtime_error("Failed to build revolve profile face");
  }
  return face;
}

TopoDS_Shape make_polygon_prism_shape(
    const ExtrudeFeatureParameters& parameters,
    const std::vector<SketchProfilePoint>& outer_points,
    const std::vector<std::vector<SketchProfilePoint>>& inner_loops) {
  BRepBuilderAPI_MakeFace face_builder(
      make_profile_wire(parameters, outer_points));
  for (const auto& loop : inner_loops) {
    if (loop.size() < 3) {
      continue;
    }
    TopoDS_Wire hole_wire = make_profile_wire(parameters, loop);
    hole_wire.Reverse();
    face_builder.Add(hole_wire);
  }

  const TopoDS_Shape face = face_builder.Shape();
  if (face.IsNull()) {
    throw std::runtime_error("Failed to build polygon face");
  }

  const gp_Vec direction =
      parameters.plane_frame.has_value()
          ? extrusion_vector(parameters.plane_frame.value(), parameters.depth)
          : extrusion_vector(parameters.plane_id, parameters.depth);

  const TopoDS_Shape shape = BRepPrimAPI_MakePrism(face, direction).Shape();
  if (shape.IsNull()) {
    throw std::runtime_error("Failed to build polygon extrude");
  }

  return shape;
}

std::pair<double, double> profile_centroid(
    const std::vector<SketchProfilePoint>& points) {
  double x = 0.0;
  double y = 0.0;
  for (const auto& point : points) {
    x += point.x;
    y += point.y;
  }
  const double count = std::max<size_t>(points.size(), 1);
  return {x / count, y / count};
}

std::vector<SketchProfilePoint> radial_offset_loop(
    const std::vector<SketchProfilePoint>& points,
    double offset) {
  if (points.empty() || std::abs(offset) <= 1.0e-9) {
    return points;
  }
  const auto [center_x, center_y] = profile_centroid(points);
  std::vector<SketchProfilePoint> result;
  result.reserve(points.size());
  for (const auto& point : points) {
    const double dx = point.x - center_x;
    const double dy = point.y - center_y;
    const double length = std::sqrt(dx * dx + dy * dy);
    if (length <= 1.0e-9) {
      result.push_back(point);
      continue;
    }
    const double scale = (length + offset) / length;
    result.push_back({center_x + dx * scale, center_y + dy * scale});
  }
  return result;
}

void apply_closed_thin_profile(
    const ExtrudeFeatureParameters& parameters,
    const std::vector<SketchProfilePoint>& source_points,
    std::vector<SketchProfilePoint>& outer_points,
    std::vector<std::vector<SketchProfilePoint>>& inner_loops) {
  if (!parameters.thin.enabled) {
    outer_points = source_points;
    return;
  }

  const double thickness = parameters.thin.thickness;
  double outer_offset = 0.0;
  double inner_offset = -thickness;
  if (parameters.thin.placement == "center") {
    outer_offset = thickness * 0.5;
    inner_offset = -thickness * 0.5;
  } else if (parameters.thin.placement == "outside") {
    outer_offset = thickness;
    inner_offset = 0.0;
  }

  outer_points = radial_offset_loop(source_points, outer_offset);
  std::vector<SketchProfilePoint> inner = radial_offset_loop(source_points, inner_offset);
  if (inner.size() >= 3) {
    std::reverse(inner.begin(), inner.end());
    inner_loops.push_back(std::move(inner));
  }
}

std::vector<SketchProfilePoint> make_open_thin_wall(
    const ExtrudeFeatureParameters& parameters) {
  const auto& chain = parameters.profile_points;
  if (chain.size() < 2) {
    throw std::runtime_error("Open thin extrude requires at least two points");
  }
  const double thickness = parameters.thin.thickness;
  const double left_offset =
      parameters.thin.placement == "center" ? thickness * 0.5
      : parameters.thin.placement == "outside" ? thickness
                                                : 0.0;
  const double right_offset =
      parameters.thin.placement == "center" ? -thickness * 0.5
      : parameters.thin.placement == "outside" ? 0.0
                                                : -thickness;

  auto offset_point = [&](size_t index, double offset) {
    double tx = 0.0;
    double ty = 0.0;
    if (index > 0) {
      tx += chain[index].x - chain[index - 1].x;
      ty += chain[index].y - chain[index - 1].y;
    }
    if (index + 1 < chain.size()) {
      tx += chain[index + 1].x - chain[index].x;
      ty += chain[index + 1].y - chain[index].y;
    }
    const double length = std::sqrt(tx * tx + ty * ty);
    if (length <= 1.0e-9) {
      return chain[index];
    }
    const double nx = -ty / length;
    const double ny = tx / length;
    return SketchProfilePoint{chain[index].x + nx * offset,
                              chain[index].y + ny * offset};
  };

  std::vector<SketchProfilePoint> wall;
  wall.reserve(chain.size() * 2);
  for (size_t index = 0; index < chain.size(); ++index) {
    wall.push_back(offset_point(index, left_offset));
  }
  for (size_t index = chain.size(); index-- > 0;) {
    wall.push_back(offset_point(index, right_offset));
  }
  return wall;
}

TopoDS_Shape make_polygon_prism_shape(const ExtrudeFeatureParameters& parameters) {
  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);

  if (parameters.profile_kind == "open_chain") {
    const std::vector<SketchProfilePoint> wall = make_open_thin_wall(parameters);
    builder.Add(compound, make_polygon_prism_shape(parameters, wall, {}));
    return compound;
  }

  std::vector<SketchProfilePoint> primary_points;
  std::vector<std::vector<SketchProfilePoint>> primary_inner_loops =
      parameters.inner_loops;
  apply_closed_thin_profile(parameters,
                            parameters.profile_points,
                            primary_points,
                            primary_inner_loops);
  builder.Add(compound,
              make_polygon_prism_shape(parameters, primary_points, primary_inner_loops));
  for (size_t index = 0; index < parameters.additional_profile_points.size();
       ++index) {
    std::vector<SketchProfilePoint> profile_points;
    std::vector<std::vector<SketchProfilePoint>> inner_loops =
        index < parameters.additional_inner_loops.size()
            ? parameters.additional_inner_loops[index]
            : std::vector<std::vector<SketchProfilePoint>>{};
    apply_closed_thin_profile(parameters,
                              parameters.additional_profile_points[index],
                              profile_points,
                              inner_loops);
    builder.Add(compound,
                make_polygon_prism_shape(parameters, profile_points, inner_loops));
  }

  return compound;
}

std::vector<SketchProfilePoint> sample_circle_points(double center_x,
                                                     double center_y,
                                                     double radius) {
  constexpr int kCircleSegments = 96;
  std::vector<SketchProfilePoint> points;
  points.reserve(kCircleSegments);
  for (int index = 0; index < kCircleSegments; ++index) {
    const double angle =
        (static_cast<double>(index) / static_cast<double>(kCircleSegments)) *
        2.0 * kPi;
    points.push_back(SketchProfilePoint{
        .x = center_x + radius * std::cos(angle),
        .y = center_y + radius * std::sin(angle),
    });
  }
  return points;
}

TopoDS_Shape make_circle_extrude_shape(
    const ExtrudeFeatureParameters& parameters) {
  const double signed_depth = parameters.depth;
  const double abs_depth = std::abs(signed_depth);

  if (parameters.plane_frame.has_value()) {
    const auto& frame = parameters.plane_frame.value();
    const gp_Pnt center =
        to_world_point(frame, parameters.start_x, parameters.start_y);
    const double sign = signed_depth >= 0.0 ? 1.0 : -1.0;
    const gp_Dir axis_direction(frame.normal_x * sign,
                                frame.normal_y * sign,
                                frame.normal_z * sign);
    const gp_Ax2 axis(center, axis_direction);
    const TopoDS_Shape shape =
        BRepPrimAPI_MakeCylinder(axis, parameters.radius, abs_depth).Shape();
    if (shape.IsNull()) {
      throw std::runtime_error("Failed to build circle extrude on plane frame");
    }
    return shape;
  }

  const gp_Pnt center = to_world_point(parameters.plane_id,
                                       parameters.start_x,
                                       parameters.start_y);
  const double sign = signed_depth >= 0.0 ? 1.0 : -1.0;
  const gp_Dir axis_direction =
      parameters.plane_id == "ref-plane-xy"
          ? gp_Dir(0.0, sign, 0.0)
          : parameters.plane_id == "ref-plane-yz"
                ? gp_Dir(sign, 0.0, 0.0)
                : gp_Dir(0.0, 0.0, sign);
  const gp_Ax2 axis(center, axis_direction);
  const TopoDS_Shape shape =
      BRepPrimAPI_MakeCylinder(axis, parameters.radius, abs_depth).Shape();
  if (shape.IsNull()) {
    throw std::runtime_error("Failed to build circle extrude");
  }
  return shape;
}

ExtrudeFeatureParameters make_polygon_source(
    const ExtrudeFeatureParameters& parameters) {
  ExtrudeFeatureParameters source = parameters;
  if (source.profile_kind == "rectangle") {
    source.profile_kind = "polygon";
    source.profile_points = {
        {parameters.start_x, parameters.start_y},
        {parameters.start_x + parameters.width, parameters.start_y},
        {parameters.start_x + parameters.width,
         parameters.start_y + parameters.height},
        {parameters.start_x, parameters.start_y + parameters.height},
    };
  } else if (source.profile_kind == "circle" && source.thin.enabled) {
    source.profile_kind = "polygon";
    source.profile_points =
        sample_circle_points(parameters.start_x, parameters.start_y, parameters.radius);
  }
  return source;
}

TopoDS_Shape build_single_depth_extrude(
    const ExtrudeFeatureParameters& parameters) {
  if (parameters.profile_kind == "rectangle") {
    return make_polygon_prism_shape(make_polygon_source(parameters));
  }
  if (parameters.profile_kind == "circle") {
    if (parameters.thin.enabled) {
      return make_polygon_prism_shape(make_polygon_source(parameters));
    }
    return make_circle_extrude_shape(parameters);
  }
  if (parameters.profile_kind == "polygon" ||
      parameters.profile_kind == "open_chain") {
    return make_polygon_prism_shape(parameters);
  }
  throw std::runtime_error("Unsupported extrude profile kind: " +
                           parameters.profile_kind);
}

double resolved_side_distance(
    const ExtrudeFeatureParameters& parameters,
    const ExtrudeFeatureParameters::SideParameters& side,
    bool symmetric) {
  double distance = side.distance;
  if (distance <= 0.0) {
    distance = std::abs(parameters.depth);
  }
  if (symmetric) {
    distance *= 0.5;
  }
  return distance;
}

TopoDS_Shape build_extrude_side(
    const ExtrudeFeatureParameters& parameters,
    const ExtrudeFeatureParameters::SideParameters& side,
    double side_sign,
    bool symmetric) {
  ExtrudeFeatureParameters side_parameters = make_polygon_source(parameters);
  side_parameters.depth =
      side_sign * resolved_side_distance(parameters, side, symmetric);
  side_parameters.extent_mode = "one_side";
  side_parameters.side1 = side;
  side_parameters.side2 = std::nullopt;

  TopoDS_Shape shape = build_single_depth_extrude(side_parameters);
  shape = translate_shape(shape, extrusion_vector(parameters,
                                                  side_sign * side.start_offset));
  shape = apply_draft_angle(shape,
                            parameters,
                            side_sign,
                            side.taper_angle_degrees,
                            side.start_offset);
  return shape;
}

}  // namespace

TopoDS_Shape build_box_shape(const BoxFeatureParameters& parameters) {
  const TopoDS_Shape shape =
      BRepPrimAPI_MakeBox(parameters.width, parameters.height, parameters.depth)
          .Shape();
  if (shape.IsNull()) {
    throw std::runtime_error("Failed to build box shape");
  }
  return shape;
}

TopoDS_Shape build_cylinder_shape(const CylinderFeatureParameters& parameters) {
  const gp_Ax2 axis(gp_Pnt(parameters.radius, 0.0, parameters.radius),
                    gp_Dir(0.0, 1.0, 0.0));
  const TopoDS_Shape shape =
      BRepPrimAPI_MakeCylinder(axis, parameters.radius, parameters.height).Shape();
  if (shape.IsNull()) {
    throw std::runtime_error("Failed to build cylinder shape");
  }
  return shape;
}

TopoDS_Shape build_extrude_shape(const ExtrudeFeatureParameters& parameters) {
  try {
    const bool symmetric = parameters.extent_mode == "symmetric";
    const double side1_sign = parameters.depth < 0.0 ? -1.0 : 1.0;
    TopoDS_Shape shape =
        build_extrude_side(parameters, parameters.side1, side1_sign, symmetric);

    if (parameters.extent_mode == "symmetric") {
      shape = fuse_shapes(
          shape,
          build_extrude_side(parameters,
                             parameters.side2.value_or(parameters.side1),
                             -side1_sign,
                             true));
    } else if (parameters.extent_mode == "two_sides") {
      shape = fuse_shapes(
          shape,
          build_extrude_side(parameters,
                             parameters.side2.value_or(parameters.side1),
                             -side1_sign,
                             false));
    }

    if (shape.IsNull()) {
      throw std::runtime_error("Failed to build extrude shape");
    }
    return shape;
  } catch (const Standard_Failure&) {
    throw std::runtime_error(
        "Extrude preview failed. Adjust the extent, taper, or source profile.");
  }
}

TopoDS_Shape build_loft_shape(const LoftFeatureParameters& parameters) {
  if (parameters.sections.size() < 2) {
    throw std::runtime_error("Loft requires at least two profile sections");
  }

  BRepOffsetAPI_ThruSections loft_builder(
      /*isSolid=*/true,
      /*ruled=*/parameters.ruled,
      /*pres3d=*/1.0e-6);
  loft_builder.CheckCompatibility(true);

  for (const auto& section : parameters.sections) {
    if (section.profile_points.size() < 3) {
      throw std::runtime_error("Loft profile section requires at least three points");
    }
    loft_builder.AddWire(make_profile_wire(section, section.profile_points));
  }

  loft_builder.Build();
  if (!loft_builder.IsDone()) {
    throw std::runtime_error("Failed to build loft");
  }

  const TopoDS_Shape shape = loft_builder.Shape();
  if (shape.IsNull()) {
    throw std::runtime_error("Failed to build loft shape");
  }
  return shape;
}

TopoDS_Shape build_revolve_shape(const RevolveFeatureParameters& parameters) {
  if (parameters.profile_points.size() < 3) {
    throw std::runtime_error("Revolve requires a closed profile");
  }
  const double dx = parameters.axis_end_x - parameters.axis_start_x;
  const double dy = parameters.axis_end_y - parameters.axis_start_y;
  const double dz = parameters.axis_end_z - parameters.axis_start_z;
  if (std::sqrt(dx * dx + dy * dy + dz * dz) <= 1.0e-9) {
    throw std::runtime_error("Revolve axis must have non-zero length");
  }

  const TopoDS_Shape face = make_profile_face(
      parameters, parameters.profile_points, parameters.inner_loops);
  const gp_Ax1 axis(gp_Pnt(parameters.axis_start_x,
                           parameters.axis_start_y,
                           parameters.axis_start_z),
                    gp_Dir(dx, dy, dz));
  const double angle_radians = parameters.angle_degrees * kPi / 180.0;
  const TopoDS_Shape shape =
      BRepPrimAPI_MakeRevol(face, axis, angle_radians).Shape();
  if (shape.IsNull()) {
    throw std::runtime_error("Failed to build revolve shape");
  }
  return shape;
}

TopoDS_Shape build_feature_shape(const FeatureEntry& feature) {
  if (feature.kind == "box" && feature.box_parameters.has_value()) {
    return build_box_shape(feature.box_parameters.value());
  }
  if (feature.kind == "cylinder" && feature.cylinder_parameters.has_value()) {
    return build_cylinder_shape(feature.cylinder_parameters.value());
  }
  if (feature.kind == "extrude" && feature.extrude_parameters.has_value()) {
    return build_extrude_shape(feature.extrude_parameters.value());
  }
  if (feature.kind == "loft" && feature.loft_parameters.has_value()) {
    return build_loft_shape(feature.loft_parameters.value());
  }
  if (feature.kind == "revolve" && feature.revolve_parameters.has_value()) {
    return build_revolve_shape(feature.revolve_parameters.value());
  }
  return TopoDS_Shape{};
}

}  // namespace polysmith::core
