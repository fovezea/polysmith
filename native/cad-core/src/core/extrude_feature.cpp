#include "core/extrude_feature.h"

#include <cmath>
#include <sstream>
#include <stdexcept>

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <TopoDS_Shape.hxx>

namespace polysmith::core {
namespace {

void validate_parameters(const ExtrudeFeatureParameters& parameters) {
  // Depth may be positive (extrude in +normal direction) or negative
  // (extrude in -normal direction). Zero depth is rejected because it
  // would build a degenerate face-only shape with no volume to boolean
  // against.
  if (parameters.depth == 0.0) {
    throw std::runtime_error("Extrude depth must be non-zero");
  }

  if (parameters.profile_kind == "rectangle") {
    if (parameters.width <= 0.0 || parameters.height <= 0.0) {
      throw std::runtime_error("Rectangle extrude dimensions must be greater than zero");
    }
    return;
  }

  if (parameters.profile_kind == "circle") {
    if (parameters.radius <= 0.0) {
      throw std::runtime_error("Circle extrude radius must be greater than zero");
    }
    return;
  }

  if (parameters.profile_kind == "polygon") {
    if (parameters.profile_points.size() < 3) {
      throw std::runtime_error("Polygon extrude requires at least three profile points");
    }
    return;
  }

  throw std::runtime_error("Unsupported extrude profile kind: " + parameters.profile_kind);
}

void validate_occt_shape(const ExtrudeFeatureParameters& parameters) {
  // Validation only checks that OCCT can build *some* shape with these
  // parameters; it doesn't have to match the world-space shape that
  // build_extrude_shape produces. Negative depths are validated via
  // abs(depth) on the legacy primitives below since BRepPrimAPI_MakeBox
  // and BRepPrimAPI_MakeCylinder reject non-positive dimensions.
  const double abs_depth = std::abs(parameters.depth);
  TopoDS_Shape shape;
  if (parameters.profile_kind == "rectangle") {
    shape = BRepPrimAPI_MakeBox(
                parameters.width, abs_depth, parameters.height)
                .Shape();
  } else if (parameters.profile_kind == "circle") {
    shape = BRepPrimAPI_MakeCylinder(parameters.radius, abs_depth).Shape();
  } else {
    BRepBuilderAPI_MakePolygon polygon_builder;
    for (const auto& point : parameters.profile_points) {
      polygon_builder.Add(gp_Pnt(point.x, point.y, 0.0));
    }
    polygon_builder.Close();

    if (!polygon_builder.IsDone()) {
      throw std::runtime_error("OCCT failed to create a polygon wire");
    }

    const TopoDS_Shape face =
        BRepBuilderAPI_MakeFace(polygon_builder.Wire()).Shape();
    // gp_Vec is happy with signed components, so the polygon prism
    // path doesn't need abs(depth) — extruding by a negative vector
    // produces a valid solid in the -z direction.
    shape = BRepPrimAPI_MakePrism(face, gp_Vec(0.0, 0.0, parameters.depth)).Shape();
  }

  if (shape.IsNull()) {
    throw std::runtime_error("OCCT failed to create an extruded shape");
  }
}

std::string make_parameters_summary(const ExtrudeFeatureParameters& parameters) {
  std::ostringstream stream;
  stream << parameters.profile_id << " · " << parameters.depth << " mm";
  return stream.str();
}

std::string make_default_name(const ExtrudeFeatureParameters& parameters) {
  return parameters.mode == "new_body" ? "Body" : "Extrude";
}

}  // namespace

FeatureEntry create_extrude_feature(int feature_index,
                                    const ExtrudeFeatureParameters& parameters) {
  validate_parameters(parameters);
  validate_occt_shape(parameters);

  return FeatureEntry{
      .id = "feature-" + std::to_string(feature_index),
      .kind = "extrude",
      .name = make_default_name(parameters),
      .status = "healthy",
      .parameters_summary = make_parameters_summary(parameters),
      .box_parameters = std::nullopt,
      .cylinder_parameters = std::nullopt,
      .extrude_parameters = parameters,
      .sketch_parameters = std::nullopt,
  };
}

void update_extrude_depth(FeatureEntry& feature, double depth) {
  if (feature.kind != "extrude") {
    throw std::runtime_error(
        "Only extrude features can be updated with extrude depth");
  }

  if (!feature.extrude_parameters.has_value()) {
    throw std::runtime_error("Extrude feature is missing parameters");
  }

  ExtrudeFeatureParameters next = feature.extrude_parameters.value();
  next.depth = depth;

  validate_parameters(next);
  validate_occt_shape(next);

  feature.parameters_summary = make_parameters_summary(next);
  feature.extrude_parameters = next;
}

}  // namespace polysmith::core
