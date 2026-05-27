#include "core/body_compiler.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <unordered_map>
#include <utility>
#include <vector>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <BRepOffset_Mode.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_JoinType.hxx>
#include <NCollection_List.hxx>
#include <Poly_Triangulation.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "core/document.h"
#include "core/feature_shape.h"
#include "core/refresh_dependents.h"

namespace polysmith::core {
namespace {

constexpr double kLinearDeflection = 0.1;
constexpr double kAngularDeflection = 0.5;
constexpr double kPi = 3.14159265358979323846;

struct ParsedEdgeId {
  std::string body_id;
  int index = -1;
};

struct ThreadAxis {
  gp_Pnt start;
  gp_Dir direction;
  double length = 0.0;
};

std::optional<ParsedEdgeId> parse_edge_id(const std::string& id) {
  const std::string separator = ":edge:";
  const auto pos = id.find(separator);
  if (pos == std::string::npos) {
    return std::nullopt;
  }
  ParsedEdgeId parsed{};
  parsed.body_id = id.substr(0, pos);
  try {
    size_t consumed = 0;
    const std::string suffix = id.substr(pos + separator.size());
    parsed.index = std::stoi(suffix, &consumed);
    if (consumed != suffix.size() || parsed.index < 0) {
      return std::nullopt;
    }
  } catch (const std::exception&) {
    return std::nullopt;
  }
  return parsed;
}

TopoDS_Shape unify_same_domain(const TopoDS_Shape& shape) {
  if (shape.IsNull()) {
    return shape;
  }
  try {
    ShapeUpgrade_UnifySameDomain unify(shape,
                                       /*UnifyEdges=*/true,
                                       /*UnifyFaces=*/true,
                                       /*ConcatBSplines=*/false);
    unify.Build();
    const TopoDS_Shape unified = unify.Shape();
    if (!unified.IsNull()) {
      return unified;
    }
  } catch (const std::exception&) {
    // Keep the original boolean result if OCCT cannot merge domains.
  }
  return shape;
}

std::optional<ThreadAxis> resolve_thread_axis(
    const DocumentState& document,
    const std::string& source_id,
    const std::unordered_map<std::string, TopoDS_Shape>& body_shapes) {
  if (const auto parsed = parse_edge_id(source_id); parsed.has_value()) {
    const auto body_it = body_shapes.find(parsed->body_id);
    if (body_it == body_shapes.end() || body_it->second.IsNull()) {
      return std::nullopt;
    }
    TopTools_IndexedMapOfShape edge_map;
    TopExp::MapShapes(body_it->second, TopAbs_EDGE, edge_map);
    const int one_based = parsed->index + 1;
    if (one_based < 1 || one_based > edge_map.Extent()) {
      return std::nullopt;
    }
    const TopoDS_Edge edge = TopoDS::Edge(edge_map(one_based));
    if (edge.IsNull()) {
      return std::nullopt;
    }
    BRepAdaptor_Curve curve(edge);
    if (curve.GetType() != GeomAbs_Line) {
      return std::nullopt;
    }
    TopoDS_Vertex first;
    TopoDS_Vertex last;
    TopExp::Vertices(edge, first, last, /*CumOri=*/true);
    if (first.IsNull() || last.IsNull()) {
      return std::nullopt;
    }
    const gp_Pnt start = BRep_Tool::Pnt(first);
    const gp_Pnt end = BRep_Tool::Pnt(last);
    const gp_Vec span(start, end);
    if (span.SquareMagnitude() <= 1.0e-18) {
      return std::nullopt;
    }
    return ThreadAxis{
        .start = start,
        .direction = gp_Dir(span),
        .length = span.Magnitude(),
    };
  }

  const auto axis = resolve_construction_axis_source(document, source_id);
  if (!axis.has_value()) {
    return std::nullopt;
  }
  const gp_Pnt start(axis->start_x, axis->start_y, axis->start_z);
  const gp_Pnt end(axis->end_x, axis->end_y, axis->end_z);
  const gp_Vec span(start, end);
  if (span.SquareMagnitude() <= 1.0e-18) {
    return std::nullopt;
  }
  return ThreadAxis{
      .start = start,
      .direction = gp_Dir(span),
      .length = span.Magnitude(),
  };
}

std::optional<TopoDS_Wire> make_wire_from_points(
    const std::vector<gp_Pnt>& points) {
  if (points.size() < 2) {
    return std::nullopt;
  }
  BRepBuilderAPI_MakeWire wire_builder;
  for (size_t index = 1; index < points.size(); ++index) {
    if (points[index - 1].Distance(points[index]) <= 1.0e-9) {
      continue;
    }
    const TopoDS_Edge edge =
        BRepBuilderAPI_MakeEdge(points[index - 1], points[index]).Edge();
    if (edge.IsNull()) {
      return std::nullopt;
    }
    wire_builder.Add(edge);
  }
  if (!wire_builder.IsDone()) {
    return std::nullopt;
  }
  return wire_builder.Wire();
}

TopoDS_Shape make_thread_cutter_profile(const gp_Pnt& center,
                                        const gp_Pnt& axis_point,
                                        const gp_Vec& tangent,
                                        const ThreadFeatureParameters& params,
                                        double major_radius,
                                        double minor_radius,
                                        double half_width) {
  gp_Vec radial(axis_point, center);
  if (radial.SquareMagnitude() <= 1.0e-18 ||
      tangent.SquareMagnitude() <= 1.0e-18) {
    return TopoDS_Shape{};
  }
  radial.Normalize();
  gp_Vec width = tangent.Crossed(radial);
  if (width.SquareMagnitude() <= 1.0e-18) {
    return TopoDS_Shape{};
  }
  width.Normalize();

  const double center_radius = (major_radius + minor_radius) * 0.5;
  const double overshoot = std::max((major_radius - minor_radius) * 0.35, 0.02);
  gp_Pnt base_a;
  gp_Pnt base_b;
  gp_Pnt tip;
  if (params.mode == "internal") {
    const double inner_base = minor_radius - overshoot - center_radius;
    const double outer_tip = major_radius - center_radius;
    base_a = center.Translated(radial.Multiplied(inner_base))
                 .Translated(width.Multiplied(half_width));
    base_b = center.Translated(radial.Multiplied(inner_base))
                 .Translated(width.Reversed().Multiplied(half_width));
    tip = center.Translated(radial.Multiplied(outer_tip));
  } else {
    const double outer_base = major_radius + overshoot - center_radius;
    const double inner_tip = minor_radius - center_radius;
    base_a = center.Translated(radial.Multiplied(outer_base))
                 .Translated(width.Multiplied(half_width));
    base_b = center.Translated(radial.Multiplied(outer_base))
                 .Translated(width.Reversed().Multiplied(half_width));
    tip = center.Translated(radial.Multiplied(inner_tip));
  }

  BRepBuilderAPI_MakePolygon polygon;
  polygon.Add(base_a);
  polygon.Add(base_b);
  polygon.Add(tip);
  polygon.Close();
  if (!polygon.IsDone()) {
    return TopoDS_Shape{};
  }
  BRepBuilderAPI_MakeFace face(polygon.Wire());
  if (!face.IsDone()) {
    return TopoDS_Shape{};
  }
  return face.Face();
}

TopoDS_Shape build_thread_cutter(const ThreadAxis& axis,
                                 const ThreadFeatureParameters& params) {
  if (params.representation != "modeled" || params.pitch <= 0.0 ||
      params.length <= 0.0 || params.major_diameter <= 0.0) {
    return TopoDS_Shape{};
  }
  const double major_radius = params.major_diameter * 0.5;
  double minor_radius = params.minor_diameter > 0.0
                            ? params.minor_diameter * 0.5
                            : major_radius - params.pitch * 0.6;
  minor_radius = std::min(minor_radius, major_radius - 0.02);
  if (minor_radius <= 0.0) {
    return TopoDS_Shape{};
  }

  const double length =
      axis.length > 0.0
          ? std::min(params.length, std::max(0.0, axis.length - params.start_offset))
          : params.length;
  if (length <= 0.0) {
    return TopoDS_Shape{};
  }

  const gp_Vec axis_vec(axis.direction);
  gp_Vec seed(0.0, 1.0, 0.0);
  if (std::abs(axis_vec.Normalized().Dot(seed)) > 0.9) {
    seed = gp_Vec(1.0, 0.0, 0.0);
  }
  gp_Vec u = axis_vec.Crossed(seed);
  if (u.SquareMagnitude() <= 1.0e-18) {
    return TopoDS_Shape{};
  }
  u.Normalize();
  gp_Vec v = axis_vec.Crossed(u);
  if (v.SquareMagnitude() <= 1.0e-18) {
    return TopoDS_Shape{};
  }
  v.Normalize();

  const double helix_radius = (major_radius + minor_radius) * 0.5;
  const double direction_sign = params.handedness == "left" ? -1.0 : 1.0;
  const int steps =
      std::max(32, std::min(1800, static_cast<int>(
                                      std::ceil((length / params.pitch) * 48.0))));
  std::vector<gp_Pnt> points;
  points.reserve(static_cast<size_t>(steps + 1));
  for (int index = 0; index <= steps; ++index) {
    const double t = static_cast<double>(index) / static_cast<double>(steps);
    const double along = params.start_offset + length * t;
    const double angle = direction_sign * 2.0 * kPi * (along / params.pitch);
    gp_Vec offset = axis_vec.Multiplied(along);
    offset += u.Multiplied(std::cos(angle) * helix_radius);
    offset += v.Multiplied(std::sin(angle) * helix_radius);
    points.push_back(axis.start.Translated(offset));
  }

  const auto wire = make_wire_from_points(points);
  if (!wire.has_value() || points.size() < 2) {
    return TopoDS_Shape{};
  }
  const gp_Vec tangent(points[0], points[1]);
  const gp_Pnt axis_point = axis.start.Translated(
      axis_vec.Multiplied(params.start_offset));
  const double half_width = std::min(params.pitch * 0.30, major_radius * 0.24);
  const TopoDS_Shape profile =
      make_thread_cutter_profile(points.front(),
                                 axis_point,
                                 tangent,
                                 params,
                                 major_radius,
                                 minor_radius,
                                 half_width);
  if (profile.IsNull()) {
    return TopoDS_Shape{};
  }

  try {
    BRepOffsetAPI_MakePipe pipe(wire.value(), profile);
    pipe.Build();
    if (!pipe.IsDone()) {
      return TopoDS_Shape{};
    }
    return pipe.Shape();
  } catch (const Standard_Failure&) {
    return TopoDS_Shape{};
  }
}

TopoDS_Shape apply_thread(const TopoDS_Shape& body_shape,
                          const ThreadFeatureParameters& params,
                          const ThreadAxis& axis) {
  const TopoDS_Shape cutter = build_thread_cutter(axis, params);
  if (body_shape.IsNull() || cutter.IsNull()) {
    return body_shape;
  }
  try {
    const TopoDS_Shape result = BRepAlgoAPI_Cut(body_shape, cutter).Shape();
    return result.IsNull() ? body_shape : unify_same_domain(result);
  } catch (const Standard_Failure&) {
    return body_shape;
  }
}

// Triangulate `shape` and accumulate world-space vertices/indices/normals
// into `out`. Each face is processed independently so we get per-face
// flat normals which read well as a default "matte solid" look in the
// viewport.
void tessellate_shape(const TopoDS_Shape& shape, BodyMesh& out) {
  if (shape.IsNull()) {
    return;
  }

  BRepMesh_IncrementalMesh mesher(shape,
                                  kLinearDeflection,
                                  /*isRelative=*/false,
                                  kAngularDeflection,
                                  /*isInParallel=*/true);
  if (!mesher.IsDone()) {
    throw std::runtime_error("BRepMesh_IncrementalMesh failed");
  }

  for (TopExp_Explorer face_explorer(shape, TopAbs_FACE);
       face_explorer.More();
       face_explorer.Next()) {
    const TopoDS_Face& face = TopoDS::Face(face_explorer.Current());
    TopLoc_Location location;
    const Handle(Poly_Triangulation) triangulation =
        BRep_Tool::Triangulation(face, location);
    if (triangulation.IsNull()) {
      continue;
    }

    const gp_Trsf transform = location.Transformation();
    const bool reversed = face.Orientation() == TopAbs_REVERSED;
    const int base_index = static_cast<int>(out.vertices.size() / 3);
    const int node_count = triangulation->NbNodes();

    // Append every node of the face's triangulation, transformed into
    // world space.
    for (int node_index = 1; node_index <= node_count; ++node_index) {
      gp_Pnt node = triangulation->Node(node_index);
      node.Transform(transform);
      out.vertices.push_back(node.X());
      out.vertices.push_back(node.Y());
      out.vertices.push_back(node.Z());
    }

    // Append placeholder normals; we'll fill them in below per triangle.
    for (int node_index = 1; node_index <= node_count; ++node_index) {
      out.normals.push_back(0.0);
      out.normals.push_back(0.0);
      out.normals.push_back(0.0);
    }

    const int triangle_count = triangulation->NbTriangles();
    for (int tri_index = 1; tri_index <= triangle_count; ++tri_index) {
      const Poly_Triangle& triangle = triangulation->Triangle(tri_index);
      int n1 = 0;
      int n2 = 0;
      int n3 = 0;
      triangle.Get(n1, n2, n3);
      if (reversed) {
        std::swap(n2, n3);
      }
      const int i1 = base_index + (n1 - 1);
      const int i2 = base_index + (n2 - 1);
      const int i3 = base_index + (n3 - 1);
      out.indices.push_back(i1);
      out.indices.push_back(i2);
      out.indices.push_back(i3);

      // Compute a per-triangle normal and accumulate onto each vertex
      // of the triangle. After processing all triangles we leave the
      // normals un-renormalized; three.js's flat shading material works
      // either way and the magnitudes don't drive lighting anyway.
      const auto get = [&](int vertex_index) {
        return std::array<double, 3>{
            out.vertices[3 * vertex_index + 0],
            out.vertices[3 * vertex_index + 1],
            out.vertices[3 * vertex_index + 2],
        };
      };
      const auto a = get(i1);
      const auto b = get(i2);
      const auto c = get(i3);
      const double ux = b[0] - a[0];
      const double uy = b[1] - a[1];
      const double uz = b[2] - a[2];
      const double vx = c[0] - a[0];
      const double vy = c[1] - a[1];
      const double vz = c[2] - a[2];
      const double nx = uy * vz - uz * vy;
      const double ny = uz * vx - ux * vz;
      const double nz = ux * vy - uy * vx;
      const double length = std::sqrt(nx * nx + ny * ny + nz * nz);
      const double inv = length > 0.0 ? 1.0 / length : 0.0;
      const double normalized_x = nx * inv;
      const double normalized_y = ny * inv;
      const double normalized_z = nz * inv;
      for (int vi : {i1, i2, i3}) {
        out.normals[3 * vi + 0] += normalized_x;
        out.normals[3 * vi + 1] += normalized_y;
        out.normals[3 * vi + 2] += normalized_z;
      }
    }
  }
}

// Parse the trailing index out of an edge id formatted as
// "<owner_body_id>:edge:<index>". Returns -1 if the id doesn't match the
// expected shape — callers treat that as "skip this edge" rather than
// erroring out so a stale id from the UI degrades gracefully into a no-op.
int parse_edge_index(const std::string& edge_id) {
  const std::string marker = ":edge:";
  const auto pos = edge_id.rfind(marker);
  if (pos == std::string::npos) {
    return -1;
  }
  try {
    return std::stoi(edge_id.substr(pos + marker.size()));
  } catch (const std::exception&) {
    return -1;
  }
}

int parse_face_index(const std::string& face_id) {
  const std::string marker = ":face:";
  const auto pos = face_id.rfind(marker);
  if (pos == std::string::npos) {
    return -1;
  }
  try {
    return std::stoi(face_id.substr(pos + marker.size()));
  } catch (const std::exception&) {
    return -1;
  }
}

// Apply a fillet feature onto an existing body shape. Returns the new
// shape on success, or `body_shape` unchanged on any failure (missing
// edges, OCCT failure, etc.) so the document keeps rendering.
TopoDS_Shape apply_fillet(const TopoDS_Shape& body_shape,
                          const FilletFeatureParameters& params) {
  if (body_shape.IsNull() || params.edge_ids.empty() || params.radius <= 0.0) {
    return body_shape;
  }

  TopTools_IndexedMapOfShape edge_map;
  TopExp::MapShapes(body_shape, TopAbs_EDGE, edge_map);

  try {
    BRepFilletAPI_MakeFillet maker(body_shape);
    bool any_added = false;
    for (const std::string& edge_id : params.edge_ids) {
      const int zero_based = parse_edge_index(edge_id);
      const int one_based = zero_based + 1;
      if (zero_based < 0 || one_based < 1 || one_based > edge_map.Extent()) {
        continue;
      }
      const TopoDS_Edge edge = TopoDS::Edge(edge_map(one_based));
      maker.Add(params.radius, edge);
      any_added = true;
    }
    if (!any_added) {
      return body_shape;
    }
    maker.Build();
    if (!maker.IsDone()) {
      return body_shape;
    }
    const TopoDS_Shape result = maker.Shape();
    if (result.IsNull()) {
      return body_shape;
    }
    return result;
  } catch (const std::exception&) {
    return body_shape;
  }
}

TopoDS_Shape apply_chamfer(const TopoDS_Shape& body_shape,
                           const ChamferFeatureParameters& params) {
  if (body_shape.IsNull() || params.edge_ids.empty() ||
      params.distance <= 0.0) {
    return body_shape;
  }

  TopTools_IndexedMapOfShape edge_map;
  TopExp::MapShapes(body_shape, TopAbs_EDGE, edge_map);

  try {
    BRepFilletAPI_MakeChamfer maker(body_shape);
    bool any_added = false;
    for (const std::string& edge_id : params.edge_ids) {
      const int zero_based = parse_edge_index(edge_id);
      const int one_based = zero_based + 1;
      if (zero_based < 0 || one_based < 1 || one_based > edge_map.Extent()) {
        continue;
      }
      const TopoDS_Edge edge = TopoDS::Edge(edge_map(one_based));
      // Symmetric chamfer: same distance on both adjacent faces. The
      // single-arg Add overload uses the edge's first adjacent face,
      // which is fine for symmetric chamfers.
      maker.Add(params.distance, edge);
      any_added = true;
    }
    if (!any_added) {
      return body_shape;
    }
    maker.Build();
    if (!maker.IsDone()) {
      return body_shape;
    }
    const TopoDS_Shape result = maker.Shape();
    if (result.IsNull()) {
      return body_shape;
    }
    return result;
  } catch (const std::exception&) {
    return body_shape;
  }
}

TopoDS_Shape apply_shell(const TopoDS_Shape& body_shape,
                         const ShellFeatureParameters& params) {
  if (body_shape.IsNull() || params.thickness <= 0.0 ||
      params.removed_face_ids.empty()) {
    return body_shape;
  }

  TopTools_IndexedMapOfShape face_map;
  TopExp::MapShapes(body_shape, TopAbs_FACE, face_map);

  try {
    NCollection_List<TopoDS_Shape> closing_faces;
    for (const std::string& face_id : params.removed_face_ids) {
      const int zero_based = parse_face_index(face_id);
      const int one_based = zero_based + 1;
      if (zero_based < 0 || one_based < 1 || one_based > face_map.Extent()) {
        continue;
      }
      closing_faces.Append(TopoDS::Face(face_map(one_based)));
    }
    if (closing_faces.IsEmpty()) {
      return body_shape;
    }

    BRepOffsetAPI_MakeThickSolid maker;
    maker.MakeThickSolidByJoin(body_shape,
                               closing_faces,
                               -std::abs(params.thickness),
                               1.0e-3,
                               BRepOffset_Skin,
                               false,
                               false,
                               GeomAbs_Arc,
                               true);
    maker.Build();
    if (!maker.IsDone()) {
      return body_shape;
    }
    const TopoDS_Shape result = maker.Shape();
    if (result.IsNull()) {
      return body_shape;
    }
    return result;
  } catch (const std::exception&) {
    return body_shape;
  }
}

TopoDS_Shape apply_hole(const TopoDS_Shape& body_shape,
                        const HoleFeatureParameters& params) {
  if (body_shape.IsNull()) {
    return body_shape;
  }
  try {
    const TopoDS_Shape cutter = build_hole_cutter_shape(params);
    if (cutter.IsNull()) {
      return body_shape;
    }
    TopoDS_Shape result = BRepAlgoAPI_Cut(body_shape, cutter).Shape();
    if (result.IsNull()) {
      return body_shape;
    }
    result = unify_same_domain(result);
    if (!params.thread_enabled ||
        params.thread_representation != "modeled" ||
        params.thread_pitch <= 0.0 ||
        params.major_diameter <= 0.0 ||
        params.minor_diameter <= 0.0) {
      return result;
    }

    const gp_Pnt face_center(
        params.plane_frame.origin_x +
            params.plane_frame.x_axis_x * params.center_x +
            params.plane_frame.y_axis_x * params.center_y,
        params.plane_frame.origin_y +
            params.plane_frame.x_axis_y * params.center_x +
            params.plane_frame.y_axis_y * params.center_y,
        params.plane_frame.origin_z +
            params.plane_frame.x_axis_z * params.center_x +
            params.plane_frame.y_axis_z * params.center_y);
    gp_Vec inward(-params.plane_frame.normal_x,
                  -params.plane_frame.normal_y,
                  -params.plane_frame.normal_z);
    if (inward.SquareMagnitude() <= 1.0e-18) {
      return result;
    }
    inward.Normalize();
    ThreadFeatureParameters thread{};
    thread.target_body_id = params.target_body_id;
    thread.axis_source_id = params.source_face_id;
    thread.mode = "internal";
    thread.standard = params.standard;
    thread.size = params.standard_size;
    thread.major_diameter = params.major_diameter;
    thread.minor_diameter = params.minor_diameter;
    thread.pitch = params.thread_pitch;
    thread.length = std::min(std::abs(params.thread_depth),
                             params.extent_type == "through_all"
                                 ? std::max(10000.0, std::abs(params.depth))
                                 : std::abs(params.depth));
    thread.thread_angle_degrees = 60.0;
    thread.start_offset = 0.0;
    thread.handedness = "right";
    thread.representation = "modeled";
    const ThreadAxis axis{
        .start = face_center,
        .direction = gp_Dir(inward),
        .length = thread.length,
    };
    return apply_thread(result, thread, axis);
  } catch (const std::exception&) {
    return body_shape;
  }
}

}  // namespace

CompiledBodies compile_bodies(const DocumentState& document) {
  CompiledBodies result;

  // Body root id, in insertion order. We use a parallel vector instead of
  // an ordered map because we need stable "most recent body" semantics:
  // when an extrude is in cut/join mode it targets the body that was the
  // most-recently created or modified.
  std::vector<std::string> body_order;
  std::unordered_map<std::string, TopoDS_Shape> body_shapes;
  // When a fillet/chamfer feature with `is_pending=true` is replayed
  // we capture the body shape *before* the op was applied. The
  // viewport later enumerates body edges from this shape so edge ids
  // stay stable for the duration of the panel session, even though
  // the post-op shape (used for visual rendering) keeps mutating as
  // the user toggles edges. Cleared per-body when a non-pending op
  // overwrites that body. See FilletFeatureParameters::is_pending.
  std::unordered_map<std::string, TopoDS_Shape> body_pick_shapes;

  // First pass: detect whether any body needs the native mesh path. If
  // not we still need per-body shapes for downstream callers (export),
  // but we skip tessellation since legacy primitives will render the
  // viewport. This keeps the cost path-dependent.
  bool any_boolean = false;
  for (const auto& feature : document.feature_history) {
    if (feature.suppressed) {
      continue;
    }
    if (feature.dependency_broken || feature.status == "warning") {
      continue;
    }
    if (feature.kind == "extrude" &&
        feature.extrude_parameters.has_value()) {
      if (feature.extrude_parameters->mode != "new_body") {
        any_boolean = true;
        break;
      }
      // Negative-depth extrudes also force the mesh path: the legacy
      // polygon-extrude primitive renderer assumes a positive depth in
      // the +normal direction, so a negative depth would render in the
      // wrong place. The body_compiler always produces the right body
      // shape regardless of sign.
      if (feature.extrude_parameters->depth < 0.0) {
        any_boolean = true;
        break;
      }
      // Circle extrudes can be created on arbitrary sketch planes.
      // The legacy cylinder primitive only knows the old world-Y axis
      // layout, so use OCCT tessellation for circular profiles.
      if (feature.extrude_parameters->profile_kind == "circle") {
        any_boolean = true;
        break;
      }
      // Profile holes, multi-profile, thin, and side-based extrudes are
      // real native-core topology. The legacy three.js polygon-extrude
      // preview can show simple prisms, but OCCT tessellation is the
      // authoritative path for rings, disjoint same-plane regions, and
      // advanced extents.
      // topology. The legacy three.js polygon-extrude preview can show
      // simple prisms, but OCCT tessellation is the authoritative path
      // for rings and disjoint same-plane regions.
      const auto& params = feature.extrude_parameters.value();
      const bool has_additional_holes = std::any_of(
          params.additional_inner_loops.begin(),
          params.additional_inner_loops.end(),
          [](const auto& loops) { return !loops.empty(); });
      if (!params.inner_loops.empty() ||
          !params.additional_profile_points.empty() ||
          has_additional_holes ||
          params.thin.enabled ||
          params.extent_mode != "one_side" ||
          params.side1.start_offset != 0.0 ||
          params.side1.taper_angle_degrees != 0.0 ||
          params.side1.extent_type != "distance" ||
          params.side2.has_value()) {
        any_boolean = true;
        break;
      }
    }
    if (feature.kind == "fillet" || feature.kind == "chamfer" ||
        feature.kind == "shell" || feature.kind == "hole" ||
        feature.kind == "fastener") {
      // Body-modifying features always produce a mesh body (they modify an
      // existing OCCT shape in ways the legacy primitive renderers
      // can't replicate), so they always trigger the mesh path.
      any_boolean = true;
      break;
    }
    if (feature.kind == "thread" && feature.thread_parameters.has_value() &&
        feature.thread_parameters->representation == "modeled") {
      any_boolean = true;
      break;
    }
    if (feature.kind == "loft" || feature.kind == "revolve" ||
        feature.kind == "sweep") {
      any_boolean = true;
      break;
    }
  }

  for (const auto& feature : document.feature_history) {
    // Suppressed features participate neither in body building nor in
    // the consumed-feature accounting downstream. The legacy primitive
    // renderer skips them via the same flag, so a suppressed box just
    // disappears until unsuppressed.
    if (feature.suppressed) {
      continue;
    }
    if (feature.dependency_broken || feature.status == "warning") {
      continue;
    }
    // Fillet / chamfer modify an existing body in place rather than
    // emitting a new shape, so they're handled here before falling
    // through to the shape-building path used for box/cylinder/extrude.
    if (feature.kind == "fillet" && feature.fillet_parameters.has_value()) {
      const auto& params = feature.fillet_parameters.value();
      // Resolve target body: prefer the explicit target, otherwise fall
      // back to the most recent body. If neither resolves to an existing
      // body the feature is a no-op (the user likely deleted the body).
      std::string target_id;
      if (!params.target_body_id.empty() &&
          body_shapes.find(params.target_body_id) != body_shapes.end()) {
        target_id = params.target_body_id;
      } else if (!body_order.empty()) {
        target_id = body_order.back();
      } else {
        continue;
      }
      const TopoDS_Shape pre_shape = body_shapes[target_id];
      const TopoDS_Shape next = apply_fillet(pre_shape, params);
      body_shapes[target_id] = next;
      // Pending feature: keep the pre-op shape around so the viewport
      // can pick edges against a stable topology. Non-pending features
      // overwrite (and effectively clear) any prior pick_shape on this
      // body, since once confirmed the body's edge identity follows
      // the new post-op topology.
      if (params.is_pending) {
        body_pick_shapes[target_id] = pre_shape;
      } else {
        body_pick_shapes.erase(target_id);
      }
      result.consumed_feature_ids.insert(feature.id);
      // Refresh "most recent body" so subsequent boolean ops target the
      // post-fillet shape.
      if (!body_order.empty() && body_order.back() != target_id) {
        for (auto it = body_order.begin(); it != body_order.end(); ++it) {
          if (*it == target_id) {
            body_order.erase(it);
            break;
          }
        }
        body_order.push_back(target_id);
      }
      continue;
    }
    if (feature.kind == "chamfer" && feature.chamfer_parameters.has_value()) {
      const auto& params = feature.chamfer_parameters.value();
      std::string target_id;
      if (!params.target_body_id.empty() &&
          body_shapes.find(params.target_body_id) != body_shapes.end()) {
        target_id = params.target_body_id;
      } else if (!body_order.empty()) {
        target_id = body_order.back();
      } else {
        continue;
      }
      const TopoDS_Shape pre_shape = body_shapes[target_id];
      const TopoDS_Shape next = apply_chamfer(pre_shape, params);
      body_shapes[target_id] = next;
      // Same pending-shape logic as fillet — see the matching comment
      // a few lines above.
      if (params.is_pending) {
        body_pick_shapes[target_id] = pre_shape;
      } else {
        body_pick_shapes.erase(target_id);
      }
      result.consumed_feature_ids.insert(feature.id);
      if (!body_order.empty() && body_order.back() != target_id) {
        for (auto it = body_order.begin(); it != body_order.end(); ++it) {
          if (*it == target_id) {
            body_order.erase(it);
            break;
          }
        }
        body_order.push_back(target_id);
      }
      continue;
    }
    if (feature.kind == "shell" && feature.shell_parameters.has_value()) {
      const auto& params = feature.shell_parameters.value();
      std::string target_id;
      if (!params.target_body_id.empty() &&
          body_shapes.find(params.target_body_id) != body_shapes.end()) {
        target_id = params.target_body_id;
      } else if (!body_order.empty()) {
        target_id = body_order.back();
      } else {
        continue;
      }
      const TopoDS_Shape pre_shape = body_shapes[target_id];
      const TopoDS_Shape next = apply_shell(pre_shape, params);
      body_shapes[target_id] = next;
      if (params.is_pending) {
        body_pick_shapes[target_id] = pre_shape;
      } else {
        body_pick_shapes.erase(target_id);
      }
      result.consumed_feature_ids.insert(feature.id);
      if (!body_order.empty() && body_order.back() != target_id) {
        for (auto it = body_order.begin(); it != body_order.end(); ++it) {
          if (*it == target_id) {
            body_order.erase(it);
            break;
          }
        }
        body_order.push_back(target_id);
      }
      continue;
    }
    if (feature.kind == "hole" && feature.hole_parameters.has_value()) {
      const auto& params = feature.hole_parameters.value();
      std::string target_id;
      if (!params.target_body_id.empty() &&
          body_shapes.find(params.target_body_id) != body_shapes.end()) {
        target_id = params.target_body_id;
      } else if (!body_order.empty()) {
        target_id = body_order.back();
      } else {
        continue;
      }
      const TopoDS_Shape pre_shape = body_shapes[target_id];
      body_shapes[target_id] = apply_hole(pre_shape, params);
      result.consumed_feature_ids.insert(feature.id);
      result.consumed_feature_ids.insert(target_id);
      body_pick_shapes.erase(target_id);
      if (!body_order.empty() && body_order.back() != target_id) {
        for (auto it = body_order.begin(); it != body_order.end(); ++it) {
          if (*it == target_id) {
            body_order.erase(it);
            break;
          }
        }
        body_order.push_back(target_id);
      }
      continue;
    }
    if (feature.kind == "thread" && feature.thread_parameters.has_value()) {
      const auto& params = feature.thread_parameters.value();
      if (params.representation == "modeled") {
        std::string target_id;
        if (!params.target_body_id.empty() &&
            body_shapes.find(params.target_body_id) != body_shapes.end()) {
          target_id = params.target_body_id;
        } else if (!body_order.empty()) {
          target_id = body_order.back();
        } else {
          result.consumed_feature_ids.insert(feature.id);
          continue;
        }
        const auto axis = resolve_thread_axis(document,
                                              params.axis_source_id,
                                              body_shapes);
        if (axis.has_value()) {
          body_shapes[target_id] =
              apply_thread(body_shapes[target_id], params, axis.value());
          body_pick_shapes.erase(target_id);
          if (!body_order.empty() && body_order.back() != target_id) {
            for (auto it = body_order.begin(); it != body_order.end(); ++it) {
              if (*it == target_id) {
                body_order.erase(it);
                break;
              }
            }
            body_order.push_back(target_id);
          }
        }
        result.consumed_feature_ids.insert(target_id);
      }
      result.consumed_feature_ids.insert(feature.id);
      continue;
    }

    const TopoDS_Shape shape = build_feature_shape(feature);
    if (shape.IsNull()) {
      continue;
    }

    std::string mode = "new_body";
    if (feature.kind == "extrude" && feature.extrude_parameters.has_value()) {
      mode = feature.extrude_parameters->mode;
    }

    if (mode != "new_body" && !body_order.empty()) {
      // Honor an explicit target_body_id when set and still present in
      // the current body set; otherwise fall back to the most recent
      // body. This keeps boolean ops well-defined even when prior body
      // roots were consumed by a more recent boolean further upstream.
      std::string target_id = body_order.back();
      if (feature.kind == "extrude" &&
          feature.extrude_parameters.has_value() &&
          feature.extrude_parameters->target_body_id.has_value()) {
        const std::string& requested =
            feature.extrude_parameters->target_body_id.value();
        if (body_shapes.find(requested) != body_shapes.end()) {
          target_id = requested;
        }
      }
      const TopoDS_Shape target_shape = body_shapes[target_id];

      TopoDS_Shape combined;
      try {
        if (mode == "join") {
          combined = BRepAlgoAPI_Fuse(target_shape, shape).Shape();
        } else if (mode == "cut") {
          combined = BRepAlgoAPI_Cut(target_shape, shape).Shape();
        } else if (mode == "intersect") {
          combined = BRepAlgoAPI_Common(target_shape, shape).Shape();
        } else {
          throw std::runtime_error("Unknown extrude mode: " + mode);
        }
      } catch (const std::exception&) {
        // Swallow boolean failures — fall back to a fresh body so the
        // user still sees their geometry instead of an opaque error.
        combined = shape;
      }

      if (combined.IsNull()) {
        // Boolean failure: degrade to an independent body so the user
        // still sees the new geometry.
        body_shapes[feature.id] = shape;
        body_order.push_back(feature.id);
        continue;
      }
      combined = unify_same_domain(combined);

      const bool intersect_as_new_body =
          mode == "intersect" &&
          feature.kind == "extrude" &&
          feature.extrude_parameters.has_value() &&
          feature.extrude_parameters->intersect_result == "new_body";
      if (intersect_as_new_body) {
        body_shapes[feature.id] = combined;
        body_order.push_back(feature.id);
        result.consumed_feature_ids.insert(feature.id);
        continue;
      }

      body_shapes[target_id] = combined;
      // A boolean op replaced the body's topology, so any stale
      // pending-fillet pick shape no longer reflects what the user is
      // looking at. Clear it so edge picks resolve against the current
      // body shape from here on.
      body_pick_shapes.erase(target_id);
      result.consumed_feature_ids.insert(feature.id);
      result.consumed_feature_ids.insert(target_id);
      // The combined body is now the most recent body for the purpose
      // of "most recent" fallbacks downstream — bring its id to the
      // back of body_order if it's not already there.
      if (!body_order.empty() && body_order.back() != target_id) {
        for (auto it = body_order.begin(); it != body_order.end(); ++it) {
          if (*it == target_id) {
            body_order.erase(it);
            break;
          }
        }
        body_order.push_back(target_id);
      }
    } else {
      body_shapes[feature.id] = shape;
      body_order.push_back(feature.id);
    }
  }

  for (const auto& body_id : body_order) {
    CompiledBody body{};
    body.id = body_id;
    body.shape = body_shapes[body_id];
    const auto pick_it = body_pick_shapes.find(body_id);
    if (pick_it != body_pick_shapes.end()) {
      body.pick_shape = pick_it->second;
    }
    result.bodies.push_back(body);
  }

  if (!any_boolean) {
    return result;
  }

  // Tessellate every body — including independent ones — so the viewport
  // can render them all consistently when at least one boolean op is in
  // play. (Mixing legacy primitives and meshes for the same scene is
  // jarring, and the cost is dominated by the boolean op anyway.)
  for (const auto& body : result.bodies) {
    BodyMesh mesh{};
    mesh.body_id = body.id;
    try {
      tessellate_shape(body.shape, mesh);
    } catch (const std::exception&) {
      // Skip the failing body rather than aborting the whole viewport
      // build; users will see other bodies render correctly.
      mesh.vertices.clear();
      mesh.indices.clear();
      mesh.normals.clear();
    }
    if (!mesh.vertices.empty() && !mesh.indices.empty()) {
      result.meshes.push_back(std::move(mesh));
      // Once a mesh exists for this body, suppress the legacy primitive
      // for its root feature so we don't double-render.
      result.consumed_feature_ids.insert(body.id);
    }
  }

  return result;
}

}  // namespace polysmith::core
