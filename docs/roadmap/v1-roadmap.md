# PolySmith V1 Roadmap

## Project Focus

PolySmith v1 is intentionally narrow:

- local-first desktop CAD
- hobbyist 3D-printing workflows
- single-part parametric modeling
- a familiar, modern parametric CAD workflow
- a strong architecture boundary between UI and native CAD logic

This roadmap intentionally avoids CAM, cloud collaboration, simulation,
enterprise features, and complex assemblies.

## Current Repo Status

The earlier "infrastructure-heavy, feature-light" phase is done. The
codebase now has:

- a React + Tauri desktop shell with the `Midnight Carbon` design language
- a C++ CAD core built with CMake on top of OpenCascade
- a JSON IPC bridge with documented commands and a versioned schema
- a real document model with feature history, undo/redo, and core-owned
  selection state
- 2D sketch entities (lines, rectangles, circles, arcs), points,
  dimensions, constraints (horizontal/vertical/perpendicular/parallel/
  equal-length/coincident/fixed), and stored sketch profiles
- closed-profile detection that survives parametric edits and point
  merges, including loops that mix line and arc edges
- extrude features that target sketch profiles, with editable depth via
  `update_extrude_depth`
- selectable solid faces and reference planes; sketches can start on any
  origin plane or any solid face
- finished sketches can be re-entered without rebuilding via `reenter_sketch`
- STEP export of the live document
- a contextual modeling workflow documented in
  `docs/architecture/contextual-modeling-workflow.md`: select inputs → invoke
  action → floating context panel → real geometry preview → confirm/cancel
- an `E` hotkey + floating extrude preview panel that drives live, debounced
  `update_extrude_depth` recomputes
- a CAD-style document hierarchy with collapsible Origin / Sketches /
  Bodies categories, eye-icon visibility toggles, double-click to re-enter
  sketches, and a right-click context menu for rename / hide / delete

That puts the project past Milestones 0–2 of the original v1 roadmap and
roughly mid-way through Milestone 3.

## Architectural Invariants (Do Not Break)

These are rules going forward, not goals to chase:

- React UI does **not** own CAD state. The native core is the single
  source of truth for documents, features, geometry, and selection.
- The IPC protocol is the contract. Schema, TypeScript types, C++ command
  dispatch, and `docs/architecture/ipc-protocol.md` move together.
- All modeling features follow the contextual modeling workflow in
  `docs/architecture/contextual-modeling-workflow.md`.
- Live previews are real geometry recomputed by the core. The UI does not
  invent geometry locally.
- Changes stay minimal, scoped, and reviewable. No vibe-coded rewrites.

## Where We Are Going

The next phase is the modeling slice that turns PolySmith from "extrude a
single profile" into "model a printable part you'd actually want to print".

### Tier 1 — make modeling actually useful

These three close the gap between fancy demo and real workflow:

- **Cut / subtract extrude.** Add `New Body | Join | Cut` modes to the
  Extrude action. Single largest UX unlock. Depends on a new viewport
  mesh primitive type (the boolean'd body cannot be visualised by the
  existing per-feature primitive types).
- ✅ **Save / load `.polysmith` document** — shipped. Core-owned JSON
  document format with a `document_from_payload` deserializer mirroring
  `to_payload`, plus File → Open / Save buttons.
- ✅ **STL export** — shipped alongside STEP export.

### Tier 2 — the obvious next features

- ✅ **Edge & vertex selection** — shipped. Core enumerates body edges
  and vertices via `TopExp` and emits `viewport_state.edges` /
  `viewport_state.vertices`; the UI raycasts vertices first, then edges,
  then faces, and dispatches `select_edge` / `select_vertex`.
- ✅ **Fillet & chamfer on edges** — shipped. New body-modifying
  feature kinds (`fillet`, `chamfer`) are applied during body
  compilation via `BRepFilletAPI_MakeFillet` /
  `BRepFilletAPI_MakeChamfer` against the target body's edges.
  Hotkey `F` / `C` on a selected edge spawns a contextual floating
  preview panel with live `update_fillet_radius` /
  `update_chamfer_distance` updates and Confirm / Cancel.
