#include "core/construction_plane_feature.h"

#include <sstream>
#include <stdexcept>

namespace polysmith::core {

namespace {

std::string make_parameters_summary(
    const ConstructionPlaneFeatureParameters& parameters) {
  std::ostringstream stream;
  stream << parameters.source_plane_id << " · " << parameters.offset << " mm";
  return stream.str();
}

}  // namespace

PlaneFrame derive_offset_frame(const PlaneFrame& source_frame, double offset) {
  // The offset slides the source frame along its own normal. Basis
  // vectors stay aligned with the source so a sketch on the new
  // plane keeps a predictable orientation (Fusion does the same).
  return PlaneFrame{
      .origin_x = source_frame.origin_x + source_frame.normal_x * offset,
      .origin_y = source_frame.origin_y + source_frame.normal_y * offset,
      .origin_z = source_frame.origin_z + source_frame.normal_z * offset,
      .x_axis_x = source_frame.x_axis_x,
      .x_axis_y = source_frame.x_axis_y,
      .x_axis_z = source_frame.x_axis_z,
      .y_axis_x = source_frame.y_axis_x,
      .y_axis_y = source_frame.y_axis_y,
      .y_axis_z = source_frame.y_axis_z,
      .normal_x = source_frame.normal_x,
      .normal_y = source_frame.normal_y,
      .normal_z = source_frame.normal_z,
  };
}

FeatureEntry create_construction_plane_feature(
    int feature_index,
    const std::string& source_plane_id,
    double offset,
    const PlaneFrame& source_frame) {
  if (source_plane_id.empty()) {
    throw std::runtime_error("Construction plane requires a source plane id");
  }

  ConstructionPlaneFeatureParameters parameters{
      .source_plane_id = source_plane_id,
      .offset = offset,
      .plane_frame = derive_offset_frame(source_frame, offset),
  };

  return FeatureEntry{
      .id = "feature-" + std::to_string(feature_index),
      .kind = "construction_plane",
      .name = "Offset Plane",
      .status = "healthy",
      .parameters_summary = make_parameters_summary(parameters),
      .construction_plane_parameters = parameters,
  };
}

void update_construction_plane(FeatureEntry& feature,
                               double offset,
                               const PlaneFrame& source_frame) {
  if (feature.kind != "construction_plane" ||
      !feature.construction_plane_parameters.has_value()) {
    throw std::runtime_error(
        "Only construction_plane features can be updated with an offset");
  }

  ConstructionPlaneFeatureParameters next =
      feature.construction_plane_parameters.value();
  next.offset = offset;
  next.plane_frame = derive_offset_frame(source_frame, offset);

  feature.parameters_summary = make_parameters_summary(next);
  feature.construction_plane_parameters = next;
}

}  // namespace polysmith::core
