import type {
  SketchTool,
  CoreCommand,
  CoreMessage,
  DocumentState,
  DocumentExportResult,
  ErrorEvent,
  ExtrudeMode,
  ViewportState,
} from "@/types";

import { coreMessageSchema } from "./schemas/ipcSchema";

export function parseCoreMessage(input: unknown): CoreMessage {
  return coreMessageSchema.parse(input) as CoreMessage;
}

export function makePingCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "ping",
    payload: {},
  };
}

export function makeCreateDocumentCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "create_document",
    payload: {},
  };
}

export function makeGetDocumentStateCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "get_document_state",
    payload: {},
  };
}

export function makeGetSessionStateCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "get_session_state",
    payload: {},
  };
}

export function makeGetViewportStateCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "get_viewport_state",
    payload: {},
  };
}

export function makeExportDocumentCommand(filePath: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "export_document",
    payload: {
      file_path: filePath,
    },
  };
}

export function makeExportDocumentStlCommand(filePath: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "export_document_stl",
    payload: {
      file_path: filePath,
    },
  };
}

export function makeSaveDocumentCommand(filePath: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "save_document",
    payload: {
      file_path: filePath,
    },
  };
}

export function makeLoadDocumentCommand(filePath: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "load_document",
    payload: {
      file_path: filePath,
    },
  };
}

export function makeProjectFaceIntoSketchCommand(faceId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "project_face_into_sketch",
    payload: {
      face_id: faceId,
    },
  };
}

export function makeProjectEdgeIntoSketchCommand(edgeId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "project_edge_into_sketch",
    payload: {
      edge_id: edgeId,
    },
  };
}

export function makeProjectVertexIntoSketchCommand(
  vertexId: string,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "project_vertex_into_sketch",
    payload: {
      vertex_id: vertexId,
    },
  };
}

export function makeAddBoxFeatureCommand(
  width: number,
  height: number,
  depth: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "add_box_feature",
    payload: {
      width,
      height,
      depth,
    },
  };
}

export function makeAddCylinderFeatureCommand(
  radius: number,
  height: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "add_cylinder_feature",
    payload: {
      radius,
      height,
    },
  };
}

export function makeUpdateBoxFeatureCommand(
  featureId: string,
  width: number,
  height: number,
  depth: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_box_feature",
    payload: {
      feature_id: featureId,
      width,
      height,
      depth,
    },
  };
}

export function makeUpdateCylinderFeatureCommand(
  featureId: string,
  radius: number,
  height: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_cylinder_feature",
    payload: {
      feature_id: featureId,
      radius,
      height,
    },
  };
}

export function makeSetFeatureSuppressedCommand(
  featureId: string,
  suppressed: boolean,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_feature_suppressed",
    payload: {
      feature_id: featureId,
      suppressed,
    },
  };
}

export function makeUpdateExtrudeDepthCommand(
  featureId: string,
  depth: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_extrude_depth",
    payload: {
      feature_id: featureId,
      depth,
    },
  };
}

export function makeRenameFeatureCommand(
  featureId: string,
  name: string,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "rename_feature",
    payload: {
      feature_id: featureId,
      name,
    },
  };
}

export function makeDeleteFeatureCommand(featureId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "delete_feature",
    payload: {
      feature_id: featureId,
    },
  };
}

export function makeUndoCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "undo",
    payload: {},
  };
}

export function makeRedoCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "redo",
    payload: {},
  };
}

export function makeSelectFeatureCommand(featureId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_feature",
    payload: {
      feature_id: featureId,
    },
  };
}

export function makeSelectReferenceCommand(referenceId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_reference",
    payload: {
      reference_id: referenceId,
    },
  };
}

export function makeSelectFaceCommand(faceId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_face",
    payload: {
      face_id: faceId,
    },
  };
}

export function makeSelectEdgeCommand(
  edgeId: string,
  additive: boolean,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_edge",
    payload: {
      edge_id: edgeId,
      additive,
    },
  };
}

export function makeSelectVertexCommand(
  vertexId: string,
  additive: boolean,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_vertex",
    payload: {
      vertex_id: vertexId,
      additive,
    },
  };
}

