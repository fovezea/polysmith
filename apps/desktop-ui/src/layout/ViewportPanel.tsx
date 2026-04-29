import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createViewportScene } from "@/lib";
import type {
  ConstraintType,
  DocumentState,
  SketchTool,
  ViewportState,
  SketchDimensionScene,
  SolidFacePlaneFrame,
  PrimitiveVisual,
  PrimitiveInteractionState,
  ReferencePlaneVisual,
  ReferencePlaneInteractionState,
  SolidFaceVisual,
  SolidFaceInteractionState,
  ViewportContextMenuState,
  SketchPreviewPoint,
} from "@/types";
import {
  applyPrimitiveVisualState,
  applyReferencePlaneVisualState,
  applySolidFaceVisualState,
  buildPrimitiveObject,
  buildReferenceAxisObject,
  buildReferencePlaneObject,
  buildSketchCircleObject,
  buildSketchConstraintObject,
  buildSketchDimensionObject,
  buildSketchLineObject,
  buildSketchPointObject,
  buildSketchProfileObject,
  buildSolidFaceObject,
  buildCutPreviewObject,
  buildSceneEdgeObject,
  buildSceneVertexObject,
  applyEdgeVisualColor,
  applyVertexVisualColor,
  disposeGroup,
  disposeMaterial,
  distanceBetweenPoints,
  frameCamera,
  frameCameraToSketchPlane,
  projectWorldPointToViewport,
  resolveSketchPlanePoint,
  SKETCH_SNAP_DISTANCE,
  themeColor,
  toWorldPoint,
} from "@/utils";

interface ViewportPanelProps {
  status: "idle" | "starting" | "connected" | "error" | "stopped";
  document: DocumentState | null;
  viewport: ViewportState | null;
  onSelectPrimitive: (primitiveId: string) => Promise<void>;
  onSelectReference: (referenceId: string) => Promise<void>;
  onSelectFace: (faceId: string) => Promise<void>;
  // `additive` is true when the user shift-clicked the edge: the
  // core toggles the edge into the existing selection rather than
  // replacing it. Other selection categories don't support multi
  // yet, so they keep their single-id callbacks.
  onSelectEdge: (edgeId: string, additive: boolean) => Promise<void>;
  // Same multi-select shape as `onSelectEdge`: shift-click toggles
  // the vertex into the existing vertex set (used by the bottom-right
  // Selection panel to show vertex-vertex distance), plain click
  // replaces.
  onSelectVertex: (vertexId: string, additive: boolean) => Promise<void>;
  onStartSketch: (referenceId: string) => Promise<void>;
  onStartSketchOnFace: (
    faceId: string,
    planeFrame: SolidFacePlaneFrame,
  ) => Promise<void>;
  onAddSketchLine: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    isConstruction: boolean,
  ) => Promise<void>;
  onSetSketchLineConstruction: (
    lineId: string,
    isConstruction: boolean,
  ) => Promise<void>;
  onSetSketchMidpointAnchor: (
    pointId: string,
    hostLineId: string,
  ) => Promise<void>;
  onSetSketchPerpendicularConstraint: (
    lineId: string,
    otherLineId: string | null,
  ) => Promise<void>;
  onAddSketchRectangle: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ) => Promise<void>;
  onAddSketchCircle: (
    centerX: number,
    centerY: number,
    radius: number,
  ) => Promise<void>;
  onSelectSketchEntity: (entityId: string) => Promise<void>;
  onPickSketchPoint: (
    pointId: string,
    kind: "endpoint" | "center",
  ) => Promise<void>;
  armedSketchConstraint:
    | null
    | { kind: "horizontal" | "vertical" | "clear" }
    | {
        kind: "equal_length" | "perpendicular" | "parallel";
        firstLineId: string | null;
      }
    | { kind: "coincident"; firstPointId: string | null };
  onCancelSketchConstraint: () => void;
  onClearSketchConstraint: (
    kind: ConstraintType,
    entityId: string,
    relatedEntityId: string | null,
  ) => Promise<void>;
  onSelectSketchDimension: (dimensionId: string) => Promise<void>;
  onUpdateSketchDimension: (
    dimensionId: string,
    value: number,
  ) => Promise<void>;
  onSelectSketchProfile: (profileId: string) => Promise<void>;
  onSetSketchTool: (tool: SketchTool) => Promise<void>;
  hiddenFeatureIds?: ReadonlySet<string>;
  hiddenSketchPlaneIds?: ReadonlySet<string>;
  hideReferences?: boolean;
}

