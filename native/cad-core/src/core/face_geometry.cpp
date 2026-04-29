#include "core/face_geometry.h"

#include <algorithm>

#include <BRepAdaptor_Curve.hxx>
#include <BRep_Tool.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <GeomAbs_CurveType.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Circ.hxx>
#include <gp_Pnt.hxx>

#include "core/body_compiler.h"
#include "core/document.h"

namespace polysmith::core {
namespace {

struct ParsedFaceId {
  std::string owner_id;
  std::string suffix;
};

std::optional<ParsedFaceId> parse_face_id(const std::string& face_id) {
  // Expected layout: "{owner_id}:face:{suffix}".
  const std::string separator = ":face:";
  const auto pos = face_id.find(separator);
  if (pos == std::string::npos) {
    return std::nullopt;
  }
  return ParsedFaceId{
      .owner_id = face_id.substr(0, pos),
      .suffix = face_id.substr(pos + separator.size()),
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

// Compute a world-space point from a plane frame's local (u, v) coordinates
// plus an offset along the plane's normal.
FaceOutlinePoint plane_to_world(const PlaneFrame& frame,
                                double u,
                                double v,
                                double w) {
  return FaceOutlinePoint{
      .x = frame.origin_x + frame.x_axis_x * u + frame.y_axis_x * v +
           frame.normal_x * w,
      .y = frame.origin_y + frame.x_axis_y * u + frame.y_axis_y * v +
           frame.normal_y * w,
      .z = frame.origin_z + frame.x_axis_z * u + frame.y_axis_z * v +
           frame.normal_z * w,
  };
}

std::optional<FaceOutline> outline_for_extrude(
    const ExtrudeFeatureParameters& parameters,
    const std::string& suffix) {
  if (!parameters.plane_frame.has_value()) {
    // Legacy origin-plane extrudes (no plane_frame) are not supported by
    // the projection helper yet.
    return std::nullopt;
  }
  const PlaneFrame& frame = parameters.plane_frame.value();
  const double depth = parameters.depth;

  if (parameters.profile_kind == "rectangle") {
    const double u0 = parameters.start_x;
    const double v0 = parameters.start_y;
    const double u1 = parameters.start_x + parameters.width;
    const double v1 = parameters.start_y + parameters.height;

    auto rectangle_at_offset = [&](double offset) {
      FaceOutline outline{};
      outline.kind = "rectangle";
      outline.rectangle_corners = {
          plane_to_world(frame, u0, v0, offset),
          plane_to_world(frame, u1, v0, offset),
          plane_to_world(frame, u1, v1, offset),
          plane_to_world(frame, u0, v1, offset),
      };
      return outline;
    };

    if (suffix == "base") {
      return rectangle_at_offset(0.0);
    }
    if (suffix == "top") {
      return rectangle_at_offset(depth);
    }

    // Side faces of a rectangular extrude. Each side spans one base edge
    // (length L) and the depth axis (height D), so the four corners are:
    //   (edge_start, 0), (edge_end, 0), (edge_end, depth), (edge_start, depth)
    // expressed in the (u/v base plane, normal) frame.
    auto side_face = [&](double su, double sv, double eu, double ev) {
      FaceOutline outline{};
      outline.kind = "rectangle";
      outline.rectangle_corners = {
          plane_to_world(frame, su, sv, 0.0),
          plane_to_world(frame, eu, ev, 0.0),
          plane_to_world(frame, eu, ev, depth),
          plane_to_world(frame, su, sv, depth),
      };
      return outline;
    };

    if (suffix == "front") {
      return side_face(u0, v0, u1, v0);
    }
    if (suffix == "back") {
      return side_face(u0, v1, u1, v1);
    }
    if (suffix == "left") {
      return side_face(u0, v0, u0, v1);
    }
    if (suffix == "right") {
      return side_face(u1, v0, u1, v1);
    }

    return std::nullopt;
  }

  if (parameters.profile_kind == "circle") {
    if (suffix != "top" && suffix != "base") {
      return std::nullopt;
    }
    const double offset = suffix == "top" ? depth : 0.0;
    FaceOutline outline{};
    outline.kind = "circle";
    outline.circle_center =
        plane_to_world(frame, parameters.start_x, parameters.start_y, offset);
    outline.circle_axis = FaceOutlinePoint{
        .x = frame.normal_x,
        .y = frame.normal_y,
        .z = frame.normal_z,
    };
    outline.circle_radius = parameters.radius;
    return outline;
  }

  // Polygon profiles are not yet supported by Project.
  return std::nullopt;
}

// Returns true when `suffix` parses as a non-negative integer — that's
// the body-derived face id format ("<body_id>:face:<index>"), distinct
// from the legacy named suffixes ("top", "base", "side-N", etc.).
bool suffix_is_numeric_index(const std::string& suffix, int& index_out) {
  if (suffix.empty()) {
    return false;
  }
  try {
    size_t consumed = 0;
    const int value = std::stoi(suffix, &consumed);
    if (consumed != suffix.size() || value < 0) {
      return false;
    }
    index_out = value;
    return true;
  } catch (const std::exception&) {
    return false;
  }
}

// Walk `face`'s outer wire and produce a world-space outline. Detects:
//   - a wire with a single circle edge -> "circle" outline
//   - everything else -> "polygon" outline (line segments only;
//     curved edges are sampled by their two endpoints, which is a
//     reasonable approximation when the user projects a face whose
//     outer wire happens to include arcs).
// Returns nullopt only when the wire couldn't be walked at all.
std::optional<FaceOutline> outline_from_face(const TopoDS_Face& face) {
  TopoDS_Wire outer;
  try {
    outer = BRepTools::OuterWire(face);
  } catch (const std::exception&) {
    return std::nullopt;
  }
  if (outer.IsNull()) {
    return std::nullopt;
  }

  // Collect edges in order around the wire so the projected polygon's
  // corners follow the face's actual outline.
  std::vector<TopoDS_Edge> ordered_edges;
  for (BRepTools_WireExplorer explorer(outer); explorer.More();
       explorer.Next()) {
    ordered_edges.push_back(TopoDS::Edge(explorer.Current()));
  }
  if (ordered_edges.empty()) {
    return std::nullopt;
  }

  // Special-case a single-circle wire so circular cap faces project as
  // sketch circles (the natural representation) instead of dense
  // polygons.
  if (ordered_edges.size() == 1) {
    try {
      BRepAdaptor_Curve curve(ordered_edges.front());
      if (curve.GetType() == GeomAbs_Circle) {
        const gp_Circ circle = curve.Circle();
        FaceOutline outline{};
        outline.kind = "circle";
        const gp_Pnt center = circle.Location();
        outline.circle_center = FaceOutlinePoint{
            .x = center.X(), .y = center.Y(), .z = center.Z()};
        const gp_Dir axis = circle.Axis().Direction();
        outline.circle_axis = FaceOutlinePoint{
            .x = axis.X(), .y = axis.Y(), .z = axis.Z()};
        outline.circle_radius = circle.Radius();
        return outline;
      }
    } catch (const std::exception&) {
      // Fall through to polygon path.
    }
  }

  FaceOutline outline{};
  outline.kind = "polygon";

  // Walk edges in wire order; each edge contributes its first vertex
  // (with respect to the wire's traversal) to the corner list. The
  // last vertex of the last edge closes the loop and matches corner[0]
  // for a watertight wire — the projector adds that closing line.
  for (const auto& edge : ordered_edges) {
    if (edge.IsNull()) {
      continue;
    }
    TopoDS_Vertex first_vertex;
    TopoDS_Vertex last_vertex;
    TopExp::Vertices(edge, first_vertex, last_vertex,
                     /*CumOri=*/true);
    if (first_vertex.IsNull()) {
      continue;
    }
    const gp_Pnt point = BRep_Tool::Pnt(first_vertex);
    outline.polygon_corners.push_back(
        FaceOutlinePoint{.x = point.X(), .y = point.Y(), .z = point.Z()});
  }

  if (outline.polygon_corners.size() < 3) {
    return std::nullopt;
  }

  return outline;
}

// Resolve a numeric face id ("<body_id>:face:<index>") by recompiling
// bodies, finding the body whose root id matches `body_id`, and walking
// `TopExp::MapShapes(TopAbs_FACE)` to retrieve the requested face. The
// recompile mirrors what the viewport already does — it's the source of
// truth for body topology, so it's also the source of truth for face
// resolution.
std::optional<FaceOutline> outline_for_body_face(
    const DocumentState& document,
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
    return outline_from_face(face);
  }
  return std::nullopt;
}

}  // namespace

std::optional<FaceOutline> compute_face_outline(const DocumentState& document,
                                                const std::string& face_id) {
  const auto parsed = parse_face_id(face_id);
  if (!parsed.has_value()) {
    return std::nullopt;
  }

  // Body-derived face ids ship a numeric index suffix. Resolve those
  // through the OCCT body shape so projections work for booleaned,
  // filleted, chamfered, and plane-frame-rotated faces.
  int face_index = -1;
  if (suffix_is_numeric_index(parsed->suffix, face_index)) {
    return outline_for_body_face(document, parsed->owner_id, face_index);
  }

  // Legacy named-suffix face ids: handled per source feature.
  const FeatureEntry* feature = find_feature(document, parsed->owner_id);
  if (feature == nullptr) {
    return std::nullopt;
  }

  if (feature->kind == "extrude" && feature->extrude_parameters.has_value()) {
    return outline_for_extrude(feature->extrude_parameters.value(),
                               parsed->suffix);
  }

  // Box and cylinder source features are placed in viewport-space using a
  // running x-offset and are not supported by the projection helper yet.
  return std::nullopt;
}

}  // namespace polysmith::core