export function makeCreateFilletCommand(
  edgeIds: readonly string[],
  radius: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "create_fillet",
    payload: {
      edge_ids: [...edgeIds],
      radius,
    },
  };
}

export function makeUpdateFilletEdgesCommand(
  featureId: string,
  edgeIds: readonly string[],
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_fillet_edges",
    payload: {
      feature_id: featureId,
      edge_ids: [...edgeIds],
    },
  };
}

export function makeUpdateChamferEdgesCommand(
  featureId: string,
  edgeIds: readonly string[],
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_chamfer_edges",
    payload: {
      feature_id: featureId,
      edge_ids: [...edgeIds],
    },
  };
}

export function makeUpdateFilletRadiusCommand(
  featureId: string,
  radius: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_fillet_radius",
    payload: {
      feature_id: featureId,
      radius,
    },
  };
}

export function makeCreateChamferCommand(
  edgeIds: readonly string[],
  distance: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "create_chamfer",
    payload: {
      edge_ids: [...edgeIds],
      distance,
    },
  };
}

export function makeUpdateChamferDistanceCommand(
  featureId: string,
  distance: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_chamfer_distance",
    payload: {
      feature_id: featureId,
      distance,
    },
  };
}

export function makeConfirmFilletCommand(featureId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "confirm_fillet",
    payload: { feature_id: featureId },
  };
}

export function makeConfirmChamferCommand(featureId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "confirm_chamfer",
    payload: { feature_id: featureId },
  };
}

// Create a parametric offset construction plane. The source plane id
// can be one of the three origin planes ("ref-plane-xy/yz/xz"), an
// existing construction plane's feature id, or a planar body face id
// ("<body_id>:face:<index>"). The core resolves the source's frame,
// slides it along the normal by `offset`, and stores the result as a
// new `construction_plane` feature.
export function makeCreateOffsetPlaneCommand(
  sourcePlaneId: string,
  offset: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "create_offset_plane",
    payload: {
      source_plane_id: sourcePlaneId,
      offset,
    },
  };
}

export function makeUpdateOffsetPlaneCommand(
  featureId: string,
  offset: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_offset_plane",
    payload: {
      feature_id: featureId,
      offset,
    },
  };
}

export function makeStartSketchOnPlaneCommand(
  referenceId: string,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "start_sketch_on_plane",
    payload: {
      reference_id: referenceId,
    },
  };
}

export function makeStartSketchOnFaceCommand(
  faceId: string,
  planeFrame: {
    origin: { x: number; y: number; z: number };
    x_axis: { x: number; y: number; z: number };
    y_axis: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
  },
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "start_sketch_on_face",
    payload: {
      face_id: faceId,
      plane_frame: planeFrame,
    },
  };
}

export function makeSetSketchToolCommand(tool: SketchTool): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_tool",
    payload: {
      tool,
    },
  };
}

export function makeUpdateSketchLineCommand(
  lineId: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_sketch_line",
    payload: {
      line_id: lineId,
      start_x: startX,
      start_y: startY,
      end_x: endX,
      end_y: endY,
    },
  };
}

export function makeUpdateSketchPointCommand(
  pointId: string,
  x: number,
  y: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_sketch_point",
    payload: {
      point_id: pointId,
      x,
      y,
    },
  };
}

export function makeSetSketchLineConstraintCommand(
  lineId: string,
  constraint: "none" | "horizontal" | "vertical",
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_line_constraint",
    payload: {
      line_id: lineId,
      constraint,
    },
  };
}

export function makeSetSketchEqualLengthConstraintCommand(
  lineId: string,
  otherLineId: string | null,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_equal_length_constraint",
    payload: {
      line_id: lineId,
      other_line_id: otherLineId ?? "none",
    },
  };
}

export function makeSetSketchPerpendicularConstraintCommand(
  lineId: string,
  otherLineId: string | null,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_perpendicular_constraint",
    payload: {
      line_id: lineId,
      other_line_id: otherLineId ?? "none",
    },
  };
}

// Mirror tool lifecycle factories. All five mirror the C++ ops in
// `core/sketch_feature.h`. Start opens an empty pending preview;
// the two `update_*` ops drive the live preview as the user
// edits the panel; commit/cancel finish the action.
export function makeStartMirrorPreviewCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "start_mirror_preview",
    payload: {},
  };
}

