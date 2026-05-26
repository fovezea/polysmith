import {
  FeatureEntry,
  ViewportBoxPrimitive,
  ViewportCylinderPrimitive,
  ViewportPolygonExtrudePrimitive,
  ViewportReferenceAxis,
  ViewportReferencePlane,
  ViewportSceneBounds,
  ViewportSketchArc,
  ViewportSketchCircle,
  ViewportSketchConstraint,
  ViewportSketchPolygon,
  ViewportSketchDimension,
  ViewportSketchLine,
  ViewportSketchPoint,
  ViewportSketchProfile,
  ViewportSolidFace,
  SketchTool,
  PlaneFrame,
} from "@/types";

export interface DocumentState {
  document_id: string;
  name: string;
  units: string;
  revision: number;
  selected_feature_id: string | null;
  selected_reference_id: string | null;
  selected_face_id: string | null;
  selected_edge_ids: string[];
  selected_vertex_ids: string[];
  active_sketch_plane_id: string | null;
  active_sketch_face_id: string | null;
  active_sketch_feature_id: string | null;
  active_sketch_tool: SketchTool | null;
  selected_sketch_point_id: string | null;
  selected_sketch_entity_id: string | null;
  selected_sketch_point_ids: string[];
  selected_sketch_entity_ids: string[];
  selected_sketch_dimension_id: string | null;
  selected_sketch_profile_id: string | null;
  selected_sketch_profile_ids: string[];
  timeline_cursor: number | null;
  feature_history: FeatureEntry[];
  parameters: ParameterEntry[];
}

export interface SessionState {
  document_count: number;
  has_active_document: boolean;
  active_document_id: string | null;
  can_undo: boolean;
  can_redo: boolean;
}

export interface ViewportState {
  has_active_document: boolean;
  boxes: ViewportBoxPrimitive[];
  cylinders: ViewportCylinderPrimitive[];
  polygon_extrudes: ViewportPolygonExtrudePrimitive[];
  solid_faces: ViewportSolidFace[];
  reference_planes: ViewportReferencePlane[];
  reference_axes: ViewportReferenceAxis[];
  sketch_lines: ViewportSketchLine[];
  sketch_circles: ViewportSketchCircle[];
  sketch_polygons: ViewportSketchPolygon[];
  sketch_arcs: ViewportSketchArc[];
  sketch_points: ViewportSketchPoint[];
  sketch_dimensions: ViewportSketchDimension[];
  sketch_constraints: ViewportSketchConstraint[];
  sketch_profiles: ViewportSketchProfile[];
  meshes: ViewportMeshPrimitive[];
  cut_previews: ViewportCutPreview[];
  bodies: ViewportBodySummary[];
  edges: ViewportEdgePrimitive[];
  vertices: ViewportVertexPrimitive[];
  scene_width: number;
  scene_height: number;
  scene_depth: number;
  scene_bounds: ViewportSceneBounds;
  dof_statuses: Array<{
    entity_id: string;
    entity_kind: string;
    total_dof: number;
    consumed_dof: number;
    status: "under" | "full" | "over";
  }>;
  selection_filter: {
    select_curves: boolean;
    select_points: boolean;
    select_construction: boolean;
    select_constraints: boolean;
    snap_endpoint: boolean;
    snap_midpoint: boolean;
    snap_center: boolean;
    snap_intersection: boolean;
    snap_nearest: boolean;
    snap_quadrant: boolean;
    snap_perpendicular: boolean;
    snap_parallel: boolean;
    snap_tangent: boolean;
    snap_grid: boolean;
    magnetic_pull: boolean;
    tolerance_px: number;
  };
}

export interface ViewportMeshPrimitive {
  primitive_id: string;
  // Triangulated body geometry in world space, laid out as flat arrays
  // for direct upload to a three.js BufferGeometry.
  positions: number[];
  normals: number[];
  indices: number[];
  is_selected: boolean;
}

// Translucent red preview of the cutter volume for the currently-edited
// cut extrude. Emitted by the core only while the user is editing the
// cut (i.e. the corresponding feature is selected). Renders as a red
// translucent overlay so the user sees exactly which volume is about
// to be removed, mirroring common CAD workflow's behavior.
export interface ViewportCutPreview {
  id: string;
  positions: number[];
  normals: number[];
  indices: number[];
}

