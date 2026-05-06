#include "core/document.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>

#include <nlohmann/json.hpp>

#include <BRepAlgoAPI_Common.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>

#include "core/body_compiler.h"
#include "core/face_geometry.h"
#include "core/feature_shape.h"
#include "core/refresh_dependents.h"
#include "protocol/serialization.h"

namespace polysmith::core {
namespace {

bool is_origin_plane_reference(const std::string& reference_id) {
  return reference_id == "ref-plane-xy" || reference_id == "ref-plane-yz" ||
         reference_id == "ref-plane-xz";
}

// Test whether two solid shapes intersect with non-zero volume. Used by
// the auto-cut detector at extrude-creation time so a new_body extrude
// that overlaps an existing body is silently promoted to a cut.
bool shapes_intersect_with_volume(const TopoDS_Shape& a,
                                  const TopoDS_Shape& b) {
  if (a.IsNull() || b.IsNull()) {
    return false;
  }
  try {
    BRepAlgoAPI_Common common(a, b);
    common.Build();
    if (!common.IsDone()) {
      return false;
    }
    const TopoDS_Shape result = common.Shape();
    if (result.IsNull()) {
      return false;
    }
    // Any solid in the result -> the inputs share volume. We don't
    // dilute to TopAbs_FACE because two adjacent (touching but not
    // overlapping) solids share faces without sharing volume, and
    // promoting that to a cut would surprise the user.
    TopExp_Explorer explorer(result, TopAbs_SOLID);
    return explorer.More();
  } catch (const std::exception&) {
    return false;
  }
}

// Check whether a candidate extrude (built from `parameters`) would
// overlap any existing body in `document`. Returns the body id of the
// first such body, or nullopt when no intersection is found. Bodies
// derived from features after the candidate (in feature_history order)
// are excluded — we only want to detect overlap with bodies that exist
// "now" from the user's point of view.
std::optional<std::string> find_intersecting_body_for_extrude(
    const DocumentState& document,
    const ExtrudeFeatureParameters& parameters) {
  TopoDS_Shape candidate;
  try {
    candidate = build_extrude_shape(parameters);
  } catch (const std::exception&) {
    return std::nullopt;
  }
  if (candidate.IsNull()) {
    return std::nullopt;
  }

  const CompiledBodies compiled = compile_bodies(document);
  for (const auto& body : compiled.bodies) {
    if (body.shape.IsNull()) {
      continue;
    }
    if (shapes_intersect_with_volume(body.shape, candidate)) {
      return body.id;
    }
  }
  return std::nullopt;
}

std::string face_owner_id(const std::string& face_id) {
  const auto separator = face_id.find(":face:");
  if (separator == std::string::npos) {
    return "";
  }

  return face_id.substr(0, separator);
}

bool is_supported_sketch_tool(const std::string& tool) {
  return tool == "select" || tool == "line" || tool == "rectangle" ||
         tool == "circle" || tool == "arc";
}

std::string plane_id_from_frame(
    const SketchFeatureParameters::SketchPlaneFrame& plane_frame) {
  const double abs_x = std::abs(plane_frame.normal_x);
  const double abs_y = std::abs(plane_frame.normal_y);
  const double abs_z = std::abs(plane_frame.normal_z);

  if (abs_x >= abs_y && abs_x >= abs_z) {
    return "ref-plane-yz";
  }

  if (abs_y >= abs_x && abs_y >= abs_z) {
    return "ref-plane-xy";
  }

  return "ref-plane-xz";
}

PlaneFrame make_plane_frame(
    const SketchFeatureParameters::SketchPlaneFrame& plane_frame) {
  return PlaneFrame{
      .origin_x = plane_frame.origin_x,
      .origin_y = plane_frame.origin_y,
      .origin_z = plane_frame.origin_z,
      .x_axis_x = plane_frame.x_axis_x,
      .x_axis_y = plane_frame.x_axis_y,
      .x_axis_z = plane_frame.x_axis_z,
      .y_axis_x = plane_frame.y_axis_x,
      .y_axis_y = plane_frame.y_axis_y,
      .y_axis_z = plane_frame.y_axis_z,
      .normal_x = plane_frame.normal_x,
      .normal_y = plane_frame.normal_y,
      .normal_z = plane_frame.normal_z,
  };
}

std::optional<ExtrudeFeatureParameters> make_extrude_parameters_for_profile(
    const FeatureEntry& sketch_feature,
    const SketchProfileRegion& profile,
    double depth) {
  if (!sketch_feature.sketch_parameters.has_value()) {
    return std::nullopt;
  }

  const auto& sketch = sketch_feature.sketch_parameters.value();
  const std::string plane_id = sketch.plane_frame.has_value()
                                   ? plane_id_from_frame(sketch.plane_frame.value())
                                   : sketch.plane_id;
  const std::optional<PlaneFrame> plane_frame =
      sketch.plane_frame.has_value()
          ? std::optional<PlaneFrame>(make_plane_frame(sketch.plane_frame.value()))
          : std::nullopt;

  if (profile.kind == "polygon") {
    return ExtrudeFeatureParameters{
        .sketch_feature_id = sketch_feature.id,
        .profile_id = profile.id,
        .plane_id = plane_id,
        .plane_frame = plane_frame,
        .profile_kind = "polygon",
        .start_x = 0.0,
        .start_y = 0.0,
        .width = 0.0,
        .height = 0.0,
        .radius = 0.0,
        .profile_points = profile.points,
        .depth = depth,
    };
  }

  if (profile.kind == "circle") {
    return ExtrudeFeatureParameters{
        .sketch_feature_id = sketch_feature.id,
        .profile_id = profile.id,
        .plane_id = plane_id,
        .plane_frame = plane_frame,
        .profile_kind = "circle",
        .start_x = profile.center_x,
        .start_y = profile.center_y,
        .width = 0.0,
        .height = 0.0,
        .radius = profile.radius,
        .profile_points = {},
        .depth = depth,
    };
  }

  return std::nullopt;
}

void refresh_linked_extrudes(DocumentState& document,
                             const FeatureEntry& sketch_feature) {
  if (!sketch_feature.sketch_parameters.has_value()) {
    return;
  }

  for (auto& feature : document.feature_history) {
    if (feature.kind != "extrude" || !feature.extrude_parameters.has_value() ||
        feature.extrude_parameters->sketch_feature_id != sketch_feature.id) {
      continue;
    }

    const auto profile_it = std::find_if(
        sketch_feature.sketch_parameters->profiles.begin(),
        sketch_feature.sketch_parameters->profiles.end(),
        [&](const SketchProfileRegion& profile) {
          return profile.id == feature.extrude_parameters->profile_id;
        });
    if (profile_it == sketch_feature.sketch_parameters->profiles.end()) {
      feature.status = "warning";
      feature.parameters_summary = "Source profile unavailable";
      continue;
    }

    const double depth = feature.extrude_parameters->depth;
    const auto next_parameters =
        make_extrude_parameters_for_profile(sketch_feature, *profile_it, depth);
    if (!next_parameters.has_value()) {
      feature.status = "warning";
      feature.parameters_summary = "Source profile unsupported";
      continue;
    }

    feature.extrude_parameters = next_parameters.value();
    feature.status = "healthy";
    feature.parameters_summary =
        feature.extrude_parameters->profile_id + " · " +
        std::to_string(feature.extrude_parameters->depth) + " mm";
  }
}

}  // namespace

void DocumentManager::require_document() const {
  if (!document_.has_value()) {
    throw std::runtime_error("No active document");
  }
}

void DocumentManager::push_undo_state() {
  require_document();
  undo_stack_.push_back(document_.value());
}

void DocumentManager::bump_geometry_revision() {
  require_document();
  refresh_history_dependencies(*document_);
  // Increment the revision via a local before assigning back so the
  // literal `document_->revision += 1;` doesn't appear here — that
  // way mass-renaming call sites won't accidentally rewrite this
  // implementation.
  const int next = document_->revision + 1;
  document_->revision = next;
}

void DocumentManager::clear_redo_stack() {
  redo_stack_.clear();
}

FeatureEntry DocumentManager::make_root_feature() {
  return FeatureEntry{
      .id = "feature-" + std::to_string(next_feature_id_++),
      .kind = "root_part",
      .name = "Base Part",
      .status = "healthy",
      .parameters_summary = "Document root",
      .box_parameters = std::nullopt,
      .cylinder_parameters = std::nullopt,
      .extrude_parameters = std::nullopt,
      .sketch_parameters = std::nullopt,
  };
}

DocumentState DocumentManager::create_document() {
  DocumentState document{
      .id = "doc-" + std::to_string(next_document_id_++),
      .name = "Untitled Part",
      .units = "mm",
      .revision = 1,
      .selected_feature_id = std::nullopt,
      .selected_reference_id = std::nullopt,
      .selected_face_id = std::nullopt,
      .selected_edge_ids = {},
      .selected_vertex_ids = {},
      .active_sketch_plane_id = std::nullopt,
      .active_sketch_face_id = std::nullopt,
      .active_sketch_feature_id = std::nullopt,
      .active_sketch_tool = std::nullopt,
      .selected_sketch_point_id = std::nullopt,
      .selected_sketch_entity_id = std::nullopt,
      .selected_sketch_dimension_id = std::nullopt,
      .selected_sketch_profile_id = std::nullopt,
      .feature_history = {make_root_feature()},
  };

  document_ = document;
  document_count_ = 1;
  undo_stack_.clear();
  redo_stack_.clear();
  return document;
}

DocumentState DocumentManager::add_box_feature(
    const BoxFeatureParameters& parameters) {
  require_document();
  push_undo_state();
  clear_redo_stack();

  document_->feature_history.push_back(
      create_box_feature(next_feature_id_++, parameters));
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::add_cylinder_feature(
    const CylinderFeatureParameters& parameters) {
  require_document();
  push_undo_state();
  clear_redo_stack();

  document_->feature_history.push_back(
      create_cylinder_feature(next_feature_id_++, parameters));
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_box_feature(
    const std::string& feature_id, const BoxFeatureParameters& parameters) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::update_box_feature(*feature_it, parameters);
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_cylinder_feature(
    const std::string& feature_id,
    const CylinderFeatureParameters& parameters) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::update_cylinder_feature(*feature_it, parameters);
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_extrude_depth(
    const std::string& feature_id, double depth) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::update_extrude_depth(*feature_it, depth);
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_extrude_mode(
    const std::string& feature_id, const std::string& mode) {
  require_document();

  if (mode != "new_body" && mode != "join" && mode != "cut") {
    throw std::runtime_error("Unsupported extrude mode: " + mode);
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  if (feature_it->kind != "extrude" ||
      !feature_it->extrude_parameters.has_value()) {
    throw std::runtime_error(
        "update_extrude_mode requires an extrude feature: " + feature_id);
  }

  push_undo_state();
  clear_redo_stack();
  feature_it->extrude_parameters->mode = mode;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_extrude_target_body(
    const std::string& feature_id,
    const std::optional<std::string>& target_body_id) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  if (feature_it->kind != "extrude" ||
      !feature_it->extrude_parameters.has_value()) {
    throw std::runtime_error(
        "update_extrude_target_body requires an extrude feature: " +
        feature_id);
  }

  // Target ids that point at the extrude itself (or at a feature that
  // does not exist) are silently coerced to nullopt so the body compiler
  // simply falls back to "most recent body".
  std::optional<std::string> resolved = target_body_id;
  if (resolved.has_value()) {
    if (resolved.value() == feature_id) {
      resolved = std::nullopt;
    } else {
      bool exists = false;
      for (const auto& other : document_->feature_history) {
        if (other.id == resolved.value()) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        resolved = std::nullopt;
      }
    }
  }

  push_undo_state();
  clear_redo_stack();
  feature_it->extrude_parameters->target_body_id = resolved;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::rename_feature(const std::string& feature_id,
                                              const std::string& name) {
  require_document();

  if (name.empty()) {
    throw std::runtime_error("Feature name cannot be empty");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  push_undo_state();
  clear_redo_stack();
  feature_it->name = name;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_feature_suppressed(
    const std::string& feature_id, bool suppressed) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  if (feature_it->kind == "root_part") {
    throw std::runtime_error("The root feature cannot be suppressed");
  }

  // No-op early exit so we don't pollute undo with a redundant entry
  // when the UI's "Suppress" button is double-clicked.
  if (feature_it->suppressed == suppressed) {
    return document_.value();
  }

  push_undo_state();
  clear_redo_stack();
  feature_it->suppressed = suppressed;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::delete_feature(const std::string& feature_id) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  if (feature_it->kind == "root_part") {
    throw std::runtime_error("The root feature cannot be deleted");
  }

  push_undo_state();
  clear_redo_stack();

  const bool deleted_selected =
      document_->selected_feature_id.has_value() &&
      document_->selected_feature_id.value() == feature_id;

  document_->feature_history.erase(feature_it);
  if (deleted_selected) {
    document_->selected_feature_id = std::nullopt;
  }
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::undo() {
  require_document();

  if (undo_stack_.empty()) {
    throw std::runtime_error("Nothing to undo");
  }

  redo_stack_.push_back(document_.value());
  document_ = undo_stack_.back();
  undo_stack_.pop_back();
  return document_.value();
}

DocumentState DocumentManager::redo() {
  require_document();

  if (redo_stack_.empty()) {
    throw std::runtime_error("Nothing to redo");
  }

  undo_stack_.push_back(document_.value());
  document_ = redo_stack_.back();
  redo_stack_.pop_back();
  return document_.value();
}

DocumentState DocumentManager::select_feature(const std::string& feature_id) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }

  document_->selected_feature_id = feature_id;
  document_->selected_reference_id = std::nullopt;
  document_->selected_face_id = std::nullopt;
  document_->selected_edge_ids.clear();
  document_->selected_vertex_ids.clear();
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

DocumentState DocumentManager::select_reference(const std::string& reference_id) {
  require_document();

  if (!is_origin_plane_reference(reference_id)) {
    throw std::runtime_error("Reference not found: " + reference_id);
  }

  document_->selected_feature_id = std::nullopt;
  document_->selected_reference_id = reference_id;
  document_->selected_face_id = std::nullopt;
  document_->selected_edge_ids.clear();
  document_->selected_vertex_ids.clear();
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

DocumentState DocumentManager::start_sketch_on_plane(
    const std::string& reference_id) {
  require_document();

  if (!is_origin_plane_reference(reference_id)) {
    throw std::runtime_error("Sketch plane not found: " + reference_id);
  }

  push_undo_state();
  clear_redo_stack();

  document_->feature_history.push_back(
      create_sketch_feature(next_feature_id_++, reference_id));
  const std::string sketch_feature_id = document_->feature_history.back().id;
  document_->selected_feature_id = std::nullopt;
  document_->selected_reference_id = reference_id;
  document_->selected_face_id = std::nullopt;
  document_->selected_edge_ids.clear();
  document_->selected_vertex_ids.clear();
  document_->active_sketch_plane_id = reference_id;
  document_->active_sketch_face_id = std::nullopt;
  document_->active_sketch_feature_id = sketch_feature_id;
  document_->active_sketch_tool = "select";
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::select_face(const std::string& face_id) {
  require_document();

  const std::string owner_id = face_owner_id(face_id);
  if (owner_id.empty()) {
    throw std::runtime_error("Face not found: " + face_id);
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == owner_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Face owner not found: " + face_id);
  }

  document_->selected_feature_id = feature_it->id;
  document_->selected_reference_id = std::nullopt;
  document_->selected_face_id = face_id;
  document_->selected_edge_ids.clear();
  document_->selected_vertex_ids.clear();
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

DocumentState DocumentManager::select_edge(const std::string& edge_id,
                                            bool additive) {
  require_document();

  // Edge ids are minted by the viewport as "<owner_body_id>:edge:<index>".
  // We don't validate the index — the body's edge enumeration may shift
  // by topology so a stale id from the UI just becomes a no-op highlight.
  // The owner body id, however, must point at a real feature so we can
  // also bring the body into focus (selected_feature_id) for the
  // hierarchy panel and downstream actions like fillet/chamfer.
  const auto separator = edge_id.find(":edge:");
  if (separator == std::string::npos || separator == 0) {
    throw std::runtime_error("Malformed edge id: " + edge_id);
  }
  const std::string owner_id = edge_id.substr(0, separator);

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == owner_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Edge owner not found: " + edge_id);
  }

  // Multi-select semantics: shift-click toggles, plain click replaces.
  // Toggling preserves the rest of the selection so users can build up
  // a multi-edge set incrementally for fillet / chamfer. Adding an
  // edge from a different body is allowed at the storage layer; the
  // fillet / chamfer creators are the ones that reject mixed-body
  // selections, since OCCT expects a single target body per feature.
  if (additive) {
    const auto existing = std::find(document_->selected_edge_ids.begin(),
                                    document_->selected_edge_ids.end(),
                                    edge_id);
    if (existing != document_->selected_edge_ids.end()) {
      document_->selected_edge_ids.erase(existing);
    } else {
      document_->selected_edge_ids.push_back(edge_id);
    }
  } else {
    document_->selected_edge_ids = {edge_id};
  }

  document_->selected_feature_id = feature_it->id;
  document_->selected_reference_id = std::nullopt;
  document_->selected_face_id = std::nullopt;
  document_->selected_vertex_ids.clear();
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

DocumentState DocumentManager::select_vertex(const std::string& vertex_id,
                                              bool additive) {
  require_document();

  // Vertex ids are minted by the viewport as
  // "<owner_body_id>:vertex:<index>". Same lenience as select_edge:
  // we don't validate the index since topology can shift, but the
  // owner body id must point at a real feature so the hierarchy
  // panel highlights the correct body and downstream actions can
  // resolve the body via selected_feature_id.
  const auto separator = vertex_id.find(":vertex:");
  if (separator == std::string::npos || separator == 0) {
    throw std::runtime_error("Malformed vertex id: " + vertex_id);
  }
  const std::string owner_id = vertex_id.substr(0, separator);

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == owner_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Vertex owner not found: " + vertex_id);
  }

  // Toggle / replace mirror of select_edge: shift-click adds or
  // removes; plain click replaces. Two-vertex selections drive the
  // distance readout in the UI's Selection panel.
  if (additive) {
    const auto existing = std::find(document_->selected_vertex_ids.begin(),
                                    document_->selected_vertex_ids.end(),
                                    vertex_id);
    if (existing != document_->selected_vertex_ids.end()) {
      document_->selected_vertex_ids.erase(existing);
    } else {
      document_->selected_vertex_ids.push_back(vertex_id);
    }
  } else {
    document_->selected_vertex_ids = {vertex_id};
  }

  document_->selected_feature_id = feature_it->id;
  document_->selected_reference_id = std::nullopt;
  document_->selected_face_id = std::nullopt;
  document_->selected_edge_ids.clear();
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

namespace {

std::string edge_owner_id(const std::string& edge_id) {
  const auto separator = edge_id.find(":edge:");
  if (separator == std::string::npos) {
    return "";
  }
  return edge_id.substr(0, separator);
}

}  // namespace

DocumentState DocumentManager::create_fillet(
    const std::vector<std::string>& edge_ids, double radius) {
  require_document();

  if (radius <= 0.0) {
    throw std::runtime_error("Fillet radius must be greater than zero");
  }
  if (edge_ids.empty()) {
    throw std::runtime_error("Fillet requires at least one edge");
  }

  // Validate every edge is well-formed and that all share the same
  // owner body — OCCT's fillet builder operates on a single shape, so
  // mixing edges from multiple bodies has no well-defined semantics.
  // We surface this as an error rather than silently slicing the
  // selection.
  const std::string owner_id = edge_owner_id(edge_ids.front());
  if (owner_id.empty()) {
    throw std::runtime_error("Malformed edge id: " + edge_ids.front());
  }
  for (const auto& edge_id : edge_ids) {
    const std::string id_owner = edge_owner_id(edge_id);
    if (id_owner.empty()) {
      throw std::runtime_error("Malformed edge id: " + edge_id);
    }
    if (id_owner != owner_id) {
      throw std::runtime_error(
          "Fillet edges must all belong to the same body");
    }
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == owner_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Edge owner not found: " + owner_id);
  }

  push_undo_state();
  clear_redo_stack();

  FilletFeatureParameters params{};
  params.target_body_id = owner_id;
  params.edge_ids = edge_ids;
  params.radius = radius;
  // Born pending so body_compiler retains the pre-fillet shape for
  // edge picking until the UI calls `confirm_fillet`. See
  // FilletFeatureParameters::is_pending.
  params.is_pending = true;

  std::ostringstream summary;
  summary << edge_ids.size() << " edge"
          << (edge_ids.size() == 1 ? "" : "s") << " · " << radius
          << " mm";

  FeatureEntry feature{
      .id = "feature-" + std::to_string(next_feature_id_++),
      .kind = "fillet",
      .name = "Fillet",
      .status = "healthy",
      .parameters_summary = summary.str(),
      .box_parameters = std::nullopt,
      .cylinder_parameters = std::nullopt,
      .extrude_parameters = std::nullopt,
      .sketch_parameters = std::nullopt,
      .fillet_parameters = params,
      .chamfer_parameters = std::nullopt,
  };
  document_->feature_history.push_back(std::move(feature));
  document_->selected_feature_id = document_->feature_history.back().id;
  // Keep the picked edges highlighted while the floating panel is
  // open: the body_compiler highlights edges that are in
  // selected_edge_ids, and the panel's "edit edges" interaction
  // (update_fillet_edges) keeps this set in sync. The UI's Confirm
  // path is responsible for clearing the selection once the user is
  // done; Cancel goes through undo() which restores the prior set.
  document_->selected_edge_ids = edge_ids;
  document_->selected_vertex_ids.clear();
  document_->selected_face_id = std::nullopt;
  document_->selected_reference_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_fillet_edges(
    const std::string& feature_id,
    const std::vector<std::string>& edge_ids) {
  require_document();

  if (edge_ids.empty()) {
    throw std::runtime_error("Fillet must keep at least one edge");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }
  if (feature_it->kind != "fillet" ||
      !feature_it->fillet_parameters.has_value()) {
    throw std::runtime_error(
        "update_fillet_edges requires a fillet feature: " + feature_id);
  }

  // Every new edge must belong to the feature's existing target body
  // — see create_fillet for why mixed-body sets aren't representable.
  // We compare against the stored target_body_id rather than parsing
  // the first edge's owner so the feature's body identity stays
  // authoritative across edge swaps.
  const std::string& target = feature_it->fillet_parameters->target_body_id;
  for (const auto& edge_id : edge_ids) {
    const auto separator = edge_id.find(":edge:");
    if (separator == std::string::npos || separator == 0) {
      throw std::runtime_error("Malformed edge id: " + edge_id);
    }
    if (edge_id.substr(0, separator) != target) {
      throw std::runtime_error(
          "Fillet edges must all belong to the same body");
    }
  }

  // No push_undo_state here: this is a live-preview update on the
  // freshly-created fillet whose own create_fillet already pushed an
  // undo step. Pushing here would make a panel session of N edge
  // toggles and M radius edits collapse to a single user-visible
  // feature but produce N+M+1 undo steps, so Cancel → undo() would
  // only revert the last edit instead of the whole session. The
  // create_* push covers the entire session.
  feature_it->fillet_parameters->edge_ids = edge_ids;
  std::ostringstream summary;
  summary << edge_ids.size() << " edge"
          << (edge_ids.size() == 1 ? "" : "s") << " · "
          << feature_it->fillet_parameters->radius << " mm";
  feature_it->parameters_summary = summary.str();
  // Keep the highlight in sync with the live edge set so the user
  // sees what's being filleted while picking.
  document_->selected_edge_ids = edge_ids;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::confirm_fillet(const std::string& feature_id) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }
  if (feature_it->kind != "fillet" ||
      !feature_it->fillet_parameters.has_value()) {
    throw std::runtime_error(
        "confirm_fillet requires a fillet feature: " + feature_id);
  }

  // Idempotent: confirming an already-confirmed fillet is a no-op so
  // the UI doesn't have to track whether it has called this before.
  if (!feature_it->fillet_parameters->is_pending) {
    return document_.value();
  }

  // No push_undo here — the matching create_fillet's undo step covers
  // the entire pending session, so a single undo() rolls back create
  // + all edits + this confirm in one step.
  feature_it->fillet_parameters->is_pending = false;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_fillet_radius(
    const std::string& feature_id, double radius) {
  require_document();

  if (radius <= 0.0) {
    throw std::runtime_error("Fillet radius must be greater than zero");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }
  if (feature_it->kind != "fillet" || !feature_it->fillet_parameters.has_value()) {
    throw std::runtime_error(
        "update_fillet_radius requires a fillet feature: " + feature_id);
  }

  // See update_fillet_edges for why this command intentionally does
  // not push an undo step.
  feature_it->fillet_parameters->radius = radius;
  std::ostringstream summary;
  summary << feature_it->fillet_parameters->edge_ids.size() << " edge"
          << (feature_it->fillet_parameters->edge_ids.size() == 1 ? "" : "s")
          << " · " << radius << " mm";
  feature_it->parameters_summary = summary.str();
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::create_chamfer(
    const std::vector<std::string>& edge_ids, double distance) {
  require_document();

  if (distance <= 0.0) {
    throw std::runtime_error("Chamfer distance must be greater than zero");
  }
  if (edge_ids.empty()) {
    throw std::runtime_error("Chamfer requires at least one edge");
  }

  // Same single-body validation as create_fillet — see comment there
  // for why mixed-body selections aren't representable.
  const std::string owner_id = edge_owner_id(edge_ids.front());
  if (owner_id.empty()) {
    throw std::runtime_error("Malformed edge id: " + edge_ids.front());
  }
  for (const auto& edge_id : edge_ids) {
    const std::string id_owner = edge_owner_id(edge_id);
    if (id_owner.empty()) {
      throw std::runtime_error("Malformed edge id: " + edge_id);
    }
    if (id_owner != owner_id) {
      throw std::runtime_error(
          "Chamfer edges must all belong to the same body");
    }
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == owner_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Edge owner not found: " + owner_id);
  }

  push_undo_state();
  clear_redo_stack();

  ChamferFeatureParameters params{};
  params.target_body_id = owner_id;
  params.edge_ids = edge_ids;
  params.distance = distance;
  // Same rationale as create_fillet — see comment there.
  params.is_pending = true;

  std::ostringstream summary;
  summary << edge_ids.size() << " edge"
          << (edge_ids.size() == 1 ? "" : "s") << " · " << distance
          << " mm";

  FeatureEntry feature{
      .id = "feature-" + std::to_string(next_feature_id_++),
      .kind = "chamfer",
      .name = "Chamfer",
      .status = "healthy",
      .parameters_summary = summary.str(),
      .box_parameters = std::nullopt,
      .cylinder_parameters = std::nullopt,
      .extrude_parameters = std::nullopt,
      .sketch_parameters = std::nullopt,
      .fillet_parameters = std::nullopt,
      .chamfer_parameters = params,
  };
  document_->feature_history.push_back(std::move(feature));
  document_->selected_feature_id = document_->feature_history.back().id;
  // Same rationale as create_fillet: keep the chamfered edges
  // highlighted while the floating panel is open. See comment there.
  document_->selected_edge_ids = edge_ids;
  document_->selected_vertex_ids.clear();
  document_->selected_face_id = std::nullopt;
  document_->selected_reference_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_chamfer_edges(
    const std::string& feature_id,
    const std::vector<std::string>& edge_ids) {
  require_document();

  if (edge_ids.empty()) {
    throw std::runtime_error("Chamfer must keep at least one edge");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }
  if (feature_it->kind != "chamfer" ||
      !feature_it->chamfer_parameters.has_value()) {
    throw std::runtime_error(
        "update_chamfer_edges requires a chamfer feature: " + feature_id);
  }

  // See update_fillet_edges for the same-body invariant rationale.
  const std::string& target = feature_it->chamfer_parameters->target_body_id;
  for (const auto& edge_id : edge_ids) {
    const auto separator = edge_id.find(":edge:");
    if (separator == std::string::npos || separator == 0) {
      throw std::runtime_error("Malformed edge id: " + edge_id);
    }
    if (edge_id.substr(0, separator) != target) {
      throw std::runtime_error(
          "Chamfer edges must all belong to the same body");
    }
  }

  // See update_fillet_edges for why this command intentionally does
  // not push an undo step.
  feature_it->chamfer_parameters->edge_ids = edge_ids;
  std::ostringstream summary;
  summary << edge_ids.size() << " edge"
          << (edge_ids.size() == 1 ? "" : "s") << " · "
          << feature_it->chamfer_parameters->distance << " mm";
  feature_it->parameters_summary = summary.str();
  document_->selected_edge_ids = edge_ids;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_chamfer_distance(
    const std::string& feature_id, double distance) {
  require_document();

  if (distance <= 0.0) {
    throw std::runtime_error("Chamfer distance must be greater than zero");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }
  if (feature_it->kind != "chamfer" ||
      !feature_it->chamfer_parameters.has_value()) {
    throw std::runtime_error(
        "update_chamfer_distance requires a chamfer feature: " + feature_id);
  }

  // See update_fillet_edges for why this command intentionally does
  // not push an undo step.
  feature_it->chamfer_parameters->distance = distance;
  std::ostringstream summary;
  summary << feature_it->chamfer_parameters->edge_ids.size() << " edge"
          << (feature_it->chamfer_parameters->edge_ids.size() == 1 ? "" : "s")
          << " · " << distance << " mm";
  feature_it->parameters_summary = summary.str();
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::confirm_chamfer(const std::string& feature_id) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Feature not found: " + feature_id);
  }
  if (feature_it->kind != "chamfer" ||
      !feature_it->chamfer_parameters.has_value()) {
    throw std::runtime_error(
        "confirm_chamfer requires a chamfer feature: " + feature_id);
  }

  if (!feature_it->chamfer_parameters->is_pending) {
    return document_.value();
  }

  // See `confirm_fillet` for why this does not push an undo step.
  feature_it->chamfer_parameters->is_pending = false;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::start_sketch_on_face(
    const std::string& face_id,
    const SketchFeatureParameters::SketchPlaneFrame& plane_frame) {
  require_document();

  const std::string owner_id = face_owner_id(face_id);
  if (owner_id.empty()) {
    throw std::runtime_error("Sketch face not found: " + face_id);
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == owner_id; });
  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Sketch face owner not found: " + face_id);
  }

  push_undo_state();
  clear_redo_stack();

  document_->feature_history.push_back(
      create_sketch_feature(next_feature_id_++, face_id, plane_frame));
  const std::string sketch_feature_id = document_->feature_history.back().id;
  document_->selected_feature_id = std::nullopt;
  document_->selected_reference_id = std::nullopt;
  document_->selected_face_id = face_id;
  document_->active_sketch_plane_id = face_id;
  document_->active_sketch_face_id = face_id;
  document_->active_sketch_feature_id = sketch_feature_id;
  document_->active_sketch_tool = "select";
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_tool(const std::string& tool) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  if (!is_supported_sketch_tool(tool)) {
    throw std::runtime_error("Unsupported sketch tool: " + tool);
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  polysmith::core::set_sketch_tool(*feature_it, tool);
  document_->active_sketch_tool = tool;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

DocumentState DocumentManager::update_sketch_line(const std::string& line_id,
                                                  double start_x,
                                                  double start_y,
                                                  double end_x,
                                                  double end_y) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::update_sketch_line(
      *feature_it, line_id, start_x, start_y, end_x, end_y);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = line_id;
  document_->selected_sketch_dimension_id = "dim-line-" + line_id;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_sketch_point(const std::string& point_id,
                                                   double x,
                                                   double y) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::update_sketch_point(*feature_it, point_id, x, y);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = point_id;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_line_constraint(
    const std::string& line_id,
    const std::optional<std::string>& constraint) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_line_constraint(*feature_it, line_id, constraint);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = line_id;
  document_->selected_sketch_dimension_id = "dim-line-" + line_id;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_line_construction(
    const std::string& line_id,
    bool is_construction) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_line_construction(
      *feature_it, line_id, is_construction);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_entity_id = line_id;
  document_->selected_sketch_point_id = std::nullopt;
  // The auto length-dimension is removed when toggling to
  // construction. Clear the dimension selection if it pointed at it.
  if (document_->selected_sketch_dimension_id.has_value() &&
      document_->selected_sketch_dimension_id.value() ==
          "dim-line-" + line_id &&
      is_construction) {
    document_->selected_sketch_dimension_id = std::nullopt;
  }
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_midpoint_anchor(
    const std::string& point_id,
    const std::string& host_line_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_midpoint_anchor(
      *feature_it, point_id, host_line_id);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_point_line_anchor(
    const std::string& point_id,
    const std::string& host_line_id,
    double t) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_point_line_anchor(
      *feature_it, point_id, host_line_id, t);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_equal_length_constraint(
    const std::string& line_id,
    const std::optional<std::string>& other_line_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_equal_length_constraint(
      *feature_it, line_id, other_line_id);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = line_id;
  document_->selected_sketch_dimension_id = "dim-line-" + line_id;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_perpendicular_constraint(
    const std::string& line_id,
    const std::optional<std::string>& other_line_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_perpendicular_constraint(
      *feature_it, line_id, other_line_id);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = line_id;
  document_->selected_sketch_dimension_id = "dim-line-" + line_id;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

// Tiny helper used by all five mirror_preview wrappers — they
// all need to find the active sketch feature and bail out if
// there isn't one. Returns a non-const iterator into
// `feature_history` so the caller can mutate it.
namespace {
std::vector<FeatureEntry>::iterator require_active_sketch(
    DocumentState& document) {
  if (!document.active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }
  const auto& sketch_id = *document.active_sketch_feature_id;
  const auto feature_it = std::find_if(
      document.feature_history.begin(),
      document.feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == sketch_id; });
  if (feature_it == document.feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }
  return feature_it;
}
}  // namespace

DocumentState DocumentManager::start_mirror_preview() {
  require_document();
  const auto feature_it = require_active_sketch(*document_);
  // No undo push — preview state is transient and we don't want
  // it to clutter the undo history.
  polysmith::core::start_mirror_preview(*feature_it);
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_mirror_preview_axis(
    const std::string& axis_line_id) {
  require_document();
  const auto feature_it = require_active_sketch(*document_);
  polysmith::core::update_mirror_preview_axis(*feature_it, axis_line_id);
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_mirror_preview_objects(
    const std::vector<std::string>& object_ids) {
  require_document();
  const auto feature_it = require_active_sketch(*document_);
  polysmith::core::update_mirror_preview_objects(*feature_it, object_ids);
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::commit_mirror_preview() {
  require_document();
  const auto feature_it = require_active_sketch(*document_);
  // Commit is the only mirror_preview op that actually changes
  // permanent geometry, so it's the one that pushes an undo
  // state. Cancel/start/update don't write anything that needs
  // rolling back beyond the in-memory pending struct.
  push_undo_state();
  clear_redo_stack();
  polysmith::core::commit_mirror_preview(
      *feature_it, next_sketch_line_id_, next_sketch_circle_id_);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::cancel_mirror_preview() {
  require_document();
  const auto feature_it = require_active_sketch(*document_);
  polysmith::core::cancel_mirror_preview(*feature_it);
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_tangent_constraint(
    const std::string& line_id, const std::string& circle_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_tangent_constraint(
      *feature_it, line_id, circle_id);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_parallel_constraint(
    const std::string& line_id,
    const std::optional<std::string>& other_line_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_parallel_constraint(
      *feature_it, line_id, other_line_id);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = line_id;
  document_->selected_sketch_dimension_id = "dim-line-" + line_id;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_coincident_constraint(
    const std::string& point_id, const std::string& other_point_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_coincident_constraint(
      *feature_it, point_id, other_point_id);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = other_point_id;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::set_sketch_point_fixed(const std::string& point_id,
                                                      bool is_fixed) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::set_sketch_point_fixed(*feature_it, point_id, is_fixed);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = point_id;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_sketch_circle(const std::string& circle_id,
                                                    double center_x,
                                                    double center_y,
                                                    double radius) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::update_sketch_circle(
      *feature_it, circle_id, center_x, center_y, radius);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = circle_id;
  document_->selected_sketch_dimension_id = "dim-circle-" + circle_id;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::add_sketch_angle_dimension(
    const std::string& first_line_id,
    const std::string& second_line_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::add_sketch_angle_dimension(
      *feature_it, first_line_id, second_line_id);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::update_sketch_dimension(
    const std::string& dimension_id, double value) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::update_sketch_dimension(*feature_it, dimension_id, value);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  if (feature_it->sketch_parameters.has_value()) {
    const auto dimension_it = std::find_if(
        feature_it->sketch_parameters->dimensions.begin(),
        feature_it->sketch_parameters->dimensions.end(),
        [&](const SketchDimension& dimension) {
          return dimension.id == dimension_id;
        });

    if (dimension_it != feature_it->sketch_parameters->dimensions.end()) {
      document_->selected_sketch_entity_id = dimension_it->entity_id;
      document_->selected_sketch_dimension_id = dimension_it->id;
    }
  }
  bump_geometry_revision();
  return document_.value();
}

namespace {

std::vector<FeatureEntry>::iterator find_sketch_feature_owning_profile(
    std::vector<FeatureEntry>& features, const std::string& profile_id) {
  return std::find_if(
      features.begin(), features.end(), [&](const FeatureEntry& feature) {
        if (feature.kind != "sketch" || !feature.sketch_parameters.has_value()) {
          return false;
        }
        const auto& profiles = feature.sketch_parameters->profiles;
        return std::any_of(
            profiles.begin(), profiles.end(),
            [&](const SketchProfileRegion& profile) {
              return profile.id == profile_id;
            });
      });
}

}  // namespace

DocumentState DocumentManager::select_sketch_profile(const std::string& profile_id) {
  require_document();

  // Selection of profiles is allowed both inside and outside an active sketch.
  // The owning sketch feature is located by scanning the feature history.
  const auto feature_it = find_sketch_feature_owning_profile(
      document_->feature_history, profile_id);

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Sketch profile not found: " + profile_id);
  }

  const auto profile_it = std::find_if(
      feature_it->sketch_parameters->profiles.begin(),
      feature_it->sketch_parameters->profiles.end(),
      [&](const SketchProfileRegion& profile) { return profile.id == profile_id; });

  if (profile_it == feature_it->sketch_parameters->profiles.end()) {
    throw std::runtime_error("Sketch profile not found: " + profile_id);
  }

  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = profile_id;
  return document_.value();
}

DocumentState DocumentManager::extrude_profile(
    const std::string& profile_id,
    double depth,
    const std::string& mode,
    const std::optional<std::string>& target_body_id) {
  require_document();

  // Extrusion runs on any sketch profile in the document, even if its parent
  // sketch is finished (i.e. not the active sketch).
  const auto feature_it = find_sketch_feature_owning_profile(
      document_->feature_history, profile_id);

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Sketch profile not found: " + profile_id);
  }

  std::optional<ExtrudeFeatureParameters> extrude_parameters;

  for (const auto& profile : feature_it->sketch_parameters->profiles) {
    if (profile.id != profile_id || profile.kind != "polygon") {
      continue;
    }

    extrude_parameters = ExtrudeFeatureParameters{
        .sketch_feature_id = feature_it->id,
        .profile_id = profile_id,
        .plane_id = feature_it->sketch_parameters->plane_frame.has_value()
                        ? plane_id_from_frame(
                              feature_it->sketch_parameters->plane_frame.value())
                        : feature_it->sketch_parameters->plane_id,
        .plane_frame = feature_it->sketch_parameters->plane_frame.has_value()
                           ? std::optional<PlaneFrame>(
                                 make_plane_frame(
                                     feature_it->sketch_parameters->plane_frame.value()))
                           : std::nullopt,
        .profile_kind = "polygon",
        .start_x = 0.0,
        .start_y = 0.0,
        .width = 0.0,
        .height = 0.0,
        .radius = 0.0,
        .profile_points = profile.points,
        .depth = depth,
        .mode = mode,
        .target_body_id = target_body_id,
    };
    break;
  }

  if (!extrude_parameters.has_value()) {
    for (const auto& profile : feature_it->sketch_parameters->profiles) {
      if (profile.id != profile_id || profile.kind != "circle") {
        continue;
      }

      extrude_parameters = ExtrudeFeatureParameters{
          .sketch_feature_id = feature_it->id,
          .profile_id = profile_id,
          .plane_id = feature_it->sketch_parameters->plane_frame.has_value()
                          ? plane_id_from_frame(
                                feature_it->sketch_parameters->plane_frame.value())
                          : feature_it->sketch_parameters->plane_id,
          .plane_frame = feature_it->sketch_parameters->plane_frame.has_value()
                             ? std::optional<PlaneFrame>(
                                   make_plane_frame(
                                       feature_it->sketch_parameters->plane_frame.value()))
                             : std::nullopt,
          .profile_kind = "circle",
          .start_x = profile.center_x,
          .start_y = profile.center_y,
          .width = 0.0,
          .height = 0.0,
          .radius = profile.radius,
          .profile_points = {},
          .depth = depth,
          .mode = mode,
          .target_body_id = target_body_id,
      };

      if (feature_it->sketch_parameters->plane_id != "ref-plane-xy") {
        throw std::runtime_error(
            "Circle extrude currently supports the XY plane only");
      }
      break;
    }
  }

  if (!extrude_parameters.has_value()) {
    throw std::runtime_error("Sketch profile not found: " + profile_id);
  }

  // Auto-cut detection (Fusion-style): when the user invokes a default
  // new_body extrude on a profile whose swept volume overlaps an
  // existing body, silently promote the feature to a cut against that
  // body. Explicit modes (the user picked join/cut) are honored as-is.
  if (extrude_parameters->mode == "new_body" &&
      !extrude_parameters->target_body_id.has_value()) {
    const auto intersected =
        find_intersecting_body_for_extrude(*document_,
                                           extrude_parameters.value());
    if (intersected.has_value()) {
      extrude_parameters->mode = "cut";
      extrude_parameters->target_body_id = intersected;
    }
  }

  push_undo_state();
  clear_redo_stack();
  document_->feature_history.push_back(
      create_extrude_feature(next_feature_id_++, extrude_parameters.value()));
  document_->selected_feature_id = document_->feature_history.back().id;
  document_->selected_reference_id = std::nullopt;
  document_->active_sketch_plane_id = std::nullopt;
  document_->active_sketch_feature_id = std::nullopt;
  document_->active_sketch_tool = std::nullopt;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::add_sketch_line(double start_x,
                                               double start_y,
                                               double end_x,
                                               double end_y,
                                               bool is_construction) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::add_sketch_line(*feature_it,
                                   next_sketch_line_id_++,
                                   start_x,
                                   start_y,
                                   end_x,
                                   end_y,
                                   is_construction);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id =
      feature_it->sketch_parameters->lines.back().id;
  // Construction lines don't get an auto length dimension, so the
  // dimension list may be unchanged. Pick the dimension only if one
  // was actually created for this line; otherwise clear the
  // selection so the editor doesn't open on an unrelated dimension.
  const std::string expected_dim_id =
      "dim-line-" + feature_it->sketch_parameters->lines.back().id;
  const auto& dims = feature_it->sketch_parameters->dimensions;
  const auto dim_it = std::find_if(
      dims.begin(), dims.end(),
      [&](const SketchDimension& dim) { return dim.id == expected_dim_id; });
  document_->selected_sketch_dimension_id =
      dim_it != dims.end() ? std::optional<std::string>{dim_it->id}
                           : std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  document_->active_sketch_tool = "line";
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::add_sketch_rectangle(double start_x,
                                                    double start_y,
                                                    double end_x,
                                                    double end_y) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::add_sketch_rectangle(
      *feature_it, next_sketch_line_id_, start_x, start_y, end_x, end_y);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id =
      feature_it->sketch_parameters->lines.back().id;
  document_->selected_sketch_dimension_id =
      feature_it->sketch_parameters->dimensions.back().id;
  document_->selected_sketch_profile_id = std::nullopt;
  document_->active_sketch_tool = "rectangle";
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::add_sketch_arc(double start_x,
                                              double start_y,
                                              double end_x,
                                              double end_y,
                                              double anchor_x,
                                              double anchor_y,
                                              const std::string& mode) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  // Resolve (center, radius, ccw) up-front from whichever creation
  // mode the UI used. Doing it here keeps `polysmith::core::add_sketch_arc`
  // a pure constructor — it just stores the cached params we hand it.
  double center_x = 0.0;
  double center_y = 0.0;
  double radius = 0.0;
  double final_end_x = end_x;
  double final_end_y = end_y;
  bool ccw = true;

  if (mode == "three_point") {
    // Circumcenter of (start, end, anchor). Solved via the standard
    // perpendicular-bisector intersection:
    //   d = 2 * ((sx)(ey - ay) + (ex)(ay - sy) + (ax)(sy - ey))
    // Falls through to a degenerate-arc error when the three points
    // are colinear (d == 0) so the UI can surface the failure
    // instead of producing a malformed arc.
    const double sx = start_x;
    const double sy = start_y;
    const double ex = end_x;
    const double ey = end_y;
    const double ax = anchor_x;
    const double ay = anchor_y;
    const double d =
        2.0 * (sx * (ey - ay) + ex * (ay - sy) + ax * (sy - ey));
    if (std::abs(d) < 1e-9) {
      throw std::runtime_error(
          "Three-point arc: start, end, and anchor are colinear");
    }
    const double s2 = sx * sx + sy * sy;
    const double e2 = ex * ex + ey * ey;
    const double a2 = ax * ax + ay * ay;
    center_x =
        (s2 * (ey - ay) + e2 * (ay - sy) + a2 * (sy - ey)) / d;
    center_y =
        (s2 * (ax - ex) + e2 * (sx - ax) + a2 * (ex - sx)) / d;
    radius = std::hypot(start_x - center_x, start_y - center_y);
    // Sweep direction: CCW iff the signed area (start, anchor, end)
    // is positive. Matches "the anchor lies on the CCW arc from
    // start to end".
    const double cross =
        (anchor_x - start_x) * (end_y - start_y) -
        (anchor_y - start_y) * (end_x - start_x);
    ccw = cross > 0.0;
  } else if (mode == "center_start_end") {
    // anchor is the center; radius = |center - start|. We then
    // *snap* the user-supplied end point onto the resulting circle
    // by walking the angle direction from center→end and
    // re-projecting at radius distance — keeps the arc closed even
    // if the user's third click wasn't pixel-perfect.
    center_x = anchor_x;
    center_y = anchor_y;
    radius = std::hypot(start_x - center_x, start_y - center_y);
    // Mirrors the dimension-floor used elsewhere in sketch validation
    // (see `kMinimumSketchDimensionValue` in sketch_feature.cpp). Kept
    // as an inline literal here because the constant lives in a TU-
    // local anonymous namespace in sketch_feature.cpp; promoting it
    // to a header just for this one call site isn't worth the churn.
    constexpr double kArcMinimumDimension = 0.001;
    if (radius <= kArcMinimumDimension) {
      throw std::runtime_error("Center+start+end arc: radius is zero");
    }
    const double end_dx = end_x - center_x;
    const double end_dy = end_y - center_y;
    const double end_len = std::hypot(end_dx, end_dy);
    if (end_len <= kArcMinimumDimension) {
      throw std::runtime_error(
          "Center+start+end arc: end point coincides with center");
    }
    final_end_x = center_x + end_dx * radius / end_len;
    final_end_y = center_y + end_dy * radius / end_len;
    // CCW when going from start_angle to end_angle increases angle
    // (i.e. the cross product of the two radii is positive).
    const double cross =
        (start_x - center_x) * (final_end_y - center_y) -
        (start_y - center_y) * (final_end_x - center_x);
    ccw = cross > 0.0;
  } else {
    throw std::runtime_error("Unknown arc creation mode: " + mode);
  }

  push_undo_state();
  clear_redo_stack();

  // Endpoint points share the line counter so they live in a single
  // id space; arc id has its own counter.
  const int start_point_index = next_sketch_line_id_++;
  const int end_point_index = next_sketch_line_id_++;
  polysmith::core::add_sketch_arc(*feature_it,
                                  next_sketch_arc_id_++,
                                  start_point_index,
                                  end_point_index,
                                  start_x,
                                  start_y,
                                  final_end_x,
                                  final_end_y,
                                  center_x,
                                  center_y,
                                  radius,
                                  ccw);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id =
      feature_it->sketch_parameters->arcs.back().id;
  document_->selected_sketch_dimension_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::add_sketch_circle(double center_x,
                                                 double center_y,
                                                 double radius) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  polysmith::core::add_sketch_circle(
      *feature_it, next_sketch_circle_id_++, center_x, center_y, radius);
  refresh_linked_extrudes(*document_, *feature_it);
  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id =
      feature_it->sketch_parameters->circles.back().id;
  document_->selected_sketch_dimension_id =
      feature_it->sketch_parameters->dimensions.back().id;
  document_->selected_sketch_profile_id = std::nullopt;
  document_->active_sketch_tool = "circle";
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::select_sketch_point(const std::string& point_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end() ||
      !feature_it->sketch_parameters.has_value()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  const auto point_it = std::find_if(
      feature_it->sketch_parameters->points.begin(),
      feature_it->sketch_parameters->points.end(),
      [&](const SketchPoint& point) { return point.id == point_id; });
  if (point_it == feature_it->sketch_parameters->points.end()) {
    throw std::runtime_error("Sketch point not found: " + point_id);
  }

  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = point_id;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

DocumentState DocumentManager::select_sketch_entity(const std::string& entity_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end() ||
      !feature_it->sketch_parameters.has_value()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  const bool has_line = std::any_of(
      feature_it->sketch_parameters->lines.begin(),
      feature_it->sketch_parameters->lines.end(),
      [&](const SketchLine& line) { return line.id == entity_id; });
  const bool has_circle = std::any_of(
      feature_it->sketch_parameters->circles.begin(),
      feature_it->sketch_parameters->circles.end(),
      [&](const SketchCircle& circle) { return circle.id == entity_id; });

  if (!has_line && !has_circle) {
    throw std::runtime_error("Sketch entity not found: " + entity_id);
  }

  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = entity_id;
  const auto dimension_it = std::find_if(
      feature_it->sketch_parameters->dimensions.begin(),
      feature_it->sketch_parameters->dimensions.end(),
      [&](const SketchDimension& dimension) {
        return dimension.entity_id == entity_id;
      });
  document_->selected_sketch_dimension_id =
      dimension_it != feature_it->sketch_parameters->dimensions.end()
          ? std::make_optional(dimension_it->id)
          : std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

DocumentState DocumentManager::select_sketch_dimension(
    const std::string& dimension_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end() ||
      !feature_it->sketch_parameters.has_value()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  const auto dimension_it = std::find_if(
      feature_it->sketch_parameters->dimensions.begin(),
      feature_it->sketch_parameters->dimensions.end(),
      [&](const SketchDimension& dimension) { return dimension.id == dimension_id; });

  if (dimension_it == feature_it->sketch_parameters->dimensions.end()) {
    throw std::runtime_error("Sketch dimension not found: " + dimension_id);
  }

  document_->selected_feature_id = feature_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = dimension_it->entity_id;
  document_->selected_sketch_dimension_id = dimension_it->id;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

DocumentState DocumentManager::finish_sketch() {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch to finish");
  }

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Active sketch feature not found");
  }

  push_undo_state();
  clear_redo_stack();
  feature_it->status = "healthy";
  document_->selected_feature_id = feature_it->id;
  document_->selected_reference_id = std::nullopt;
  document_->active_sketch_plane_id = std::nullopt;
  document_->active_sketch_feature_id = std::nullopt;
  document_->active_sketch_tool = std::nullopt;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::reenter_sketch(const std::string& feature_id) {
  require_document();

  const auto feature_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) { return feature.id == feature_id; });

  if (feature_it == document_->feature_history.end()) {
    throw std::runtime_error("Sketch feature not found: " + feature_id);
  }

  if (feature_it->kind != "sketch" || !feature_it->sketch_parameters.has_value()) {
    throw std::runtime_error("Feature is not a sketch: " + feature_id);
  }

  // Re-entering does not push to undo: it only flips active flags, so undo
  // continues to refer to real geometry edits.
  document_->selected_feature_id = std::nullopt;
  document_->selected_reference_id = std::nullopt;
  document_->selected_face_id = std::nullopt;
  document_->selected_edge_ids.clear();
  document_->selected_vertex_ids.clear();
  document_->active_sketch_plane_id = feature_it->sketch_parameters->plane_id;
  // Face id information is not preserved separately in sketch_parameters; the
  // plane_id matches the face id when the sketch was created on a face, which
  // is sufficient for downstream consumers (viewport hides the sketch face,
  // raycasting is plane-frame based).
  document_->active_sketch_face_id =
      feature_it->sketch_parameters->plane_frame.has_value()
          ? std::optional<std::string>(feature_it->sketch_parameters->plane_id)
          : std::nullopt;
  document_->active_sketch_feature_id = feature_it->id;
  document_->active_sketch_tool = "select";
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();
  return document_.value();
}

DocumentState DocumentManager::project_face_into_sketch(
    const std::string& face_id) {
  require_document();

  if (!document_->active_sketch_feature_id.has_value()) {
    throw std::runtime_error("No active sketch");
  }

  const auto sketch_it = std::find_if(
      document_->feature_history.begin(),
      document_->feature_history.end(),
      [&](const FeatureEntry& feature) {
        return feature.id == document_->active_sketch_feature_id.value();
      });

  if (sketch_it == document_->feature_history.end() ||
      !sketch_it->sketch_parameters.has_value() ||
      !sketch_it->sketch_parameters->plane_frame.has_value()) {
    throw std::runtime_error(
        "Active sketch does not have a plane frame for projection");
  }

  // Don't project a face onto its own owning sketch — the sketch is on the
  // base plane of the extrude, so projecting the base back onto it would
  // overlay the original profile.
  const std::string separator = ":face:";
  const auto sep_pos = face_id.find(separator);
  if (sep_pos == std::string::npos) {
    throw std::runtime_error("Invalid face id: " + face_id);
  }
  const std::string face_owner_id = face_id.substr(0, sep_pos);

  // Walk extrude features that point at this sketch — projecting one of
  // their faces back onto the sketch is almost always a user mistake.
  for (const auto& feature : document_->feature_history) {
    if (feature.kind != "extrude" || !feature.extrude_parameters.has_value()) {
      continue;
    }
    if (feature.extrude_parameters->sketch_feature_id == sketch_it->id &&
        feature.id == face_owner_id) {
      throw std::runtime_error(
          "Cannot project a face from an extrude back onto its own source "
          "sketch");
    }
  }

  const auto outline = compute_face_outline(*document_, face_id);
  if (!outline.has_value()) {
    throw std::runtime_error(
        "Face is not supported by the projection helper: " + face_id);
  }

  const auto& sketch_frame = sketch_it->sketch_parameters->plane_frame.value();

  auto project_to_sketch_local =
      [&sketch_frame](const FaceOutlinePoint& world) -> std::pair<double, double> {
    const double dx = world.x - sketch_frame.origin_x;
    const double dy = world.y - sketch_frame.origin_y;
    const double dz = world.z - sketch_frame.origin_z;
    const double sx = dx * sketch_frame.x_axis_x + dy * sketch_frame.x_axis_y +
                      dz * sketch_frame.x_axis_z;
    const double sy = dx * sketch_frame.y_axis_x + dy * sketch_frame.y_axis_y +
                      dz * sketch_frame.y_axis_z;
    return {sx, sy};
  };

  push_undo_state();
  clear_redo_stack();

  if (outline->kind == "rectangle") {
    if (outline->rectangle_corners.size() != 4) {
      throw std::runtime_error("Rectangle outline must have four corners");
    }

    std::array<std::pair<double, double>, 4> local{};
    for (size_t i = 0; i < 4; ++i) {
      local[i] = project_to_sketch_local(outline->rectangle_corners[i]);
    }

    const size_t lines_before = sketch_it->sketch_parameters->lines.size();
    for (size_t i = 0; i < 4; ++i) {
      const auto& a = local[i];
      const auto& b = local[(i + 1) % 4];
      polysmith::core::add_sketch_line(*sketch_it,
                                       next_sketch_line_id_++,
                                       a.first,
                                       a.second,
                                       b.first,
                                       b.second);
    }

    // Lock every endpoint of the four projected lines so the user cannot
    // drag them away from their projected location. This mirrors Fusion's
    // "Project" behaviour where projected entities are derived geometry.
    for (size_t i = lines_before; i < sketch_it->sketch_parameters->lines.size();
         ++i) {
      const auto& line = sketch_it->sketch_parameters->lines[i];
      polysmith::core::set_sketch_point_fixed(*sketch_it,
                                              line.start_point_id,
                                              true);
      polysmith::core::set_sketch_point_fixed(*sketch_it,
                                              line.end_point_id,
                                              true);
    }
  } else if (outline->kind == "circle") {
    const auto center_local = project_to_sketch_local(outline->circle_center);
    polysmith::core::add_sketch_circle(*sketch_it,
                                       next_sketch_circle_id_++,
                                       center_local.first,
                                       center_local.second,
                                       outline->circle_radius);
  } else if (outline->kind == "polygon") {
    if (outline->polygon_corners.size() < 3) {
      throw std::runtime_error("Polygon outline must have at least 3 corners");
    }

    // Project every corner first, then add closed-loop sketch lines.
    std::vector<std::pair<double, double>> local;
    local.reserve(outline->polygon_corners.size());
    for (const auto& corner : outline->polygon_corners) {
      local.push_back(project_to_sketch_local(corner));
    }

    const size_t lines_before = sketch_it->sketch_parameters->lines.size();
    for (size_t i = 0; i < local.size(); ++i) {
      const auto& a = local[i];
      const auto& b = local[(i + 1) % local.size()];
      polysmith::core::add_sketch_line(*sketch_it,
                                       next_sketch_line_id_++,
                                       a.first,
                                       a.second,
                                       b.first,
                                       b.second);
    }

    // Lock every endpoint of the projected lines (same Fusion-like
    // "derived geometry" lock as the rectangle path).
    for (size_t i = lines_before; i < sketch_it->sketch_parameters->lines.size();
         ++i) {
      const auto& line = sketch_it->sketch_parameters->lines[i];
      polysmith::core::set_sketch_point_fixed(*sketch_it,
                                              line.start_point_id,
                                              true);
      polysmith::core::set_sketch_point_fixed(*sketch_it,
                                              line.end_point_id,
                                              true);
    }
  } else {
    throw std::runtime_error("Unsupported projected face kind: " + outline->kind);
  }

  refresh_linked_extrudes(*document_, *sketch_it);
  document_->selected_feature_id = sketch_it->id;
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  bump_geometry_revision();

  return document_.value();
}

DocumentState DocumentManager::clear_selection() {
  require_document();

  document_->selected_feature_id = std::nullopt;
  document_->selected_reference_id = std::nullopt;
  document_->selected_face_id = std::nullopt;
  document_->selected_edge_ids.clear();
  document_->selected_vertex_ids.clear();
  document_->selected_sketch_point_id = std::nullopt;
  document_->selected_sketch_entity_id = std::nullopt;
  document_->selected_sketch_dimension_id = std::nullopt;
  document_->selected_sketch_profile_id = std::nullopt;
  return document_.value();
}

ExportResult DocumentManager::export_document_as_step(
    const std::string& file_path) const {
  require_document();
  return polysmith::core::export_document_as_step(document_.value(), file_path);
}

ExportResult DocumentManager::export_document_as_stl(
    const std::string& file_path) const {
  require_document();
  return polysmith::core::export_document_as_stl(document_.value(), file_path);
}

namespace {

// Extract the trailing positive integer from id strings like "feature-12",
// "doc-3", "line-7". Returns 0 if no trailing integer is present.
int trailing_integer(const std::string& id) {
  size_t i = id.size();
  while (i > 0 && id[i - 1] >= '0' && id[i - 1] <= '9') {
    --i;
  }
  if (i == id.size()) {
    return 0;
  }
  try {
    return std::stoi(id.substr(i));
  } catch (...) {
    return 0;
  }
}

}  // namespace

void DocumentManager::save_document_to_path(const std::string& file_path) const {
  require_document();
  if (file_path.empty()) {
    throw std::runtime_error("Save path cannot be empty");
  }

  const nlohmann::json payload = polysmith::protocol::to_payload(document_.value());

  std::ofstream stream(file_path);
  if (!stream.is_open()) {
    throw std::runtime_error("Failed to open file for writing: " + file_path);
  }
  stream << payload.dump(2);
  if (!stream.good()) {
    throw std::runtime_error("Failed to write document to: " + file_path);
  }
}

DocumentState DocumentManager::load_document_from_path(
    const std::string& file_path) {
  if (file_path.empty()) {
    throw std::runtime_error("Load path cannot be empty");
  }

  std::ifstream stream(file_path);
  if (!stream.is_open()) {
    throw std::runtime_error("Failed to open file for reading: " + file_path);
  }
  std::stringstream buffer;
  buffer << stream.rdbuf();
  if (!stream.good() && !stream.eof()) {
    throw std::runtime_error("Failed to read document from: " + file_path);
  }

  nlohmann::json payload;
  try {
    payload = nlohmann::json::parse(buffer.str());
  } catch (const std::exception& error) {
    throw std::runtime_error(std::string("Document parse error: ") +
                             error.what());
  }

  DocumentState loaded = polysmith::protocol::document_from_payload(payload);

  // Replace the live document with the loaded one. Clear undo/redo, since
  // their previous contents reference a different document timeline.
  document_ = loaded;
  undo_stack_.clear();
  redo_stack_.clear();
  if (document_count_ == 0) {
    document_count_ = 1;
  }

  // Restore id counters so subsequent feature/sketch additions don't
  // collide with ids already present in the loaded document. Walk the
  // feature history and bump every counter to one past the highest seen
  // value.
  next_document_id_ = std::max(next_document_id_, trailing_integer(loaded.id) + 1);

  for (const auto& feature : loaded.feature_history) {
    next_feature_id_ = std::max(next_feature_id_, trailing_integer(feature.id) + 1);

    if (!feature.sketch_parameters.has_value()) {
      continue;
    }
    const auto& sketch = feature.sketch_parameters.value();
    for (const auto& line : sketch.lines) {
      next_sketch_line_id_ =
          std::max(next_sketch_line_id_, trailing_integer(line.id) + 1);
    }
    for (const auto& circle : sketch.circles) {
      next_sketch_circle_id_ =
          std::max(next_sketch_circle_id_, trailing_integer(circle.id) + 1);
    }
  }

  if (document_) {
    bump_geometry_revision();
  }

  return document_.value();
}

std::optional<DocumentState> DocumentManager::get_document() const {
  return document_;
}

SessionState DocumentManager::get_session_state() const {
  return SessionState{
      .document_count = document_count_,
      .active_document_id =
          document_.has_value() ? std::make_optional(document_->id) : std::nullopt,
      .can_undo = !undo_stack_.empty(),
      .can_redo = !redo_stack_.empty(),
  };
}

}  // namespace polysmith::core
