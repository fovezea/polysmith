#include "core/sketch_profile.h"

#include <algorithm>
#include <cmath>
#include <deque>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace polysmith::core {
namespace {

constexpr double kProfileTolerance = 0.01;
// Per-arc sample count when materializing a closed loop into a
// polyline. 16 segments per arc gives a visually smooth approximation
// at typical sketch scales while keeping the resulting polygon cheap
// for OCCT to extrude. We sample uniformly in arc parameter (angle)
// regardless of arc sweep size; tiny arcs end up with tightly-spaced
// samples and large arcs with widely-spaced ones, which is fine.
constexpr int kArcSampleSegments = 16;
// Local copy of pi — `M_PI` is non-standard (POSIX-only) and
// `std::numbers::pi` is C++20-only. Defining it here keeps this file
// portable without committing the rest of the codebase to either.
constexpr double kPi = 3.14159265358979323846;

bool nearly_equal(double left, double right) {
  return std::abs(left - right) <= kProfileTolerance;
}

bool points_match(const SketchProfilePoint& left, const SketchProfilePoint& right) {
  return nearly_equal(left.x, right.x) && nearly_equal(left.y, right.y);
}

long long quantize_coordinate(double value) {
  return std::llround(value / kProfileTolerance);
}

std::string make_node_key(const SketchProfilePoint& point) {
  return std::to_string(quantize_coordinate(point.x)) + ":" +
         std::to_string(quantize_coordinate(point.y));
}

double polygon_signed_area(const std::vector<SketchProfilePoint>& points) {
  if (points.size() < 3) {
    return 0.0;
  }

  double area = 0.0;
  for (size_t index = 0; index < points.size(); ++index) {
    const auto& current = points[index];
    const auto& next = points[(index + 1) % points.size()];
    area += current.x * next.y - next.x * current.y;
  }

  return area * 0.5;
}

std::string make_polygon_profile_id(const std::vector<std::string>& edge_ids) {
  std::vector<std::string> sorted_ids = edge_ids;
  std::sort(sorted_ids.begin(), sorted_ids.end());

  std::ostringstream stream;
  stream << "profile-poly";
  for (const auto& id : sorted_ids) {
    stream << "-" << id;
  }
  return stream.str();
}

// Generic edge wrapper used by the loop detector so a single graph
// algorithm walks both lines and arcs uniformly. `kind == Arc` means
// the cached arc params (center / radius / ccw) are populated; lines
// leave them at zero.
struct ProfileEdge {
  enum class Kind { Line, Arc };