- **Hole feature.** Parametric simple/counterbore/countersink on a face,
  built on top of cut extrude.
- **Pattern features.** Linear and circular patterns of features and
  bodies.
- **Mirror.** Body / feature mirror about a plane.

### Tier 3 — modeling primitives & references

- **Offset construction plane.** Sketch on a plane offset from a face or
  reference plane.
- ⚠️ **Sketch arcs, slots, polygons, and offset-curve.** Arcs shipped
  in v1: `add_sketch_arc` supports three-point and center+start+end
  modes through a segmented toolbar control, the closed-
  profile detector walks lines and arcs uniformly so loops mixing the
  two extrude cleanly, and arc endpoints share the SketchPoint graph.
  Endpoints are stored fixed for v1 (no post-creation reshape /
  constraints / dimension drive); slots, polygons, and offset-curve
  remain.
- ✅ **2D sketch fillets** — shipped. Parametric corner fillet between
  two sketch lines: click the Fillet tool, click a shared corner, and
  the floating `SketchFilletPanel` drives live `update_sketch_fillet_radius`
  previews. Cancel calls `delete_sketch_fillet` to restore the
  original corner. The recompute pass keeps the fillet tangent under
  subsequent line edits, so dragging the far end of a filleted line
  preserves the rounded corner. v1 limits to line-line corners; line-
  arc and arc-arc are follow-ups.
- **Construction axes** through edges and through two points.
- ✅ **Project sketch tool** — shipped. Projects extrude faces (rectangle
  and circle profiles) onto the active sketch as fixed-endpoint lines or
  a circle. Polygon-extrude sides and legacy box/cylinder features remain
  to be added.

### Cross-cutting polish

Small individually but they shape day-to-day usability:

- ✅ **Undo / redo hotkeys** (`⌘Z` / `⌘⇧Z` and Ctrl equivalents) — shipped.
- **Measure tool** (point-to-point, edge length, face area).
- **Named user parameters** that drive sketch dimensions and feature
  depths.
- **View cube / named views** (Front / Top / Iso).
- **Active sketch panel** showing entities in the same hierarchy treatment.

## Suggested Order

1. ✅ Save/load + STL export + undo/redo hotkeys + Project — shipped.
2. **Viewport mesh primitive + cut extrude** (next big slice; the mesh
   primitive unlocks every boolean-producing feature below).
3. **Edge & vertex selection** plumbing → **fillet & chamfer**.
4. **Pattern + mirror**.
5. **Hole feature** (cut-extrude variant on a selected face).
6. Polish: measure tool, named parameters, view cube, active sketch panel.
7. **Display units (metric/inch toggle).** UI-layer conversion only: the
   C++ core always works in mm; React converts at the presentation
   boundary. Design doc: `docs/architecture/display-units.md`.
8. **Manual sketch dimension tool completion.** Single-entity dimension
   creation for lines, circles, and polygons whose auto-dimensions were
   deleted by the fusion-style on-demand system.

Each row above maps cleanly onto the existing contextual modeling action pattern
(select inputs → invoke action → floating panel → live preview →
confirm/cancel) and reuses the panel + hotkey machinery already built.

## Key Decisions and Constraints

- The UI does not own CAD state.
- Tauri acts as the bridge between UI and native systems, not as a second
  CAD logic layer.
- The IPC protocol is the contract of the system. The bridge is currently
  fire-and-forget; flows that depend on post-command state must subscribe
  to the next document/viewport event (see `awaitDocumentChange` in the
  store) rather than reading the store immediately after sending a
  command.
- V1 stays single-part and local-first.
- Changes should remain minimal, readable, and reviewable.
- Broad rewrites should be avoided unless clearly justified.

## Near-Term Recommended Next Task

Implement Tier 1 in order: cut extrude, then save/load, then STL export.
Each is a distinct focused turn. Cut extrude is the highest-impact next
feature and the most obvious user-visible gain.
