#include "core/refresh_dependents.h"

#include <cmath>
#include <optional>
#include <string>

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
        if (projection.generated_line_ids.size() !=
            outline->polygon_corners.size()) {
          projection.dependency_broken = true;
          projection.dependency_warning =
              "Projected face vertex count changed. Re-project to update.";
          any_broken = true;
          continue;
        }
        std::vector<std::pair<double, double>> local;
        local.reserve(outline->polygon_corners.size());
        for (const auto& corner : outline->polygon_corners) {
          local.push_back(world_to_sketch_local(
              frame, corner.x, corner.y, corner.z));
        }
        for (size_t k = 0; k < local.size(); ++k) {
          const auto& a = local[k];
          const auto& b = local[(k + 1) % local.size()];
          patch_sketch_line(parameters, projection.generated_line_ids[k],
                            a.first, a.second, b.first, b.second);
        }
      } else if (outline->kind == "circle") {
        if (projection.generated_circle_ids.size() != 1) {
          projection.dependency_broken = true;
          projection.dependency_warning =
              "Projected face changed shape. Re-project to update.";
          any_broken = true;
          continue;
        }
        const auto center = world_to_sketch_local(
            frame, outline->circle_center.x, outline->circle_center.y,
            outline->circle_center.z);
        patch_sketch_circle(parameters,
                            projection.generated_circle_ids.front(),
                            center.first, center.second,
                            outline->circle_radius);
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
      const std::optional<PlaneFrame> source_frame =
          resolve_plane_source_frame(prefix, params.source_plane_id);
      if (source_frame.has_value()) {
        ConstructionPlaneFeatureParameters next = params;
        next.plane_frame =
            derive_offset_frame(source_frame.value(), params.offset);
        feature.construction_plane_parameters = next;
        feature.dependency_broken = false;
        feature.dependency_warning.clear();
      } else {
        // Leave the cached frame at its last value so the UI can
        // still render the plane somewhere; the warning surfaces
        // via dependency_broken.
        feature.dependency_broken = true;
        feature.dependency_warning =
            "Construction plane references '" + params.source_plane_id +
            "', which is no longer available. Edit upstream features to "
            "restore it.";
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
      // sketch entities. Mirrors Fusion 360's "edit the original,
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
  }
}

}  // namespace polysmith::core
