#include "core/sweep_feature.h"

#include <cmath>
#include <stdexcept>
#include <string>

#include <TopoDS_Shape.hxx>

#include "core/feature_shape.h"

namespace polysmith::core {
namespace {

void validate_parameters(const SweepFeatureParameters& parameters) {
  if (parameters.profile_points.size() < 3) {
    throw std::runtime_error("Sweep requires a closed sketch profile");
  }
  const double dx = parameters.path_end_x - parameters.path_start_x;
  const double dy = parameters.path_end_y - parameters.path_start_y;
  const double dz = parameters.path_end_z - parameters.path_start_z;
  if (std::sqrt(dx * dx + dy * dy + dz * dz) <= 1.0e-9) {
    throw std::runtime_error("Sweep path must have non-zero length");
  }
}

std::string make_parameters_summary(const SweepFeatureParameters& parameters) {
  const double dx = parameters.path_end_x - parameters.path_start_x;
  const double dy = parameters.path_end_y - parameters.path_start_y;
  const double dz = parameters.path_end_z - parameters.path_start_z;
  return "Profile · " + std::to_string(std::sqrt(dx * dx + dy * dy + dz * dz)) +
         " mm path";
}

}  // namespace

FeatureEntry create_sweep_feature(int feature_index,
                                  const SweepFeatureParameters& parameters) {
  validate_parameters(parameters);
  const TopoDS_Shape shape = build_sweep_shape(parameters);
  if (shape.IsNull()) {
    throw std::runtime_error("OCCT failed to create a swept shape");
  }

  return FeatureEntry{
      .id = "feature-" + std::to_string(feature_index),
      .kind = "sweep",
      .name = "Sweep",
      .status = "healthy",
      .parameters_summary = make_parameters_summary(parameters),
      .sweep_parameters = parameters,
  };
}

}  // namespace polysmith::core