export function makeUpdateMirrorPreviewAxisCommand(
  axisLineId: string | null,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_mirror_preview_axis",
    // The C++ side treats an empty string as "no axis" (clears the
    // preview), so a null/absent UI state maps to "".
    payload: { axis_line_id: axisLineId ?? "" },
  };
}

export function makeUpdateMirrorPreviewObjectsCommand(
  objectIds: string[],
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_mirror_preview_objects",
    payload: { object_ids: objectIds },
  };
}

export function makeCommitMirrorPreviewCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "commit_mirror_preview",
    payload: {},
  };
}

export function makeCancelMirrorPreviewCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "cancel_mirror_preview",
    payload: {},
  };
}

export function makeSetSketchTangentConstraintCommand(
  lineId: string,
  circleId: string,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_tangent_constraint",
    payload: {
      line_id: lineId,
      circle_id: circleId,
    },
  };
}

export function makeSetSketchParallelConstraintCommand(
  lineId: string,
  otherLineId: string | null,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_parallel_constraint",
    payload: {
      line_id: lineId,
      other_line_id: otherLineId ?? "none",
    },
  };
}

export function makeSetSketchCoincidentConstraintCommand(
  pointId: string,
  otherPointId: string,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_coincident_constraint",
    payload: {
      point_id: pointId,
      other_point_id: otherPointId,
    },
  };
}

export function makeSetSketchPointFixedCommand(
  pointId: string,
  isFixed: boolean,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_point_fixed",
    payload: {
      point_id: pointId,
      is_fixed: isFixed,
    },
  };
}

export function makeUpdateSketchCircleCommand(
  circleId: string,
  centerX: number,
  centerY: number,
  radius: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_sketch_circle",
    payload: {
      circle_id: circleId,
      center_x: centerX,
      center_y: centerY,
      radius,
    },
  };
}

export function makeUpdateSketchDimensionCommand(
  dimensionId: string,
  value: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_sketch_dimension",
    payload: {
      dimension_id: dimensionId,
      value,
    },
  };
}

export function makeSelectSketchProfileCommand(
  profileId: string,
  additive = false,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_sketch_profile",
    payload: {
      profile_id: profileId,
      additive,
    },
  };
}

export function makeExtrudeProfileCommand(
  profileIds: string | readonly string[],
  depth: number,
  mode: ExtrudeMode = "new_body",
  targetBodyId: string | null = null,
): CoreCommand {
  const ids = Array.isArray(profileIds) ? [...profileIds] : [profileIds];
  return {
    id: crypto.randomUUID(),
    type: "extrude_profile",
    payload: {
      profile_id: ids[0],
      profile_ids: ids,
      depth,
      mode,
      ...(targetBodyId ? { target_body_id: targetBodyId } : {}),
    },
  };
}

export function makeUpdateExtrudeModeCommand(
  featureId: string,
  mode: ExtrudeMode,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_extrude_mode",
    payload: {
      feature_id: featureId,
      mode,
    },
  };
}

export function makeUpdateExtrudeTargetBodyCommand(
  featureId: string,
  targetBodyId: string | null,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_extrude_target_body",
    payload: {
      feature_id: featureId,
      ...(targetBodyId ? { target_body_id: targetBodyId } : {}),
    },
  };
}

export function makeUpdateExtrudeProfilesCommand(
  featureId: string,
  profileIds: readonly string[],
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_extrude_profiles",
    payload: {
      feature_id: featureId,
      profile_ids: [...profileIds],
    },
  };
}

export function makeAddSketchLineCommand(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  isConstruction = false,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "add_sketch_line",
    payload: {
      start_x: startX,
      start_y: startY,
      end_x: endX,
      end_y: endY,
      is_construction: isConstruction,
    },
  };
}

export function makeSetSketchLineConstructionCommand(
  lineId: string,
  isConstruction: boolean,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_line_construction",
    payload: {
      line_id: lineId,
      is_construction: isConstruction,
    },
  };
}

