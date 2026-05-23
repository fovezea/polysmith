#include "core/snap_engine.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <unordered_set>

namespace polysmith::core {
namespace {

// Compute the distance between two sketch-plane points.
double point_distance(double x1, double y1, double x2, double y2) {
  const double dx = x2 - x1;
  const double dy = y2 - y1;
  return std::sqrt(dx * dx + dy * dy);
}

// Find all endpoint snaps on lines.
void collect_line_endpoint_candidates(
    const SketchFeatureParameters& sketch,
    double cursor_x,
    double cursor_y,
    double tolerance,
    const SelectionFilter& filter,
    std::vector<SnapCandidate>& candidates) {
  for (const auto& line : sketch.lines) {
    if (line.is_construction && !filter.select_construction) {
      continue;
    }
    // Start point
    {
      const double d = point_distance(cursor_x, cursor_y, line.start_x, line.start_y);
      if (d <= tolerance) {
        candidates.push_back(SnapCandidate{
            .kind = "endpoint",
            .entity_id = line.id,
            .point_id = line.start_point_id,
            .local_x = line.start_x,
            .local_y = line.start_y,
            .distance = d,
            .label = "Endpoint",
        });
      }
    }
    // End point
    {
      const double d = point_distance(cursor_x, cursor_y, line.end_x, line.end_y);
      if (d <= tolerance) {
        candidates.push_back(SnapCandidate{
            .kind = "endpoint",
            .entity_id = line.id,
            .point_id = line.end_point_id,
            .local_x = line.end_x,
            .local_y = line.end_y,
            .distance = d,
            .label = "Endpoint",
        });
      }
    }
  }
}

// Find all endpoint snaps on arcs.
void collect_arc_endpoint_candidates(
    const SketchFeatureParameters& sketch,
    double cursor_x,
    double cursor_y,
    double tolerance,
    const SelectionFilter& filter,
    std::vector<SnapCandidate>& candidates) {
  for (const auto& arc : sketch.arcs) {
    if (arc.is_construction && !filter.select_construction) {
      continue;
    }
    {
      const double d = point_distance(cursor_x, cursor_y, arc.start_x, arc.start_y);
      if (d <= tolerance) {
        candidates.push_back(SnapCandidate{
            .kind = "endpoint",
            .entity_id = arc.id,
            .point_id = arc.start_point_id,
            .local_x = arc.start_x,
            .local_y = arc.start_y,
            .distance = d,
            .label = "Endpoint",
        });
      }
    }
    {
      const double d = point_distance(cursor_x, cursor_y, arc.end_x, arc.end_y);
      if (d <= tolerance) {
        candidates.push_back(SnapCandidate{
            .kind = "endpoint",
            .entity_id = arc.id,
            .point_id = arc.end_point_id,
            .local_x = arc.end_x,
            .local_y = arc.end_y,
            .distance = d,
            .label = "Endpoint",
        });
      }
    }
  }
}

// Find midpoint snaps on lines.
void collect_line_midpoint_candidates(
    const SketchFeatureParameters& sketch,
    double cursor_x,
    double cursor_y,
    double tolerance,
    const SelectionFilter& filter,
    std::vector<SnapCandidate>& candidates) {
  for (const auto& line : sketch.lines) {
    if (line.is_construction && !filter.select_construction) {
      continue;
    }
    const double mx = (line.start_x + line.end_x) / 2.0;
    const double my = (line.start_y + line.end_y) / 2.0;
    const double d = point_distance(cursor_x, cursor_y, mx, my);
    if (d <= tolerance) {
      candidates.push_back(SnapCandidate{
          .kind = "midpoint",
          .entity_id = line.id,
          .point_id = "",
          .local_x = mx,
          .local_y = my,
          .distance = d,
          .label = "Midpoint",
      });
    }
  }
}

// Find center snaps on circles.
void collect_circle_center_candidates(
    const SketchFeatureParameters& sketch,
    double cursor_x,
    double cursor_y,
    double tolerance,
    const SelectionFilter& filter,
    std::vector<SnapCandidate>& candidates) {
  for (const auto& circle : sketch.circles) {
    if (circle.is_construction && !filter.select_construction) {
      continue;
    }
    const double d = point_distance(cursor_x, cursor_y, circle.center_x, circle.center_y);
    if (d <= tolerance) {
      candidates.push_back(SnapCandidate{
          .kind = "center",
          .entity_id = circle.id,
          .point_id = "",
          .local_x = circle.center_x,
          .local_y = circle.center_y,
          .distance = d,
          .label = "Center",
      });
    }
  }
}

// Find center snaps on polygons.
void collect_polygon_center_candidates(
    const SketchFeatureParameters& sketch,
    double cursor_x,
    double cursor_y,
    double tolerance,
    const SelectionFilter& filter,
    std::vector<SnapCandidate>& candidates) {
  for (const auto& poly : sketch.polygons) {
    if (poly.is_construction && !filter.select_construction) {
      continue;
    }
    const double d = point_distance(cursor_x, cursor_y, poly.center_x, poly.center_y);
    if (d <= tolerance) {
      candidates.push_back(SnapCandidate{
          .kind = "center",
          .entity_id = poly.id,
          .point_id = "",
          .local_x = poly.center_x,
          .local_y = poly.center_y,
          .distance = d,
          .label = "Center",
      });
    }
  }
}

// Find center snaps on arcs.
void collect_arc_center_candidates(
    const SketchFeatureParameters& sketch,
    double cursor_x,
    double cursor_y,
    double tolerance,
    const SelectionFilter& filter,
    std::vector<SnapCandidate>& candidates) {
  for (const auto& arc : sketch.arcs) {
    if (arc.is_construction && !filter.select_construction) {
      continue;
    }
    const double d = point_distance(cursor_x, cursor_y, arc.center_x, arc.center_y);
    if (d <= tolerance) {
      candidates.push_back(SnapCandidate{
          .kind = "center",
          .entity_id = arc.id,
          .point_id = "",
          .local_x = arc.center_x,
          .local_y = arc.center_y,
          .distance = d,
          .label = "Center",
      });
    }
  }
}

// Find nearest (body) snaps on lines — any point along the line segment
// within tolerance.
void collect_nearest_candidates(
    const SketchFeatureParameters& sketch,
    double cursor_x,
    double cursor_y,
    double tolerance,
    const SelectionFilter& filter,
    std::vector<SnapCandidate>& candidates) {
  for (const auto& line : sketch.lines) {
    if (line.is_construction && !filter.select_construction) {
      continue;
    }
    // Project cursor onto the infinite line, clamp to segment.
    const double dx = line.end_x - line.start_x;
    const double dy = line.end_y - line.start_y;
    const double len_sq = dx * dx + dy * dy;
    if (len_sq < 1e-12) continue;
    double t = ((cursor_x - line.start_x) * dx + (cursor_y - line.start_y) * dy) / len_sq;
    t = std::max(0.0, std::min(1.0, t));
    const double px = line.start_x + t * dx;
    const double py = line.start_y + t * dy;
    const double d = point_distance(cursor_x, cursor_y, px, py);
    if (d <= tolerance) {
      candidates.push_back(SnapCandidate{
          .kind = "nearest",
          .entity_id = line.id,
          .point_id = "",
          .local_x = px,
          .local_y = py,
          .distance = d,
          .label = "Nearest",
      });
    }
  }
}

} // namespace

std::optional<SnapCandidate> resolve_snap(
    double cursor_x,
    double cursor_y,
    const SketchFeatureParameters& sketch,
    const SelectionFilter& filter,
    double tolerance,
    const std::vector<std::string>& snap_priority) {
  std::vector<SnapCandidate> candidates;

  // Collect candidates based on active snap types in the filter.
  if (filter.snap_endpoint) {
    collect_line_endpoint_candidates(sketch, cursor_x, cursor_y, tolerance, filter, candidates);
    collect_arc_endpoint_candidates(sketch, cursor_x, cursor_y, tolerance, filter, candidates);
  }
  if (filter.snap_midpoint) {
    collect_line_midpoint_candidates(sketch, cursor_x, cursor_y, tolerance, filter, candidates);
  }
  if (filter.snap_center) {
    collect_circle_center_candidates(sketch, cursor_x, cursor_y, tolerance, filter, candidates);
    collect_polygon_center_candidates(sketch, cursor_x, cursor_y, tolerance, filter, candidates);
    collect_arc_center_candidates(sketch, cursor_x, cursor_y, tolerance, filter, candidates);
  }
  if (filter.snap_nearest) {
    collect_nearest_candidates(sketch, cursor_x, cursor_y, tolerance, filter, candidates);
  }

  if (candidates.empty()) {
    return std::nullopt;
  }

  // Build a priority map.
  const auto& priority = snap_priority.empty() ? kDefaultSnapPriority : snap_priority;
  std::unordered_set<std::string> priority_set(
      priority.begin(), priority.end());

  // Assign priority rank. Unknown snap types get lowest priority.
  auto priority_rank = [&](const std::string& kind) -> int {
    for (size_t i = 0; i < priority.size(); ++i) {
      if (priority[i] == kind) return static_cast<int>(i);
    }
    return static_cast<int>(priority.size());
  };

  // Find the best candidate: highest priority first, then smallest distance.
  const SnapCandidate* best = nullptr;
  int best_rank = std::numeric_limits<int>::max();
  double best_dist = std::numeric_limits<double>::max();

  for (const auto& c : candidates) {
    int rank = priority_rank(c.kind);
    if (rank < best_rank || (rank == best_rank && c.distance < best_dist)) {
      best = &c;
      best_rank = rank;
      best_dist = c.distance;
    }
  }

  if (best) {
    return *best;
  }
  return std::nullopt;
}

} // namespace polysmith::core