// Lightweight summary of every body present in the current document, in
// document order. Used by the extrude panel to populate the cut/join
// target picker with stable ids and human-readable labels.
export interface ViewportBodySummary {
  id: string;
  label: string;
}

// Selectable edge of a body, expressed as a flat polyline that the
// renderer can hand straight to a THREE.Line. Edge ids are stable for
// a given body's topology so selection survives mode/depth tweaks.
export interface ViewportEdgePrimitive {
  id: string;
  owner_body_id: string;
  // "line" | "circle" | "curve" — informational only, the renderer
  // treats them all as polylines.
  kind: string;
  // Flat world-space samples: x0, y0, z0, x1, y1, z1, ...
  points: number[];
  // Exact length in millimetres, computed by OCCT in the core. Used
  // by the bottom-right Selection readout when a single edge is
  // selected.
  length: number;
  is_selected: boolean;
}

// Selectable vertex of a body. Same id stability story as edges.
export interface ViewportVertexPrimitive {
  id: string;
  owner_body_id: string;
  position: { x: number; y: number; z: number };
  is_selected: boolean;
}

export interface DocumentExportResult {
  file_path: string;
  format: "step" | "stl";
  exported_feature_count: number;
}

export interface BaseMessage {
  id?: string;
  type: string;
  payload?: unknown;
}

export interface HelloEvent extends BaseMessage {
  type: "hello";
  payload: {
    service: string;
    version: string;
  };
}

export interface PongEvent extends BaseMessage {
  type: "pong";
  id: string;
  payload: {
    version: string;
  };
}

export interface DocumentCreatedEvent extends BaseMessage {
  type: "document_created";
  id: string;
  payload: DocumentState;
}

export interface DocumentStateEvent extends BaseMessage {
  type: "document_state";
  id: string;
  payload: DocumentState;
}

export interface SessionStateEvent extends BaseMessage {
  type: "session_state";
  id: string;
  payload: SessionState;
}

export interface ViewportStateEvent extends BaseMessage {
  type: "viewport_state";
  id: string;
  payload: ViewportState;
}

export interface DocumentExportedEvent extends BaseMessage {
  type: "document_exported";
  id: string;
  payload: DocumentExportResult;
}

export interface DocumentSavedEvent extends BaseMessage {
  type: "document_saved";
  id: string;
  payload: {
    file_path: string;
  };
}

export interface ErrorEvent extends BaseMessage {
  type: "error";
  id?: string;
  payload: {
    code: string;
    message: string;
  };
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent extends BaseMessage {
  type: "log";
  payload: LogEntry;
}

export interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  timestamp: string;
}

export type CoreMessage =
  | HelloEvent
  | PongEvent
  | DocumentCreatedEvent
  | DocumentStateEvent
  | SessionStateEvent
  | ViewportStateEvent
  | DocumentExportedEvent
  | DocumentSavedEvent
  | LogEvent
  | ErrorEvent;

export interface PingCommand {
  id: string;
  type: "ping";
  payload: Record<string, never>;
}

export interface CreateDocumentCommand {
  id: string;
  type: "create_document";
  payload: Record<string, never>;
}

export interface GetDocumentStateCommand {
  id: string;
  type: "get_document_state";
  payload: Record<string, never>;
}

export interface GetSessionStateCommand {
  id: string;
  type: "get_session_state";
  payload: Record<string, never>;
}

export interface GetViewportStateCommand {
  id: string;
  type: "get_viewport_state";
  payload: Record<string, never>;
}

export interface ExportDocumentCommand {
  id: string;
  type: "export_document";
  payload: {
    file_path: string;
  };
}

export interface ExportDocumentStlCommand {
  id: string;
  type: "export_document_stl";
  payload: {
    file_path: string;
  };
}

export interface SaveDocumentCommand {
  id: string;
  type: "save_document";
  payload: {
    file_path: string;
  };
}

export interface LoadDocumentCommand {
  id: string;
  type: "load_document";
  payload: {
    file_path: string;
  };
}

export interface ProjectFaceIntoSketchCommand {
  id: string;
  type: "project_face_into_sketch";
  payload: {
    face_id: string;
  };
}

