import { useEffect } from "react";
import {
  onCadCoreError,
  onCadCoreEvent,
  onCadCoreExited,
  onCadCoreLog,
  sendCoreCommand,
  startCadCore,
  makeCreateDocumentCommand,
  makeAddBoxFeatureCommand,
  makeAddCylinderFeatureCommand,
  makeAddSketchArcCommand,
  makeAddSketchFilletCommand,
  makeUpdateSketchFilletRadiusCommand,
  makeDeleteSketchFilletCommand,
  makeDeleteSketchDimensionCommand,
  makeAddParameterCommand,
  makeUpdateParameterCommand,
  makeDeleteParameterCommand,
  makeDeleteSketchSelectionCommand,
  makeAddSketchCircleCommand,
  makeAddSketchPolygonCommand,
  makeAddSketchLineCommand,
  makeSetSketchLineConstructionCommand,
  makeSetSketchMidpointAnchorCommand,
  makeSetSketchPointLineAnchorCommand,
  makeAddSketchAngleDimensionCommand,
  makeAddSketchDistanceDimensionCommand,
  makeAddSketchLineLengthDimensionCommand,
  makeAddSketchCircleRadiusDimensionCommand,
  makeAddSketchPolygonRadiusDimensionCommand,
  makeAddSketchRectangleCommand,
  makeClearSelectionCommand,
  makeDeleteFeatureCommand,
  makeExportDocumentCommand,
  makeExportDocumentStlCommand,
  makeLoadDocumentCommand,
  makeProjectEdgeIntoSketchCommand,
  makeProjectFaceIntoSketchCommand,
  makeProjectProfileIntoSketchCommand,
  makeProjectVertexIntoSketchCommand,
  makeSaveDocumentCommand,
  makeFinishSketchCommand,
  makeReenterSketchCommand,
  makeGetDocumentStateCommand,
  makeGetSessionStateCommand,
  makeGetViewportStateCommand,
  makePingCommand,
  makeRedoCommand,
  makeSelectSketchProfileCommand,
  makeSelectSketchDimensionCommand,
  makeSelectSketchEntityCommand,
  makeSelectSketchPointCommand,
  makeRenameFeatureCommand,
  makeSetFeatureSuppressedCommand,
  makeSelectFeatureCommand,
  makeSelectReferenceCommand,
  makeSelectFaceCommand,
  makeSelectEdgeCommand,
  makeSelectVertexCommand,
  makeCreateFilletCommand,
  makeUpdateFilletEdgesCommand,
  makeUpdateFilletRadiusCommand,
  makeUpdateChamferEdgesCommand,
  makeCreateChamferCommand,
  makeUpdateChamferDistanceCommand,
  makeConfirmFilletCommand,
  makeConfirmChamferCommand,
  makeCreateOffsetPlaneCommand,
  makeUpdateOffsetPlaneCommand,
  makeSetSketchCoincidentConstraintCommand,
  makeSetSketchEqualLengthConstraintCommand,
  makeSetSketchParallelConstraintCommand,
  makeSetSketchPerpendicularConstraintCommand,
  makeSetSketchTangentConstraintCommand,
  makeStartMirrorPreviewCommand,
  makeUpdateMirrorPreviewAxisCommand,
  makeUpdateMirrorPreviewObjectsCommand,
  makeCommitMirrorPreviewCommand,
  makeCancelMirrorPreviewCommand,
  makeSetSketchPointFixedCommand,
  makeExtrudeFaceCommand,
  makeExtrudeProfileCommand,
  makeSetSketchLineConstraintCommand,
  makeSetSketchToolCommand,
  makeStartSketchOnPlaneCommand,
  makeStartSketchOnFaceCommand,
  makeUndoCommand,
  makeUpdateSketchCircleCommand,
  makeUpdateSketchDimensionCommand,
  makeUpdateSketchLineCommand,
  makeUpdateSketchPointCommand,
  makeUpdateBoxFeatureCommand,
  makeUpdateCylinderFeatureCommand,
  makeUpdateExtrudeDepthCommand,
  makeUpdateExtrudeModeCommand,
  makeUpdateExtrudeProfilesCommand,
  makeUpdateExtrudeTargetBodyCommand,
  parseCoreMessage,
  makeUiLogEntry,
  writeLogToConsole,
} from "@/lib";
import type { ExtrudeMode } from "@/types";

import { useCadCoreStore } from "@/state";
import { SketchTool } from "@/types";

