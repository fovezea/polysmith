# IPC Protocol

PolySmith uses a JSON-based IPC protocol to communicate between the UI (React) and the CAD core (C++).

This document describes the architectural rules of that protocol. It should stay focused on contract and transport behavior, not feature planning. For near-term milestones, see the roadmap document.

## Goals

- clear separation between UI and core
- stable contract between components
- easy debugging without weakening boundaries
- language-agnostic communication
- predictable behavior for a solo-developer codebase

## Core Rules

- The UI sends commands that represent user intent
- The CAD core owns document state, geometry, feature history, and modeling behavior
- Tauri acts as the bridge between the UI and the native CAD core
- All cross-boundary communication must go through the IPC protocol
- No shared memory or direct bindings between UI and CAD logic

## Transport

Initial transport:

- `stdin` for commands sent to the CAD core
- `stdout` for protocol messages emitted by the CAD core
- `stderr` for human-readable logs and diagnostics

Protocol rule:

- `stdout` is reserved for newline-delimited JSON protocol messages only
- human-readable logs must go to `stderr`, never `stdout`

This distinction keeps protocol parsing reliable and makes debugging easier without weakening the contract.

## Message Structure

All protocol messages follow a common base shape.

```json
{
  "id": "string",
  "type": "string",
  "payload": {}
}
```

- `id` is used for request/response matching when applicable
- `type` identifies the command, event, or error
- `payload` contains the message-specific data

Not every message must include every field, but every message type must be documented and schema-backed.

## Commands (UI -> Core)

Commands represent explicit user intent.

Example:

```json
{
  "id": "123",
  "type": "ping",
  "payload": {}
}
```

Command rules:

- commands must be explicit and self-contained
- commands must not rely on hidden UI-side state
- every command type must be documented
- every command type must be represented in schema

## Events and Responses (Core -> UI)

The core replies with structured protocol messages.

Example:

```json
{
  "id": "123",
  "type": "pong",
  "payload": {
    "version": "0.1.0"
  }
}
```

Response rules:

- every handled command should produce at least one response or error
- responses tied to a command should include the original `id`
- the core may also emit independent events such as lifecycle or state updates
- response and event types must be documented and schema-backed

## Error Handling

Errors must be explicit protocol messages, not implied by missing output or mixed into free-form logs.

Example:

```json
{
  "id": "123",
  "type": "error",
  "payload": {
    "message": "Invalid command",
    "code": "INVALID_COMMAND"
  }
}
```

Error rules:

- errors should use a documented error type and payload shape
- invalid input should produce structured protocol errors
- logs may provide extra debugging detail, but protocol consumers must not depend on log text

## Lifecycle

### Startup

When the CAD core starts successfully, it should emit a `hello` message describing the service and version.

Example:

```json
{
  "type": "hello",
  "payload": {
    "service": "cad_core",
    "version": "0.1.0"
  }
}
```

### Shutdown

The UI requests shutdown through a documented protocol command.

Example:

```json
{
  "type": "shutdown"
}
```

The core should exit gracefully after handling the shutdown request.

## Schema and Validation

The schema files under `protocol/schema/` are the source of truth for message shape.

That means:

- new message types should be added to schema and docs together
- UI-side message handling should validate incoming core messages at the boundary
- Tauri bridge code should preserve the protocol cleanly and avoid undocumented reshaping
- core-side command handling should validate and reject malformed input explicitly

Planned message types may be documented ahead of implementation, but they must be clearly treated as planned until the code supports them.

## Initial Required Foundation Message Set

The first meaningful protocol slice for PolySmith foundation work should include:

- `hello`
- `ping`
- `shutdown`
- `create_document`
- `get_document_state`
- `error`

These message types are the minimum needed to move from process bootstrap to real document lifecycle work.

The current implementation may extend beyond that minimum slice as small feature-oriented commands are added. Those additions should still follow the same rules:

- document the message type
- update schema and code together
- keep modeling behavior in the native core

The current implementation now also includes a focused export spike:

- the UI may send `export_document` (STEP) or `export_document_stl` (binary STL) with a destination file path
- the CAD core rebuilds exportable solids from core-owned feature history and writes the file
- the STL exporter triangulates the compound with a fixed linear/angular deflection before writing; the UI does not generate any tessellation itself
- the core replies with `document_exported` when the export succeeds; the payload's `format` field reflects the writer that ran (`step` or `stl`)
- the UI must not reconstruct geometry or write CAD files itself

The protocol also covers native document persistence and the Project sketch
tool:

- `create_offset_plane { source_plane_id, offset }` adds a parametric offset construction plane to the document. `source_plane_id` may be one of the three origin planes (`ref-plane-xy/yz/xz`), an existing construction plane's feature id, or a planar body face id of the form `<body_id>:face:<index>`. `offset` is a signed distance (mm) along the source's normal. The core resolves the source's frame, slides it along the normal, stores the result on a new `construction_plane` feature, and emits the updated document.
- `update_offset_plane { feature_id, offset }` rewrites the offset on an existing construction plane and re-derives its cached frame from the source's current frame, so chained planes / face-source planes update correctly under upstream edits.
- `viewport_state.reference_planes[]` gained an optional `plane_frame` field. Origin planes leave it null and the renderer keeps using the legacy `orientation` rotation; construction planes ship a real world-space frame and the renderer positions the quad with that frame instead.
- `save_document` writes the live document state as a JSON `.polysmith` file at the supplied `file_path`; the core replies with `document_saved`
- `load_document` parses a `.polysmith` file, replaces the live document, restores ID counters by scanning the loaded ids, clears undo/redo stacks, and replies with `document_state`
- `project_face_into_sketch` projects the outline of a selected solid face onto the active sketch's plane, creating fixed-endpoint sketch lines (or a sketch circle for circular caps); supports extrude features that carry a `plane_frame` (rectangle and circle profiles, base/top/side faces). Polygon profile sides and legacy box/cylinder features are not yet supported by the projection helper and produce a structured error.
- `project_edge_into_sketch { edge_id }` projects a single body edge onto the active sketch's plane. Linear edges become sketch lines; circular edges become sketch circles or arcs when the edge's plane is parallel to the sketch's. Edges that would project to ellipses (non-parallel circle plane) and other curve types (B-splines, etc.) are rejected with a structured error so the UI can surface a transient message. Repeated clicks on the same edge are no-ops (idempotency now walks `sketch_parameters.projections[*].source_id`).
- `project_vertex_into_sketch { vertex_id }` projects a single body vertex onto the active sketch's plane as a fixed standalone sketch point (`points[]` entry with `kind = "projected"`). Recorded in `sketch_parameters.projected_points[]` for the cached coords plus a `sketch_parameters.projections[]` entry for the live link. Repeated clicks on the same vertex are no-ops.
- All three project commands now also append a `SketchProjection` record to `sketch_parameters.projections[]`. Each record carries `source_id`, `source_kind` ("face" / "edge" / "vertex"), and the ids of every entity the projection generated (`generated_line_ids`, `generated_circle_ids`, `generated_arc_ids`, `generated_point_id`). On every recompute the core's `refresh_sketch_projections` pass re-resolves each source against the current body geometry and patches the matching generated entities in place, so editing the upstream geometry moves the projected sketch entities in lockstep (Fusion-style live link). When a source can't be re-resolved (body deleted, curve type changed) the projection's `dependency_broken` flag is set and the parent sketch surfaces a feature-level warning; the generated entities stay frozen at their last-known coords until the user re-projects.

For the current spike, export is intentionally narrow:

- format: STEP
- exported content: all solid-producing document features that can be rebuilt from feature parameters
- skipped content: non-solid sketch-only features
- viewport-only presentation data such as primitive spacing is not part of the export contract

A viewport snapshot follows the same rule set. The core decides what renderable scene data exists, and the UI only visualizes that snapshot.

For renderer-oriented viewport data, the same ownership rule still applies:

- the core may provide primitive placement, centers, and scene bounds when that helps visualization
- the core may provide renderer-facing polygon footprint data for sketch profiles or profile-driven solids when the viewport needs to render them
- the core may provide reference geometry such as origin planes and axes when those are selectable CAD targets
- the core may provide lightweight solid-face metadata for picking and highlighting when a face is a selectable CAD target
- the core may provide active sketch state, renderable sketch entities, derived sketch dimensions, and renderable sketch constraint markers when sketching is in progress
- the UI may adapt that snapshot for a renderer, but it must not invent CAD state or modeling behavior

Sketch commands follow the same ownership boundary:

- the UI may send selection or sketch intent such as `select_face`, `start_sketch_on_face`, `start_sketch_on_plane`, `set_sketch_tool`, `update_sketch_line`, `update_sketch_point`, `set_sketch_line_constraint`, `set_sketch_equal_length_constraint`, `set_sketch_coincident_constraint`, `set_sketch_perpendicular_constraint`, `set_sketch_parallel_constraint`, `set_sketch_point_fixed`, `update_sketch_circle`, `update_sketch_dimension`, `add_sketch_line`, `add_sketch_rectangle`, `add_sketch_circle`, `add_sketch_arc`, `select_sketch_point`, `select_sketch_entity`, `select_sketch_dimension`, `select_sketch_profile`, `extrude_profile`, `update_extrude_depth`, `finish_sketch`, or `reenter_sketch`
- `add_sketch_line { start_x, start_y, end_x, end_y, is_construction? }` creates a sketch line on the active sketch. Construction lines render dashed, stay available for snapping / constraints, and are excluded from profile loop detection and automatic line dimensions.
- `add_sketch_rectangle { start_x, start_y, end_x, end_y, is_construction? }` creates four sketch lines. When `is_construction` is true, all four sides are construction lines and therefore do not seal selectable profiles or receive automatic side dimensions.
- `add_sketch_circle { center_x, center_y, radius, is_construction? }` creates a sketch circle. Construction circles render dashed, stay selectable / snappable, are excluded from profile and hole detection, and do not receive an automatic diameter dimension.
- `add_sketch_arc { start_x, start_y, end_x, end_y, anchor_x, anchor_y, mode, is_construction? }` creates a sketch arc on the active sketch. `mode` is one of `three_point` (anchor lies on the arc; center = circumcenter of start, anchor, end) or `center_start_end` (anchor is the center; end is snapped onto the resulting circle). Endpoints participate in the shared sketch-point graph and are stored as fixed (v1 freezes arc shape at creation; reshape requires delete + redraw). The core rejects colinear / zero-radius input as a structured error. Non-construction arc edges contribute to closed-profile loop detection alongside lines, with interior points sampled into the profile so OCCT extrudes a clean curved boundary; construction arcs are skipped by profile detection.
- `viewport_state.sketch_circles: [{circle_id, plane_id, center, radius, is_selected, is_construction, is_preview}]` carries world-space circle centers plus the sketch-plane radius. The corresponding feature-level state lives at `feature_history[].sketch_parameters.circles[]` with local center / radius / `is_construction`.
- `viewport_state.sketch_arcs: [{arc_id, start_point_id, end_point_id, plane_id, center, radius, start, end, ccw, is_selected, is_construction, is_preview}]` carries the world-space endpoint and center coordinates plus the sweep direction (`ccw`); the UI samples between `start` and `end` around `center` to render the arc. The corresponding feature-level state lives at `feature_history[].sketch_parameters.arcs[]` with the same shape but in sketch-local 2D coordinates
- `add_sketch_fillet { corner_point_id, line_a_id, line_b_id, radius }` rounds a corner shared by two sketch lines into a tangent arc. The corner is identified by the shared sketch point id; the core validates strict eligibility (corner is an endpoint of both lines, lines are non-parallel, radius fits on each line, no other fillet already at this corner) and rejects with a structured error otherwise. On success the core mutates each line's filleted endpoint to reference a newly allocated fixed trim point and inserts a generated `SketchArc` between them. The relationship is parametric: a `SketchFillet` record on the sketch carries enough state to keep the geometry tangent under subsequent line edits and to fully restore the original corner on delete
- `update_sketch_fillet_radius { fillet_id, radius }` rewrites the parametric radius and re-runs the sketch recompute pass; the trim distances and arc geometry update in lockstep. If the new radius no longer fits on the current line lengths the recompute silently skips the update (leaving the previous frame's geometry intact) — the user can drag the lines longer to recover
- `delete_sketch_fillet { fillet_id }` restores each line's filleted endpoint back to the original corner point and removes the generated arc + the fillet record. The corner point is re-emitted by the next `rebuild_sketch_points` from the fillet's cached `corner_x` / `corner_y` (denormalized onto the fillet record specifically so the points table can survive the case where no other entity references the corner)
- `feature_history[].sketch_parameters.fillets: [{fillet_id, corner_point_id, corner_x, corner_y, line_a_id, line_b_id, trim_a_point_id, trim_b_point_id, arc_id, radius}]` round-trips through save / load so the parametric model survives across sessions. The generated trim points appear in `points[]` (with `is_fixed=true`) and the generated arc in `arcs[]`, just like any other sketch geometry, but consumers that need to know they're fillet outputs (not user-drawn) can cross-reference by id
- `select_sketch_profile` and `extrude_profile` accept any profile in the document (the owning sketch is resolved by the core); they do not require an active sketch. `select_sketch_profile { profile_id, additive? }` replaces the current sketch-profile selection by default, or toggles the profile when `additive=true` (used by Ctrl/Cmd/Shift-click in the viewport). The document state keeps the legacy `selected_sketch_profile_id` as the most recent selection and also emits `selected_sketch_profile_ids[]` for multi-profile commands.
- `extrude_profile` accepts the legacy single `profile_id` or a `profile_ids[]` array. When multiple profiles are provided, the core validates they belong to the same sketch plane and creates one extrude feature containing all selected regions. It also accepts an optional `mode` payload field of `new_body | join | cut` (default `new_body`) and an optional `target_body_id` for boolean modes; `update_extrude_profiles { feature_id, profile_ids[] }` replaces the source regions for an in-progress extrude while preserving its depth/mode/target, `update_extrude_mode` flips the boolean composition mode of an existing extrude, and `update_extrude_target_body` retargets a boolean extrude (omit `target_body_id` to clear the explicit target and fall back to the most recent body)
- sketch profile regions may carry `inner_loops[]` in both `feature_history[].sketch_parameters.profiles[]` and `viewport_state.sketch_profiles[]`. v1 uses this for circles and nested closed polygon profiles inside another polygon profile: the containing region represents the outer area minus the inner loop, while the inner loop remains a separate selectable profile. Selecting both profiles explicitly is therefore the way to extrude the full filled area.
- the core may emit triangulated body meshes (`viewport_state.meshes` with `primitive_id`, flat `positions`, `normals`, `indices`, and `is_selected`) so the UI can render boolean'd bodies directly via three.js BufferGeometry instead of reconstructing them from feature primitives; primitives consumed by a Fuse/Cut are suppressed in the legacy `boxes` / `cylinders` / `polygon_extrudes` arrays in the same snapshot
- the core also emits `viewport_state.bodies: [{id, label}]` (in document order) so UIs can render a stable target picker for boolean extrudes; the `id` of each body matches the root feature id reported as `target_body_id` on the wire
- the core may emit selectable body edges as `viewport_state.edges: [{id, owner_body_id, kind, points[], is_selected}]` where `id` is `<owner_body_id>:edge:<index>` and `points` is a flat world-space polyline (x0, y0, z0, x1, y1, z1, ...). The UI may raycast against these polylines and dispatch `select_edge` with the picked id; the core then sets `selected_edge_id` on the document state and clears competing selections (face / reference / sketch entities). Edge ids are stable across viewport snapshots when body topology is unchanged, so selection survives mode/depth tweaks
- the core also emits selectable body vertices as `viewport_state.vertices: [{id, owner_body_id, position: {x, y, z}, is_selected}]` where `id` is `<owner_body_id>:vertex:<index>`. The UI raycasts vertex meshes ahead of edges and faces and dispatches `select_vertex` with the picked id; the core then sets `selected_vertex_id` on the document state and clears competing selections. Vertex ids are stable across viewport snapshots under the same conditions as edge ids
- `create_fillet { edge_id, radius }` and `create_chamfer { edge_id, distance }` create body-modifying features owned by the body the edge belongs to. The core resolves the target body from `<owner_body_id>` in the edge id, applies `BRepFilletAPI_MakeFillet` / `BRepFilletAPI_MakeChamfer` during body compilation, and emits the modified body via `viewport_state.meshes`. `update_fillet_radius { feature_id, radius }` and `update_chamfer_distance { feature_id, distance }` drive live preview the same way `update_extrude_depth` does. Fillet and chamfer feature parameters round-trip on `feature_history[].fillet_parameters` / `feature_history[].chamfer_parameters` with `target_body_id`, `edge_ids[]`, and `radius` / `distance`
- `reenter_sketch` reactivates a finished sketch by feature id without creating a new feature or pushing an undo entry; it only flips the active sketch flags so the UI can resume editing the same plane and entities
- `select_face` is selection only; `start_sketch_on_face` must be driven by a core-provided face id together with the matching core-emitted face plane frame from the viewport snapshot
- the core keeps the sketch plane frame with detected sketch profiles and generated extrusions so face-based loops continue to render and extrude on the selected face rather than being remapped to a perpendicular origin plane
- the core owns the active sketch, active sketch tool including non-drawing selection mode, selected sketch point, selected sketch entity, selected sketch dimension, selected sketch profile, stored sketch entities, stored sketch points including fixed-point state and point-driven edits, stored sketch dimensions, stored sketch line relations, stored sketch profile regions, profile-linked extrude refreshes, and their serialized viewport representation
- the core may emit point-owned constraint markers such as fixed-point badges in the viewport snapshot; the UI may render and clear them through the documented IPC commands, but it must not infer or solve those relations itself
- the core owns selected solid-face ids, the meaning of those ids, and the sketch plane/frame derived from a chosen face

## Versioning

- protocol versioning must be tracked deliberately
- breaking protocol changes require a version bump
- UI and core must agree on protocol version

## Logging and Debugging

- protocol traffic should be easy to inspect during development
- structured messages should remain machine-readable in all environments
- logs should help developers, but they must never become part of the contract

## Philosophy

The IPC protocol is the contract of the system.

If the protocol stays clean:

- the architecture stays clean
- the UI stays focused on presentation and user intent
- the core stays responsible for CAD behavior
- the codebase stays understandable and maintainable