export interface ProjectProfileIntoSketchCommand {
  id: string;
  type: "project_profile_into_sketch";
  payload: {
    profile_id: string;
  };
}

export interface ProjectEdgeIntoSketchCommand {
  id: string;
  type: "project_edge_into_sketch";
  payload: {
    edge_id: string;
  };
}

export interface ProjectVertexIntoSketchCommand {
  id: string;
  type: "project_vertex_into_sketch";
  payload: {
    vertex_id: string;
  };
}

export interface AddBoxFeatureCommand {
  id: string;
  type: "add_box_feature";
  payload: {
    width: number;
    height: number;
    depth: number;
  };
}

export interface AddCylinderFeatureCommand {
  id: string;
  type: "add_cylinder_feature";
  payload: {
    radius: number;
    height: number;
  };
}

export interface UpdateBoxFeatureCommand {
  id: string;
  type: "update_box_feature";
  payload: {
    feature_id: string;
    width: number;
    height: number;
    depth: number;
  };
}

export interface UpdateCylinderFeatureCommand {
  id: string;
  type: "update_cylinder_feature";
  payload: {
    feature_id: string;
    radius: number;
    height: number;
  };
}

export interface UpdateExtrudeDepthCommand {
  id: string;
  type: "update_extrude_depth";
  payload: {
    feature_id: string;
    depth: number;
  };
}

export interface SetFeatureSuppressedCommand {
  id: string;
  type: "set_feature_suppressed";
  payload: {
    feature_id: string;
    suppressed: boolean;
  };
}

export interface RenameFeatureCommand {
  id: string;
  type: "rename_feature";
  payload: {
    feature_id: string;
    name: string;
  };
}

export interface DeleteFeatureCommand {
  id: string;
  type: "delete_feature";
  payload: {
    feature_id: string;
  };
}

export interface UndoCommand {
  id: string;
  type: "undo";
  payload: Record<string, never>;
}

export interface RedoCommand {
  id: string;
  type: "redo";
  payload: Record<string, never>;
}

export interface SetTimelineCursorCommand {
  id: string;
  type: "set_timeline_cursor";
  payload: {
    included_action_count: number;
  };
}

export interface SelectFeatureCommand {
  id: string;
  type: "select_feature";
  payload: {
    feature_id: string;
  };
}

export interface SelectReferenceCommand {
  id: string;
  type: "select_reference";
  payload: {
    reference_id: string;
  };
}

export interface SelectFaceCommand {
  id: string;
  type: "select_face";
  payload: {
    face_id: string;
  };
}

export interface SelectEdgeCommand {
  id: string;
  type: "select_edge";
  payload: {
    edge_id: string;
    // When true, the edge is toggled into the existing edge
    // selection set (shift-click). When false / omitted, it replaces
    // the previous edge selection.
    additive: boolean;
  };
}

export interface SelectVertexCommand {
  id: string;
  type: "select_vertex";
  payload: {
    // Mirrors SelectEdgeCommand: shift-click toggles into the
    // multi-vertex set; plain click replaces.
    additive: boolean;
    vertex_id: string;
  };
}

export interface CreateFilletCommand {
  id: string;
  type: "create_fillet";
  payload: {
    // One or more edges (must all share the same owner body — the
    // core rejects mixed-body selections).
    edge_ids: string[];
    radius: number;
  };
}

export interface UpdateFilletRadiusCommand {
  id: string;
  type: "update_fillet_radius";
  payload: {
    feature_id: string;
    radius: number;
  };
}

export interface UpdateFilletEdgesCommand {
  id: string;
  type: "update_fillet_edges";
  payload: {
    feature_id: string;
    edge_ids: string[];
  };
}

export interface UpdateChamferEdgesCommand {
  id: string;
  type: "update_chamfer_edges";
  payload: {
    feature_id: string;
    edge_ids: string[];
  };
}

export interface CreateChamferCommand {
  id: string;
  type: "create_chamfer";
  payload: {
    edge_ids: string[];
    distance: number;
  };
}

export interface UpdateChamferDistanceCommand {
  id: string;
  type: "update_chamfer_distance";
  payload: {
    feature_id: string;
    distance: number;
  };
}

export interface ConfirmFilletCommand {
  id: string;
  type: "confirm_fillet";
  payload: {
    feature_id: string;
  };
}