  std::string id;
  Kind kind;
  std::string start_point_id;
  std::string end_point_id;
  double start_x;
  double start_y;
  double end_x;
  double end_y;
  // Arc-only fields (zeroed for lines).
  double center_x = 0.0;
  double center_y = 0.0;
  double radius = 0.0;
  bool ccw = false;
};

ProfileEdge profile_edge_from_line(const SketchLine& line) {
  return ProfileEdge{
      .id = line.id,
      .kind = ProfileEdge::Kind::Line,
      .start_point_id = line.start_point_id,
      .end_point_id = line.end_point_id,
      .start_x = line.start_x,
      .start_y = line.start_y,
      .end_x = line.end_x,
      .end_y = line.end_y,
  };
}

ProfileEdge profile_edge_from_arc(const SketchArc& arc) {
  return ProfileEdge{
      .id = arc.id,
      .kind = ProfileEdge::Kind::Arc,
      .start_point_id = arc.start_point_id,
      .end_point_id = arc.end_point_id,
      .start_x = arc.start_x,
      .start_y = arc.start_y,
      .end_x = arc.end_x,
      .end_y = arc.end_y,
      .center_x = arc.center_x,
      .center_y = arc.center_y,
      .radius = arc.radius,
      .ccw = arc.ccw,
  };
}

std::string edge_node_id(const ProfileEdge& edge, bool is_start) {
  const std::string& point_id =
      is_start ? edge.start_point_id : edge.end_point_id;
  if (!point_id.empty()) {
    return point_id;
  }
  return make_node_key({
      .x = is_start ? edge.start_x : edge.end_x,
      .y = is_start ? edge.start_y : edge.end_y,
  });
}

// Sample interior points of an arc walked from `from` to `to`,
// excluding both endpoints. The result is the (kArcSampleSegments-1)
// intermediate samples in walk order, ready to slot between the
// endpoint vertices in the polygon point list. We parameterize on
// signed sweep angle: the arc's stored ccw direction tells us which
// way start→end goes; if the loop walk crosses the arc end-to-start
// instead, we just reverse `forward` so the sweep direction matches.
std::vector<SketchProfilePoint> sample_arc_interior(
    const ProfileEdge& edge, bool from_start) {
  std::vector<SketchProfilePoint> samples;
  if (edge.kind != ProfileEdge::Kind::Arc) {
    return samples;
  }

  const double start_angle =
      std::atan2(edge.start_y - edge.center_y, edge.start_x - edge.center_x);
  const double end_angle =
      std::atan2(edge.end_y - edge.center_y, edge.end_x - edge.center_x);

  // Compute the signed sweep from start_angle to end_angle along
  // the stored ccw direction. We normalize into (0, 2π) so a full-
  // circle sweep doesn't collapse to zero.
  double sweep = end_angle - start_angle;
  if (edge.ccw) {
    while (sweep <= 0.0) {
      sweep += 2.0 * kPi;
    }
  } else {
    while (sweep >= 0.0) {
      sweep -= 2.0 * kPi;
    }
  }

  // If we're walking the arc in reverse (loop entered at end_point
  // and exits at start_point) we still sample the same geometric
  // points but in reverse order. Compute samples forward, reverse
  // at the end if needed.
  for (int i = 1; i < kArcSampleSegments; ++i) {
    const double t = static_cast<double>(i) / kArcSampleSegments;
    const double angle = start_angle + sweep * t;
    samples.push_back(SketchProfilePoint{
        .x = edge.center_x + edge.radius * std::cos(angle),
        .y = edge.center_y + edge.radius * std::sin(angle),
    });
  }

  if (!from_start) {
    std::reverse(samples.begin(), samples.end());
  }
  return samples;
}

struct EdgeLoopCandidate {
  std::vector<SketchProfilePoint> points;
  std::vector<std::string> point_ids;
  std::vector<std::string> edge_ids;
};

std::optional<EdgeLoopCandidate> detect_edge_loop(
    const std::vector<ProfileEdge>& edges) {
  if (edges.size() < 2) {
    // A polygon needs at least 3 edges, but a loop made of two arcs
    // (e.g. a stadium half) is also valid. Two lines can't enclose
    // an area, so 2-line components fail the area test below; arcs
    // can pass on the area test, so we accept >=2 here and let the
    // signed-area gate filter degenerate cases.
    return std::nullopt;
  }

  std::map<std::string, SketchProfilePoint> nodes;
  std::map<std::string, std::vector<size_t>> adjacency;
  std::vector<std::pair<std::string, std::string>> edge_nodes;

  for (size_t index = 0; index < edges.size(); ++index) {
    const auto& edge = edges[index];
    const SketchProfilePoint start{.x = edge.start_x, .y = edge.start_y};
    const SketchProfilePoint end{.x = edge.end_x, .y = edge.end_y};

    if (points_match(start, end)) {
      return std::nullopt;
    }

    const std::string start_key = edge_node_id(edge, true);
    const std::string end_key = edge_node_id(edge, false);
    const auto [start_it, inserted_start] = nodes.emplace(start_key, start);
    const auto [end_it, inserted_end] = nodes.emplace(end_key, end);
    const bool start_uses_fallback_key = edge.start_point_id.empty();
    const bool end_uses_fallback_key = edge.end_point_id.empty();
    if ((!inserted_start && start_uses_fallback_key &&
         !points_match(start_it->second, start)) ||
        (!inserted_end && end_uses_fallback_key &&
         !points_match(end_it->second, end))) {
      return std::nullopt;
    }
    adjacency[start_key].push_back(index);
    adjacency[end_key].push_back(index);
    edge_nodes.push_back({start_key, end_key});
  }

  if (nodes.size() != edges.size()) {
    return std::nullopt;
  }

  for (const auto& [node_key, incident_edges] : adjacency) {
    if (incident_edges.size() != 2) {
      return std::nullopt;
    }
  }

  std::vector<SketchProfilePoint> ordered_points;
  std::vector<std::string> ordered_point_ids;
  std::vector<std::string> ordered_edge_ids;
  std::set<size_t> visited_edges;

  std::string current_node = edge_nodes.front().first;

  while (visited_edges.size() < edges.size()) {
    const auto adjacency_it = adjacency.find(current_node);
    if (adjacency_it == adjacency.end()) {
      return std::nullopt;
    }

    const auto next_edge_it = std::find_if(
        adjacency_it->second.begin(),
        adjacency_it->second.end(),
        [&](size_t edge_index) { return !visited_edges.contains(edge_index); });

    if (next_edge_it == adjacency_it->second.end()) {
      return std::nullopt;
    }

    const size_t edge_index = *next_edge_it;
    visited_edges.insert(edge_index);
    const auto& edge = edges[edge_index];

    // Push the start vertex of this edge in walk direction. The next
    // edge's iteration will push the next vertex, and so on around
    // the loop.
    ordered_points.push_back(nodes.at(current_node));
    ordered_point_ids.push_back(current_node);
    ordered_edge_ids.push_back(edge.id);

    // For arc edges, also push the interior samples so the polygon
    // approximates the arc when extruded. Direction matters: if the
    // loop walk enters at start_point_id we sample forward; if it
    // enters at end_point_id we sample reversed.
    if (edge.kind == ProfileEdge::Kind::Arc) {
      const bool from_start = current_node == edge_nodes[edge_index].first;
      const auto interior = sample_arc_interior(edge, from_start);
      // Interior samples don't have stable point ids — use a synthetic
      // one anchored to the arc id and the sample index so consumers
      // that group by point id can still distinguish them. They're
      // not user-meaningful and don't appear as snap targets.
      for (size_t i = 0; i < interior.size(); ++i) {
        ordered_points.push_back(interior[i]);
        ordered_point_ids.push_back(
            "arc-sample-" + edge.id + "-" + std::to_string(i));
      }
    }

    const auto& [start_key, end_key] = edge_nodes[edge_index];
    current_node = start_key == current_node ? end_key : start_key;
  }

  if (!points_match(nodes.at(edge_nodes.front().first),
                    nodes.at(current_node))) {
    return std::nullopt;
  }

  const double area = polygon_signed_area(ordered_points);
  if (std::abs(area) <= kProfileTolerance) {
    return std::nullopt;
  }

  if (area < 0.0) {
    std::reverse(ordered_points.begin(), ordered_points.end());
  }

  return EdgeLoopCandidate{
      .points = ordered_points,
      .point_ids = ordered_point_ids,
      .edge_ids = ordered_edge_ids,
  };
}

std::vector<std::vector<ProfileEdge>> split_edge_components(
    const std::vector<ProfileEdge>& edges) {
  std::map<std::string, std::vector<size_t>> node_to_edges;
  std::vector<std::pair<std::string, std::string>> edge_nodes;

  for (size_t index = 0; index < edges.size(); ++index) {
    const auto& edge = edges[index];
    const std::string start_key = edge_node_id(edge, true);
    const std::string end_key = edge_node_id(edge, false);
    node_to_edges[start_key].push_back(index);
    node_to_edges[end_key].push_back(index);
    edge_nodes.push_back({start_key, end_key});
  }

  std::set<size_t> visited_edges;
  std::vector<std::vector<ProfileEdge>> components;

  for (size_t start_index = 0; start_index < edges.size(); ++start_index) {
    if (visited_edges.contains(start_index)) {
      continue;
    }

    std::deque<size_t> frontier = {start_index};
    std::vector<ProfileEdge> component;

    while (!frontier.empty()) {
      const size_t edge_index = frontier.front();
      frontier.pop_front();

      if (visited_edges.contains(edge_index)) {
        continue;
      }

      visited_edges.insert(edge_index);
      component.push_back(edges[edge_index]);

      const auto& [start_key, end_key] = edge_nodes[edge_index];
      for (const auto& node_key : {start_key, end_key}) {
        const auto adjacency_it = node_to_edges.find(node_key);
        if (adjacency_it == node_to_edges.end()) {
          continue;
        }

        for (size_t adjacent_edge_index : adjacency_it->second) {
          if (!visited_edges.contains(adjacent_edge_index)) {
            frontier.push_back(adjacent_edge_index);
          }
        }
      }
    }

    components.push_back(component);
  }

  return components;
}

}  // namespace

