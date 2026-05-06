import {
  FeatureEntry,
  ViewportBoxPrimitive,
  ViewportCylinderPrimitive,
  ViewportPolygonExtrudePrimitive,
  ViewportReferenceAxis,
  ViewportReferencePlane,
  ViewportSceneBounds,
  ViewportSketchCircle,
  ViewportSketchConstraint,
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
  selected_sketch_dimension_id: string | null;
  selected_sketch_profile_id: string | null;
  feature_history: FeatureEntry[];
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
// to be removed, mirroring Fusion's behavior.
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
  format: "step";
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

export type CoreMessage =
  | HelloEvent
  | PongEvent
  | DocumentCreatedEvent
  | DocumentStateEvent
  | SessionStateEvent
  | ViewportStateEvent
  | DocumentExportedEvent
  | DocumentSavedEvent
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
  };
}

export interface AddSketchCircleCommand {
  id: string;
  type: "add_sketch_circle";
  payload: {
    center_x: number;
    center_y: number;
    radius: number;
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

// Mirror tool — Fusion-style pending preview lifecycle. See
// `docs/architecture/fusion-style-behavior.md` and
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

export interface UpdateSketchDimensionCommand {
  id: string;
  type: "update_sketch_dimension";
  payload: {
    dimension_id: string;
    value: number;
  };
}

export interface SelectSketchProfileCommand {
  id: string;
  type: "select_sketch_profile";
  payload: {
    profile_id: string;
  };
}

export type ExtrudeMode = "new_body" | "join" | "cut";

export interface ExtrudeProfileCommand {
  id: string;
  type: "extrude_profile";
  payload: {
    profile_id: string;
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

export interface SelectSketchEntityCommand {
  id: string;
  type: "select_sketch_entity";
  payload: {
    entity_id: string;
  };
}

export interface SelectSketchPointCommand {
  id: string;
  type: "select_sketch_point";
  payload: {
    point_id: string;
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
  | AddBoxFeatureCommand
  | AddCylinderFeatureCommand
  | UpdateBoxFeatureCommand
  | UpdateCylinderFeatureCommand
  | UpdateExtrudeDepthCommand
  | UpdateExtrudeModeCommand
  | UpdateExtrudeTargetBodyCommand
  | RenameFeatureCommand
  | SetFeatureSuppressedCommand
  | DeleteFeatureCommand
  | UndoCommand
  | RedoCommand
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
  | ExtrudeProfileCommand
  | AddSketchLineCommand
  | SetSketchLineConstructionCommand
  | SetSketchMidpointAnchorCommand
  | SetSketchPointLineAnchorCommand
  | AddSketchAngleDimensionCommand
  | AddSketchRectangleCommand
  | AddSketchCircleCommand
  | SelectSketchPointCommand
  | SelectSketchEntityCommand
  | SelectSketchDimensionCommand
  | FinishSketchCommand
  | ReenterSketchCommand
  | ClearSelectionCommand
  | ShutdownCommand;