export interface ConfirmChamferCommand {
  id: string;
  type: "confirm_chamfer";
  payload: {
    feature_id: string;
  };
}

// Create a parametric offset construction plane. `source_plane_id`
// must resolve to a plane the core knows about (origin plane,
// existing construction plane, or "<body_id>:face:<index>" face id).
export interface CreateOffsetPlaneCommand {
  id: string;
  type: "create_offset_plane";
  payload: {
    source_plane_id: string;
    offset: number;
  };
}

// Live-edit an existing construction plane's offset. The core
// re-derives the cached frame from the source's current frame, so
// chained planes / face-source planes update correctly.
export interface UpdateOffsetPlaneCommand {
  id: string;
  type: "update_offset_plane";
  payload: {
    feature_id: string;
    offset: number;
  };
}

export interface StartSketchOnPlaneCommand {
  id: string;
  type: "start_sketch_on_plane";
  payload: {
    reference_id: string;
  };
}

export interface StartSketchOnFaceCommand {
  id: string;
  type: "start_sketch_on_face";
  payload: {
    face_id: string;
    plane_frame: PlaneFrame;
  };
}

export interface AddSketchLineCommand {
  id: string;
  type: "add_sketch_line";
  payload: {
    start_x: number;
    start_y: number;
    end_x: number;
    end_y: number;
    is_construction: boolean;
  };
}

export interface SetSketchLineConstructionCommand {
  id: string;
  type: "set_sketch_line_construction";
  payload: {
    line_id: string;
    is_construction: boolean;
  };
}

export interface SetSketchMidpointAnchorCommand {
  id: string;
  type: "set_sketch_midpoint_anchor";
  payload: {
    point_id: string;
    // Empty string clears any existing anchor for the point.
    host_line_id: string;
  };
}

export interface AddSketchAngleDimensionCommand {
  id: string;
  type: "add_sketch_angle_dimension";
  payload: {
    first_line_id: string;
    second_line_id: string;
  };
}

export interface AddSketchDistanceDimensionCommand {
  id: string;
  type: "add_sketch_distance_dimension";
  payload: {
    first_entity_id: string;
    second_entity_id: string;
  };
}

export interface AddSketchLineLengthDimensionCommand {
  id: string;
  type: "add_sketch_line_length_dimension";
  payload: {
    line_id: string;
  };
}

export interface AddSketchCircleRadiusDimensionCommand {
  id: string;
  type: "add_sketch_circle_radius_dimension";
  payload: {
    circle_id: string;
  };
}

export interface AddSketchPolygonRadiusDimensionCommand {
  id: string;
  type: "add_sketch_polygon_radius_dimension";
  payload: {
    polygon_id: string;
  };
}

export interface SetSketchPointLineAnchorCommand {
  id: string;
  type: "set_sketch_point_line_anchor";
  payload: {
    point_id: string;
    // Empty string clears any existing anchor for the point.
    host_line_id: string;
    // Parametric position along the host line, clamped to [0, 1] by
    // the core. 0 = host start, 1 = host end.
    t: number;
  };
}

export interface AddSketchRectangleCommand {
  id: string;
  type: "add_sketch_rectangle";
  payload: {
    start_x: number;
    start_y: number;
    end_x: number;
    end_y: number;
    is_construction: boolean;
  };
}

export interface AddSketchCircleCommand {
  id: string;
  type: "add_sketch_circle";
  payload: {
    center_x: number;
    center_y: number;
    radius: number;
    is_construction: boolean;
  };
}

export interface AddSketchPolygonCommand {
  id: string;
  type: "add_sketch_polygon";
  payload: {
    sides: number;
    mode: string;
    start_x: number;
    start_y: number;
    end_x: number;
    end_y: number;
    is_construction: boolean;
  };
}

// Add an arc to the active sketch. The third anchor's interpretation
// depends on `mode`:
//   - "three_point": (start, end, anchor) where anchor lies on the
//     arc and fixes the bulge. Center is the circumcenter of the
//     three points.
//   - "center_start_end": anchor is the center; radius derives from
//     |center - start|, and the end point is snapped onto the
//     resulting circle.
export interface AddSketchArcCommand {
  id: string;
  type: "add_sketch_arc";
  payload: {
    start_x: number;
    start_y: number;
    end_x: number;
    end_y: number;
    anchor_x: number;
    anchor_y: number;
    mode: "three_point" | "center_start_end";
    is_construction: boolean;
  };
}

