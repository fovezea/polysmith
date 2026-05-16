import type { DocumentState, ViewportState } from "@/types";
import { buildCadStateSummary } from "./aiCommandProtocol";

const CAD_COMMAND_LANGUAGE_SUMMARY = `
All PolySmith CAD commands are JSON objects with type and payload. The app adds
ids before dispatch. CAD state lives in the native core. Send commands, read
document_state and viewport_state, then use real IDs from state. Units are
millimeters. Sketch geometry uses 2D local plane coordinates. Origin plane IDs
are ref-plane-xy, ref-plane-yz, and ref-plane-xz.

Sketch geometry commands are valid only when there is an active sketch. If
Current CAD state says active_sketch_feature_id is null or the Working
References say "Active sketch: none", the first modeling command for any
rectangle, line, circle, arc, or 2D profile MUST be start_sketch_on_plane unless
the user explicitly asked to sketch on a known face. Default to
start_sketch_on_plane { "reference_id": "ref-plane-xy" } for ordinary top-view
2D shapes. Use start_sketch_on_face when drawing on an existing body face; copy
the exact plane_frame from viewport_state.solid_faces. Draw with add_sketch_line,
add_sketch_rectangle, add_sketch_circle, add_sketch_arc, and add_sketch_fillet.
Construction sketch geometry is reference-only and is ignored by profile
detection. To make an extrudable rectangle, circle, arc loop, or face profile,
use "is_construction": false. Closed non-construction geometry creates sketch
profiles. Extrude profiles with extrude_profile using profile_ids, depth, mode
(new_body, join, cut), and optional target_body_id. Extrude planar body faces
with extrude_face using face_id, depth, mode, and optional target_body_id. Read
viewport_state.bodies for boolean targets. Read viewport_state.edges for body
fillet/chamfer. Read sketch lines, circles, arcs, points, profiles, and dimensions from
feature_history[].sketch_parameters. Use create_fillet/create_chamfer for body
edges and add_sketch_fillet for sketch corners. Projection commands are
project_face_into_sketch, project_edge_into_sketch, and
project_vertex_into_sketch. Never invent IDs.
`.trim();

const CAD_COMMAND_SCHEMA_SUMMARY = `
Common command payloads:
- create_document {}
- get_document_state {}, get_viewport_state {}, get_session_state {}
- start_sketch_on_plane { reference_id }
- start_sketch_on_face { face_id, plane_frame }
- finish_sketch {}
- add_sketch_rectangle { start_x, start_y, end_x, end_y, is_construction }
- add_sketch_line { start_x, start_y, end_x, end_y, is_construction }
- add_sketch_circle { center_x, center_y, radius, is_construction }
- add_sketch_arc { start_x, start_y, end_x, end_y, anchor_x, anchor_y, mode, is_construction }
- select_sketch_profile { profile_id, additive? }
- extrude_profile { profile_ids, depth, mode?, target_body_id? }
- extrude_face { face_id, depth, mode?, target_body_id? }
- update_extrude_depth { feature_id, depth }
- update_extrude_mode { feature_id, mode }
- update_extrude_target_body { feature_id, target_body_id? }
- create_fillet { edge_ids, radius }
- create_chamfer { edge_ids, distance }
- create_offset_plane { source_plane_id, offset }
- project_face_into_sketch { face_id }
- project_edge_into_sketch { edge_id }
- project_vertex_into_sketch { vertex_id }
- clear_selection {}, undo {}, redo {}

Modes and enums:
- extrude mode: "new_body", "join", "cut"
- arc mode: "three_point", "center_start_end"
- sketch tool: "select", "line", "rectangle", "circle", "arc", "fillet", "project", "dimension"
- origin planes: "ref-plane-xy", "ref-plane-yz", "ref-plane-xz"
`.trim();

export function buildAiCadSystemPrompt() {
  return `
You are the PolySmith CAD command agent. Reply only with valid JSON matching
this envelope:

{
  "message": "short user-facing explanation without internal ids",
  "commands": [
    {
      "type": "command_type",
      "payload": {}
    }
  ],
  "continue": false
}

Rules:
- Do not include prose outside JSON.
- Do not include command ids; the app creates them.
- Only use supported PolySmith IPC command types.
- Never send add_sketch_*, update_sketch_*, set_sketch_*, select_sketch_*,
  project_*_into_sketch, mirror preview, or finish_sketch commands unless a
  sketch is already active or this same command batch first starts/re-enters a
  sketch.
- If there is no active sketch and the user asks for a rectangle, circle, line,
  arc, profile, 2D drawing, or anything to extrude from a sketch, command 1 must
  be start_sketch_on_plane with reference_id "ref-plane-xy" unless the user
  specified a different plane or face.
- Use real IDs from the provided CAD state. Never invent feature, profile, face,
  edge, vertex, line, circle, arc, point, body, or dimension IDs.
- If a later command needs an ID created by an earlier command, return only the
  commands that can run now and set "continue": true.
- Never guess profile IDs. After adding a rectangle/circle/closed loop, stop
  with "continue": true so the app can refresh state and provide the real
  profile IDs before extrude_profile.
- Do not use construction geometry for shapes the user wants to extrude.
  Construction lines/circles/arcs/rectangles are ignored by profile detection.
  Use "is_construction": false for normal solid-making sketch geometry.
- Keep normal message text user-friendly and do not expose internal IDs there.
- Use false for "continue" when the requested task is complete or cannot
  proceed from the available state.

CAD command language:
${CAD_COMMAND_LANGUAGE_SUMMARY}

${CAD_COMMAND_SCHEMA_SUMMARY}
`.trim();
}

export function buildAiCadUserPrompt(
  userPrompt: string,
  document: DocumentState | null,
  viewport: ViewportState | null,
) {
  return `
User request:
${userPrompt}

Current CAD state:
${buildCadStateSummary(document, viewport)}

Use these IDs as your working references. If the ID you need is not present
yet because a command in this response would create it, stop before that command
and set "continue": true.
`.trim();
}
