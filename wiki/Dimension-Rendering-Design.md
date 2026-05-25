# Dimension Rendering — Design Rationale

> **Status as of 2026-05-25:** The C++ core approach has been implemented.
> Angle dimensions now emit arc/reference-line geometry from the core via IPC.
> Committed dimension groups are zoom-aware (uniform scaling per frame).
> See [Implementation Log](Implementation-Log) for the full session summary.

This page explains _why_ the dimension rendering system is built the way it is.
It is written for human contributors who need to understand past decisions,
avoid known pitfalls, and evaluate new proposals against the project's design
philosophy.

## The Core Principle

**The C++ core computes geometry. The React frontend renders it.**

This is the same rule that governs every other part of PolySmith. The core
owns CAD state, sketch entities, constraints, and dimension values. The
React UI presents the results. When this boundary is crossed — when the
frontend starts computing geometry from scene data — bugs, inconsistencies,
and maintenance debt accumulate.

## Why Dimensions Are Harder Than They Look

Sketch dimensions are simple data: a value, a kind, a target entity. But
_rendering_ them is a geometry problem. A dimension line needs:

- A world-space position offset from the entity
- Extension lines from entity endpoints to the dimension line
- Arrows at both ends (or at arc endpoints for angles)
- A label position
- Visual scaling that stays readable regardless of camera zoom

The first four are geometry computed from the entity shape. The last one
is a pure viewport concern — a transform applied to the rendered result.

## The Two Approaches

### Frontend approach (prototyped, rejected)

Compute dimension geometry client-side from `sceneData.sketchLines` and
`displayedSketchDimensions`, reusing the draft preview's `renderDraftDimensions`
pipeline.

**Why it was tempting:**
- No IPC changes. Quick visual match to the draft preview.
- Small code surface (~50 lines in `ViewportPanel.tsx`).

**Why it was rejected:**
- Breaks the architectural boundary: React would own dimension _geometry
  computation_, not just rendering.
- Every other dimension path (circle, rectangle, polygon, arcs, angle,
  distance) goes through C++ core → IPC → `buildSketchDimensionObject`.
  A frontend-only path for line dimensions creates a fork that future
  contributors will trip over.
- On large projects with dozens of committed dimensions, client-side
  recomputation at render time may regress.
- Sets a precedent: if the frontend can compute dimension geometry, what
  stops it from computing other CAD geometry?

### C++ core approach (chosen direction)

Extend the `ViewportSketchDimensionPrimitive` struct so the core emits
all the geometry data the renderer needs: arc parameters, reference-line
endpoints, extension offsets.

**Advantages:**
- The core remains the single source of truth for all geometry.
- One path for all dimension kinds (line, circle, polygon, angle, arc).
- The same IPC schema benefits non-draft-preview contexts (dimension-only
  views, printing, future 2D drawing workspace).
- The frontend only applies viewport-aware visual scaling — the same kind
  of operation as sizing a text sprite.

## The Zoom Problem

Zoom-aware offsets (30 px on screen, 480 px arc cap) are the one aspect
of dimension rendering that genuinely belongs in the viewport layer. The
core cannot know the camera zoom.

The solution: the core emits geometry at a **fixed world-space offset**
(`kLineDimensionOffset = 12.0`). The frontend scales the entire dimension
group uniformly by a zoom factor computed from the camera frustum. This
keeps the boundary clean: the core owns geometry placement, the frontend
owns visual sizing.

## The Opposite-Sides Rule

In the draft preview, the length dimension and the angle arc are always on
opposite sides of the rubber band:

- **Length dimension**: offset by `-perpDir` (toward the camera)
- **Angle arc**: centered at the line start with no perpendicular offset;
  the shorter angular sweep (CCW for positive angles) places the arc in
  the natural opposite half-plane

The perpendicular direction `perpDir` is flipped toward the camera position
in 3D so the rule holds regardless of which side of the sketch plane the
camera is on.

### Where the arc actually sits

The angle arc sweeps from the +X reference (horizontal right, 0°) to the
line direction. For an up-right line (dy > 0), the arc's Y is `r × sin(θ)`
for θ ∈ [0, line_angle]. Since sin(θ) ≤ sin(line_angle), the arc is at or
**below the line** — between the horizontal and the line, not beyond it.
For down-right lines (dy < 0) the arc is at or **above the line**.

This is the opposite of the naive intuition and was corrected on
2026-05-25 after two rounds of fixing the wrong direction.

### How the core enforces it

`make_line_dimension_primitive` applies two passes:

1. **Centroid-aware flip** — flips the normal away from the sketch centroid.
   For multi-entity sketches this puts dimensions on the outside of profiles.
2. **Tiebreaker flip** — when the line is isolated (single entity, midpoint
   near centroid → `to_outside_mag < 0.5`):
   - `dy < 0` (arc above) → flip normal down → length below
   - `dy ≥ 0` (arc below) → normal already up → no flip

The tiebreaker yields to the centroid for multi-entity sketches, where the
centroid-aware flip handles collision avoidance between adjacent lines.

## Formal Specification

The draft preview rendering rules were formalised in
[Draft-Dimension-Visualization](Draft-Dimension-Visualization).
Those rules are the reference for any committed dimension restyling.

**Zoom formulas** (per frame):

```
viewH         = (camera.top - camera.bottom) / camera.zoom
vpH           = renderer.domElement.height
zoomDimOffset = max(4, 30 × viewH / vpH)      // ≈30 px
zoomCap       = max(20, 480 × viewH / vpH)     // ≈480 px
```

**Length dimension:** offset by `-2 × zoomDimOffset × perpDir` from the
entity, extension lines, arrowheads at both ends, label at midpoint.

**Angle arc:** radius `max(8, min(lineLen, zoomCap))` — follows the line
up to the zoom cap, hard minimum of 8 world units. Sweep from reference
angle to line direction along the shorter path.

## References

- [Draft-Dimension-Visualization](Draft-Dimension-Visualization) — full specification
- [Architecture-Overview](Architecture-Overview) — project architecture boundaries
- [Contextual-Modeling-Workflow](Contextual-Modeling-Workflow) — binding UX pattern
- [Implementation-Log](Implementation-Log) — 2026-05-25 entries