// Round a corner shared by two sketch lines into a tangent arc.
// `corner_point_id` must be an endpoint of both lines; the v1 core
// rejects mismatches and oversized radii with a structured error.
export interface AddSketchFilletCommand {
  id: string;
  type: "add_sketch_fillet";
  payload: {
    corner_point_id: string;
    line_a_id: string;
    line_b_id: string;
    radius: number;
  };
}

export interface UpdateSketchFilletRadiusCommand {
  id: string;
  type: "update_sketch_fillet_radius";
  payload: {
    fillet_id: string;
    radius: number;
  };
}

export interface DeleteSketchFilletCommand {
  id: string;
  type: "delete_sketch_fillet";
  payload: {
    fillet_id: string;
  };
}

export interface DeleteSketchDimensionCommand {
  id: string;
  type: "delete_sketch_dimension";
  payload: {
    dimension_id: string;
  };
}

export interface TrimSketchEntityCommand {
  id: string;
  type: "trim_sketch_entity";
  payload: {
    entity_id: string;
    click_x: number;
    click_y: number;
  };
}

export interface DeleteSketchSelectionCommand {
  id: string;
  type: "delete_sketch_selection";
  payload: {
    entity_ids: string[];
    point_ids: string[];
    profile_ids: string[];
  };
}

export interface SetSketchToolCommand {
  id: string;
  type: "set_sketch_tool";
  payload: {
    tool: SketchTool;
  };
}

export interface UpdateSketchLineCommand {
  id: string;
  type: "update_sketch_line";
  payload: {
    line_id: string;
    start_x: number;
    start_y: number;
    end_x: number;
    end_y: number;
  };
}

export interface UpdateSketchPointCommand {
  id: string;
  type: "update_sketch_point";
  payload: {
    point_id: string;
    x: number;
    y: number;
  };
}

export interface SetSketchLineConstraintCommand {
  id: string;
  type: "set_sketch_line_constraint";
  payload: {
    line_id: string;
    constraint: "none" | "horizontal" | "vertical";
  };
}

export interface SetSketchEqualLengthConstraintCommand {
  id: string;
  type: "set_sketch_equal_length_constraint";
  payload: {
    line_id: string;
    other_line_id: string;
  };
}

export interface SetSketchPerpendicularConstraintCommand {
  id: string;
  type: "set_sketch_perpendicular_constraint";
  payload: {
    line_id: string;
    other_line_id: string;
  };
}

// Mirror tool — contextual modeling pending preview lifecycle. See
// `wiki/polysmith.wiki/Contextual-Modeling-Workflow.md` and
// `core/sketch_feature.h`.
export interface StartMirrorPreviewCommand {
  id: string;
  type: "start_mirror_preview";
  payload: Record<string, never>;
}

export interface UpdateMirrorPreviewAxisCommand {
  id: string;
  type: "update_mirror_preview_axis";
  payload: {
    // Empty string clears the axis (preview drops to no geometry).
    axis_line_id: string;
  };
}

export interface UpdateMirrorPreviewObjectsCommand {
  id: string;
  type: "update_mirror_preview_objects";
  payload: {
    object_ids: string[];
  };
}

export interface CommitMirrorPreviewCommand {
  id: string;
  type: "commit_mirror_preview";
  payload: Record<string, never>;
}

export interface CancelMirrorPreviewCommand {
  id: string;
  type: "cancel_mirror_preview";
  payload: Record<string, never>;
}

export interface SetSketchTangentConstraintCommand {
  id: string;
  type: "set_sketch_tangent_constraint";
  payload: {
    line_id: string;
    // Empty string clears any existing tangent relation on the line.
    circle_id: string;
  };
}

export interface SetSketchParallelConstraintCommand {
  id: string;
  type: "set_sketch_parallel_constraint";
  payload: {
    line_id: string;
    other_line_id: string;
  };
}

export interface SetSketchCoincidentConstraintCommand {
  id: string;
  type: "set_sketch_coincident_constraint";
  payload: {
    point_id: string;
    other_point_id: string;
  };
}

