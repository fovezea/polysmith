#include "core/refresh_dependents.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <BRepAdaptor_Surface.hxx>
#include <BRepGProp_Face.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "core/body_compiler.h"
#include "core/construction_plane_feature.h"
#include "core/document.h"
#include "core/edge_geometry.h"
#include "core/face_geometry.h"
#include "core/feature.h"
#include "core/sketch_feature.h"

namespace polysmith::core {
namespace {

// "<body_id>:face:<index>" — same shape used everywhere else in the
// core. Returns std::nullopt for non-face ids (legacy sketch on a
// reference plane, etc.). When the suffix isn't a non-negative
// integer, callers treat the id as a legacy named-face sketch and
// skip refreshing — those don't need it because their plane_frame is
// already invariant under upstream edits.
struct ParsedFaceTarget {
  std::string body_id;
  int face_index;
};

std::optional<ParsedFaceTarget> parse_face_target(const std::string& plane_id) {
  const std::string separator = ":face:";
  const auto pos = plane_id.find(separator);
  if (pos == std::string::npos) {
    return std::nullopt;
  }
  const std::string body_id = plane_id.substr(0, pos);
  const std::string suffix = plane_id.substr(pos + separator.size());
  if (suffix.empty()) {
    return std::nullopt;
  }
  try {
    size_t consumed = 0;
    const int index = std::stoi(suffix, &consumed);
    if (consumed != suffix.size() || index < 0) {
      return std::nullopt;
    }
    return ParsedFaceTarget{.body_id = body_id, .face_index = index};
  } catch (const std::exception&) {
    return std::nullopt;
  }
}

// Build a PlaneFrame from a planar OCCT face. Mirrors the planar
// branch of `derive_face_frame` in viewport.cpp, kept inline here so
// the dependency walker doesn't reach across translation units. If
// the face isn't planar we return nullopt — sketches require a planar
// face by construction, so a non-planar resolution is treated the
// same as a missing face (broken dependency).
std::optional<PlaneFrame> frame_from_planar_face(const TopoDS_Face& face) {
  try {
    BRepAdaptor_Surface surface(face);
    if (surface.GetType() != GeomAbs_Plane) {
      return std::nullopt;
    }
    const gp_Pln plane = surface.Plane();
    const gp_Ax3 ax = plane.Position();
    const gp_Pnt origin = ax.Location();
    gp_Dir x_axis = ax.XDirection();
    gp_Dir y_axis = ax.YDirection();
    gp_Dir z_axis = ax.Direction();
    if (face.Orientation() == TopAbs_REVERSED) {
      // Same handed-frame convention as viewport.cpp: flip both the
      // normal and the y-axis on a reversed face so the resulting
      // basis stays right-handed and the normal points outward.
      z_axis.Reverse();
      y_axis.Reverse();
    }
    return PlaneFrame{
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
  } catch (const std::exception&) {
    return std::nullopt;
  }
}

// Resolve the world-space frame of face `index` on body `body_id` in
// `document` by recompiling bodies and walking the body's face map.
// Returns nullopt when the body or face index can't be found, when
// the OCCT call throws, or when the face isn't planar.
std::optional<PlaneFrame> resolve_face_frame(const DocumentState& document,
                                             const std::string& body_id,
                                             int face_index) {
  if (face_index < 0) {
    return std::nullopt;
  }
  const CompiledBodies compiled = compile_bodies(document);
  for (const auto& body : compiled.bodies) {
    if (body.id != body_id || body.shape.IsNull()) {
      continue;
    }
    TopTools_IndexedMapOfShape face_map;
    TopExp::MapShapes(body.shape, TopAbs_FACE, face_map);
    const int one_based = face_index + 1;
    if (one_based < 1 || one_based > face_map.Extent()) {
      return std::nullopt;
    }
    const TopoDS_Face face = TopoDS::Face(face_map(one_based));
    if (face.IsNull()) {
      return std::nullopt;
    }
    return frame_from_planar_face(face);
  }
  return std::nullopt;
}

std::optional<PlaneFrame> frame_from_tangent_face(const TopoDS_Face& face) {
  if (face.IsNull()) {
    return std::nullopt;
  }
  try {
    BRepAdaptor_Surface surface(face);
    const double u_mid =
        0.5 * (surface.FirstUParameter() + surface.LastUParameter());
    const double v_mid =
        0.5 * (surface.FirstVParameter() + surface.LastVParameter());

    BRepGProp_Face prop(face);
    gp_Pnt center;
    gp_Vec normal;
    prop.Normal(u_mid, v_mid, center, normal);
    if (normal.Magnitude() <= 0.0) {
      return std::nullopt;
    }
    normal.Normalize();
    if (face.Orientation() == TopAbs_REVERSED) {
      normal.Reverse();
    }

    gp_Vec arbitrary = std::abs(normal.X()) < 0.9
                           ? gp_Vec(1.0, 0.0, 0.0)
                           : gp_Vec(0.0, 1.0, 0.0);
    gp_Vec x_axis = arbitrary.Crossed(normal);
    if (x_axis.Magnitude() <= 0.0) {
      return std::nullopt;
    }
    x_axis.Normalize();
    gp_Vec y_axis = normal.Crossed(x_axis);
    if (y_axis.Magnitude() <= 0.0) {
      return std::nullopt;
    }
    y_axis.Normalize();

    return PlaneFrame{
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
  } catch (const std::exception&) {
    return std::nullopt;
  }
}

std::optional<PlaneFrame> resolve_body_face_frame(
    const DocumentState& document,
    const std::string& body_id,
    int face_index,
    bool require_planar) {
  if (face_index < 0) {
    return std::nullopt;
  }
  const CompiledBodies compiled = compile_bodies(document);
  for (const auto& body : compiled.bodies) {
    if (body.id != body_id || body.shape.IsNull()) {
      continue;
    }
    TopTools_IndexedMapOfShape face_map;
    TopExp::MapShapes(body.shape, TopAbs_FACE, face_map);
    const int one_based = face_index + 1;
    if (one_based < 1 || one_based > face_map.Extent()) {
      return std::nullopt;
    }
    const TopoDS_Face face = TopoDS::Face(face_map(one_based));
    if (face.IsNull()) {
      return std::nullopt;
    }
    return require_planar ? frame_from_planar_face(face)
                          : frame_from_tangent_face(face);
  }
  return std::nullopt;
}

SketchFeatureParameters::SketchPlaneFrame to_sketch_plane_frame(
    const PlaneFrame& frame) {
  return SketchFeatureParameters::SketchPlaneFrame{
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

PlaneFrame from_sketch_plane_frame(
    const SketchFeatureParameters::SketchPlaneFrame& frame) {
  return PlaneFrame{
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

const FeatureEntry* find_feature(const DocumentState& document,
                                 const std::string& feature_id) {
  for (const auto& feature : document.feature_history) {
    if (feature.id == feature_id) {
      return &feature;
    }
  }
  return nullptr;
}

// Hardcoded frames for the three origin reference planes. The basis
// vectors mirror the existing conventions used by `feature_shape.cpp`
// (`to_world_point` and `extrusion_vector`) so a sketch / extrude
// rendered against one of these frames lands at the same world
// position it always has — extending `start_sketch_on_plane` with a
// plane_frame must not move legacy sketches.
//
// Mapping (kept in lockstep with `feature_shape.cpp::to_world_point`):
//   ref-plane-xy: local (x, y) -> world (x, 0, y), normal (0, 1, 0)
//   ref-plane-yz: local (x, y) -> world (0, x, y), normal (1, 0, 0)
//   ref-plane-xz: local (x, y) -> world (x, y, 0), normal (0, 0, 1)
std::optional<PlaneFrame> origin_plane_frame(const std::string& reference_id) {
  if (reference_id == "ref-plane-xy") {
    return PlaneFrame{
        .origin_x = 0.0, .origin_y = 0.0, .origin_z = 0.0,
        .x_axis_x = 1.0, .x_axis_y = 0.0, .x_axis_z = 0.0,
        .y_axis_x = 0.0, .y_axis_y = 0.0, .y_axis_z = 1.0,
        .normal_x = 0.0, .normal_y = 1.0, .normal_z = 0.0,
    };
  }
  if (reference_id == "ref-plane-yz") {
    return PlaneFrame{
        .origin_x = 0.0, .origin_y = 0.0, .origin_z = 0.0,
        .x_axis_x = 0.0, .x_axis_y = 1.0, .x_axis_z = 0.0,
        .y_axis_x = 0.0, .y_axis_y = 0.0, .y_axis_z = 1.0,
        .normal_x = 1.0, .normal_y = 0.0, .normal_z = 0.0,
    };
  }
  if (reference_id == "ref-plane-xz") {
    return PlaneFrame{
        .origin_x = 0.0, .origin_y = 0.0, .origin_z = 0.0,
        .x_axis_x = 1.0, .x_axis_y = 0.0, .x_axis_z = 0.0,
        .y_axis_x = 0.0, .y_axis_y = 1.0, .y_axis_z = 0.0,
        .normal_x = 0.0, .normal_y = 0.0, .normal_z = 1.0,
    };
  }
  return std::nullopt;
}

std::array<double, 3> sketch_local_to_world(const PlaneFrame& frame,
                                            double local_x,
                                            double local_y);

std::optional<PlaneFrame> resolve_sketch_profile_frame(
    const DocumentState& document,
    const std::string& profile_id) {
  for (const auto& feature : document.feature_history) {
    if (feature.kind != "sketch" || !feature.sketch_parameters.has_value()) {
      continue;
    }
    const auto& sketch = feature.sketch_parameters.value();
    const auto profile_it = std::find_if(
        sketch.profiles.begin(), sketch.profiles.end(),
        [&](const SketchProfileRegion& profile) {
          return profile.id == profile_id;
        });
    if (profile_it == sketch.profiles.end()) {
      continue;
    }

    std::optional<PlaneFrame> frame =
        sketch.plane_frame.has_value()
            ? std::optional<PlaneFrame>(
                  from_sketch_plane_frame(sketch.plane_frame.value()))
            : origin_plane_frame(sketch.plane_id);
    if (!frame.has_value()) {
      return std::nullopt;
    }

    double local_x = profile_it->center_x;
    double local_y = profile_it->center_y;
    if (profile_it->kind != "circle") {
      if (profile_it->points.empty()) {
        return std::nullopt;
      }
      local_x = 0.0;
      local_y = 0.0;
      for (const auto& point : profile_it->points) {
        local_x += point.x;
        local_y += point.y;
      }
      local_x /= static_cast<double>(profile_it->points.size());
      local_y /= static_cast<double>(profile_it->points.size());
    }

    const auto origin = sketch_local_to_world(frame.value(), local_x, local_y);
    frame->origin_x = origin[0];
    frame->origin_y = origin[1];
    frame->origin_z = origin[2];
    return frame;
  }

  return std::nullopt;
}

}  // namespace

std::optional<PlaneFrame> resolve_plane_source_frame(
    const DocumentState& document,
    const std::string& source_id) {
  // Origin reference plane — static frame.
  if (auto frame = origin_plane_frame(source_id); frame.has_value()) {
    return frame;
  }

  // Body face — "<body_id>:face:<index>".
  if (const auto target = parse_face_target(source_id); target.has_value()) {
    return resolve_face_frame(document, target->body_id, target->face_index);
  }

  // Sketch profile — use the owning sketch plane, centered on the
  // profile region so the offset plane appears where the user picked.
  if (auto frame = resolve_sketch_profile_frame(document, source_id);
      frame.has_value()) {
    return frame;
  }

  // Construction-plane feature id — read its cached frame. The
  // topological walk in `refresh_history_dependencies` runs each
  // construction plane in feature_history order, so by the time a
  // downstream feature asks for an upstream construction plane's
  // frame, the upstream feature's cache has already been refreshed.
  if (const FeatureEntry* feature = find_feature(document, source_id);
      feature != nullptr &&
      feature->kind == "construction_plane" &&
      feature->construction_plane_parameters.has_value()) {
    return feature->construction_plane_parameters->plane_frame;
  }

  return std::nullopt;
}

std::optional<PlaneFrame> resolve_tangent_plane_source_frame(
    const DocumentState& document,
    const std::string& source_id) {
  const auto target = parse_face_target(source_id);
  if (!target.has_value()) {
    return std::nullopt;
  }
  return resolve_body_face_frame(document,
                                 target->body_id,
                                 target->face_index,
                                 false);
}

std::optional<ConstructionAxisFrame> resolve_angle_plane_axis(
    const DocumentState& document,
    const std::string& source_id) {
  const auto axis = resolve_construction_axis_source(document, source_id);
  if (!axis.has_value()) {
    return std::nullopt;
  }
  return ConstructionAxisFrame{
      .start_x = axis->start_x,
      .start_y = axis->start_y,
      .start_z = axis->start_z,
      .end_x = axis->end_x,
      .end_y = axis->end_y,
      .end_z = axis->end_z,
  };
}

std::optional<ConstructionAxisFeatureParameters> resolve_construction_axis_source(
    const DocumentState& document,
    const std::string& source_id) {
  if (source_id.find(":edge:") != std::string::npos) {
    const auto edge = compute_edge_geometry(document, source_id);
    if (!edge.has_value() || edge->kind != "line") {
      return std::nullopt;
    }
    return ConstructionAxisFeatureParameters{
        .source_id = source_id,
        .source_kind = "edge",
        .start_x = edge->start.x,
        .start_y = edge->start.y,
        .start_z = edge->start.z,
        .end_x = edge->end.x,
        .end_y = edge->end.y,
        .end_z = edge->end.z,
    };
  }

  for (const auto& feature : document.feature_history) {
    if (feature.kind != "sketch" || !feature.sketch_parameters.has_value()) {
      continue;
    }
    const auto& sketch = feature.sketch_parameters.value();
    const auto line_it = std::find_if(
        sketch.lines.begin(), sketch.lines.end(),
        [&](const SketchLine& line) { return line.id == source_id; });
    if (line_it == sketch.lines.end()) {
      continue;
    }
    const std::optional<PlaneFrame> frame =
        sketch.plane_frame.has_value()
            ? std::optional<PlaneFrame>(
                  from_sketch_plane_frame(sketch.plane_frame.value()))
            : origin_plane_frame(sketch.plane_id);
    if (!frame.has_value()) {
      return std::nullopt;
    }

    const auto start =
        sketch_local_to_world(frame.value(), line_it->start_x, line_it->start_y);
    const auto end =
        sketch_local_to_world(frame.value(), line_it->end_x, line_it->end_y);
    return ConstructionAxisFeatureParameters{
        .source_id = source_id,
        .source_kind = "sketch_line",
        .start_x = start[0],
        .start_y = start[1],
        .start_z = start[2],
        .end_x = end[0],
        .end_y = end[1],
        .end_z = end[2],
    };
  }

  return std::nullopt;
}

std::optional<ConstructionPointFeatureParameters> resolve_construction_point_source(
    const DocumentState& document,
    const std::string& source_id) {
  if (source_id.find(":vertex:") != std::string::npos) {
    const auto point = compute_vertex_position(document, source_id);
    if (!point.has_value()) {
      return std::nullopt;
    }
    return ConstructionPointFeatureParameters{
        .source_id = source_id,
        .source_kind = "vertex",
        .x = point->x,
        .y = point->y,
        .z = point->z,
    };
  }

  for (const auto& feature : document.feature_history) {
    if (feature.kind != "sketch" || !feature.sketch_parameters.has_value()) {
      continue;
    }
    const auto& sketch = feature.sketch_parameters.value();
    const auto point_it = std::find_if(
        sketch.points.begin(), sketch.points.end(),
        [&](const SketchPoint& point) { return point.id == source_id; });
    if (point_it == sketch.points.end()) {
      continue;
    }
    const std::optional<PlaneFrame> frame =
        sketch.plane_frame.has_value()
            ? std::optional<PlaneFrame>(
                  from_sketch_plane_frame(sketch.plane_frame.value()))
            : origin_plane_frame(sketch.plane_id);
    if (!frame.has_value()) {
      return std::nullopt;
    }

    const auto world =
        sketch_local_to_world(frame.value(), point_it->x, point_it->y);
    return ConstructionPointFeatureParameters{
        .source_id = source_id,
        .source_kind = "sketch_point",
        .x = world[0],
        .y = world[1],
        .z = world[2],
    };
  }

  return std::nullopt;
}

namespace {

// Flatten a world-space point onto a sketch plane's local (u, v).
// Mirror of `world_to_sketch_local` in document.cpp — pulled in here
// so the live-projection refresher doesn't have to reach across
// translation units. Identical maths.
std::pair<double, double> world_to_sketch_local(
    const SketchFeatureParameters::SketchPlaneFrame& frame,
    double wx, double wy, double wz) {
  const double dx = wx - frame.origin_x;
  const double dy = wy - frame.origin_y;
  const double dz = wz - frame.origin_z;
  const double sx =
      dx * frame.x_axis_x + dy * frame.x_axis_y + dz * frame.x_axis_z;
  const double sy =
      dx * frame.y_axis_x + dy * frame.y_axis_y + dz * frame.y_axis_z;
  return {sx, sy};
}

std::array<double, 3> sketch_local_to_world(const PlaneFrame& frame,
                                            double local_x,
                                            double local_y) {
  return {
      frame.origin_x + local_x * frame.x_axis_x + local_y * frame.y_axis_x,
      frame.origin_y + local_x * frame.x_axis_y + local_y * frame.y_axis_y,
      frame.origin_z + local_x * frame.x_axis_z + local_y * frame.y_axis_z,
  };
}

std::vector<double> make_refreshed_helix_points(
    const ConstructionAxisFeatureParameters& axis,
    const HelixFeatureParameters& params) {
  constexpr double kPi = 3.14159265358979323846;
  const double ax = axis.end_x - axis.start_x;
  const double ay = axis.end_y - axis.start_y;
  const double az = axis.end_z - axis.start_z;
  const double length = std::sqrt(ax * ax + ay * ay + az * az);
  if (length <= 1.0e-9 || params.radius <= 0.0 || params.pitch <= 0.0 ||
      params.height <= 0.0) {
    return {};
  }

  const std::array<double, 3> dir{ax / length, ay / length, az / length};
  const std::array<double, 3> seed =
      std::abs(dir[0]) < 0.9 ? std::array<double, 3>{1.0, 0.0, 0.0}
                             : std::array<double, 3>{0.0, 1.0, 0.0};
  std::array<double, 3> u{
      dir[1] * seed[2] - dir[2] * seed[1],
      dir[2] * seed[0] - dir[0] * seed[2],
      dir[0] * seed[1] - dir[1] * seed[0],
  };
  const double u_len = std::sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
  if (u_len <= 1.0e-9) {
    return {};
  }
  u = {u[0] / u_len, u[1] / u_len, u[2] / u_len};
  const std::array<double, 3> v{
      dir[1] * u[2] - dir[2] * u[1],
      dir[2] * u[0] - dir[0] * u[2],
      dir[0] * u[1] - dir[1] * u[0],
  };

  const double turns = params.height / params.pitch;
  const int samples = std::max(24, static_cast<int>(std::ceil(turns * 48.0)));
  const double handed = params.handedness == "left" ? -1.0 : 1.0;
  const double start = params.start_angle_degrees * kPi / 180.0;
  std::vector<double> points;
  points.reserve(static_cast<size_t>(samples + 1) * 3);
  for (int i = 0; i <= samples; ++i) {
    const double t = static_cast<double>(i) / static_cast<double>(samples);
    const double along = params.height * t;
    const double angle = start + handed * 2.0 * kPi * turns * t;
    points.push_back(axis.start_x + dir[0] * along +
                     u[0] * std::cos(angle) * params.radius +
                     v[0] * std::sin(angle) * params.radius);
    points.push_back(axis.start_y + dir[1] * along +
                     u[1] * std::cos(angle) * params.radius +
                     v[1] * std::sin(angle) * params.radius);
    points.push_back(axis.start_z + dir[2] * along +
                     u[2] * std::cos(angle) * params.radius +
                     v[2] * std::sin(angle) * params.radius);
  }
  return points;
}

struct SweepPathEntity {
  std::string id;
  std::string kind;
  std::string start_point_id;
  std::string end_point_id;
  const SketchLine* line = nullptr;
  const SketchArc* arc = nullptr;
};

double normalize_sweep_arc_angle(double start_angle,
                                 double end_angle,
                                 bool ccw) {
  constexpr double kPi = 3.14159265358979323846;
  double sweep = end_angle - start_angle;
  if (ccw) {
    while (sweep <= 0.0) {
      sweep += 2.0 * kPi;
    }
  } else {
    while (sweep >= 0.0) {
      sweep -= 2.0 * kPi;
    }
  }
  return sweep;
}

std::vector<SweepPathEntity> order_sweep_path_entities(
    const SketchFeatureParameters& sketch,
    const std::string& seed_entity_id) {
  std::vector<SweepPathEntity> entities;
  for (const auto& line : sketch.lines) {
    if (!line.is_construction) {
      entities.push_back(SweepPathEntity{.id = line.id,
                                         .kind = "line",
                                         .start_point_id = line.start_point_id,
                                         .end_point_id = line.end_point_id,
                                         .line = &line});
    }
  }
  for (const auto& arc : sketch.arcs) {
    if (!arc.is_construction) {
      entities.push_back(SweepPathEntity{.id = arc.id,
                                         .kind = "arc",
                                         .start_point_id = arc.start_point_id,
                                         .end_point_id = arc.end_point_id,
                                         .arc = &arc});
    }
  }
  const auto seed_it = std::find_if(
      entities.begin(), entities.end(),
      [&](const SweepPathEntity& entity) { return entity.id == seed_entity_id; });
  if (seed_it == entities.end()) {
    return {};
  }
  const size_t seed_index =
      static_cast<size_t>(std::distance(entities.begin(), seed_it));
  std::unordered_map<std::string, std::vector<size_t>> by_point;
  for (size_t index = 0; index < entities.size(); ++index) {
    by_point[entities[index].start_point_id].push_back(index);
    by_point[entities[index].end_point_id].push_back(index);
  }

  std::vector<size_t> stack{seed_index};
  std::unordered_set<size_t> component;
  while (!stack.empty()) {
    const size_t index = stack.back();
    stack.pop_back();
    if (!component.insert(index).second) {
      continue;
    }
    for (const auto& point_id :
         {entities[index].start_point_id, entities[index].end_point_id}) {
      for (const size_t connected : by_point[point_id]) {
        if (!component.count(connected)) {
          stack.push_back(connected);
        }
      }
    }
  }
  for (const size_t index : component) {
    const auto& entity = entities[index];
    if (by_point[entity.start_point_id].size() > 2 ||
        by_point[entity.end_point_id].size() > 2) {
      return {};
    }
  }

  size_t start_index = seed_index;
  std::string current_point = entities[seed_index].start_point_id;
  for (const size_t index : component) {
    const auto& entity = entities[index];
    if (by_point[entity.start_point_id].size() == 1) {
      start_index = index;
      current_point = entity.start_point_id;
      break;
    }
    if (by_point[entity.end_point_id].size() == 1) {
      start_index = index;
      current_point = entity.end_point_id;
      break;
    }
  }

  std::vector<SweepPathEntity> ordered;
  std::unordered_set<size_t> used;
  size_t current_index = start_index;
  while (used.size() < component.size()) {
    const auto& entity = entities[current_index];
    SweepPathEntity oriented = entity;
    if (entity.end_point_id == current_point) {
      std::swap(oriented.start_point_id, oriented.end_point_id);
    }
    ordered.push_back(oriented);
    used.insert(current_index);
    current_point = oriented.end_point_id;

    std::optional<size_t> next_index;
    for (const size_t connected : by_point[current_point]) {
      if (component.count(connected) && !used.count(connected)) {
        next_index = connected;
        break;
      }
    }
    if (!next_index.has_value()) {
      break;
    }
    current_index = next_index.value();
  }
  return ordered.size() == component.size() ? ordered : std::vector<SweepPathEntity>{};
}

std::vector<SweepFeatureParameters::PathSegment> make_sweep_path_segments(
    const SketchFeatureParameters& sketch,
    const PlaneFrame& path_frame,
    const std::string& seed_entity_id) {
  const auto ordered = order_sweep_path_entities(sketch, seed_entity_id);
  std::vector<SweepFeatureParameters::PathSegment> segments;
  for (const auto& entity : ordered) {
    if (entity.kind == "line" && entity.line != nullptr) {
      const bool reversed = entity.start_point_id != entity.line->start_point_id;
      const auto start = sketch_local_to_world(
          path_frame, reversed ? entity.line->end_x : entity.line->start_x,
          reversed ? entity.line->end_y : entity.line->start_y);
      const auto end = sketch_local_to_world(
          path_frame, reversed ? entity.line->start_x : entity.line->end_x,
          reversed ? entity.line->start_y : entity.line->end_y);
      segments.push_back(SweepFeatureParameters::PathSegment{
          .entity_id = entity.id,
          .kind = "line",
          .start_x = start[0],
          .start_y = start[1],
          .start_z = start[2],
          .end_x = end[0],
          .end_y = end[1],
          .end_z = end[2],
      });
      continue;
    }
    if (entity.kind == "arc" && entity.arc != nullptr) {
      const bool reversed = entity.start_point_id != entity.arc->start_point_id;
      const bool ccw = reversed ? !entity.arc->ccw : entity.arc->ccw;
      const double start_x = reversed ? entity.arc->end_x : entity.arc->start_x;
      const double start_y = reversed ? entity.arc->end_y : entity.arc->start_y;
      const double end_x = reversed ? entity.arc->start_x : entity.arc->end_x;
      const double end_y = reversed ? entity.arc->start_y : entity.arc->end_y;
      const double start_angle =
          std::atan2(start_y - entity.arc->center_y,
                     start_x - entity.arc->center_x);
      const double end_angle =
          std::atan2(end_y - entity.arc->center_y,
                     end_x - entity.arc->center_x);
      const double mid_angle =
          start_angle +
          normalize_sweep_arc_angle(start_angle, end_angle, ccw) * 0.5;
      const double mid_x =
          entity.arc->center_x + entity.arc->radius * std::cos(mid_angle);
      const double mid_y =
          entity.arc->center_y + entity.arc->radius * std::sin(mid_angle);
      const auto start = sketch_local_to_world(path_frame, start_x, start_y);
      const auto end = sketch_local_to_world(path_frame, end_x, end_y);
      const auto center = sketch_local_to_world(
          path_frame, entity.arc->center_x, entity.arc->center_y);
      const auto mid = sketch_local_to_world(path_frame, mid_x, mid_y);
      segments.push_back(SweepFeatureParameters::PathSegment{
          .entity_id = entity.id,
          .kind = "arc",
          .start_x = start[0],
          .start_y = start[1],
          .start_z = start[2],
          .end_x = end[0],
          .end_y = end[1],
          .end_z = end[2],
          .center_x = center[0],
          .center_y = center[1],
          .center_z = center[2],
          .mid_x = mid[0],
          .mid_y = mid[1],
          .mid_z = mid[2],
          .radius = entity.arc->radius,
          .ccw = ccw,
      });
    }
  }
  return segments;
}

// Find a sketch line by id and patch its endpoint coords. The mutator
// updates the cached (start_x, start_y) / (end_x, end_y); the points
// table picks up the new coords via the next
// `refresh_sketch_derived_state` pass.
bool patch_sketch_line(SketchFeatureParameters& parameters,
                       const std::string& line_id,
                       double start_x, double start_y,
                       double end_x, double end_y) {
  for (auto& line : parameters.lines) {
    if (line.id == line_id) {
      line.start_x = start_x;
      line.start_y = start_y;
      line.end_x = end_x;
      line.end_y = end_y;
      return true;
    }
  }
  return false;
}

bool patch_sketch_circle(SketchFeatureParameters& parameters,
                         const std::string& circle_id,
                         double center_x, double center_y, double radius) {
  for (auto& circle : parameters.circles) {
    if (circle.id == circle_id) {
      circle.center_x = center_x;
      circle.center_y = center_y;
      circle.radius = radius;
      return true;
    }
  }
  return false;
}

bool patch_sketch_arc(SketchFeatureParameters& parameters,
                      const std::string& arc_id,
                      double start_x, double start_y,
                      double end_x, double end_y,
                      double center_x, double center_y,
                      double radius, bool ccw) {
  for (auto& arc : parameters.arcs) {
    if (arc.id == arc_id) {
      arc.start_x = start_x;
      arc.start_y = start_y;
      arc.end_x = end_x;
      arc.end_y = end_y;
      arc.center_x = center_x;
      arc.center_y = center_y;
      arc.radius = radius;
      arc.ccw = ccw;
      return true;
    }
  }
  return false;
}

bool patch_projected_point(SketchFeatureParameters& parameters,
                           const std::string& point_id,
                           double x, double y) {
  for (auto& projected : parameters.projected_points) {
    if (projected.id == point_id) {
      projected.x = x;
      projected.y = y;
      return true;
    }
  }
  return false;
}

// Re-derive every projection on `feature` against `prefix` (the
// document state with this sketch's *upstream* features only) and
// patch the matching generated entities in place. The `prefix` is
// already body-compiled to the latest geometry by the surrounding
// `refresh_history_dependencies` walker, so the sources we resolve
// reflect every recent edit. Returns true iff at least one
// projection's source could not be resolved (caller surfaces this
// as a feature-level dependency_broken).
bool refresh_sketch_projections(const DocumentState& prefix,
                                FeatureEntry& feature) {
  if (!feature.sketch_parameters.has_value() ||
      !feature.sketch_parameters->plane_frame.has_value()) {
    return false;
  }
  auto& parameters = feature.sketch_parameters.value();
  const auto& frame = parameters.plane_frame.value();

  bool any_broken = false;
  for (auto& projection : parameters.projections) {
    projection.dependency_broken = false;
    projection.dependency_warning.clear();

    if (projection.source_kind == "vertex") {
      const auto position =
          compute_vertex_position(prefix, projection.source_id);
      if (!position.has_value()) {
        projection.dependency_broken = true;
        projection.dependency_warning =
            "Projected vertex source is no longer available.";
        any_broken = true;
        continue;
      }
      const auto local = world_to_sketch_local(
          frame, position->x, position->y, position->z);
      if (!projection.generated_point_id.empty()) {
        patch_projected_point(parameters, projection.generated_point_id,
                              local.first, local.second);
      }
    } else if (projection.source_kind == "edge") {
      const auto edge =
          compute_edge_geometry(prefix, projection.source_id);
      if (!edge.has_value() || edge->kind == "unsupported") {
        projection.dependency_broken = true;
        projection.dependency_warning =
            "Projected edge source is no longer available or its "
            "curve type is no longer supported.";
        any_broken = true;
        continue;
      }
      if (edge->kind == "line") {
        if (projection.generated_line_ids.size() != 1) {
          // Source-shape mismatch: the original projection was a
          // single straight line but now we'd be patching the wrong
          // entity count. Flag broken and leave the cached coords
          // alone so nothing visually jumps until the user re-projects.
          projection.dependency_broken = true;
          projection.dependency_warning =
              "Projected source changed shape (line). Re-project to "
              "update.";
          any_broken = true;
          continue;
        }
        const auto a = world_to_sketch_local(
            frame, edge->start.x, edge->start.y, edge->start.z);
        const auto b = world_to_sketch_local(
            frame, edge->end.x, edge->end.y, edge->end.z);
        patch_sketch_line(parameters, projection.generated_line_ids.front(),
                          a.first, a.second, b.first, b.second);
      } else if (edge->kind == "circle") {
        if (projection.generated_circle_ids.size() != 1) {
          projection.dependency_broken = true;
          projection.dependency_warning =
              "Projected source changed shape (circle). Re-project to "
              "update.";
          any_broken = true;
          continue;
        }
        const auto center = world_to_sketch_local(
            frame, edge->center.x, edge->center.y, edge->center.z);
        patch_sketch_circle(parameters,
                            projection.generated_circle_ids.front(),
                            center.first, center.second, edge->radius);
      } else if (edge->kind == "arc") {
        if (projection.generated_arc_ids.size() != 1) {
          projection.dependency_broken = true;
          projection.dependency_warning =
              "Projected source changed shape (arc). Re-project to "
              "update.";
          any_broken = true;
          continue;
        }
        const auto start = world_to_sketch_local(
            frame, edge->start.x, edge->start.y, edge->start.z);
        const auto end = world_to_sketch_local(
            frame, edge->end.x, edge->end.y, edge->end.z);
        const auto center = world_to_sketch_local(
            frame, edge->center.x, edge->center.y, edge->center.z);
        const double dot = edge->axis.x * frame.normal_x +
                           edge->axis.y * frame.normal_y +
                           edge->axis.z * frame.normal_z;
        const bool ccw = dot > 0.0;
        patch_sketch_arc(parameters,
                         projection.generated_arc_ids.front(),
                         start.first, start.second,
                         end.first, end.second,
                         center.first, center.second,
                         edge->radius, ccw);
      }
    } else if (projection.source_kind == "face") {
      const auto outline =
          compute_face_outline(prefix, projection.source_id);
      if (!outline.has_value()) {
        projection.dependency_broken = true;
        projection.dependency_warning =
            "Projected face source is no longer available.";
        any_broken = true;
        continue;
      }
      // Face outlines map onto a fixed number of generated entities
      // recorded at projection time. If the upstream face's vertex
      // count or shape category changed (e.g. a polygon gained a
      // vertex after a chamfer), the existing generated_line /
      // generated_circle ids no longer cover the new outline. v1
      // flags this as broken; the user re-projects to re-emit the
      // updated geometry.
      if (outline->kind == "rectangle") {
        if (projection.generated_line_ids.size() != 4) {
          projection.dependency_broken = true;
          projection.dependency_warning =
              "Projected face changed shape. Re-project to update.";
          any_broken = true;
          continue;
        }
        std::array<std::pair<double, double>, 4> local{};
        for (size_t k = 0; k < 4; ++k) {
          const auto& corner = outline->rectangle_corners[k];
          local[k] = world_to_sketch_local(frame, corner.x, corner.y, corner.z);
        }
        for (size_t k = 0; k < 4; ++k) {
          const auto& a = local[k];
          const auto& b = local[(k + 1) % 4];
          patch_sketch_line(parameters, projection.generated_line_ids[k],
                            a.first, a.second, b.first, b.second);
        }
      } else if (outline->kind == "polygon") {
        size_t expected_line_count = outline->polygon_corners.size();
        for (const auto& inner_loop : outline->inner_loops) {
          expected_line_count += inner_loop.size();
        }
        if (projection.generated_line_ids.size() != expected_line_count) {
          projection.dependency_broken = true;
          projection.dependency_warning =
              "Projected face vertex count changed. Re-project to update.";
          any_broken = true;
          continue;
        }
        size_t line_id_index = 0;
        auto patch_loop =
            [&](const std::vector<FaceOutlinePoint>& loop) {
              std::vector<std::pair<double, double>> local;
              local.reserve(loop.size());
              for (const auto& corner : loop) {
                local.push_back(world_to_sketch_local(
                    frame, corner.x, corner.y, corner.z));
              }
              for (size_t k = 0; k < local.size(); ++k) {
                const auto& a = local[k];
                const auto& b = local[(k + 1) % local.size()];
                patch_sketch_line(parameters,
                                  projection.generated_line_ids[line_id_index++],
                                  a.first, a.second, b.first, b.second);
              }
            };
        patch_loop(outline->polygon_corners);
        for (const auto& inner_loop : outline->inner_loops) {
          patch_loop(inner_loop);
        }
      } else if (outline->kind == "circle") {
        const size_t expected_circle_count = 1 + outline->inner_circles.size();
        if (projection.generated_circle_ids.size() != expected_circle_count) {
          projection.dependency_broken = true;
          projection.dependency_warning =
              "Projected face changed shape. Re-project to update.";
          any_broken = true;
          continue;
        }
        auto patch_projected_circle =
            [&](size_t index, const FaceOutlinePoint& center, double radius) {
          const auto local = world_to_sketch_local(
              frame, center.x, center.y, center.z);
          patch_sketch_circle(parameters, projection.generated_circle_ids[index],
                              local.first, local.second, radius);
        };
        patch_projected_circle(0, outline->circle_center,
                               outline->circle_radius);
        for (size_t index = 0; index < outline->inner_circles.size(); ++index) {
          const auto& inner_circle = outline->inner_circles[index];
          patch_projected_circle(index + 1, inner_circle.center,
                                 inner_circle.radius);
        }
      }
    }
  }
  return any_broken;
}

}  // namespace

void refresh_history_dependencies(DocumentState& document) {
  for (size_t i = 0; i < document.feature_history.size(); ++i) {
    FeatureEntry& feature = document.feature_history[i];

    // Construction plane: re-derive its cached frame from the
    // current source. Every earlier feature has already been
    // refreshed in place by previous iterations, so reading the
    // upstream construction plane's cache or the upstream face's
    // body works against fresh state.
    if (feature.kind == "construction_plane" &&
        feature.construction_plane_parameters.has_value()) {
      const auto& params = feature.construction_plane_parameters.value();
      DocumentState prefix = document;
      prefix.feature_history.resize(i);
      std::optional<PlaneFrame> next_frame;
      if (params.plane_type == "midplane") {
        if (params.source_plane_ids.size() >= 2) {
          const auto first_frame =
              resolve_plane_source_frame(prefix, params.source_plane_ids[0]);
          const auto second_frame =
              resolve_plane_source_frame(prefix, params.source_plane_ids[1]);
          if (first_frame.has_value() && second_frame.has_value()) {
            try {
              next_frame =
                  derive_midplane_frame(first_frame.value(), second_frame.value());
            } catch (const std::exception&) {
              next_frame = std::nullopt;
            }
          }
        }
      } else if (params.plane_type == "tangent") {
        next_frame =
            resolve_tangent_plane_source_frame(prefix, params.source_plane_id);
      } else if (params.plane_type == "angle") {
        const auto source_frame =
            resolve_plane_source_frame(prefix, params.source_plane_id);
        const auto axis =
            resolve_angle_plane_axis(prefix, params.source_axis_id);
        if (source_frame.has_value() && axis.has_value()) {
          try {
            next_frame = derive_angle_plane_frame(
                source_frame.value(), axis.value(), params.angle_degrees);
          } catch (const std::exception&) {
            next_frame = std::nullopt;
          }
        }
      } else {
        const auto source_frame =
            resolve_plane_source_frame(prefix, params.source_plane_id);
        if (source_frame.has_value()) {
          next_frame = derive_offset_frame(source_frame.value(), params.offset);
        }
      }

      if (next_frame.has_value()) {
        ConstructionPlaneFeatureParameters next = params;
        next.plane_frame = next_frame.value();
        feature.construction_plane_parameters = next;
        feature.dependency_broken = false;
        feature.dependency_warning.clear();
      } else {
        // Leave the cached frame at its last value so the UI can
        // still render the plane somewhere; the warning surfaces
        // via dependency_broken.
        feature.dependency_broken = true;
        const std::string source_summary =
            params.plane_type == "angle"
                ? params.source_plane_id + "' / '" + params.source_axis_id
                : params.source_plane_id;
        feature.dependency_warning =
            "Construction plane references '" + source_summary +
            "', which is no longer available. Edit upstream features to "
            "restore it.";
      }
    }

    if (feature.kind == "construction_axis" &&
        feature.construction_axis_parameters.has_value()) {
      const auto& params = feature.construction_axis_parameters.value();
      DocumentState prefix = document;
      prefix.feature_history.resize(i);
      const auto next_axis =
          resolve_construction_axis_source(prefix, params.source_id);
      if (next_axis.has_value()) {
        feature.construction_axis_parameters = next_axis.value();
        feature.dependency_broken = false;
        feature.dependency_warning.clear();
      } else {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Construction axis references '" + params.source_id +
            "', which is no longer available or is no longer linear.";
      }
    }

    if (feature.kind == "construction_point" &&
        feature.construction_point_parameters.has_value()) {
      const auto& params = feature.construction_point_parameters.value();
      DocumentState prefix = document;
      prefix.feature_history.resize(i);
      const auto next_point =
          resolve_construction_point_source(prefix, params.source_id);
      if (next_point.has_value()) {
        feature.construction_point_parameters = next_point.value();
        feature.dependency_broken = false;
        feature.dependency_warning.clear();
      } else {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Construction point references '" + params.source_id +
            "', which is no longer available.";
      }
    }

    if (feature.kind == "hole" && feature.hole_parameters.has_value()) {
      const auto& params = feature.hole_parameters.value();
      DocumentState prefix = document;
      prefix.feature_history.resize(i);
      const auto face_target = parse_face_target(params.source_face_id);
      std::optional<PlaneFrame> next_frame;
      if (face_target.has_value()) {
        next_frame = resolve_face_frame(
            prefix, face_target->body_id, face_target->face_index);
      }
      if (next_frame.has_value()) {
        HoleFeatureParameters next = params;
        next.target_body_id =
            face_target.has_value() ? face_target->body_id : params.target_body_id;
        next.plane_frame = next_frame.value();
        feature.hole_parameters = next;
        feature.dependency_broken = false;
        feature.dependency_warning.clear();
      } else {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Hole references '" + params.source_face_id +
            "', which is no longer available as a planar face.";
      }
    }

    if (feature.kind == "helix" && feature.helix_parameters.has_value()) {
      const auto& params = feature.helix_parameters.value();
      DocumentState prefix = document;
      prefix.feature_history.resize(i);
      const auto axis =
          resolve_construction_axis_source(prefix, params.axis_source_id);
      if (axis.has_value()) {
        HelixFeatureParameters next = params;
        next.axis_start_x = axis->start_x;
        next.axis_start_y = axis->start_y;
        next.axis_start_z = axis->start_z;
        next.axis_end_x = axis->end_x;
        next.axis_end_y = axis->end_y;
        next.axis_end_z = axis->end_z;
        next.turns = next.pitch > 0.0 ? next.height / next.pitch : 0.0;
        next.points = make_refreshed_helix_points(axis.value(), next);
        feature.helix_parameters = next;
        feature.dependency_broken = next.points.empty();
        feature.dependency_warning =
            next.points.empty() ? "Helix parameters are invalid." : "";
      } else {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Helix references '" + params.axis_source_id +
            "', which is no longer available or is no longer linear.";
      }
    }

    // Sketch on a body face / construction plane: re-resolve the
    // plane frame against upstream geometry. We compile the prefix
    // [0, i) — every earlier feature has already been refreshed in
    // place by previous iterations, so the upstream geometry
    // reflects the latest edits.
    if (feature.kind == "sketch" && feature.sketch_parameters.has_value()) {
      const std::string& plane_id = feature.sketch_parameters->plane_id;
      const auto face_target = parse_face_target(plane_id);
      const FeatureEntry* upstream_plane =
          face_target.has_value() ? nullptr : find_feature(document, plane_id);
      const bool is_construction_source =
          upstream_plane != nullptr &&
          upstream_plane->kind == "construction_plane";

      if (face_target.has_value() || is_construction_source) {
        DocumentState prefix = document;
        prefix.feature_history.resize(i);

        const std::optional<PlaneFrame> frame =
            resolve_plane_source_frame(prefix, plane_id);
        if (frame.has_value()) {
          feature.sketch_parameters->plane_frame =
              to_sketch_plane_frame(frame.value());
          feature.dependency_broken = false;
          feature.dependency_warning.clear();
        } else {
          // Leave the sketch's stored plane_frame at its last known
          // value so the UI can still render the sketch entities; the
          // warning is surfaced via `dependency_broken`.
          feature.dependency_broken = true;
          feature.dependency_warning =
              face_target.has_value()
                  ? std::string{
                        "Sketch plane references a face that no longer "
                        "exists on body '"} +
                        face_target->body_id +
                        "'. Edit upstream features to restore it."
                  : std::string{"Sketch plane references construction "
                                "plane '"} +
                        plane_id +
                        "', which is no longer available.";
        }
      } else {
        // Origin reference plane sketch (legacy plane_id like
        // "ref-plane-xy"): its frame is invariant under upstream
        // edits. Clearing any stale broken-state from a previous run
        // keeps the timeline honest.
        feature.dependency_broken = false;
        feature.dependency_warning.clear();
      }

      // Live projection refresh. Every projection on this sketch
      // re-resolves its body source against the prefix [0, i) — which
      // already reflects every upstream edit by the time we get here
      // — and patches the cached coords on the matching generated
      // sketch entities. Mirrors mainstream CAD's "edit the original,
      // the projection follows" behaviour. Skipped when the sketch
      // has no projections, or when its plane frame is missing
      // (broken sketches stay frozen on their last-known coords).
      if (!feature.sketch_parameters->projections.empty() &&
          feature.sketch_parameters->plane_frame.has_value()) {
        DocumentState prefix = document;
        prefix.feature_history.resize(i);
        const bool any_broken = refresh_sketch_projections(prefix, feature);
        if (any_broken && !feature.dependency_broken) {
          // Don't overwrite a more specific upstream-plane warning;
          // only surface the projection-broken message when the
          // feature is otherwise healthy.
          feature.dependency_broken = true;
          feature.dependency_warning =
              "One or more projected entities reference a body source "
              "that no longer exists or changed shape. Re-project to "
              "restore the live link.";
        }
        // After patching, re-run the sketch's derived state so
        // points / profiles pick up the updated coords.
        refresh_sketch_derived_state(feature);
      }
    }

    // Extrude: derive the live plane frame from its owning sketch.
    // The sketch was just refreshed in an earlier iteration (sketches
    // always come before their extrude in feature_history), so we get
    // the up-to-date frame here.
    if (feature.kind == "extrude" && feature.extrude_parameters.has_value()) {
      if (feature.status == "warning" && feature.dependency_broken) {
        // Source-profile breakage is set by the sketch refresh path.
        // Do not clear it just because the sketch plane still resolves.
        continue;
      }
      const FeatureEntry* sketch = find_feature(
          document, feature.extrude_parameters->sketch_feature_id);
      if (sketch == nullptr || !sketch->sketch_parameters.has_value()) {
        continue;
      }
      if (sketch->dependency_broken) {
        // Cascade the broken state: the extrude's plane_frame copy is
        // also stale. We keep the existing `extrude_parameters.plane_frame`
        // so the body still renders somewhere reasonable rather than
        // collapsing to the world origin.
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Extrude depends on sketch '" + sketch->id +
            "', whose plane reference is broken.";
        continue;
      }
      if (sketch->sketch_parameters->plane_frame.has_value()) {
        feature.extrude_parameters->plane_frame =
            from_sketch_plane_frame(
                sketch->sketch_parameters->plane_frame.value());
        feature.dependency_broken = false;
        feature.dependency_warning.clear();
      }
    }

    if (feature.kind == "loft" && feature.loft_parameters.has_value()) {
      if (feature.status == "warning" && feature.dependency_broken) {
        continue;
      }

      bool broken = false;
      std::string warning;
      for (auto& section : feature.loft_parameters->sections) {
        const FeatureEntry* sketch = find_feature(document, section.sketch_feature_id);
        if (sketch == nullptr || !sketch->sketch_parameters.has_value()) {
          broken = true;
          warning = "Loft depends on a sketch that no longer exists.";
          break;
        }
        if (sketch->dependency_broken) {
          broken = true;
          warning = "Loft depends on sketch '" + sketch->id +
                    "', whose plane reference is broken.";
          break;
        }
        if (sketch->sketch_parameters->plane_frame.has_value()) {
          section.plane_frame =
              from_sketch_plane_frame(
                  sketch->sketch_parameters->plane_frame.value());
        }
      }

      if (broken) {
        feature.dependency_broken = true;
        feature.dependency_warning = warning;
      } else {
        feature.dependency_broken = false;
        feature.dependency_warning.clear();
      }
    }

    if (feature.kind == "revolve" && feature.revolve_parameters.has_value()) {
      if (feature.status == "warning" && feature.dependency_broken) {
        continue;
      }

      auto& parameters = feature.revolve_parameters.value();
      const FeatureEntry* profile_sketch =
          find_feature(document, parameters.sketch_feature_id);
      const FeatureEntry* axis_sketch =
          find_feature(document, parameters.axis_sketch_feature_id);

      if (profile_sketch == nullptr ||
          !profile_sketch->sketch_parameters.has_value()) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Revolve depends on a profile sketch that no longer exists.";
        continue;
      }
      if (axis_sketch == nullptr ||
          !axis_sketch->sketch_parameters.has_value()) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Revolve depends on an axis sketch that no longer exists.";
        continue;
      }
      if (profile_sketch->dependency_broken) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Revolve depends on sketch '" + profile_sketch->id +
            "', whose plane reference is broken.";
        continue;
      }
      if (axis_sketch->dependency_broken) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Revolve depends on sketch '" + axis_sketch->id +
            "', whose plane reference is broken.";
        continue;
      }
      if (profile_sketch->sketch_parameters->plane_frame.has_value()) {
        parameters.plane_frame = from_sketch_plane_frame(
            profile_sketch->sketch_parameters->plane_frame.value());
      }
      const SketchLine* axis_line = nullptr;
      for (const auto& line : axis_sketch->sketch_parameters->lines) {
        if (line.id == parameters.axis_entity_id) {
          axis_line = &line;
          break;
        }
      }
      if (axis_line == nullptr) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Revolve depends on an axis line that no longer exists.";
        continue;
      }
      std::optional<PlaneFrame> axis_frame;
      if (axis_sketch->sketch_parameters->plane_frame.has_value()) {
        axis_frame = from_sketch_plane_frame(
            axis_sketch->sketch_parameters->plane_frame.value());
      } else {
        axis_frame = origin_plane_frame(axis_sketch->sketch_parameters->plane_id);
      }
      if (!axis_frame.has_value()) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Revolve could not resolve the axis sketch plane.";
        continue;
      }
      const auto axis_start = sketch_local_to_world(
          axis_frame.value(), axis_line->start_x, axis_line->start_y);
      const auto axis_end = sketch_local_to_world(
          axis_frame.value(), axis_line->end_x, axis_line->end_y);
      parameters.axis_start_x = axis_start[0];
      parameters.axis_start_y = axis_start[1];
      parameters.axis_start_z = axis_start[2];
      parameters.axis_end_x = axis_end[0];
      parameters.axis_end_y = axis_end[1];
      parameters.axis_end_z = axis_end[2];

      feature.dependency_broken = false;
      feature.dependency_warning.clear();
    }

    if (feature.kind == "sweep" && feature.sweep_parameters.has_value()) {
      if (feature.status == "warning" && feature.dependency_broken) {
        continue;
      }

      auto& parameters = feature.sweep_parameters.value();
      const FeatureEntry* profile_sketch =
          find_feature(document, parameters.sketch_feature_id);
      const FeatureEntry* path_sketch =
          find_feature(document, parameters.path_sketch_feature_id);

      if (profile_sketch == nullptr ||
          !profile_sketch->sketch_parameters.has_value()) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Sweep depends on a profile sketch that no longer exists.";
        continue;
      }
      if (path_sketch == nullptr || !path_sketch->sketch_parameters.has_value()) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Sweep depends on a path sketch that no longer exists.";
        continue;
      }
      if (profile_sketch->dependency_broken) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Sweep depends on sketch '" + profile_sketch->id +
            "', whose plane reference is broken.";
        continue;
      }
      if (path_sketch->dependency_broken) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Sweep depends on sketch '" + path_sketch->id +
            "', whose plane reference is broken.";
        continue;
      }
      if (profile_sketch->sketch_parameters->plane_frame.has_value()) {
        parameters.plane_frame = from_sketch_plane_frame(
            profile_sketch->sketch_parameters->plane_frame.value());
      }
      std::optional<PlaneFrame> path_frame;
      if (path_sketch->sketch_parameters->plane_frame.has_value()) {
        path_frame = from_sketch_plane_frame(
            path_sketch->sketch_parameters->plane_frame.value());
      } else {
        path_frame = origin_plane_frame(path_sketch->sketch_parameters->plane_id);
      }
      if (!path_frame.has_value()) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Sweep could not resolve the path sketch plane.";
        continue;
      }
      const auto path_segments = make_sweep_path_segments(
          path_sketch->sketch_parameters.value(), path_frame.value(),
          parameters.path_entity_id);
      if (path_segments.empty()) {
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Sweep depends on a path entity that no longer exists or is branched.";
        continue;
      }
      parameters.path_segments = path_segments;
      parameters.path_start_x = path_segments.front().start_x;
      parameters.path_start_y = path_segments.front().start_y;
      parameters.path_start_z = path_segments.front().start_z;
      parameters.path_end_x = path_segments.back().end_x;
      parameters.path_end_y = path_segments.back().end_y;
      parameters.path_end_z = path_segments.back().end_z;

      feature.dependency_broken = false;
      feature.dependency_warning.clear();
    }
  }
}

}  // namespace polysmith::core
