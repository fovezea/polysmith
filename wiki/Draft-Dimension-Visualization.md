# Draft Dimension Visualization — Implementation Plan

> **Status as of 2026-05-25:** Fully implemented and verified. See
> [Implementation Log](Implementation-Log) for the session summary.

## Problem

When drafting a sketch entity (line, rectangle, circle), two floating HTML
`<input>` boxes show the current angle and length values. These are plain
text boxes positioned at screen coordinates. They overlap when the geometry
is tiny, have no dimension lines/arrows/arcs, and the angle input sits near
the narrow part of the angle where it's unreadable.

## Approach

Replace the HTML-only floating boxes with **scene-rendered dimension
geometry** (Three.js lines + arrows + arcs) — the same visual language as
committed sketch dimensions — with the HTML `<input>` sitting on top of the
dimension label's screen projection.

- **Length**: Linear dimension line parallel to the entity, arrows at both
  ends, extension lines from endpoints, label at midpoint. Offset opposite
  to the angle arc for visual separation.
- **Angle**: Arc centered at the line start point, sweeping from the
  reference angle (horizontal for first line, previous segment direction
  for chained lines) to the line direction. Dotted reference line from
  start along the reference angle. Dotted cursor extension from cursor
  outward.
- **Non-line tools** (rectangle, circle, polygon): fall back to the existing
  HTML-only positioning (unchanged).

## Implementation

All in `apps/desktop-ui/src/layout/ViewportPanel.tsx`:

### Architecture

- **`renderDraftDimensions()`** — Called from the animation `render()` loop
  every frame. Builds a disposable `THREE.Group` with all dimension geometry
  (length dimension lines/arrows, dotted extension, dotted reference line,
  angle arc + arrowheads). Screen positions stored in
  `draftDimScreenPositionsRef.current` for HTML input overlay placement.

- **`clearDraftDimGroup()`** — Traverses and disposes all geometry/materials
  from the previous frame's group. Called at the top of every
  `renderDraftDimensions()` invocation.

- **`draftFieldScreenPosition()`** — For the line tool, reads from
  `draftDimScreenPositionsRef` (render-loop-computed 3D positions).
  Falls through to a 2D fallback for first frame / non-line tools.
  Fallback clears stale positions on input change via `delete` to
  prevent one-frame label jumps.

### Single rendering path

The initial implementation had a duplicate rendering path in
`handlePointerMove` (reusable `draftDimSceneObjRef`) that fought with
`renderDraftDimensions()` — `clearDraftDimGroup()` destroyed the
reusable object every frame, `handlePointerMove` recreated it on
mouse move, creating a destroy/recreate cycle at 60 fps. This caused
flickering, GPU churn, and crashes when user input arrived mid-cycle.
The duplicate was removed; only `renderDraftDimensions()` draws
dimension geometry now.

### Zoom-aware scaling

Dimension offset and arc cap derive from the current orthographic
camera frustum so they stay readable at any zoom level:

- **Length dimension offset**: `max(4, 30 × viewHeight / viewportHeight)`
  world units, doubled for visual breathing room.

- **Angle arc cap**: `max(8, min(lineLength, 480 × viewHeight / viewportHeight))`.
  Arc hugs the rubber band for short lines; caps at a zoom-dependent
  maximum for long lines.

### Angle reference (chained lines)

- `previousLineAngleRef` stores the 2D sketch angle of the last
  committed line segment. Set on commit, cleared on chain break or
  session clear.
- First / independent line: reference = horizontal (0 rad).
- Chained line: reference = previous segment direction, so the arc
  shows the relative turn angle.

### Length / angle opposite sides

The length dimension is offset by `-perpDir` (opposite to the computed
perpendicular). The angle arc is centered at the line start with no
perpendicular offset. This puts them on visually opposite sides of the
rubber band.

### Per-frame cleanup

Removed two diagnostic magenta lines that created new
`THREE.BufferGeometry` + `THREE.LineBasicMaterial` every frame with
100ms setTimeout cleanup — a memory/GPU leak at 60 fps.

## Remaining

- **Display units** in dimension label (currently hardcoded mm)
- **Perpendicular snap** integration (pre-existing backlog item)

## References

- `buildSketchDimensionObject()` in `viewport.utils.ts` — existing committed
  dimension rendering (arcs, arrows, labels), used as pattern reference
- [Contextual Modeling Workflow](Contextual-Modeling-Workflow) — binding UX
  pattern
- [Implementation Log](Implementation-Log) — 2026-05-25 session summary