export interface SetSketchPointFixedCommand {
  id: string;
  type: "set_sketch_point_fixed";
  payload: {
    point_id: string;
    is_fixed: boolean;
  };
}

export interface UpdateSketchCircleCommand {
  id: string;
  type: "update_sketch_circle";
  payload: {
    circle_id: string;
    center_x: number;
    center_y: number;
    radius: number;
  };
}

export interface ParameterEntry {
  name: string;
  expression: string;
  resolved_value: number;
  kind: "length" | "angle";
  has_error: boolean;
  error_message: string;
}

export interface AddParameterCommand {
  id: string;
  type: "add_parameter";
  payload: {
    name: string;
    expression: string;
    kind?: "length" | "angle";
  };
}

export interface UpdateParameterCommand {
  id: string;
  type: "update_parameter";
  payload: {
    name: string;
    expression: string;
    kind?: "length" | "angle";
  };
}

export interface DeleteParameterCommand {
  id: string;
  type: "delete_parameter";
  payload: {
    name: string;
  };
}

export interface UpdateSelectionFilterCommand {
  id: string;
  type: "update_selection_filter";
  payload: {
    select_curves?: boolean;
    select_points?: boolean;
    select_construction?: boolean;
    select_constraints?: boolean;
    snap_endpoint?: boolean;
    snap_midpoint?: boolean;
    snap_center?: boolean;
    snap_intersection?: boolean;
    snap_nearest?: boolean;
    snap_quadrant?: boolean;
    snap_perpendicular?: boolean;
    snap_parallel?: boolean;
    snap_tangent?: boolean;
    snap_grid?: boolean;
    magnetic_pull?: boolean;
    tolerance_px?: number;
  };
}

export interface UpdateSketchDimensionCommand {
  id: string;
  type: "update_sketch_dimension";
  payload: {
    dimension_id: string;
    value: number | string;
  };
}

export interface SelectSketchProfileCommand {
  id: string;
  type: "select_sketch_profile";
  payload: {
    profile_id: string;
    additive?: boolean;
  };
}

export type ExtrudeMode = "new_body" | "join" | "cut";

export interface ExtrudeProfileCommand {
  id: string;
  type: "extrude_profile";
  payload: {
    profile_id?: string;
    profile_ids?: string[];
    depth: number;
    mode?: ExtrudeMode;
    target_body_id?: string;
  };
}

export interface ExtrudeFaceCommand {
  id: string;
  type: "extrude_face";
  payload: {
    face_id: string;
    depth: number;
    mode?: ExtrudeMode;
    target_body_id?: string;
  };
}

export interface UpdateExtrudeModeCommand {
  id: string;
  type: "update_extrude_mode";
  payload: {
    feature_id: string;
    mode: ExtrudeMode;
  };
}

export interface UpdateExtrudeTargetBodyCommand {
  id: string;
  type: "update_extrude_target_body";
  payload: {
    feature_id: string;
    // Omit (or set undefined) to clear the explicit target and fall back
    // to the most recent body.
    target_body_id?: string;
  };
}

export interface UpdateExtrudeProfilesCommand {
  id: string;
  type: "update_extrude_profiles";
  payload: {
    feature_id: string;
    profile_ids: string[];
  };
}

export interface LoftProfilesCommand {
  id: string;
  type: "loft_profiles";
  payload: {
    profile_ids: string[];
    ruled?: boolean;
  };
}

export interface UpdateLoftProfilesCommand {
  id: string;
  type: "update_loft_profiles";
  payload: {
    feature_id: string;
    profile_ids: string[];
  };
}

export interface UpdateLoftRuledCommand {
  id: string;
  type: "update_loft_ruled";
  payload: {
    feature_id: string;
    ruled: boolean;
  };
}

export interface SelectSketchEntityCommand {
  id: string;
  type: "select_sketch_entity";
  payload: {
    entity_id: string;
    additive: boolean;
  };
}

export interface SelectSketchPointCommand {
  id: string;
  type: "select_sketch_point";
  payload: {
    point_id: string;
    additive: boolean;
  };
}

export interface SelectSketchDimensionCommand {
  id: string;
  type: "select_sketch_dimension";
  payload: {
    dimension_id: string;
  };
}

export interface FinishSketchCommand {
  id: string;
  type: "finish_sketch";
  payload: Record<string, never>;
}