std::vector<SketchProfileRegion> build_sketch_profile_regions(
    const SketchFeatureParameters& parameters) {
  std::vector<SketchProfileRegion> profiles;

  // Construction lines are reference geometry only — they should not
  // close profile loops. Arcs don't have a construction-line analogue
  // yet (v1 ships with solid arcs only), but the future flag would
  // be applied here in the same way.
  std::vector<ProfileEdge> solid_edges;
  solid_edges.reserve(parameters.lines.size() + parameters.arcs.size());
  for (const auto& line : parameters.lines) {
    if (!line.is_construction) {
      solid_edges.push_back(profile_edge_from_line(line));
    }
  }
  for (const auto& arc : parameters.arcs) {
    if (!arc.is_construction) {
      solid_edges.push_back(profile_edge_from_arc(arc));
    }
  }

  for (const auto& component : split_edge_components(solid_edges)) {
    if (const auto loop = detect_edge_loop(component); loop.has_value()) {
      profiles.push_back(SketchProfileRegion{
          .id = make_polygon_profile_id(loop->edge_ids),
          .kind = "polygon",
          .point_ids = loop->point_ids,
          // `line_ids` historically held line ids; with arcs in the
          // mix this field carries mixed line + arc edge ids. The
          // downstream UI uses it to compute "which entities does
          // this profile depend on" for cascade-delete, which works
          // as long as the ids resolve to entities.
          .line_ids = loop->edge_ids,
          .points = loop->points,
          .source_circle_id = std::nullopt,
          .center_x = 0.0,
          .center_y = 0.0,
          .radius = 0.0,
      });
    }
  }

  for (const auto& circle : parameters.circles) {
    profiles.push_back(SketchProfileRegion{
        .id = "profile-circle-" + circle.id,
        .kind = "circle",
        .point_ids = {"point-circle-" + circle.id + "-center"},
        .line_ids = {},
        .points = {},
        .source_circle_id = circle.id,
        .center_x = circle.center_x,
        .center_y = circle.center_y,
        .radius = circle.radius,
    });
  }

  return profiles;
}

DetectedSketchProfiles detect_sketch_profiles(const FeatureEntry& feature) {
  DetectedSketchProfiles profiles;

  if (feature.kind != "sketch" || !feature.sketch_parameters.has_value()) {
    return profiles;
  }

  const auto& sketch = feature.sketch_parameters.value();

  for (const auto& profile : sketch.profiles) {
    if (profile.kind == "polygon") {
      profiles.polygons.push_back(PolygonSketchProfile{
          .id = profile.id,
          .plane_id = sketch.plane_id,
          .plane_frame = sketch.plane_frame,
          .points = profile.points,
      });
      continue;
    }

    if (profile.kind == "circle") {
      profiles.circles.push_back(CircleSketchProfile{
          .id = profile.id,
          .plane_id = sketch.plane_id,
          .plane_frame = sketch.plane_frame,
          .center_x = profile.center_x,
          .center_y = profile.center_y,
          .radius = profile.radius,
      });
    }
  }

  return profiles;
}

}  // namespace polysmith::core
