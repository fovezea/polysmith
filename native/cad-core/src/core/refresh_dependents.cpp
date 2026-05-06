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
#include "core/feature.h"

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
    }

    // Extrude: derive the live plane frame from its owning sketch.
    // The sketch was just refreshed in an earlier iteration (sketches
    // always come before their extrude in feature_history), so we get
    // the up-to-date frame here.
    if (feature.kind == "extrude" && feature.extrude_parameters.has_value()) {
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
