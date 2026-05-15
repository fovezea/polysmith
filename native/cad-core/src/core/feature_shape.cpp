#include "core/feature_shape.h"

#include <cmath>
#include <optional>
#include <stdexcept>

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRep_Builder.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Wire.hxx>

namespace polysmith::core {
namespace {

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
  const gp_Pnt center = to_world_point(parameters, circle.center_x, circle.center_y);
  const gp_Circ curve(gp_Ax2(center, plane_normal(parameters)), circle.radius);
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

TopoDS_Shape make_polygon_prism_shape(const ExtrudeFeatureParameters& parameters) {
  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);

  builder.Add(compound,
              make_polygon_prism_shape(parameters,
                                       parameters.profile_points,
                                       parameters.inner_loops));
  for (size_t index = 0; index < parameters.additional_profile_points.size();
       ++index) {
    const std::vector<std::vector<SketchProfilePoint>> empty_inner_loops;
    const auto& inner_loops = index < parameters.additional_inner_loops.size()
                                  ? parameters.additional_inner_loops[index]
                                  : empty_inner_loops;
    builder.Add(compound,
                make_polygon_prism_shape(parameters,
                                         parameters.additional_profile_points[index],
                                         inner_loops));
  }

  return compound;
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
  if (parameters.profile_kind == "rectangle") {
    // Always route rectangles through the polygon-prism path so signed
    // depth is honored uniformly. The legacy axis-aligned MakeBox path
    // can't take a negative depth (BRepPrimAPI_MakeBox rejects
    // non-positive dimensions), and the polygon-prism builder accepts
    // signed gp_Vec components for the extrusion direction.
    ExtrudeFeatureParameters rectangle_as_polygon = parameters;
    rectangle_as_polygon.profile_kind = "polygon";
    rectangle_as_polygon.profile_points = {
        {parameters.start_x, parameters.start_y},
        {parameters.start_x + parameters.width, parameters.start_y},
        {parameters.start_x + parameters.width,
         parameters.start_y + parameters.height},
        {parameters.start_x, parameters.start_y + parameters.height},
    };
    return make_polygon_prism_shape(rectangle_as_polygon);
  }

  if (parameters.profile_kind == "circle") {
    // BRepPrimAPI_MakeCylinder requires a positive height, so for
    // negative depths we flip the axis direction and pass abs(depth).
    // The resulting solid sits on the same circular base but extends
    // in the -normal direction, matching what the user asked for.
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

  if (parameters.profile_kind == "polygon") {
    return make_polygon_prism_shape(parameters);
  }

  throw std::runtime_error("Unsupported extrude profile kind: " +
                           parameters.profile_kind);
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
  return TopoDS_Shape{};
}

}  // namespace polysmith::core