export interface ReenterSketchCommand {
  id: string;
  type: "reenter_sketch";
  payload: {
    feature_id: string;
  };
}

export interface ClearSelectionCommand {
  id: string;
  type: "clear_selection";
  payload: Record<string, never>;
}

export interface ShutdownCommand {
  type: "shutdown";
  payload?: Record<string, never>;
}

export type CoreCommand =
  | PingCommand
  | CreateDocumentCommand
  | GetDocumentStateCommand
  | GetSessionStateCommand
  | GetViewportStateCommand
  | ExportDocumentCommand
  | ExportDocumentStlCommand
  | SaveDocumentCommand
  | LoadDocumentCommand
  | ProjectFaceIntoSketchCommand
  | ProjectProfileIntoSketchCommand
  | ProjectEdgeIntoSketchCommand
  | ProjectVertexIntoSketchCommand
  | AddBoxFeatureCommand
  | AddCylinderFeatureCommand
  | UpdateBoxFeatureCommand
  | UpdateCylinderFeatureCommand
  | UpdateExtrudeDepthCommand
  | UpdateExtrudeModeCommand
  | UpdateExtrudeTargetBodyCommand
  | UpdateExtrudeProfilesCommand
  | LoftProfilesCommand
  | UpdateLoftProfilesCommand
  | UpdateLoftRuledCommand
  | RenameFeatureCommand
  | SetFeatureSuppressedCommand
  | DeleteFeatureCommand
  | UndoCommand
  | RedoCommand
  | SetTimelineCursorCommand
  | SelectFeatureCommand
  | SelectReferenceCommand
  | SelectFaceCommand
  | SelectEdgeCommand
  | SelectVertexCommand
  | CreateFilletCommand
  | UpdateFilletRadiusCommand
  | UpdateFilletEdgesCommand
  | ConfirmFilletCommand
  | CreateChamferCommand
  | UpdateChamferDistanceCommand
  | UpdateChamferEdgesCommand
  | ConfirmChamferCommand
  | CreateOffsetPlaneCommand
  | UpdateOffsetPlaneCommand
  | StartSketchOnPlaneCommand
  | StartSketchOnFaceCommand
  | SetSketchToolCommand
  | UpdateSketchLineCommand
  | UpdateSketchPointCommand
  | SetSketchLineConstraintCommand
  | SetSketchEqualLengthConstraintCommand
  | SetSketchPerpendicularConstraintCommand
  | SetSketchTangentConstraintCommand
  | StartMirrorPreviewCommand
  | UpdateMirrorPreviewAxisCommand
  | UpdateMirrorPreviewObjectsCommand
  | CommitMirrorPreviewCommand
  | CancelMirrorPreviewCommand
  | SetSketchParallelConstraintCommand
  | SetSketchCoincidentConstraintCommand
  | SetSketchPointFixedCommand
  | UpdateSketchCircleCommand
  | UpdateSketchDimensionCommand
  | SelectSketchProfileCommand
  | AddSketchDistanceDimensionCommand
  | ExtrudeProfileCommand
  | ExtrudeFaceCommand
  | AddSketchLineCommand
  | SetSketchLineConstructionCommand
  | SetSketchMidpointAnchorCommand
  | SetSketchPointLineAnchorCommand
  | AddSketchAngleDimensionCommand
  | AddSketchLineLengthDimensionCommand
  | AddSketchCircleRadiusDimensionCommand
  | AddSketchPolygonRadiusDimensionCommand
  | AddSketchRectangleCommand
  | AddSketchCircleCommand
  | AddSketchPolygonCommand
  | AddSketchArcCommand
  | AddSketchFilletCommand
  | UpdateSketchFilletRadiusCommand
  | DeleteSketchFilletCommand
  | DeleteSketchDimensionCommand
  | TrimSketchEntityCommand
  | DeleteSketchSelectionCommand
  | SelectSketchPointCommand
  | SelectSketchEntityCommand
  | SelectSketchDimensionCommand
  | FinishSketchCommand
  | ReenterSketchCommand
  | ClearSelectionCommand
  | AddParameterCommand
  | UpdateParameterCommand
  | DeleteParameterCommand
  | UpdateSelectionFilterCommand
  | ShutdownCommand;