export function makeSetSketchMidpointAnchorCommand(
  pointId: string,
  hostLineId: string,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_midpoint_anchor",
    payload: {
      point_id: pointId,
      host_line_id: hostLineId,
    },
  };
}

export function makeAddSketchAngleDimensionCommand(
  firstLineId: string,
  secondLineId: string,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "add_sketch_angle_dimension",
    payload: {
      first_line_id: firstLineId,
      second_line_id: secondLineId,
    },
  };
}

export function makeSetSketchPointLineAnchorCommand(
  pointId: string,
  hostLineId: string,
  t: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "set_sketch_point_line_anchor",
    payload: {
      point_id: pointId,
      host_line_id: hostLineId,
      t,
    },
  };
}

export function makeAddSketchRectangleCommand(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "add_sketch_rectangle",
    payload: {
      start_x: startX,
      start_y: startY,
      end_x: endX,
      end_y: endY,
    },
  };
}

export function makeAddSketchCircleCommand(
  centerX: number,
  centerY: number,
  radius: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "add_sketch_circle",
    payload: {
      center_x: centerX,
      center_y: centerY,
      radius,
    },
  };
}

// Build an `add_sketch_arc` command. `mode` is one of "three_point"
// (anchor lies on the arc and fixes the bulge) or "center_start_end"
// (anchor is the center; end is snapped onto the resulting circle).
// See `AddSketchArcCommand` in types/ipc.ts for the full contract.
export function makeAddSketchArcCommand(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  anchorX: number,
  anchorY: number,
  mode: "three_point" | "center_start_end",
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "add_sketch_arc",
    payload: {
      start_x: startX,
      start_y: startY,
      end_x: endX,
      end_y: endY,
      anchor_x: anchorX,
      anchor_y: anchorY,
      mode,
    },
  };
}

export function makeSelectSketchPointCommand(pointId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_sketch_point",
    payload: {
      point_id: pointId,
    },
  };
}

// Sketch fillet — round a corner shared by two sketch lines into a
// tangent arc. The corner is identified by the sketch point id
// shared by both lines. v1 fillets are line-line only; line-arc
// and arc-arc remain follow-ups.
export function makeAddSketchFilletCommand(
  cornerPointId: string,
  lineAId: string,
  lineBId: string,
  radius: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "add_sketch_fillet",
    payload: {
      corner_point_id: cornerPointId,
      line_a_id: lineAId,
      line_b_id: lineBId,
      radius,
    },
  };
}

export function makeUpdateSketchFilletRadiusCommand(
  filletId: string,
  radius: number,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "update_sketch_fillet_radius",
    payload: {
      fillet_id: filletId,
      radius,
    },
  };
}

export function makeDeleteSketchFilletCommand(filletId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "delete_sketch_fillet",
    payload: {
      fillet_id: filletId,
    },
  };
}

export function makeSelectSketchEntityCommand(entityId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_sketch_entity",
    payload: {
      entity_id: entityId,
    },
  };
}

export function makeSelectSketchDimensionCommand(
  dimensionId: string,
): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "select_sketch_dimension",
    payload: {
      dimension_id: dimensionId,
    },
  };
}

export function makeFinishSketchCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "finish_sketch",
    payload: {},
  };
}

export function makeReenterSketchCommand(featureId: string): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "reenter_sketch",
    payload: {
      feature_id: featureId,
    },
  };
}

export function makeClearSelectionCommand(): CoreCommand {
  return {
    id: crypto.randomUUID(),
    type: "clear_selection",
    payload: {},
  };
}

export function getDocumentFromMessage(
  message: CoreMessage,
): DocumentState | null {
  if (
    message.type === "document_created" ||
    message.type === "document_state"
  ) {
    return message.payload;
  }

  return null;
}

export function getErrorFromMessage(message: CoreMessage): ErrorEvent | null {
  if (message.type === "error") {
    return message;
  }

  return null;
}

export function getViewportFromMessage(
  message: CoreMessage,
): ViewportState | null {
  if (message.type === "viewport_state") {
    return message.payload;
  }

  return null;
}

export function getDocumentExportFromMessage(
  message: CoreMessage,
): DocumentExportResult | null {
  if (message.type === "document_exported") {
    return message.payload;
  }

  return null;
}