export function useCadCore() {
  const addMessage = useCadCoreStore((state) => state.addMessage);
  const addLogEntry = useCadCoreStore((state) => state.addLogEntry);
  const handleCoreMessage = useCadCoreStore((state) => state.handleCoreMessage);
  const setStatus = useCadCoreStore((state) => state.setStatus);

  useEffect(() => {
    let disposed = false;
    const unlistenFns: Array<() => void> = [];

    async function setupListeners() {
      const unlistenEvent = await onCadCoreEvent((payload) => {
        try {
          const message = parseCoreMessage(payload);
          if (message.type === "log") {
            writeLogToConsole(message.payload);
          }
          handleCoreMessage(message);
        } catch (error) {
          const entry = makeUiLogEntry(
            "error",
            "desktop_ui",
            `parse error: ${String(error)}`,
          );
          writeLogToConsole(entry);
          addLogEntry(entry);
          addMessage(entry.message);
          setStatus("error");
        }
      });

      const unlistenLog = await onCadCoreLog((line) => {
        const entry = makeUiLogEntry("info", "cad_core_stderr", line);
        writeLogToConsole(entry);
        addLogEntry(entry);
        addMessage(`log: ${line}`);
      });

      const unlistenError = await onCadCoreError((message) => {
        const entry = makeUiLogEntry("error", "tauri_bridge", message);
        writeLogToConsole(entry);
        addLogEntry(entry);
        addMessage(`bridge error: ${message}`);
        setStatus("error");
      });

      const unlistenExited = await onCadCoreExited((message) => {
        const entry = makeUiLogEntry("warn", "cad_core", message);
        writeLogToConsole(entry);
        addLogEntry(entry);
        addMessage(`exit: ${message}`);
        setStatus("stopped");
      });

      for (const unlisten of [
        unlistenEvent,
        unlistenLog,
        unlistenError,
        unlistenExited,
      ]) {
        if (disposed) {
          unlisten();
        } else {
          unlistenFns.push(unlisten);
        }
      }
    }

    void setupListeners();

    return () => {
      disposed = true;
      for (const unlisten of unlistenFns) {
        unlisten();
      }
    };
  }, [addLogEntry, addMessage, handleCoreMessage, setStatus]);

  return {
    start: async () => {
      setStatus("starting");
      const result = await startCadCore();
      const entry = makeUiLogEntry("info", "desktop_ui", `start: ${result}`);
      writeLogToConsole(entry);
      addLogEntry(entry);
      addMessage(`start: ${result}`);
    },
    ping: async () => {
      await sendCoreCommand(makePingCommand());
    },
    createDocument: async () => {
      await sendCoreCommand(makeCreateDocumentCommand());
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    refreshDocument: async () => {
      await sendCoreCommand(makeGetDocumentStateCommand());
    },
    refreshSession: async () => {
      await sendCoreCommand(makeGetSessionStateCommand());
    },
    refreshViewport: async () => {
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    exportDocument: async (filePath: string) => {
      await sendCoreCommand(makeExportDocumentCommand(filePath));
    },
    exportDocumentStl: async (filePath: string) => {
      await sendCoreCommand(makeExportDocumentStlCommand(filePath));
    },
    saveDocument: async (filePath: string) => {
      await sendCoreCommand(makeSaveDocumentCommand(filePath));
    },
    loadDocument: async (filePath: string) => {
      await sendCoreCommand(makeLoadDocumentCommand(filePath));
      // The load command replies with `document_state`. Refresh session
      // (undo/redo flags) and viewport so the UI reflects the loaded
      // document end-to-end.
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    projectFaceIntoSketch: async (faceId: string) => {
      await sendCoreCommand(makeProjectFaceIntoSketchCommand(faceId));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    projectProfileIntoSketch: async (profileId: string) => {
      await sendCoreCommand(makeProjectProfileIntoSketchCommand(profileId));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    projectEdgeIntoSketch: async (edgeId: string) => {
      await sendCoreCommand(makeProjectEdgeIntoSketchCommand(edgeId));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    projectVertexIntoSketch: async (vertexId: string) => {
      await sendCoreCommand(makeProjectVertexIntoSketchCommand(vertexId));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addBoxFeature: async (width: number, height: number, depth: number) => {
      await sendCoreCommand(makeAddBoxFeatureCommand(width, height, depth));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addCylinderFeature: async (radius: number, height: number) => {
      await sendCoreCommand(makeAddCylinderFeatureCommand(radius, height));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateBoxFeature: async (
      featureId: string,
      width: number,
      height: number,
      depth: number,
    ) => {
      await sendCoreCommand(
        makeUpdateBoxFeatureCommand(featureId, width, height, depth),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateCylinderFeature: async (
      featureId: string,
      radius: number,
      height: number,
    ) => {
      await sendCoreCommand(
        makeUpdateCylinderFeatureCommand(featureId, radius, height),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateExtrudeDepth: async (featureId: string, depth: number) => {
      await sendCoreCommand(makeUpdateExtrudeDepthCommand(featureId, depth));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    renameFeature: async (featureId: string, name: string) => {
      await sendCoreCommand(makeRenameFeatureCommand(featureId, name));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setFeatureSuppressed: async (featureId: string, suppressed: boolean) => {
      await sendCoreCommand(
        makeSetFeatureSuppressedCommand(featureId, suppressed),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    deleteFeature: async (featureId: string) => {
      await sendCoreCommand(makeDeleteFeatureCommand(featureId));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    undo: async () => {
      await sendCoreCommand(makeUndoCommand());
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    redo: async () => {
      await sendCoreCommand(makeRedoCommand());
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectFeature: async (featureId: string) => {
      await sendCoreCommand(makeSelectFeatureCommand(featureId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectReference: async (referenceId: string) => {
      await sendCoreCommand(makeSelectReferenceCommand(referenceId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectFace: async (faceId: string) => {
      await sendCoreCommand(makeSelectFaceCommand(faceId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectEdge: async (edgeId: string, additive: boolean = false) => {
      await sendCoreCommand(makeSelectEdgeCommand(edgeId, additive));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectVertex: async (vertexId: string, additive: boolean = false) => {
      await sendCoreCommand(makeSelectVertexCommand(vertexId, additive));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    createFillet: async (edgeIds: readonly string[], radius: number) => {
      await sendCoreCommand(makeCreateFilletCommand(edgeIds, radius));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateFilletRadius: async (featureId: string, radius: number) => {
      await sendCoreCommand(makeUpdateFilletRadiusCommand(featureId, radius));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateFilletEdges: async (
      featureId: string,
      edgeIds: readonly string[],
    ) => {
      await sendCoreCommand(makeUpdateFilletEdgesCommand(featureId, edgeIds));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    createChamfer: async (edgeIds: readonly string[], distance: number) => {
      await sendCoreCommand(makeCreateChamferCommand(edgeIds, distance));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateChamferDistance: async (featureId: string, distance: number) => {
      await sendCoreCommand(
        makeUpdateChamferDistanceCommand(featureId, distance),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateChamferEdges: async (
      featureId: string,
      edgeIds: readonly string[],
    ) => {
      await sendCoreCommand(makeUpdateChamferEdgesCommand(featureId, edgeIds));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    confirmFillet: async (featureId: string) => {
      await sendCoreCommand(makeConfirmFilletCommand(featureId));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    confirmChamfer: async (featureId: string) => {
      await sendCoreCommand(makeConfirmChamferCommand(featureId));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    createOffsetPlane: async (sourcePlaneId: string, offset: number) => {
      await sendCoreCommand(
        makeCreateOffsetPlaneCommand(sourcePlaneId, offset),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateOffsetPlane: async (featureId: string, offset: number) => {
      await sendCoreCommand(makeUpdateOffsetPlaneCommand(featureId, offset));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    startSketchOnPlane: async (referenceId: string) => {
      await sendCoreCommand(makeStartSketchOnPlaneCommand(referenceId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    startSketchOnFace: async (
      faceId: string,
      planeFrame: {
        origin: { x: number; y: number; z: number };
        x_axis: { x: number; y: number; z: number };
        y_axis: { x: number; y: number; z: number };
        normal: { x: number; y: number; z: number };
      },
    ) => {
      await sendCoreCommand(makeStartSketchOnFaceCommand(faceId, planeFrame));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchTool: async (tool: SketchTool) => {
      await sendCoreCommand(makeSetSketchToolCommand(tool));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateSketchLine: async (
      lineId: string,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
    ) => {
      await sendCoreCommand(
        makeUpdateSketchLineCommand(lineId, startX, startY, endX, endY),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateSketchPoint: async (pointId: string, x: number, y: number) => {
      await sendCoreCommand(makeUpdateSketchPointCommand(pointId, x, y));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchLineConstraint: async (
      lineId: string,
      constraint: "none" | "horizontal" | "vertical",
    ) => {
      await sendCoreCommand(
        makeSetSketchLineConstraintCommand(lineId, constraint),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchEqualLengthConstraint: async (
      lineId: string,
      otherLineId: string | null,
    ) => {
      await sendCoreCommand(
        makeSetSketchEqualLengthConstraintCommand(lineId, otherLineId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchPerpendicularConstraint: async (
      lineId: string,
      otherLineId: string | null,
    ) => {
      await sendCoreCommand(
        makeSetSketchPerpendicularConstraintCommand(lineId, otherLineId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchTangentConstraint: async (lineId: string, circleId: string) => {
      await sendCoreCommand(
        makeSetSketchTangentConstraintCommand(lineId, circleId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    // Mirror tool — five-call lifecycle. Start opens the panel,
    // update_* drive the live preview, commit/cancel finish.
    startMirrorPreview: async () => {
      await sendCoreCommand(makeStartMirrorPreviewCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateMirrorPreviewAxis: async (axisLineId: string | null) => {
      await sendCoreCommand(makeUpdateMirrorPreviewAxisCommand(axisLineId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateMirrorPreviewObjects: async (objectIds: string[]) => {
      await sendCoreCommand(makeUpdateMirrorPreviewObjectsCommand(objectIds));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    commitMirrorPreview: async () => {
      await sendCoreCommand(makeCommitMirrorPreviewCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    cancelMirrorPreview: async () => {
      await sendCoreCommand(makeCancelMirrorPreviewCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchParallelConstraint: async (
      lineId: string,
      otherLineId: string | null,
    ) => {
      await sendCoreCommand(
        makeSetSketchParallelConstraintCommand(lineId, otherLineId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchCoincidentConstraint: async (
      pointId: string,
      otherPointId: string,
    ) => {
      await sendCoreCommand(
        makeSetSketchCoincidentConstraintCommand(pointId, otherPointId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchPointFixed: async (pointId: string, isFixed: boolean) => {
      await sendCoreCommand(makeSetSketchPointFixedCommand(pointId, isFixed));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateSketchCircle: async (
      circleId: string,
      centerX: number,
      centerY: number,
      radius: number,
    ) => {
      await sendCoreCommand(
        makeUpdateSketchCircleCommand(circleId, centerX, centerY, radius),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateSketchDimension: async (dimensionId: string, value: number | string) => {
      await sendCoreCommand(
        makeUpdateSketchDimensionCommand(dimensionId, value),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchLine: async (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      isConstruction = false,
    ) => {
      await sendCoreCommand(
        makeAddSketchLineCommand(startX, startY, endX, endY, isConstruction),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchLineConstruction: async (
      lineId: string,
      isConstruction: boolean,
    ) => {
      await sendCoreCommand(
        makeSetSketchLineConstructionCommand(lineId, isConstruction),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchMidpointAnchor: async (pointId: string, hostLineId: string) => {
      await sendCoreCommand(
        makeSetSketchMidpointAnchorCommand(pointId, hostLineId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    setSketchPointLineAnchor: async (
      pointId: string,
      hostLineId: string,
      t: number,
    ) => {
      await sendCoreCommand(
        makeSetSketchPointLineAnchorCommand(pointId, hostLineId, t),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchAngleDimension: async (
      firstLineId: string,
      secondLineId: string,
    ) => {
      await sendCoreCommand(
        makeAddSketchAngleDimensionCommand(firstLineId, secondLineId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchDistanceDimension: async (
      firstEntityId: string,
      secondEntityId: string,
    ) => {
      await sendCoreCommand(
        makeAddSketchDistanceDimensionCommand(firstEntityId, secondEntityId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchLineLengthDimension: async (lineId: string) => {
      await sendCoreCommand(
        makeAddSketchLineLengthDimensionCommand(lineId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchCircleRadiusDimension: async (circleId: string) => {
      await sendCoreCommand(
        makeAddSketchCircleRadiusDimensionCommand(circleId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchPolygonRadiusDimension: async (polygonId: string) => {
      await sendCoreCommand(
        makeAddSketchPolygonRadiusDimensionCommand(polygonId),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchRectangle: async (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      isConstruction = false,
    ) => {
      await sendCoreCommand(
        makeAddSketchRectangleCommand(
          startX,
          startY,
          endX,
          endY,
          isConstruction,
        ),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchCircle: async (
      centerX: number,
      centerY: number,
      radius: number,
      isConstruction = false,
    ) => {
      await sendCoreCommand(
        makeAddSketchCircleCommand(centerX, centerY, radius, isConstruction),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchPolygon: async (
      sides: number,
      mode: string,
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      isConstruction = false,
    ) => {
      await sendCoreCommand(
        makeAddSketchPolygonCommand(sides, mode, startX, startY, endX, endY, isConstruction),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchArc: async (
      startX: number,
      startY: number,
      endX: number,
      endY: number,
      anchorX: number,
      anchorY: number,
      mode: "three_point" | "center_start_end",
      isConstruction = false,
    ) => {
      await sendCoreCommand(
        makeAddSketchArcCommand(
          startX,
          startY,
          endX,
          endY,
          anchorX,
          anchorY,
          mode,
          isConstruction,
        ),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addSketchFillet: async (
      cornerPointId: string,
      lineAId: string,
      lineBId: string,
      radius: number,
    ) => {
      await sendCoreCommand(
        makeAddSketchFilletCommand(cornerPointId, lineAId, lineBId, radius),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateSketchFilletRadius: async (filletId: string, radius: number) => {
      await sendCoreCommand(
        makeUpdateSketchFilletRadiusCommand(filletId, radius),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    deleteSketchFillet: async (filletId: string) => {
      await sendCoreCommand(makeDeleteSketchFilletCommand(filletId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    deleteSketchDimension: async (dimensionId: string) => {
      await sendCoreCommand(makeDeleteSketchDimensionCommand(dimensionId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    addParameter: async (name: string, expression: string, kind: "length" | "angle" = "length") => {
      await sendCoreCommand(makeAddParameterCommand(name, expression, kind));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateParameter: async (name: string, expression: string, kind: "length" | "angle" = "length") => {
      await sendCoreCommand(makeUpdateParameterCommand(name, expression, kind));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    deleteParameter: async (name: string) => {
      await sendCoreCommand(makeDeleteParameterCommand(name));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    deleteSketchSelection: async (
      entityIds: readonly string[],
      pointIds: readonly string[],
      profileIds: readonly string[],
    ) => {
      await sendCoreCommand(
        makeDeleteSketchSelectionCommand(entityIds, pointIds, profileIds),
      );
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectSketchPoint: async (pointId: string, additive = false) => {
      await sendCoreCommand(makeSelectSketchPointCommand(pointId, additive));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectSketchEntity: async (entityId: string, additive = false) => {
      await sendCoreCommand(makeSelectSketchEntityCommand(entityId, additive));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectSketchDimension: async (dimensionId: string) => {
      await sendCoreCommand(makeSelectSketchDimensionCommand(dimensionId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    selectSketchProfile: async (profileId: string, additive = false) => {
      await sendCoreCommand(makeSelectSketchProfileCommand(profileId, additive));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    extrudeProfile: async (
      profileIds: string | readonly string[],
      depth: number,
      mode: ExtrudeMode = "new_body",
      targetBodyId: string | null = null,
    ) => {
      await sendCoreCommand(
        makeExtrudeProfileCommand(profileIds, depth, mode, targetBodyId),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    extrudeFace: async (
      faceId: string,
      depth: number,
      mode: ExtrudeMode = "new_body",
      targetBodyId: string | null = null,
    ) => {
      await sendCoreCommand(
        makeExtrudeFaceCommand(faceId, depth, mode, targetBodyId),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateExtrudeMode: async (featureId: string, mode: ExtrudeMode) => {
      await sendCoreCommand(makeUpdateExtrudeModeCommand(featureId, mode));
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateExtrudeTargetBody: async (
      featureId: string,
      targetBodyId: string | null,
    ) => {
      await sendCoreCommand(
        makeUpdateExtrudeTargetBodyCommand(featureId, targetBodyId),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    updateExtrudeProfiles: async (
      featureId: string,
      profileIds: readonly string[],
    ) => {
      await sendCoreCommand(
        makeUpdateExtrudeProfilesCommand(featureId, profileIds),
      );
      await sendCoreCommand(makeGetSessionStateCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    finishSketch: async () => {
      await sendCoreCommand(makeFinishSketchCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    reenterSketch: async (featureId: string) => {
      await sendCoreCommand(makeReenterSketchCommand(featureId));
      await sendCoreCommand(makeGetViewportStateCommand());
    },
    clearSelection: async () => {
      await sendCoreCommand(makeClearSelectionCommand());
      await sendCoreCommand(makeGetViewportStateCommand());
    },
  };
}