export function ViewportPanel({
  status,
  document,
  viewport,
  onSelectPrimitive,
  onSelectReference,
  onSelectFace,
  onSelectEdge,
  onSelectVertex,
  onStartSketch,
  onStartSketchOnFace,
  onAddSketchLine,
  onSetSketchLineConstruction,
  onSetSketchMidpointAnchor,
  onSetSketchPerpendicularConstraint,
  onAddSketchRectangle,
  onAddSketchCircle,
  onSelectSketchEntity,
  onPickSketchPoint,
  armedSketchConstraint,
  onCancelSketchConstraint,
  onClearSketchConstraint,
  onSelectSketchDimension,
  onUpdateSketchDimension,
  onSelectSketchProfile,
  onSetSketchTool,
  hiddenFeatureIds,
  hiddenSketchPlaneIds,
  hideReferences,
}: ViewportPanelProps) {
  const [showReferencePlanes, setShowReferencePlanes] = useState(true);
  const [contextMenu, setContextMenu] =
    useState<ViewportContextMenuState | null>(null);
  const [sketchSnapLabel, setSketchSnapLabel] = useState<string | null>(null);
  // Floating constraint-preview badge tracked relative to the
  // viewport container. Shown next to the cursor whenever the snap
  // resolver is producing a midpoint or perpendicular snap so the
  // user sees *which* constraint the next click would auto-create
  // (Fusion convention). `kind` controls the glyph; `x`/`y` are
  // container-local pixel offsets so the overlay scrolls with the
  // viewport.
  const [constraintPreview, setConstraintPreview] = useState<{
    kind: "midpoint" | "perpendicular" | "on_line";
    x: number;
    y: number;
  } | null>(null);
  // Whether the next sketch line drop will be flagged as a
  // construction line. Mirrors Fusion's "Construction" toggle in the
  // line tool's options panel; bound to the X hotkey while the line
  // tool is armed. Stored as state for the panel checkbox + as a ref
  // so the pointer handler reads the latest value without forcing a
  // re-attach of the listener.
  const [lineToolConstruction, setLineToolConstruction] = useState(false);
  const lineToolConstructionRef = useRef(false);
  const [dimensionDraftValue, setDimensionDraftValue] = useState("");
  const [isDimensionEditorOpen, setIsDimensionEditorOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dimensionEditorRef = useRef<HTMLFormElement | null>(null);
  const dimensionInputRef = useRef<HTMLInputElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const contentGroupRef = useRef<THREE.Group | null>(null);
  const referenceGroupRef = useRef<THREE.Group | null>(null);
  const sketchGroupRef = useRef<THREE.Group | null>(null);
  const previewLineRef = useRef<THREE.Line | null>(null);
  const previewCircleRef = useRef<THREE.LineLoop | null>(null);
  const lineDraftStartRef = useRef<[number, number] | null>(null);
  const previousReferencePlaneVisibilityRef = useRef<boolean | null>(null);
  const primitiveVisualsRef = useRef(new Map<string, PrimitiveVisual>());
  const primitiveStatesRef = useRef(
    new Map<string, PrimitiveInteractionState>(),
  );
  const referencePlaneVisualsRef = useRef(
    new Map<string, ReferencePlaneVisual>(),
  );
  const referencePlaneStatesRef = useRef(
    new Map<string, ReferencePlaneInteractionState>(),
  );
  const solidFaceVisualsRef = useRef(new Map<string, SolidFaceVisual>());
  const solidFaceStatesRef = useRef(
    new Map<string, SolidFaceInteractionState>(),
  );
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const referencePlaneMeshesRef = useRef<THREE.Mesh[]>([]);
  const sketchEntityObjectsRef = useRef<Array<THREE.Line | THREE.LineLoop>>([]);
  const sketchDimensionObjectsRef = useRef<Array<THREE.Object3D>>([]);
  const sketchConstraintObjectsRef = useRef<Array<THREE.Object3D>>([]);
  const sketchPointObjectsRef = useRef<THREE.Mesh[]>([]);
  const sketchProfileMeshesRef = useRef<THREE.Mesh[]>([]);
  const faceMeshesRef = useRef<THREE.Mesh[]>([]);
  // Body edges materialized as THREE.Line objects. Raycasting against
  // these (with a small `params.Line.threshold`) drives edge picking
  // for the upcoming fillet/chamfer features. Edges are checked before
  // faces in the pick chain because they sit ON the faces and would
  // otherwise be visually occluded.
  const edgeLineObjectsRef = useRef<THREE.Line[]>([]);
  // Body vertices materialized as small sphere meshes. Raycast first so
  // a vertex picks ahead of any edge or face that lies underneath.
  const vertexObjectsRef = useRef<THREE.Mesh[]>([]);
  // Translucent red overlay meshes for in-progress cut extrudes. Built
  // from `cut_previews` and rendered without participating in raycasts.
  const cutPreviewObjectsRef = useRef<THREE.Mesh[]>([]);
  const lastGeometryKeyRef = useRef("");
  const selectPrimitiveRef = useRef(onSelectPrimitive);
  const selectReferenceRef = useRef(onSelectReference);
  const selectFaceRef = useRef(onSelectFace);
  const selectEdgeRef = useRef(onSelectEdge);
  const selectVertexRef = useRef(onSelectVertex);
  const startSketchRef = useRef(onStartSketch);
  const startSketchOnFaceRef = useRef(onStartSketchOnFace);
  const addSketchLineRef = useRef(onAddSketchLine);
  const addSketchRectangleRef = useRef(onAddSketchRectangle);
  const addSketchCircleRef = useRef(onAddSketchCircle);
  const selectSketchEntityRef = useRef(onSelectSketchEntity);
  const pickSketchPointRef = useRef(onPickSketchPoint);
  const selectSketchDimensionRef = useRef(onSelectSketchDimension);
  const updateSketchDimensionRef = useRef(onUpdateSketchDimension);
  const selectSketchProfileRef = useRef(onSelectSketchProfile);
  const selectedSketchDimensionRef = useRef<SketchDimensionScene | null>(null);
  const isDimensionEditorOpenRef = useRef(false);
  useEffect(() => {
    isDimensionEditorOpenRef.current = isDimensionEditorOpen;
  }, [isDimensionEditorOpen]);
  const setSketchToolRef = useRef(onSetSketchTool);
  const armedSketchConstraintRef = useRef(armedSketchConstraint);
  const cancelSketchConstraintRef = useRef(onCancelSketchConstraint);
  const clearSketchConstraintRef = useRef(onClearSketchConstraint);
  const activeSketchToolRef = useRef<SketchTool>("select");
  const sketchSnapCandidatesRef = useRef<
    Array<{
      local: [number, number];
      label: string;
      kind?: "midpoint" | "endpoint";
      hostLineId?: string;
      endpointHostLineId?: string;
    }>
  >([]);
  // Track host line ids for midpoint snaps that were committed during
  // a line draft. The first click of a line stores the start's host
  // (if any); the second click stores the end's host. After the
  // resulting `add_sketch_line` IPC settles, the post-add effect
  // reads the new line's start_point_id / end_point_id and dispatches
  // `set_sketch_midpoint_anchor` for each side that snapped to a
  // midpoint. The line count baseline at dispatch time guards against
  // misattributing the anchor to a later line.
  const pendingMidpointAnchorRef = useRef<{
    fromLineCount: number;
    startHostLineId: string | null;
    endHostLineId: string | null;
  } | null>(null);
  const draftStartMidpointHostRef = useRef<string | null>(null);
  // Host line id under the *start* point of the active draft. When
  // set, `resolveSnappedSketchPoint` enables perpendicular-foot snap
  // — projecting the cursor onto the perpendicular ray from the
  // start, in the direction normal to the host line.
  const draftStartEndpointHostRef = useRef<string | null>(null);
  // Pending perpendicular-constraint state, keyed against the line
  // count baseline for the same reasons as the midpoint anchor
  // pending state above. The post-add effect dispatches
  // `set_sketch_perpendicular_constraint` once the new line lands.
  const pendingPerpendicularConstraintRef = useRef<{
    fromLineCount: number;
    hostLineId: string;
  } | null>(null);
  // Latest line count for the active sketch, mirrored as a ref so the
  // pointer handler (which captures stale closures) can baseline new
  // lines for the post-add midpoint-anchor effect.
  const sketchLineCountRef = useRef(0);
  // Stable ref to `onSetSketchMidpointAnchor` so the post-add effect
  // can issue the IPC without remounting on every re-render.
  const setSketchMidpointAnchorRef = useRef(onSetSketchMidpointAnchor);
  const setSketchPerpendicularConstraintRef = useRef(
    onSetSketchPerpendicularConstraint,
  );
  // Snapshot of the sketch feature's lines for the post-add effect to
  // index into. Same pattern as the count ref above.
  const sketchLinesRef = useRef<
    NonNullable<typeof sketchFeature>["sketch_parameters"] | null
  >(null);
  const sceneData = useMemo(
    () =>
      viewport?.has_active_document
        ? createViewportScene(viewport, {
            hiddenFeatureIds,
            hiddenSketchPlaneIds,
            hideReferences,
          })
        : null,
    [viewport, hiddenFeatureIds, hiddenSketchPlaneIds, hideReferences],
  );
  const sceneDataRef = useRef(sceneData);
  useEffect(() => {
    sceneDataRef.current = sceneData;
  }, [sceneData]);
  const hasActiveDocument = Boolean(viewport?.has_active_document);
  const activeSketchPlaneId = document?.active_sketch_plane_id ?? null;
  const activeSketchTool = document?.active_sketch_tool ?? "select";
  const sketchFeature = useMemo(
    () =>
      document?.feature_history.find(
        (feature) => feature.feature_id === document.active_sketch_feature_id,
      ) ?? null,
    [document],
  );
  const selectedPrimitiveLabel = useMemo(() => {
    const selectedBox = viewport?.boxes.find((box) => box.is_selected);
    if (selectedBox) {
      return selectedBox.label;
    }

    const selectedCylinder = viewport?.cylinders.find(
      (cylinder) => cylinder.is_selected,
    );
    if (selectedCylinder) {
      return selectedCylinder.label;
    }

    const selectedPolygonExtrude = viewport?.polygon_extrudes.find(
      (primitive) => primitive.is_selected,
    );
    return selectedPolygonExtrude?.label ?? null;
  }, [viewport]);
  const selectedReference = useMemo(
    () =>
      viewport?.reference_planes.find(
        (referencePlane) => referencePlane.is_selected,
      ) ?? null,
    [viewport],
  );
  // Live "quick measurement" readout for the bottom-right Selection
  // panel, mirroring Fusion's behavior where a single edge shows its
  // length and two vertices show their straight-line distance. Edge
  // length is computed by the core (BRepGProp) and shipped on the
  // viewport edge primitive; vertex distance is a trivial Euclidean
  // calc on world-space positions the core already gave us, so we do
  // it inline rather than round-tripping a `measure` command. Anything
  // outside those two cases returns null so the row is hidden.
  const measurementText = useMemo(() => {
    if (!document || !viewport) {
      return null;
    }
    if (document.selected_edge_ids.length === 1) {
      const edge = viewport.edges.find(
        (entry) => entry.id === document.selected_edge_ids[0],
      );
      if (edge) {
        return `Length: ${edge.length.toFixed(2)} mm`;
      }
    }
    if (document.selected_vertex_ids.length === 2) {
      const [aId, bId] = document.selected_vertex_ids;
      const a = viewport.vertices.find((entry) => entry.id === aId);
      const b = viewport.vertices.find((entry) => entry.id === bId);
      if (a && b) {
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const dz = a.position.z - b.position.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        return `Distance: ${distance.toFixed(2)} mm`;
      }
    }
    return null;
  }, [document, viewport]);
  const selectedSketchDimension = useMemo(
    () =>
      document?.selected_sketch_dimension_id
        ? (sceneData?.sketchDimensions.find(
            (dimension) =>
              dimension.dimensionId === document.selected_sketch_dimension_id,
          ) ?? null)
        : null,
    [document?.selected_sketch_dimension_id, sceneData],
  );
  const selectedSketchDimensionValue = useMemo(
    () =>
      document?.selected_sketch_dimension_id && sketchFeature?.sketch_parameters
        ? (sketchFeature.sketch_parameters.dimensions.find(
            (dimension) =>
              dimension.dimension_id === document.selected_sketch_dimension_id,
          )?.value ?? null)
        : null,
    [document?.selected_sketch_dimension_id, sketchFeature],
  );
  // The currently-selected sketch line, if any. Used by the Line Tool
  // panel to surface a "Construction" toggle for the existing line so
  // the user can flip an already-drawn line into reference geometry
  // (Fusion convention).
  const selectedSketchLine = useMemo(() => {
    if (!sketchFeature?.sketch_parameters) {
      return null;
    }
    const entityId = document?.selected_sketch_entity_id;
    if (!entityId) {
      return null;
    }
    return (
      sketchFeature.sketch_parameters.lines.find(
        (line) => line.line_id === entityId,
      ) ?? null
    );
  }, [sketchFeature, document?.selected_sketch_entity_id]);
  const sketchSnapCandidates = useMemo(() => {
    if (!sketchFeature?.sketch_parameters) {
      return [];
    }

    // Endpoint candidates carry an optional `endpointHostLineId` so
    // the line tool can recognize when a draft started at an existing
    // line's endpoint and arm perpendicular-snap from that line.
    // Midpoint candidates carry `hostLineId` for the post-commit
    // midpoint anchor IPC.
    type Candidate = {
      local: [number, number];
      label: string;
      kind?: "midpoint" | "endpoint";
      hostLineId?: string;
      endpointHostLineId?: string;
    };
    const candidates: Candidate[] = [{ local: [0, 0], label: "Origin" }];
    for (const line of sketchFeature.sketch_parameters.lines) {
      candidates.push({
        local: [line.start_x, line.start_y],
        label:
          line.constraint === "horizontal" || line.constraint === "vertical"
            ? `${line.line_id} (${line.constraint})`
            : line.line_id,
        kind: "endpoint",
        endpointHostLineId: line.line_id,
      });
      candidates.push({
        local: [line.end_x, line.end_y],
        label: line.line_id,
        kind: "endpoint",
        endpointHostLineId: line.line_id,
      });
      // Midpoint candidate. Construction lines also expose midpoints
      // — they're valid reference geometry to bind to.
      candidates.push({
        local: [
          (line.start_x + line.end_x) / 2,
          (line.start_y + line.end_y) / 2,
        ],
        label: `Midpoint of ${line.line_id}`,
        kind: "midpoint",
        hostLineId: line.line_id,
      });
    }
    for (const circle of sketchFeature.sketch_parameters.circles) {
      candidates.push({
        local: [circle.center_x, circle.center_y],
        label: circle.circle_id,
      });
    }
    return candidates;
  }, [sketchFeature]);
  const activeSketchPlaneFrame =
    sketchFeature?.sketch_parameters?.plane_frame ?? null;

  function clearPreviewLine() {
    const previewLine = previewLineRef.current;
    const sketchGroup = sketchGroupRef.current;
    if (!previewLine || !sketchGroup) {
      return;
    }

    sketchGroup.remove(previewLine);
    previewLine.geometry.dispose();
    disposeMaterial(previewLine.material);
    previewLineRef.current = null;
  }

  function clearPreviewCircle() {
    const previewCircle = previewCircleRef.current;
    const sketchGroup = sketchGroupRef.current;
    if (!previewCircle || !sketchGroup) {
      return;
    }

    sketchGroup.remove(previewCircle);
    previewCircle.geometry.dispose();
    disposeMaterial(previewCircle.material);
    previewCircleRef.current = null;
  }

  function resolveSnappedSketchPoint(rawPoint: {
    local: [number, number];
    world: [number, number, number];
  }) {
    let closestCandidate:
      | (typeof sketchSnapCandidatesRef.current)[number]
      | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of sketchSnapCandidatesRef.current) {
      const distance = distanceBetweenPoints(rawPoint.local, candidate.local);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestCandidate = candidate;
      }
    }

    // Endpoint snap (or any other static candidate) wins by default.
    if (closestCandidate && closestDistance <= SKETCH_SNAP_DISTANCE) {
      return {
        local: closestCandidate.local,
        world: toWorldPoint(
          activeSketchPlaneId ?? "ref-plane-xy",
          closestCandidate.local,
          activeSketchPlaneFrame,
        ),
        snapLabel: closestCandidate.label,
        snapMidpointHostLineId:
          closestCandidate.kind === "midpoint"
            ? (closestCandidate.hostLineId ?? null)
            : null,
        snapPerpendicularHostLineId: null,
        snapEndpointHostLineId:
          closestCandidate.kind === "endpoint"
            ? (closestCandidate.endpointHostLineId ?? null)
            : null,
      } satisfies SketchPreviewPoint;
    }

    // Dynamic perpendicular-foot snap. Active only on the second
    // click of a line draft, when the start lay on an existing line
    // (`draftStartEndpointHostRef` is set). Project the cursor onto
    // the ray rooted at the start, normal to the host line. If the
    // cursor is within snap distance of that ray, snap to the foot.
    const startPoint = lineDraftStartRef.current;
    const perpHostId = draftStartEndpointHostRef.current;
    const params = sketchLinesRef.current;
    if (startPoint && perpHostId && params) {
      const hostLine = params.lines.find((line) => line.line_id === perpHostId);
      if (hostLine) {
        const dx = hostLine.end_x - hostLine.start_x;
        const dy = hostLine.end_y - hostLine.start_y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared > 1e-12) {
          const length = Math.sqrt(lengthSquared);
          // Perpendicular direction (rotate host line direction by
          // +90°). Normalized so we can project cleanly.
          const perpX = -dy / length;
          const perpY = dx / length;
          const dxFromStart = rawPoint.local[0] - startPoint[0];
          const dyFromStart = rawPoint.local[1] - startPoint[1];
          const t = dxFromStart * perpX + dyFromStart * perpY;
          const footX = startPoint[0] + t * perpX;
          const footY = startPoint[1] + t * perpY;
          const distanceFromRay = Math.hypot(
            rawPoint.local[0] - footX,
            rawPoint.local[1] - footY,
          );
          if (distanceFromRay <= SKETCH_SNAP_DISTANCE) {
            return {
              local: [footX, footY] as [number, number],
              world: toWorldPoint(
                activeSketchPlaneId ?? "ref-plane-xy",
                [footX, footY],
                activeSketchPlaneFrame,
              ),
              snapLabel: `Perpendicular to ${perpHostId}`,
              snapMidpointHostLineId: null,
              snapPerpendicularHostLineId: perpHostId,
              snapEndpointHostLineId: null,
            } satisfies SketchPreviewPoint;
          }
        }
      }
    }

    // Line-body snap: when no point candidate matched, project the
    // cursor onto the closest sketch line segment (clamped to the
    // segment's interior). This lets the user start or end a draft
    // anywhere on an existing line, not just at its endpoints or
    // midpoint. Lower priority than every point candidate above
    // because endpoint / midpoint snaps should win when the cursor
    // is genuinely close to those features.
    const linesParams = sketchLinesRef.current;
    if (linesParams) {
      let bestLineSnap: {
        local: [number, number];
        distance: number;
        lineId: string;
      } | null = null;
      for (const line of linesParams.lines) {
        const dx = line.end_x - line.start_x;
        const dy = line.end_y - line.start_y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 1e-12) {
          continue;
        }
        // Parametric projection clamped to [0, 1] so we never snap
        // past the segment's endpoints.
        const t = Math.max(
          0,
          Math.min(
            1,
            ((rawPoint.local[0] - line.start_x) * dx +
              (rawPoint.local[1] - line.start_y) * dy) /
              lengthSquared,
          ),
        );
        const px = line.start_x + t * dx;
        const py = line.start_y + t * dy;
        const distance = Math.hypot(
          rawPoint.local[0] - px,
          rawPoint.local[1] - py,
        );
        if (distance > SKETCH_SNAP_DISTANCE) {
          continue;
        }
        if (!bestLineSnap || distance < bestLineSnap.distance) {
          bestLineSnap = { local: [px, py], distance, lineId: line.line_id };
        }
      }
      if (bestLineSnap) {
        return {
          local: bestLineSnap.local,
          world: toWorldPoint(
            activeSketchPlaneId ?? "ref-plane-xy",
            bestLineSnap.local,
            activeSketchPlaneFrame,
          ),
          snapLabel: `On ${bestLineSnap.lineId}`,
          snapMidpointHostLineId: null,
          snapPerpendicularHostLineId: null,
          snapEndpointHostLineId: null,
        } satisfies SketchPreviewPoint;
      }
    }

    return {
      local: rawPoint.local,
      world: rawPoint.world,
      snapLabel: null,
      snapMidpointHostLineId: null,
      snapPerpendicularHostLineId: null,
      snapEndpointHostLineId: null,
    } satisfies SketchPreviewPoint;
  }

  function syncPrimitiveVisuals() {
    for (const [primitiveId, visual] of primitiveVisualsRef.current.entries()) {
      const state = primitiveStatesRef.current.get(primitiveId);
      if (!state) {
        continue;
      }

      applyPrimitiveVisualState(visual, state);
    }
  }

  function syncReferencePlaneVisuals() {
    for (const [
      referenceId,
      visual,
    ] of referencePlaneVisualsRef.current.entries()) {
      const state = referencePlaneStatesRef.current.get(referenceId);
      if (!state) {
        continue;
      }

      applyReferencePlaneVisualState(visual, state);
    }
  }

  function syncSolidFaceVisuals() {
    for (const [faceId, visual] of solidFaceVisualsRef.current.entries()) {
      const state = solidFaceStatesRef.current.get(faceId);
      if (!state) {
        continue;
      }

      applySolidFaceVisualState(visual, state);
    }
  }

  function setHoveredFace(faceId: string | null) {
    let changed = false;

    for (const [id, state] of solidFaceStatesRef.current.entries()) {
      const nextHovered = id === faceId;
      if (state.isHovered !== nextHovered) {
        solidFaceStatesRef.current.set(id, {
          ...state,
          isHovered: nextHovered,
        });
        changed = true;
      }
    }

    if (changed) {
      syncSolidFaceVisuals();
    }
  }

  function setHoveredPrimitive(primitiveId: string | null) {
    let changed = false;

    for (const [id, state] of primitiveStatesRef.current.entries()) {
      const nextHovered = id === primitiveId;
      if (state.isHovered !== nextHovered) {
        primitiveStatesRef.current.set(id, {
          ...state,
          isHovered: nextHovered,
        });
        changed = true;
      }
    }

    if (changed) {
      syncPrimitiveVisuals();
    }
  }

  // Hover state for body edges / vertices. Unlike face / primitive
  // hover (which keeps a per-object state map and re-runs the visual
  // helper en masse), edges and vertices are simple THREE objects
  // built once per geometry rebuild — so we recolor materials in
  // place. `userData.isSelected` was stashed at build time so we can
  // resolve the (selected, hovered) tuple per object without reading
  // the document state here.
  const hoveredEdgeIdRef = useRef<string | null>(null);
  function setHoveredEdge(edgeId: string | null) {
    if (hoveredEdgeIdRef.current === edgeId) {
      return;
    }
    hoveredEdgeIdRef.current = edgeId;
    for (const line of edgeLineObjectsRef.current) {
      const id = line.userData.edgeId as string | undefined;
      const isSelected = line.userData.isSelected === true;
      const isHovered = id !== undefined && id === edgeId;
      const material = line.material as THREE.LineBasicMaterial;
      applyEdgeVisualColor(material, { isSelected, isHovered });
    }
  }

  const hoveredVertexIdRef = useRef<string | null>(null);
  function setHoveredVertex(vertexId: string | null) {
    if (hoveredVertexIdRef.current === vertexId) {
      return;
    }
    hoveredVertexIdRef.current = vertexId;
    for (const mesh of vertexObjectsRef.current) {
      const id = mesh.userData.vertexId as string | undefined;
      const isSelected = mesh.userData.isSelected === true;
      const isHovered = id !== undefined && id === vertexId;
      const material = mesh.material as THREE.MeshBasicMaterial;
      applyVertexVisualColor(material, { isSelected, isHovered });
    }
  }

  function setHoveredReference(referenceId: string | null) {
    let changed = false;

    for (const [id, state] of referencePlaneStatesRef.current.entries()) {
      const nextHovered = id === referenceId;
      if (state.isHovered !== nextHovered) {
        referencePlaneStatesRef.current.set(id, {
          ...state,
          isHovered: nextHovered,
        });
        changed = true;
      }
    }

    if (changed) {
      syncReferencePlaneVisuals();
    }
  }

  useEffect(() => {
    selectPrimitiveRef.current = onSelectPrimitive;
    selectReferenceRef.current = onSelectReference;
    selectFaceRef.current = onSelectFace;
    selectEdgeRef.current = onSelectEdge;
    selectVertexRef.current = onSelectVertex;
    startSketchRef.current = onStartSketch;
    startSketchOnFaceRef.current = onStartSketchOnFace;
    addSketchLineRef.current = onAddSketchLine;
    addSketchRectangleRef.current = onAddSketchRectangle;
    addSketchCircleRef.current = onAddSketchCircle;
    selectSketchEntityRef.current = onSelectSketchEntity;
    pickSketchPointRef.current = onPickSketchPoint;
    selectSketchDimensionRef.current = onSelectSketchDimension;
    updateSketchDimensionRef.current = onUpdateSketchDimension;
    selectSketchProfileRef.current = onSelectSketchProfile;
    setSketchToolRef.current = onSetSketchTool;
    armedSketchConstraintRef.current = armedSketchConstraint;
    cancelSketchConstraintRef.current = onCancelSketchConstraint;
    clearSketchConstraintRef.current = onClearSketchConstraint;
  }, [
    onSelectPrimitive,
    onSelectReference,
    onSelectFace,
    onSelectEdge,
    onSelectVertex,
    onStartSketch,
    onStartSketchOnFace,
    onAddSketchLine,
    onAddSketchRectangle,
    onAddSketchCircle,
    onSelectSketchEntity,
    onPickSketchPoint,
    onSelectSketchDimension,
    onUpdateSketchDimension,
    onSelectSketchProfile,
    onSetSketchTool,
    armedSketchConstraint,
    onCancelSketchConstraint,
    onClearSketchConstraint,
  ]);

  useEffect(() => {
    activeSketchToolRef.current = activeSketchTool;
    sketchSnapCandidatesRef.current = sketchSnapCandidates;
  }, [activeSketchTool, sketchSnapCandidates]);

  useEffect(() => {
    setSketchMidpointAnchorRef.current = onSetSketchMidpointAnchor;
  }, [onSetSketchMidpointAnchor]);

  useEffect(() => {
    setSketchPerpendicularConstraintRef.current =
      onSetSketchPerpendicularConstraint;
  }, [onSetSketchPerpendicularConstraint]);

  // Post-add midpoint-anchor dispatch. When `add_sketch_line` settles
  // and the sketch's lines vector has grown, look at the just-added
  // (last) line and issue `set_sketch_midpoint_anchor` for whichever
  // endpoint(s) snapped to a midpoint host. The pending state is
  // captured at click-time (so the host id stays consistent even if
  // intervening edits re-render) and cleared as soon as we apply it.
  useEffect(() => {
    const params = sketchFeature?.sketch_parameters ?? null;
    sketchLinesRef.current = params;
    const newCount = params?.lines.length ?? 0;
    const previousCount = sketchLineCountRef.current;
    sketchLineCountRef.current = newCount;

    const pending = pendingMidpointAnchorRef.current;
    const pendingPerp = pendingPerpendicularConstraintRef.current;
    if (!params) {
      return;
    }
    if (!pending && !pendingPerp) {
      return;
    }

    // Both pending kinds use the same matching rule: the line count
    // must have grown by exactly one past the baseline. If it
    // didn't, drop both pendings (they're stale).
    const baselineMidpoint = pending?.fromLineCount;
    const baselinePerp = pendingPerp?.fromLineCount;
    const baseline = baselineMidpoint ?? baselinePerp ?? -1;
    if (newCount !== baseline + 1) {
      if (newCount !== previousCount) {
        pendingMidpointAnchorRef.current = null;
        pendingPerpendicularConstraintRef.current = null;
      }
      return;
    }

    pendingMidpointAnchorRef.current = null;
    pendingPerpendicularConstraintRef.current = null;
    const newLine = params.lines[params.lines.length - 1];
    if (!newLine) {
      return;
    }
    if (pending?.startHostLineId) {
      void setSketchMidpointAnchorRef.current(
        newLine.start_point_id,
        pending.startHostLineId,
      );
    }
    if (pending?.endHostLineId) {
      void setSketchMidpointAnchorRef.current(
        newLine.end_point_id,
        pending.endHostLineId,
      );
    }
    if (pendingPerp) {
      void setSketchPerpendicularConstraintRef.current(
        newLine.line_id,
        pendingPerp.hostLineId,
      );
    }
  }, [sketchFeature]);

  useEffect(() => {
    lineToolConstructionRef.current = lineToolConstruction;
  }, [lineToolConstruction]);

  // Auto-clear the construction toggle when the user leaves the line
  // tool (e.g. presses R or Escape). Otherwise the next time they
  // re-enter the line tool the previous toggle would silently apply.
  useEffect(() => {
    if (activeSketchTool !== "line") {
      setLineToolConstruction(false);
    }
  }, [activeSketchTool]);

  useEffect(() => {
    selectedSketchDimensionRef.current = selectedSketchDimension;
  }, [selectedSketchDimension]);

  useEffect(() => {
    if (selectedSketchDimensionValue === null) {
      setDimensionDraftValue("");
      return;
    }

    // Round to 2 decimals and strip trailing zeros so 12.000000001 →
    // "12" and 3.4567 → "3.46", instead of leaking the full IEEE-754
    // representation into the input. `parseFloat` of a fixed-precision
    // string is the canonical way to drop trailing zeros without
    // building a regex.
    setDimensionDraftValue(
      String(parseFloat(selectedSketchDimensionValue.toFixed(2))),
    );
  }, [selectedSketchDimensionValue, document?.selected_sketch_dimension_id]);

  useEffect(() => {
    if (!selectedSketchDimension) {
      setIsDimensionEditorOpen(false);
      return;
    }

    setIsDimensionEditorOpen(true);
  }, [selectedSketchDimension?.dimensionId]);

  useEffect(() => {
    if (!isDimensionEditorOpen || !selectedSketchDimension) {
      return;
    }

    const input = dimensionInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    input.select();
  }, [isDimensionEditorOpen, selectedSketchDimension?.dimensionId]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;

    if (!host || !canvas) {
      return undefined;
    }

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 10000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const contentGroup = new THREE.Group();
    const referenceGroup = new THREE.Group();
    const sketchGroup = new THREE.Group();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown: { x: number; y: number } | null = null;
    let frameId = 0;

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    contentGroupRef.current = contentGroup;
    referenceGroupRef.current = referenceGroup;
    sketchGroupRef.current = sketchGroup;

    renderer.setPixelRatio(window.devicePixelRatio);
    scene.add(contentGroup);
    scene.add(referenceGroup);
    scene.add(sketchGroup);
    // Neutral studio lighting so MeshStandardMaterial bodies render as
    // true Fusion-style gray. The previous cyan-tinted ambient + key
    // + rim lights were leaking cyan into the body fill, which made
    // the new gray material look like the old translucent cyan even
    // after the material itself was switched to opaque.
    scene.add(new THREE.AmbientLight(0xffffff, 0.85));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
    keyLight.position.set(1.2, 1.8, 1.4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.45);
    fillLight.position.set(-1.5, 0.8, -1.1);
    scene.add(fillLight);

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 24;
    controls.maxDistance = 6000;
    controls.mouseButtons.LEFT = null;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = null;
    controls.addEventListener("start", () => {
      canvas.classList.add("cad-viewport-canvas-dragging");
    });
    controls.addEventListener("end", () => {
      canvas.classList.remove("cad-viewport-canvas-dragging");
    });

    function resizeRenderer() {
      const width = Math.max(host?.clientWidth ?? 0, 1);
      const height = Math.max(host?.clientHeight ?? 0, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function render() {
      controls.update();
      renderer.render(scene, camera);

      const editor = dimensionEditorRef.current;
      const dimension = selectedSketchDimensionRef.current;
      const isOpen = isDimensionEditorOpenRef.current;
      if (!editor || !dimension || !isOpen) {
        if (editor) {
          editor.style.opacity = "0";
        }
        return;
      }

      const projectedPosition = projectWorldPointToViewport(
        dimension.labelPosition,
        camera,
        renderer,
      );

      if (!projectedPosition) {
        editor.style.opacity = "0";
        return;
      }

      editor.style.opacity = "1";
      editor.style.transform = `translate(${projectedPosition.x}px, ${projectedPosition.y}px) translate(-50%, -50%)`;
    }

    function intersectSceneTargets(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      raycaster.params.Line = { threshold: 1.75 };

      if (activeSketchPlaneId) {
        const [sketchDimensionHit] = raycaster.intersectObjects(
          sketchDimensionObjectsRef.current,
          false,
        );
        const sketchDimensionId =
          sketchDimensionHit?.object.userData.sketchDimensionId;
        if (typeof sketchDimensionId === "string") {
          return { kind: "sketch_dimension" as const, id: sketchDimensionId };
        }

        const [sketchConstraintHit] = raycaster.intersectObjects(
          sketchConstraintObjectsRef.current,
          false,
        );
        const sketchConstraintId =
          sketchConstraintHit?.object.userData.sketchConstraintId;
        if (typeof sketchConstraintId === "string") {
          return {
            kind: "sketch_constraint" as const,
            id: sketchConstraintId,
            constraintKind:
              sketchConstraintHit.object.userData.sketchConstraintKind,
            entityId:
              sketchConstraintHit.object.userData.sketchConstraintEntityId,
            relatedEntityId:
              sketchConstraintHit.object.userData
                .sketchConstraintRelatedEntityId ?? null,
          };
        }

        const [sketchPointHit] = raycaster.intersectObjects(
          sketchPointObjectsRef.current,
          false,
        );
        const sketchPointId = sketchPointHit?.object.userData.sketchPointId;
        if (typeof sketchPointId === "string") {
          return {
            kind: "sketch_point" as const,
            id: sketchPointId,
            pointKind: sketchPointHit.object.userData.sketchPointKind,
          };
        }

        const [sketchEntityHit] = raycaster.intersectObjects(
          sketchEntityObjectsRef.current,
          false,
        );
        const sketchEntityId = sketchEntityHit?.object.userData.sketchEntityId;
        const sketchEntityKind =
          sketchEntityHit?.object.userData.sketchEntityKind;
        if (typeof sketchEntityId === "string") {
          return {
            kind: "sketch_entity" as const,
            id: sketchEntityId,
            entityKind:
              typeof sketchEntityKind === "string" ? sketchEntityKind : null,
          };
        }

        const [profileHit] = raycaster.intersectObjects(
          sketchProfileMeshesRef.current,
          false,
        );
        const profileId = profileHit?.object.userData.sketchProfileId;
        if (typeof profileId === "string") {
          return { kind: "sketch_profile" as const, id: profileId };
        }
      }

      // Outside sketch mode, sketch profiles are still pickable so the
      // user can re-select a closed profile (e.g. after exiting sketch
      // mode) and run Extrude on it. We check profiles BEFORE the
      // body-side hits because a profile usually sits on a sketch plane
      // that may coincide with a body face, and the user's intent in
      // clicking a profile-tinted region is overwhelmingly "extrude
      // this", not "select the underlying face". Profiles whose owning
      // sketch was hidden (e.g. auto-hide-after-extrude) won't have a
      // mesh in the ref array, so they naturally drop out of the pick.
      {
        const [profileHit] = raycaster.intersectObjects(
          sketchProfileMeshesRef.current,
          false,
        );
        const profileId = profileHit?.object.userData.sketchProfileId;
        if (typeof profileId === "string") {
          return { kind: "sketch_profile" as const, id: profileId };
        }
      }

      const [referenceHit] = raycaster.intersectObjects(
        referencePlaneMeshesRef.current,
        false,
      );
      const referenceId = referenceHit?.object.userData.referenceId;
      if (typeof referenceId === "string") {
        return { kind: "reference" as const, id: referenceId };
      }

      // Vertices are checked first: they're the smallest pick targets
      // but always visible (renderOrder = 2, depthTest = false), and
      // they sit on top of every edge / face, so prioritizing them
      // matches the visual stacking the user sees.
      const [vertexHit] = raycaster.intersectObjects(
        vertexObjectsRef.current,
        false,
      );
      const vertexId = vertexHit?.object.userData.vertexId;
      if (typeof vertexId === "string") {
        return { kind: "vertex" as const, id: vertexId };
      }

      // Edges are checked before faces because they sit ON the faces
      // and would be hidden by the face fill if checked after.
      const previousLineThreshold = raycaster.params.Line?.threshold ?? 1;
      if (raycaster.params.Line) {
        // Generous pick tolerance so hover lights up edges without
        // the user having to land on a pixel-perfect line. Click
        // accuracy isn't hurt here because edges are checked before
        // faces in this same chain — if both hit, edge wins.
        raycaster.params.Line.threshold = 1.2;
      }
      const [edgeHit] = raycaster.intersectObjects(
        edgeLineObjectsRef.current,
        false,
      );
      if (raycaster.params.Line) {
        raycaster.params.Line.threshold = previousLineThreshold;
      }
      const edgeId = edgeHit?.object.userData.edgeId;
      if (typeof edgeId === "string") {
        return { kind: "edge" as const, id: edgeId };
      }

      const [faceHit] = raycaster.intersectObjects(
        faceMeshesRef.current,
        false,
      );
      const faceId = faceHit?.object.userData.faceId;
      if (typeof faceId === "string") {
        return { kind: "face" as const, id: faceId };
      }

      const [primitiveHit] = raycaster.intersectObjects(
        meshesRef.current,
        false,
      );
      const primitiveId = primitiveHit?.object.userData.primitiveId;
      return typeof primitiveId === "string"
        ? { kind: "primitive" as const, id: primitiveId }
        : null;
    }

    function handlePointerDown(event: PointerEvent) {
      setContextMenu(null);

      if (event.button === 1) {
        controls.mouseButtons.MIDDLE =
          event.ctrlKey || event.metaKey ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
        return;
      }

      if (event.button !== 0) {
        pointerDown = null;
        return;
      }

      pointerDown = { x: event.clientX, y: event.clientY };
    }

    function handlePointerMove(event: PointerEvent) {
      if (activeSketchPlaneId) {
        if (activeSketchToolRef.current === "select") {
          clearPreviewLine();
          clearPreviewCircle();
          setSketchSnapLabel(null);
          setConstraintPreview(null);
          return;
        }

        const draftStart = lineDraftStartRef.current;
        const rawPoint = resolveSketchPlanePoint(
          event,
          renderer,
          camera,
          activeSketchPlaneId,
          activeSketchPlaneFrame,
        );
        if (!rawPoint) {
          return;
        }

        const sketchPoint = resolveSnappedSketchPoint(rawPoint);
        setSketchSnapLabel(sketchPoint.snapLabel);

        // Hover-time constraint preview. The badge sits next to the
        // cursor in viewport-local coordinates so it stays glued to
        // the pointer regardless of canvas size or scroll. Pixel
        // offsets are taken from `getBoundingClientRect` rather than
        // `clientX/Y` directly because the canvas can be inset
        // inside the viewport panel (toolbar, side panels, etc.).
        const canvasRect = renderer.domElement.getBoundingClientRect();
        const previewX = event.clientX - canvasRect.left;
        const previewY = event.clientY - canvasRect.top;
        if (sketchPoint.snapMidpointHostLineId) {
          setConstraintPreview({
            kind: "midpoint",
            x: previewX,
            y: previewY,
          });
        } else if (sketchPoint.snapPerpendicularHostLineId) {
          setConstraintPreview({
            kind: "perpendicular",
            x: previewX,
            y: previewY,
          });
        } else if (
          sketchPoint.snapLabel &&
          sketchPoint.snapLabel.startsWith("On ")
        ) {
          setConstraintPreview({
            kind: "on_line",
            x: previewX,
            y: previewY,
          });
        } else {
          setConstraintPreview(null);
        }

        if (!draftStart) {
          setHoveredPrimitive(null);
          setHoveredReference(null);
          return;
        }

        const sketchGroupRefValue = sketchGroupRef.current;
        if (!sketchGroupRefValue) {
          return;
        }

        clearPreviewLine();
        clearPreviewCircle();
        if (activeSketchToolRef.current === "circle") {
          const radius = distanceBetweenPoints(draftStart, sketchPoint.local);
          if (radius > 0.001) {
            // Pass the active sketch's plane frame so the perimeter is
            // projected onto the actual sketch plane. Without it the
            // perimeter falls back to the legacy ref-plane axis
            // mapping which disagrees with the center's projection
            // for arbitrary planes (face-based sketches), and the
            // circle reads as perpendicular to the sketch plane.
            const preview = buildSketchCircleObject(
              {
                circleId: "preview-circle",
                planeId: activeSketchPlaneId,
                center: toWorldPoint(
                  activeSketchPlaneId,
                  draftStart,
                  activeSketchPlaneFrame,
                ),
                radius,
                isSelected: false,
              },
              activeSketchPlaneFrame,
            );
            previewCircleRef.current = preview;
            sketchGroupRefValue.add(preview);
          }
        } else if (activeSketchToolRef.current === "rectangle") {
          // Show the full 4-corner outline as the user drags so they
          // can see the rectangle they're about to create — the old
          // single-segment diagonal preview made sizing rectangles
          // largely guesswork.
          const [sx, sy] = draftStart;
          const [ex, ey] = sketchPoint.local;
          const corners: Array<[number, number]> = [
            [sx, sy],
            [ex, sy],
            [ex, ey],
            [sx, ey],
            [sx, sy],
          ];
          const worldCorners = corners.map(
            (corner) =>
              new THREE.Vector3(
                ...toWorldPoint(
                  activeSketchPlaneId,
                  corner,
                  activeSketchPlaneFrame,
                ),
              ),
          );
          const preview = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(worldCorners),
            new THREE.LineBasicMaterial({
              color: themeColor("--color-tertiary-plane-edge", "#ffe784"),
              transparent: true,
              opacity: 0.88,
            }),
          );
          previewLineRef.current = preview;
          sketchGroupRefValue.add(preview);
        } else {
          const preview = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(
                ...toWorldPoint(
                  activeSketchPlaneId,
                  draftStart,
                  activeSketchPlaneFrame,
                ),
              ),
              new THREE.Vector3(...sketchPoint.world),
            ]),
            new THREE.LineBasicMaterial({
              color: themeColor("--color-tertiary-plane-edge", "#ffe784"),
              transparent: true,
              opacity: 0.88,
            }),
          );
          previewLineRef.current = preview;
          sketchGroupRefValue.add(preview);
        }
        return;
      }

      const hit = intersectSceneTargets(event);
      if (hit?.kind === "sketch_dimension" || hit?.kind === "sketch_entity") {
        setHoveredReference(null);
        setHoveredPrimitive(null);
        setHoveredFace(null);
        setHoveredEdge(null);
        setHoveredVertex(null);
        return;
      }
      setHoveredReference(hit?.kind === "reference" ? hit.id : null);
      setHoveredFace(hit?.kind === "face" ? hit.id : null);
      // Edges and vertices are mutually exclusive with each other (the
      // raycaster prioritizes vertex over edge over face), so only one
      // of these will resolve to a real id at a time.
      setHoveredEdge(hit?.kind === "edge" ? hit.id : null);
      setHoveredVertex(hit?.kind === "vertex" ? hit.id : null);
      // Suppress primitive hover while a face under the same primitive is
      // hovered so the visual highlight reads as a face hover, not a body
      // hover.
      setHoveredPrimitive(hit?.kind === "primitive" && hit.id ? hit.id : null);
    }

    function handlePointerLeave() {
      pointerDown = null;
      setSketchSnapLabel(null);
      setConstraintPreview(null);
      if (!activeSketchPlaneId) {
        setHoveredReference(null);
        setHoveredPrimitive(null);
        setHoveredFace(null);
        setHoveredEdge(null);
        setHoveredVertex(null);
      }
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.button === 1) {
        controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
        pointerDown = null;
        return;
      }

      if (event.button !== 0) {
        pointerDown = null;
        return;
      }

      if (!pointerDown) {
        return;
      }

      const deltaX = Math.abs(event.clientX - pointerDown.x);
      const deltaY = Math.abs(event.clientY - pointerDown.y);
      pointerDown = null;

      if (deltaX > 4 || deltaY > 4) {
        return;
      }

      if (activeSketchPlaneId) {
        const hit = intersectSceneTargets(event);
        if (activeSketchToolRef.current === "select") {
          if (
            armedSketchConstraintRef.current &&
            hit?.kind === "sketch_entity" &&
            hit.entityKind === "line"
          ) {
            void selectSketchEntityRef.current(hit.id);
            return;
          }

          if (hit?.kind === "sketch_point") {
            void pickSketchPointRef.current(hit.id, hit.pointKind);
            return;
          }

          if (hit?.kind === "sketch_dimension") {
            void selectSketchDimensionRef.current(hit.id);
            return;
          }

          if (hit?.kind === "sketch_constraint") {
            void clearSketchConstraintRef.current(
              hit.constraintKind,
              hit.entityId,
              hit.relatedEntityId,
            );
            return;
          }

          if (hit?.kind === "sketch_profile") {
            void selectSketchProfileRef.current(hit.id);
            return;
          }

          if (hit?.kind === "sketch_entity") {
            void selectSketchEntityRef.current(hit.id);
          }
          return;
        }

        // Dimension tool: clicking a line or circle opens the editor
        // for its driving dimension. Construction lines have no auto
        // length dimension, so they're a no-op for now.
        if (activeSketchToolRef.current === "dimension") {
          if (hit?.kind === "sketch_dimension") {
            void selectSketchDimensionRef.current(hit.id);
            return;
          }
          if (hit?.kind === "sketch_entity") {
            const dimensionId =
              hit.entityKind === "circle"
                ? `dim-circle-${hit.id}`
                : `dim-line-${hit.id}`;
            const dimensionExists =
              sketchLinesRef.current?.dimensions.some(
                (dim) => dim.dimension_id === dimensionId,
              ) ?? false;
            if (dimensionExists) {
              void selectSketchDimensionRef.current(dimensionId);
            } else {
              void selectSketchEntityRef.current(hit.id);
            }
            return;
          }
          return;
        }

        // In a draft tool (line / rectangle / circle), clicks on an
        // existing line / dimension MUST NOT select. They should
        // fall through to the plane-projection path so the snap
        // resolver can use the entity as a snap source (line body,
        // endpoint, midpoint). Selection is reserved for the select
        // tool. Dimensions in draft mode are simply ignored — the
        // user can press S to switch back to select if they want to
        // edit one.
        const rawPoint = resolveSketchPlanePoint(
          event,
          renderer,
          camera,
          activeSketchPlaneId,
          activeSketchPlaneFrame,
        );
        if (!rawPoint) {
          return;
        }
        const sketchPoint = resolveSnappedSketchPoint(rawPoint);
        setSketchSnapLabel(sketchPoint.snapLabel);

        if (!lineDraftStartRef.current) {
          lineDraftStartRef.current = sketchPoint.local;
          // Capture whether the start snapped to a midpoint so the
          // post-add effect can attach the anchor once the IPC has
          // settled. Reset on every fresh draft so we don't reuse a
          // stale host id from a previous line.
          draftStartMidpointHostRef.current =
            sketchPoint.snapMidpointHostLineId ?? null;
          // If the start snapped to an existing line's endpoint, arm
          // the perpendicular-foot snap for the rest of the draft.
          // (The midpoint and endpoint hosts are independent: a
          // single click can only be one or the other since they
          // come from distinct snap candidates.)
          draftStartEndpointHostRef.current =
            sketchPoint.snapEndpointHostLineId ?? null;
          return;
        }

        const [startX, startY] = lineDraftStartRef.current;
        clearPreviewLine();
        clearPreviewCircle();
        if (activeSketchToolRef.current === "rectangle") {
          lineDraftStartRef.current = null;
          void addSketchRectangleRef.current(
            startX,
            startY,
            sketchPoint.local[0],
            sketchPoint.local[1],
          );
          return;
        }

        if (activeSketchToolRef.current === "circle") {
          lineDraftStartRef.current = null;
          const radius = distanceBetweenPoints(
            [startX, startY],
            sketchPoint.local,
          );
          void addSketchCircleRef.current(startX, startY, radius);
          return;
        }

        // Capture both endpoints' midpoint hosts (if any) before the
        // draft state advances, so the post-add effect can attach
        // anchors to the just-created line. The baseline line count
        // anchors the effect's match: it will fire only when the
        // sketch's line count grows past `fromLineCount` by 1.
        const startHostLineId = draftStartMidpointHostRef.current;
        const endHostLineId = sketchPoint.snapMidpointHostLineId ?? null;
        if (startHostLineId || endHostLineId) {
          pendingMidpointAnchorRef.current = {
            fromLineCount: sketchLineCountRef.current,
            startHostLineId,
            endHostLineId,
          };
        }

        // Capture pending perpendicular constraint when the cursor
        // committed on the perpendicular ray of the start's host
        // line. The post-add effect dispatches the constraint once
        // the new line lands.
        const perpHostLineId = sketchPoint.snapPerpendicularHostLineId;
        if (perpHostLineId) {
          pendingPerpendicularConstraintRef.current = {
            fromLineCount: sketchLineCountRef.current,
            hostLineId: perpHostLineId,
          };
        }

        // The line tool keeps drafting from the just-clicked end so
        // the user can chain segments. Update the start-side host to
        // the *new* draft start (= the end of the line we just
        // committed). Keeping the host in sync avoids attributing the
        // previous line's start anchor to the next line.
        lineDraftStartRef.current = sketchPoint.local;
        draftStartMidpointHostRef.current = endHostLineId;
        // Reset the perpendicular host: a fresh draft segment starts
        // from the just-clicked end. Only set it again if that end
        // happened to itself snap to an existing line's endpoint.
        draftStartEndpointHostRef.current =
          sketchPoint.snapEndpointHostLineId ?? null;
        void addSketchLineRef.current(
          startX,
          startY,
          sketchPoint.local[0],
          sketchPoint.local[1],
          lineToolConstructionRef.current,
        );
        return;
      }

      const hit = intersectSceneTargets(event);
      if (hit?.kind === "sketch_profile") {
        // Profiles are pickable outside sketch mode so the user can
        // run Extrude on a closed profile without re-entering its
        // sketch (Fusion-style). Selection is a no-op on the core's
        // body picking path; the floating Extrude action consumes
        // `selected_sketch_profile_id` directly.
        void selectSketchProfileRef.current(hit.id);
        return;
      }

      if (hit?.kind === "reference") {
        void selectReferenceRef.current(hit.id);
        return;
      }

      // Shift, Ctrl (Win/Linux) and Cmd (mac) all toggle the picked
      // entity into the existing multi-select set; plain click
      // replaces. We accept all three so the additive gesture matches
      // each OS's native file-manager / list conventions without
      // forcing the user to learn a tool-specific modifier.
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;

      if (hit?.kind === "vertex") {
        void selectVertexRef.current(hit.id, additive);
        return;
      }

      if (hit?.kind === "edge") {
        void selectEdgeRef.current(hit.id, additive);
        return;
      }

      if (hit?.kind === "face") {
        void selectFaceRef.current(hit.id);
        return;
      }

      if (hit?.kind === "primitive") {
        void selectPrimitiveRef.current(hit.id);
      }
    }

    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();

      if (activeSketchPlaneId) {
        setContextMenu(null);
        return;
      }

      const hit = intersectSceneTargets(event as PointerEvent);
      if (hit?.kind !== "reference" && hit?.kind !== "face") {
        setContextMenu(null);
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      setContextMenu({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        referenceId: hit.kind === "reference" ? hit.id : null,
        faceId: hit.kind === "face" ? hit.id : null,
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      resizeRenderer();
      render();
    });

    resizeObserver.observe(host);
    function handleDoubleClick(event: MouseEvent) {
      if (activeSketchPlaneId) {
        return;
      }

      const hit = intersectSceneTargets(event as PointerEvent);
      if (hit?.kind !== "face") {
        return;
      }

      const solidFace = sceneDataRef.current?.solidFaces.find(
        (face) => face.faceId === hit.id,
      );
      if (!solidFace) {
        return;
      }

      void selectFaceRef.current(solidFace.faceId);
      void startSketchOnFaceRef.current(solidFace.faceId, solidFace.planeFrame);
    }

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);
    renderer.domElement.addEventListener("dblclick", handleDoubleClick);
    resizeRenderer();

    const animate = () => {
      render();
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener(
        "pointerleave",
        handlePointerLeave,
      );
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      renderer.domElement.removeEventListener("dblclick", handleDoubleClick);
      controls.dispose();
      disposeGroup(contentGroup);
      disposeGroup(referenceGroup);
      disposeGroup(sketchGroup);
      renderer.dispose();
      gridRef.current?.geometry.dispose();
      disposeMaterial(gridRef.current?.material ?? []);
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      contentGroupRef.current = null;
      referenceGroupRef.current = null;
      sketchGroupRef.current = null;
      primitiveVisualsRef.current.clear();
      primitiveStatesRef.current.clear();
      referencePlaneVisualsRef.current.clear();
      referencePlaneStatesRef.current.clear();
      solidFaceVisualsRef.current.clear();
      solidFaceStatesRef.current.clear();
      referencePlaneMeshesRef.current = [];
      sketchEntityObjectsRef.current = [];
      sketchDimensionObjectsRef.current = [];
      sketchConstraintObjectsRef.current = [];
      sketchPointObjectsRef.current = [];
      sketchProfileMeshesRef.current = [];
      meshesRef.current = [];
      faceMeshesRef.current = [];
      edgeLineObjectsRef.current = [];
      vertexObjectsRef.current = [];
      cutPreviewObjectsRef.current = [];
      gridRef.current = null;
      previewLineRef.current = null;
      previewCircleRef.current = null;
      lineDraftStartRef.current = null;
      lastGeometryKeyRef.current = "";
    };
  }, [activeSketchPlaneId]);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const contentGroup = contentGroupRef.current;
    const referenceGroup = referenceGroupRef.current;
    const sketchGroup = sketchGroupRef.current;

    if (
      !scene ||
      !camera ||
      !controls ||
      !contentGroup ||
      !referenceGroup ||
      !sketchGroup
    ) {
      return;
    }

    disposeGroup(contentGroup);
    disposeGroup(referenceGroup);
    disposeGroup(sketchGroup);
    primitiveVisualsRef.current.clear();
    primitiveStatesRef.current.clear();
    referencePlaneVisualsRef.current.clear();
    referencePlaneStatesRef.current.clear();
    solidFaceVisualsRef.current.clear();
    solidFaceStatesRef.current.clear();
    referencePlaneMeshesRef.current = [];
    sketchEntityObjectsRef.current = [];
    sketchDimensionObjectsRef.current = [];
    sketchConstraintObjectsRef.current = [];
    sketchPointObjectsRef.current = [];
    sketchProfileMeshesRef.current = [];
    meshesRef.current = [];
    faceMeshesRef.current = [];
    edgeLineObjectsRef.current = [];
    vertexObjectsRef.current = [];
    cutPreviewObjectsRef.current = [];
    // Hovered ids reference disposed THREE objects after a rebuild;
    // null them out so the next pointermove cleanly re-applies hover.
    hoveredEdgeIdRef.current = null;
    hoveredVertexIdRef.current = null;
    previewLineRef.current = null;
    previewCircleRef.current = null;

    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      disposeMaterial(gridRef.current.material);
    }

    gridRef.current = null;

    if (!sceneData) {
      lastGeometryKeyRef.current = "";
      return;
    }

    // Neutral gray grid (axis line slightly lighter) so the floor reads
    // as professional CAD chrome rather than the previous cyan glow.
    const nextGrid = new THREE.GridHelper(
      Math.max(sceneData.bounds.maxDimension * 2, 200),
      20,
      themeColor("--color-cad-grid-axis", "#7a7a7c"),
      themeColor("--color-cad-grid", "#5a5a5c"),
    );
    nextGrid.position.set(
      sceneData.bounds.center[0],
      0,
      sceneData.bounds.center[2],
    );
    scene.add(nextGrid);
    gridRef.current = nextGrid;

    for (const primitive of sceneData.primitives) {
      const object = buildPrimitiveObject(primitive);
      meshesRef.current.push(object.mesh);
      primitiveVisualsRef.current.set(primitive.primitiveId, object.visual);
      primitiveStatesRef.current.set(primitive.primitiveId, {
        isSelected: primitive.isSelected,
        isHovered: false,
      });
      contentGroup.add(object.mesh);
      contentGroup.add(object.edges);
    }

    for (const reference of sceneData.references) {
      if (reference.kind === "reference_plane") {
        if (!showReferencePlanes) {
          continue;
        }

        const object = buildReferencePlaneObject(reference);
        referencePlaneMeshesRef.current.push(object.mesh);
        referencePlaneVisualsRef.current.set(
          reference.referenceId,
          object.visual,
        );
        referencePlaneStatesRef.current.set(reference.referenceId, {
          isSelected: reference.isSelected,
          isHovered: false,
          isActiveSketchPlane: reference.isActiveSketchPlane,
        });
        referenceGroup.add(object.mesh);
        referenceGroup.add(object.edges);
        continue;
      }

      const axisObject = buildReferenceAxisObject(reference);
      referenceGroup.add(axisObject.line);
    }

    for (const face of sceneData.solidFaces) {
      const faceObject = buildSolidFaceObject(face);
      faceMeshesRef.current.push(faceObject.mesh);
      solidFaceVisualsRef.current.set(face.faceId, faceObject.visual);
      solidFaceStatesRef.current.set(face.faceId, {
        isSelected: face.isSelected,
        isHovered: false,
      });
      contentGroup.add(faceObject.mesh);
    }

    for (const edge of sceneData.edges) {
      const edgeLine = buildSceneEdgeObject(edge);
      edgeLineObjectsRef.current.push(edgeLine);
      contentGroup.add(edgeLine);
    }

    for (const vertex of sceneData.vertices) {
      const vertexMesh = buildSceneVertexObject(vertex);
      vertexObjectsRef.current.push(vertexMesh);
      contentGroup.add(vertexMesh);
    }

    for (const preview of sceneData.cutPreviews) {
      const cutPreviewMesh = buildCutPreviewObject(preview);
      cutPreviewObjectsRef.current.push(cutPreviewMesh);
      contentGroup.add(cutPreviewMesh);
    }

    for (const sketchLine of sceneData.sketchLines) {
      const sketchLineObject = buildSketchLineObject(sketchLine);
      sketchEntityObjectsRef.current.push(sketchLineObject);
      sketchGroup.add(sketchLineObject);
    }

    for (const sketchCircle of sceneData.sketchCircles) {
      // Only the active sketch's circles get the live plane frame;
      // circles owned by other (currently-hidden) sketches fall back
      // to the legacy ref-plane axis mapping. In practice the only
      // visible circles are the active sketch's anyway because
      // `viewportScene` filters by `isSketchPlaneVisible`.
      const frame =
        activeSketchPlaneId &&
        sketchCircle.planeId === activeSketchPlaneId &&
        activeSketchPlaneFrame
          ? activeSketchPlaneFrame
          : null;
      const sketchCircleObject = buildSketchCircleObject(sketchCircle, frame);
      sketchEntityObjectsRef.current.push(sketchCircleObject);
      sketchGroup.add(sketchCircleObject);
    }

    for (const sketchDimension of sceneData.sketchDimensions) {
      const sketchDimensionObject = buildSketchDimensionObject(sketchDimension);
      sketchDimensionObjectsRef.current.push(sketchDimensionObject.line);
      sketchDimensionObjectsRef.current.push(sketchDimensionObject.label);
      sketchGroup.add(sketchDimensionObject.line);
      sketchGroup.add(sketchDimensionObject.label);
    }

    for (const sketchConstraint of sceneData.sketchConstraints) {
      const sketchConstraintObject =
        buildSketchConstraintObject(sketchConstraint);
      sketchConstraintObjectsRef.current.push(sketchConstraintObject);
      sketchGroup.add(sketchConstraintObject);
    }

    for (const sketchProfile of sceneData.sketchProfiles) {
      const sketchProfileMesh = buildSketchProfileObject(sketchProfile);
      sketchProfileMeshesRef.current.push(sketchProfileMesh);
      sketchGroup.add(sketchProfileMesh);
    }

    for (const sketchPoint of sceneData.sketchPoints) {
      const sketchPointObject = buildSketchPointObject(sketchPoint);
      sketchPointObjectsRef.current.push(sketchPointObject);
      sketchGroup.add(sketchPointObject);
    }

    syncPrimitiveVisuals();
    syncReferencePlaneVisuals();
    syncSolidFaceVisuals();

    if (sceneData.geometryKey !== lastGeometryKeyRef.current) {
      // Auto-frame the camera ONLY on the very first scene load (when
      // we haven't recorded any prior geometry key yet). On subsequent
      // rebuilds the geometry key flips for many reasons that have
      // nothing to do with the user's intended view — selection
      // state, hover/select highlight rebuilds, depth-preview ticks
      // during an extrude edit, etc. — so re-fitting every time
      // would yank the camera back to its initial pose any time the
      // user clicks a face. Sketch-mode framing is handled by a
      // separate effect (frameCameraToSketchPlane).
      const isFirstSceneLoad = lastGeometryKeyRef.current === "";
      if (isFirstSceneLoad && !activeSketchPlaneId) {
        frameCamera(
          camera,
          controls,
          sceneData.bounds.center,
          sceneData.bounds.maxDimension,
        );
      }

      lastGeometryKeyRef.current = sceneData.geometryKey;
    }
  }, [sceneData, showReferencePlanes]);

  useEffect(() => {
    lineDraftStartRef.current = null;
    clearPreviewLine();
    clearPreviewCircle();
    setSketchSnapLabel(null);
    setConstraintPreview(null);
  }, [activeSketchPlaneId, activeSketchTool]);

  useEffect(() => {
    if (!activeSketchPlaneId) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      if (event.code === "Escape") {
        event.preventDefault();
        if (armedSketchConstraintRef.current) {
          cancelSketchConstraintRef.current();
          return;
        }
        lineDraftStartRef.current = null;
        clearPreviewLine();
        clearPreviewCircle();
        setSketchSnapLabel(null);
        setConstraintPreview(null);
        void setSketchToolRef.current("select");
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      if (event.code === "KeyL") {
        event.preventDefault();
        void setSketchToolRef.current("line");
        return;
      }

      if (event.code === "KeyR") {
        event.preventDefault();
        void setSketchToolRef.current("rectangle");
        return;
      }

      if (event.code === "KeyC") {
        event.preventDefault();
        void setSketchToolRef.current("circle");
        return;
      }

      // X toggles the construction-line flag while the line tool is
      // armed. Outside the line tool it's a no-op (other tools don't
      // have an equivalent setting yet).
      if (event.code === "KeyX" && activeSketchToolRef.current === "line") {
        event.preventDefault();
        setLineToolConstruction((prev) => !prev);
        return;
      }

      // D arms the dimension tool (Fusion convention). Clicking a
      // line or circle while armed opens its driving dimension's
      // inline editor.
      if (event.code === "KeyD") {
        event.preventDefault();
        void setSketchToolRef.current("dimension");
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeSketchPlaneId]);

  useEffect(() => {
    if (activeSketchPlaneId) {
      if (previousReferencePlaneVisibilityRef.current === null) {
        previousReferencePlaneVisibilityRef.current = showReferencePlanes;
      }

      if (showReferencePlanes) {
        setShowReferencePlanes(false);
      }
      return;
    }

    if (previousReferencePlaneVisibilityRef.current !== null) {
      setShowReferencePlanes(previousReferencePlaneVisibilityRef.current);
      previousReferencePlaneVisibilityRef.current = null;
    }
  }, [activeSketchPlaneId, showReferencePlanes]);

  const lastFramedSketchPlaneRef = useRef<string | null>(null);
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!camera || !controls) {
      return;
    }

    if (!activeSketchPlaneId) {
      lastFramedSketchPlaneRef.current = null;
      return;
    }

    if (lastFramedSketchPlaneRef.current === activeSketchPlaneId) {
      return;
    }

    if (!sceneData) {
      return;
    }

    lastFramedSketchPlaneRef.current = activeSketchPlaneId;

    frameCameraToSketchPlane(
      camera,
      controls,
      activeSketchPlaneId,
      activeSketchPlaneFrame,
      sceneData.bounds.maxDimension,
    );
  }, [activeSketchPlaneId, activeSketchPlaneFrame, sceneData]);

  async function handleCreateSketchFromContextMenu() {
    if (contextMenu?.referenceId) {
      setContextMenu(null);
      await selectReferenceRef.current(contextMenu.referenceId);
      await startSketchRef.current(contextMenu.referenceId);
      return;
    }

    if (!contextMenu?.faceId) {
      return;
    }

    setContextMenu(null);
    await selectFaceRef.current(contextMenu.faceId);

    const solidFace = sceneData?.solidFaces.find(
      (face) => face.faceId === contextMenu.faceId,
    );
    if (!solidFace) {
      return;
    }

    await startSketchOnFaceRef.current(solidFace.faceId, solidFace.planeFrame);
  }

  const lineCount = sketchFeature?.sketch_parameters?.lines.length ?? 0;
  const circleCount = sketchFeature?.sketch_parameters?.circles.length ?? 0;

  async function handleSubmitDimensionEdit() {
    if (!selectedSketchDimension) {
      setIsDimensionEditorOpen(false);
      return;
    }

    const nextValue = Number(dimensionDraftValue);
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      setIsDimensionEditorOpen(false);
      return;
    }

    await updateSketchDimensionRef.current(
      selectedSketchDimension.dimensionId,
      nextValue,
    );
    setIsDimensionEditorOpen(false);
  }

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 cad-grid-stage opacity-70" />
      <div
        ref={hostRef}
        className="absolute inset-0 min-h-0 min-w-0 overflow-hidden rounded-[18px]"
      >
        {contextMenu ? (
          <div
            className="cad-context-menu absolute z-20 min-w-[160px] rounded-2xl p-1.5 backdrop-blur-xl"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              transform: "translate(8px, 8px)",
            }}
          >
            <button
              type="button"
              className="cad-context-menu-item flex w-full items-center justify-start rounded-xl px-3 py-2 text-sm text-on-surface transition-colors duration-200"
              onClick={handleCreateSketchFromContextMenu}
            >
              Create Sketch
            </button>
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className={`cad-viewport-canvas absolute inset-0 h-full w-full ${
            activeSketchPlaneId && activeSketchTool !== "select"
              ? "cad-viewport-canvas-drawing"
              : ""
          }`}
        />
        {/*
          Cursor-following constraint preview badge. Only visible
          while a sketch tool is producing a midpoint, perpendicular,
          or on-line snap. The badge is offset 12px down-right from
          the cursor so it doesn't sit under the actual snap dot, and
          is `pointer-events-none` so it never steals clicks from the
          underlying canvas. The colors mirror the in-scene
          constraint-badge palette to keep the language consistent.
        */}
        {constraintPreview ? (
          <div
            className="pointer-events-none absolute z-30 flex h-5 w-5 items-center justify-center rounded-full border border-cyan-300/70 bg-slate-900/85 text-[10px] font-semibold text-cyan-200 shadow-md"
            style={{
              left: `${constraintPreview.x + 12}px`,
              top: `${constraintPreview.y + 12}px`,
            }}
          >
            {constraintPreview.kind === "midpoint"
              ? "M"
              : constraintPreview.kind === "perpendicular"
                ? "\u22a5"
                : "/"}
          </div>
        ) : null}
        {/*
          Floating Line Tool options panel (Fusion-style). Appears
          while the line tool is armed *or* while a sketch line is
          selected, so the user can:
            * Toggle the construction flag for the next line they draw
              (line tool only). Hotkey X.
            * Toggle the construction flag on an already-drawn line
              (selection only).
          Pinned top-left of the viewport so it doesn't fight with the
          bottom-right Selection panel or the dimension editor.
        */}
        {activeSketchPlaneId &&
        (activeSketchTool === "line" || selectedSketchLine) ? (
          <div className="cad-floating-panel pointer-events-auto absolute left-4 top-4 z-20 flex flex-col gap-2 px-3 py-2 text-xs">
            <p className="text-[10px] uppercase tracking-[0.18em] text-on-surface-dim">
              Line Tool
            </p>
            {activeSketchTool === "line" ? (
              <label className="flex items-center gap-2 text-on-surface">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-amber-400"
                  checked={lineToolConstruction}
                  onChange={(event) => {
                    setLineToolConstruction(event.target.checked);
                  }}
                />
                <span>
                  Construction <span className="text-on-surface-dim">(X)</span>
                </span>
              </label>
            ) : null}
            {selectedSketchLine ? (
              <label className="flex items-center gap-2 text-on-surface">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-amber-400"
                  checked={selectedSketchLine.is_construction}
                  onChange={(event) => {
                    void onSetSketchLineConstruction(
                      selectedSketchLine.line_id,
                      event.target.checked,
                    );
                  }}
                />
                <span>
                  <span className="font-mono text-on-surface-muted">
                    {selectedSketchLine.line_id}
                  </span>{" "}
                  is construction
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
        {selectedSketchDimension &&
        activeSketchPlaneId &&
        isDimensionEditorOpen ? (
          <form
            ref={dimensionEditorRef}
            className="pointer-events-auto absolute z-20 flex w-[88px] items-center rounded-md bg-black/65 px-2 py-1 shadow-[0_4px_12px_rgba(0,0,0,0.45)] backdrop-blur-md"
            style={{
              left: 0,
              top: 0,
              opacity: 0,
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmitDimensionEdit();
            }}
          >
            <input
              ref={dimensionInputRef}
              className="h-6 w-full bg-transparent text-center text-sm font-medium text-on-surface tabular-nums outline-none"
              type="number"
              min="0.01"
              step="0.01"
              value={dimensionDraftValue}
              onChange={(event) => {
                setDimensionDraftValue(event.target.value);
              }}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  // Same 2-decimal compact formatting as the open
                  // effect — keeps the field consistent on Escape.
                  setDimensionDraftValue(
                    selectedSketchDimensionValue !== null
                      ? String(
                          parseFloat(selectedSketchDimensionValue.toFixed(2)),
                        )
                      : "",
                  );
                  setIsDimensionEditorOpen(false);
                }
              }}
            />
          </form>
        ) : null}
        {!hasActiveDocument ? (
          <div
            className="absolute inset-0 flex items-center justify-center backdrop-blur-sm"
            style={{ background: "var(--cad-overlay-strong)" }}
          >
            <div className="text-center">
              <p className="cad-kicker">Viewport</p>
              <p className="mt-4 text-sm text-on-surface-muted">
                No active document to render.
              </p>
            </div>
          </div>
        ) : null}
        {status === "starting" ? (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center backdrop-blur-sm"
            style={{ background: "var(--cad-overlay-soft)" }}
          >
            <div className="cad-floating-panel flex min-w-[220px] items-center gap-4 px-5 py-4">
              <span className="cad-loader-spinner" aria-hidden="true" />
              <div>
                <p className="cad-kicker">Core Startup</p>
                <p className="mt-2 text-sm text-on-surface-muted">
                  Starting the native CAD core...
                </p>
              </div>
            </div>
          </div>
        ) : null}
        {hasActiveDocument ? (
          <>
            <div className="pointer-events-none absolute bottom-4 right-4 cad-floating-panel px-4 py-3 text-right">
              <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-dim">
                Selection
              </p>
              <p className="mt-1 text-sm text-on-surface-muted">
                {selectedReference?.label ??
                  selectedPrimitiveLabel ??
                  "No selection"}
              </p>
              {measurementText ? (
                <p className="mt-1 text-sm text-primary-soft">
                  {measurementText}
                </p>
              ) : null}
              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-on-surface-dim">
                {activeSketchPlaneId
                  ? `${activeSketchPlaneId} · ${activeSketchTool} · ${lineCount} line${lineCount === 1 ? "" : "s"} · ${circleCount} circle${circleCount === 1 ? "" : "s"}`
                  : "No active sketch"}
              </p>
              {activeSketchPlaneId ? (
                <p className="mt-1 text-xs text-on-surface-dim">
                  {armedSketchConstraint
                    ? armedSketchConstraint.kind === "coincident"
                      ? armedSketchConstraint.firstPointId
                        ? `Coincident armed · first ${armedSketchConstraint.firstPointId} · click second point`
                        : "Coincident armed · click first point"
                      : armedSketchConstraint.kind === "equal_length" ||
                          armedSketchConstraint.kind === "perpendicular" ||
                          armedSketchConstraint.kind === "parallel"
                        ? armedSketchConstraint.firstLineId
                          ? `${armedSketchConstraint.kind === "equal_length" ? "Equal length" : armedSketchConstraint.kind === "perpendicular" ? "Perpendicular" : "Parallel"} armed · first ${armedSketchConstraint.firstLineId} · click second line`
                          : `${armedSketchConstraint.kind === "equal_length" ? "Equal length" : armedSketchConstraint.kind === "perpendicular" ? "Perpendicular" : "Parallel"} armed · click first line`
                        : `${armedSketchConstraint.kind} constraint armed · click a line`
                    : document?.selected_sketch_entity_id
                      ? document?.selected_sketch_dimension_id
                        ? `Dimension: ${document.selected_sketch_dimension_id} · Entity: ${document.selected_sketch_entity_id}`
                        : `Entity: ${document.selected_sketch_entity_id}`
                      : document?.selected_sketch_point_id
                        ? `Point: ${document.selected_sketch_point_id}`
                        : document?.selected_sketch_profile_id
                          ? `Profile: ${document.selected_sketch_profile_id}`
                          : sketchSnapLabel
                            ? `Snap: ${sketchSnapLabel}`
                            : activeSketchTool === "select"
                              ? "Selection mode · press a sketch tool to draw"
                              : activeSketchTool === "line" &&
                                  lineDraftStartRef.current
                                ? "Line chain active · click to continue or press Escape"
                                : "Click to place geometry"}
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
