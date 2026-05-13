import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createViewportScene } from "@/lib";
import type {
  ArmedSketchConstraint,
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
  SketchProfileScene,
} from "@/types";
import {
  applyPrimitiveVisualState,
  applyReferencePlaneVisualState,
  applySolidFaceVisualState,
  buildPrimitiveObject,
  buildReferenceAxisObject,
  buildReferencePlaneObject,
  buildSketchArcObject,
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
  SKETCH_PLANE_OFFSET,
  SKETCH_SNAP_DISTANCE,
  themeColor,
  toWorldPoint,
  buildViewCubeGroup,
  createViewCubeScene,
  createViewCubeCamera,
  getCubeViewportRect,
  isPointerInCubeArea,
  syncCubeCamera,
  raycastViewCube,
  getCubeHitTargetDirection,
  animateCameraTowardTarget,
  applyCubeHover,
  clearCubeHover,
  applyCubeDragOrbit,
  disposeViewCubeGroup,
} from "@/utils";
import type { ViewCubeHit } from "@/utils";

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
  onSetSketchPointLineAnchor: (
    pointId: string,
    hostLineId: string,
    t: number,
  ) => Promise<void>;
  onAddSketchAngleDimension: (
    firstLineId: string,
    secondLineId: string,
  ) => Promise<void>;
  onSetSketchLineConstraint: (
    lineId: string,
    constraint: "none" | "horizontal" | "vertical",
  ) => Promise<void>;
  onSetSketchPerpendicularConstraint: (
    lineId: string,
    otherLineId: string | null,
  ) => Promise<void>;
  onSetSketchTangentConstraint: (
    lineId: string,
    circleId: string,
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
  // Add an arc using one of two creation modes:
  //   - "three_point": (start, end, anchor) where anchor lies on the
  //     arc and fixes the bulge.
  //   - "center_start_end": anchor is the center; the end is snapped
  //     onto the resulting circle in the core.
  // Both modes accept the same three (x, y) pairs in sketch-local
  // 2D coordinates; the ViewportPanel resolves them from world clicks.
  onAddSketchArc: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    anchorX: number,
    anchorY: number,
    mode: "three_point" | "center_start_end",
  ) => Promise<void>;
  // Tool-level mode for the arc tool. Lifted out of ViewportPanel so
  // the SketchToolbar can render the segmented control. Defaults to
  // "three_point"; the toolbar updates it through `onSetArcToolMode`.
  arcToolMode: "three_point" | "center_start_end";
  // Sketch fillet — fired when the user clicks an eligible corner
  // point under the Fillet tool. Eligible = sketch point shared by
  // exactly two non-construction sketch lines that are not already
  // filleted at this corner. The viewport only signals "user
  // clicked an eligible corner with these args"; App owns the
  // session radius (driven by the floating panel) and decides
  // what to do with the click. Mirrors the 3D edge-op flow where
  // the viewport reports edge picks and the panel owns the
  // numeric value being applied to all of them.
  onAddSketchFillet: (
    cornerPointId: string,
    lineAId: string,
    lineBId: string,
  ) => Promise<void>;
  onSelectSketchEntity: (entityId: string) => Promise<void>;
  onPickSketchPoint: (
    pointId: string,
    kind: "endpoint" | "center",
  ) => Promise<void>;
  armedSketchConstraint: ArmedSketchConstraint;
  // Which mirror tool slot is taking entity clicks. `null` when the
  // mirror tool isn't open. The mirror tool runs alongside the
  // armed-constraint flow but takes priority when active: a click
  // on a sketch entity is routed through `onMirrorEntityPick`
  // instead of the normal selection / armed-constraint paths.
  mirrorFocusedSlot: "objects" | "axis" | null;
  onMirrorEntityPick: (
    entityId: string,
    entityKind: "line" | "circle",
  ) => Promise<void>;
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
  onSelectSketchProfile: (profileId: string, additive: boolean) => Promise<void>;
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
  onSetSketchPointLineAnchor,
  onAddSketchAngleDimension,
  onSetSketchLineConstraint,
  onSetSketchPerpendicularConstraint,
  onSetSketchTangentConstraint,
  onAddSketchRectangle,
  onAddSketchCircle,
  onAddSketchArc,
  arcToolMode,
  onAddSketchFillet,
  onSelectSketchEntity,
  onPickSketchPoint,
  armedSketchConstraint,
  mirrorFocusedSlot,
  onMirrorEntityPick,
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
  // First line picked while the dimension tool is armed. After a
  // line click we wait for a *second* line click to know whether the
  // user wants a length dim (same line clicked again) or an angle
  // dim (different line). Cleared when the dim tool exits or when a
  // dimension is created. Stored as a ref so the click handler reads
  // the latest value without re-attaching listeners.
  const dimensionToolFirstLineRef = useRef<string | null>(null);
  const [dimensionToolFirstLine, setDimensionToolFirstLine] = useState<
    string | null
  >(null);
  const [constraintPreview, setConstraintPreview] = useState<{
    kind:
      | "midpoint"
      | "perpendicular"
      | "on_line"
      | "horizontal"
      | "vertical"
      | "tangent";
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
  // Held while the user holds the wireframe-toggle key (Tab) during a
  // pending fillet/chamfer panel session. Reveals every ghost edge
  // so the user can see and click the original sharp edges that
  // were hidden by default to keep the rounded preview readable.
  // Kept as a ref because the keydown/keyup handlers repaint edge
  // materials directly (no React state read). Painting goes through
  // `paintEdgeMaterials` which reads this ref.
  const revealGhostEdgesRef = useRef(false);
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
  // Mirrors `previewLineRef` / `previewCircleRef` for the arc tool.
  // Carries the dashed in-progress arc preview rendered while the
  // user is between clicks 2 and 3 (or, in center+start+end mode, a
  // dashed circle while between clicks 1 and 2).
  const previewArcRef = useRef<THREE.Line | null>(null);
  const viewCubeGroupRef = useRef<THREE.Group | null>(null);
  const viewCubeSceneRef = useRef<THREE.Scene | null>(null);
  const viewCubeCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const viewCubeRaycasterRef = useRef<THREE.Raycaster | null>(null);
  const viewCubeHoveredRef = useRef<ViewCubeHit>(null);
  const viewCubeAnimatingRef = useRef(false);
  const viewCubeAnimStartRef = useRef(0);
  const viewCubeAnimStartPosRef = useRef(new THREE.Vector3());
  const viewCubeAnimTargetPosRef = useRef(new THREE.Vector3());
  const viewCubeDraggingRef = useRef(false);
  const viewCubeDragStartRef = useRef<{ x: number; y: number } | null>(null);
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
  const addSketchArcRef = useRef(onAddSketchArc);
  const arcToolModeRef = useRef(arcToolMode);
  const addSketchFilletRef = useRef(onAddSketchFillet);
  // Arc placement requires three clicks. The first click goes through
  // `lineDraftStartRef` (shared with line/rect/circle to keep the
  // start-snap pipeline uniform); the second click lands here and
  // captures the end point so the third click can resolve to the
  // anchor (interior point or center, depending on `arcToolMode`).
  // Cleared after every committed arc and whenever the user switches
  // away from the arc tool.
  const arcSecondPointRef = useRef<[number, number] | null>(null);
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
  const mirrorFocusedSlotRef = useRef(mirrorFocusedSlot);
  const mirrorEntityPickRef = useRef(onMirrorEntityPick);
  const cancelSketchConstraintRef = useRef(onCancelSketchConstraint);
  const clearSketchConstraintRef = useRef(onClearSketchConstraint);
  const activeSketchToolRef = useRef<SketchTool>("select");
  const sketchSnapCandidatesRef = useRef<
    Array<{
      local: [number, number];
      label: string;
      kind?: "midpoint" | "endpoint";
      hostLineId?: string;
      // Parametric position along the host line for sub-segment
      // midpoint candidates (and 0.5 for whole-line midpoints).
      tValue?: number;
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
  // Pending point-on-line anchor state. Captured at click-time when
  // either end of the just-committed draft snapped to a line body.
  // The post-add effect dispatches one `set_sketch_point_line_anchor`
  // per side once the new line lands. Same baseline-on-line-count
  // guard as the other pending refs.
  const pendingPointLineAnchorRef = useRef<{
    fromLineCount: number;
    startHost: { lineId: string; t: number } | null;
    endHost: { lineId: string; t: number } | null;
  } | null>(null);
  // Mirror of `draftStartMidpointHostRef` for the line-body snap.
  // Holds the host line + t at the time the start was committed so
  // the *next* click (which only sees the end's snap) can still
  // attribute the start-side anchor to the correct host.
  const draftStartLineBodyHostRef = useRef<{
    lineId: string;
    t: number;
  } | null>(null);
  // Latest line count for the active sketch, mirrored as a ref so the
  // pointer handler (which captures stale closures) can baseline new
  // lines for the post-add midpoint-anchor effect.
  const sketchLineCountRef = useRef(0);
  // Stable ref to `onSetSketchMidpointAnchor` so the post-add effect
  // can issue the IPC without remounting on every re-render.
  const setSketchMidpointAnchorRef = useRef(onSetSketchMidpointAnchor);
  const setSketchPointLineAnchorRef = useRef(onSetSketchPointLineAnchor);
  const addSketchAngleDimensionRef = useRef(onAddSketchAngleDimension);
  const setSketchPerpendicularConstraintRef = useRef(
    onSetSketchPerpendicularConstraint,
  );
  const setSketchLineConstraintRef = useRef(onSetSketchLineConstraint);
  const setSketchTangentConstraintRef = useRef(onSetSketchTangentConstraint);
  // Captured at click-time when the resolved sketch point indicates
  // the line's end snapped to a circle tangent. The post-add effect
  // dispatches `set_sketch_tangent_constraint` so the relation
  // sticks. Same baseline-on-line-count guard as the other refs.
  const pendingTangentConstraintRef = useRef<{
    fromLineCount: number;
    circleId: string;
  } | null>(null);
  // Set at click-time when the resolved sketch point indicates an
  // axis lock; the post-add effect dispatches `set_sketch_line_constraint`
  // for the just-added line. Same baseline-on-line-count guard as
  // the other pending refs to avoid mis-attribution if the line
  // count ticks twice between commit and refresh.
  const pendingAxisConstraintRef = useRef<{
    fromLineCount: number;
    kind: "horizontal" | "vertical";
  } | null>(null);
  // Snapshot of the sketch feature's lines for the post-add effect to
  // index into. Same pattern as the count ref above.
  const sketchLinesRef = useRef<
    NonNullable<typeof sketchFeature>["sketch_parameters"] | null
  >(null);
  // Bodies whose edges are picked against a stable pre-fillet topology
  // because a fillet / chamfer feature targeting them is in its
  // pending panel session. Used to flag those edges as ghosts in the
  // scene, which the renderer hides by default and reveals when the
  // user holds Tab. Recomputed alongside the scene so it stays in
  // sync with `feature_history`.
  const pendingEdgeOpBodyIds = useMemo(() => {
    const result = new Set<string>();
    if (!document) {
      return result;
    }
    for (const feature of document.feature_history) {
      const params =
        feature.fillet_parameters ?? feature.chamfer_parameters ?? null;
      if (params && params.is_pending && params.target_body_id) {
        result.add(params.target_body_id);
      }
    }
    return result;
  }, [document]);
  const sceneData = useMemo(
    () =>
      viewport?.has_active_document
        ? createViewportScene(viewport, {
            hiddenFeatureIds,
            hiddenSketchPlaneIds,
            hideReferences,
            pendingEdgeOpBodyIds,
          })
        : null,
    [
      viewport,
      hiddenFeatureIds,
      hiddenSketchPlaneIds,
      hideReferences,
      pendingEdgeOpBodyIds,
    ],
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
    // Midpoint candidates carry `hostLineId` and `tValue` for the
    // post-commit anchor IPC. `tValue` is 0.5 for a clean whole-line
    // midpoint; sub-segment midpoints (when the host has been split
    // by anchored points) carry whatever fractional t the snap
    // resolver should bind the new point to.
    type Candidate = {
      local: [number, number];
      label: string;
      kind?: "midpoint" | "endpoint";
      hostLineId?: string;
      tValue?: number;
      endpointHostLineId?: string;
    };
    const candidates: Candidate[] = [{ local: [0, 0], label: "Origin" }];
    const params = sketchFeature.sketch_parameters;
    for (const line of params.lines) {
      candidates.push({
        local: [line.start_x, line.start_y],
        label:
          line.constraint === "horizontal" || line.constraint === "vertical"
            ? `${line.constraint} line`
            : "Line endpoint",
        kind: "endpoint",
        endpointHostLineId: line.line_id,
      });
      candidates.push({
        local: [line.end_x, line.end_y],
        label: "Line endpoint",
        kind: "endpoint",
        endpointHostLineId: line.line_id,
      });

      // Build the list of "split" t-values for this line. A line is
      // split by any point anchored on it (whole-line midpoint
      // anchor at t=0.5, or arbitrary-t point-line anchor). Sorting
      // them and inserting the t=0 / t=1 endpoints yields a sequence
      // of sub-segments; the midpoint of each sub-segment becomes
      // its own snap candidate. With no splits, this collapses back
      // to the classic whole-line midpoint at t=0.5.
      const splitTs: number[] = [];
      for (const anchor of params.midpoint_anchors) {
        if (anchor.line_id === line.line_id) {
          splitTs.push(0.5);
        }
      }
      for (const anchor of params.point_line_anchors ?? []) {
        if (anchor.line_id === line.line_id) {
          splitTs.push(anchor.t);
        }
      }
      // Dedupe + sort. Two anchors at the same t shouldn't generate
      // a zero-length sub-segment with degenerate snap candidates.
      const uniqueTs = Array.from(new Set([0, ...splitTs, 1])).sort(
        (a, b) => a - b,
      );
      for (let i = 0; i < uniqueTs.length - 1; i++) {
        const tMid = (uniqueTs[i] + uniqueTs[i + 1]) / 2;
        // Skip degenerate sub-segments — same-position anchors leave
        // adjacent t values equal up to floating-point noise.
        if (uniqueTs[i + 1] - uniqueTs[i] < 1e-9) {
          continue;
        }
        const isWholeLine = uniqueTs.length === 2;
        const dx = line.end_x - line.start_x;
        const dy = line.end_y - line.start_y;
        candidates.push({
          local: [line.start_x + tMid * dx, line.start_y + tMid * dy],
          // The label deliberately avoids ids — see AGENTS.md UI
          // copy rules. "Midpoint" reads naturally for both whole-
          // line and sub-segment cases.
          label: isWholeLine ? "Midpoint" : "Sub-segment midpoint",
          kind: "midpoint",
          hostLineId: line.line_id,
          tValue: tMid,
        });
      }
    }
    for (const circle of params.circles) {
      candidates.push({
        local: [circle.center_x, circle.center_y],
        label: "Circle center",
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

  function clearPreviewArc() {
    const previewArc = previewArcRef.current;
    const sketchGroup = sketchGroupRef.current;
    if (!previewArc || !sketchGroup) {
      return;
    }

    sketchGroup.remove(previewArc);
    previewArc.geometry.dispose();
    disposeMaterial(previewArc.material);
    previewArcRef.current = null;
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
        snapMidpointT:
          closestCandidate.kind === "midpoint"
            ? (closestCandidate.tValue ?? null)
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

    // Tangent snap: while drafting a line from outside a circle, the
    // cursor sticks to whichever of the two tangent points it's
    // nearest. Given start S, center C, radius r and d = |C - S|,
    // the tangent points sit at distance L = sqrt(d² - r²) from S
    // along directions ±θ off S→C, where sin θ = r/d. Skipped when
    // the start lies inside or on the circle (no real tangent
    // exists). Higher priority than axis-lock so an explicit
    // "draw to this circle" gesture wins over a passive axis hint.
    if (startPoint && params) {
      let bestTangentSnap: {
        local: [number, number];
        distance: number;
        circleId: string;
      } | null = null;
      for (const circle of params.circles) {
        const dx = circle.center_x - startPoint[0];
        const dy = circle.center_y - startPoint[1];
        const dSquared = dx * dx + dy * dy;
        const rSquared = circle.radius * circle.radius;
        if (dSquared <= rSquared + 1e-9) {
          continue;
        }
        const d = Math.sqrt(dSquared);
        const tangentLength = Math.sqrt(dSquared - rSquared);
        const ux = dx / d;
        const uy = dy / d;
        const vx = -uy;
        const vy = ux;
        const along = (tangentLength * tangentLength) / d;
        const perp = (tangentLength * circle.radius) / d;
        const candidates: Array<[number, number]> = [
          [
            startPoint[0] + along * ux + perp * vx,
            startPoint[1] + along * uy + perp * vy,
          ],
          [
            startPoint[0] + along * ux - perp * vx,
            startPoint[1] + along * uy - perp * vy,
          ],
        ];
        for (const [tx, ty] of candidates) {
          const distance = Math.hypot(
            rawPoint.local[0] - tx,
            rawPoint.local[1] - ty,
          );
          if (distance > SKETCH_SNAP_DISTANCE) {
            continue;
          }
          if (!bestTangentSnap || distance < bestTangentSnap.distance) {
            bestTangentSnap = {
              local: [tx, ty],
              distance,
              circleId: circle.circle_id,
            };
          }
        }
      }
      if (bestTangentSnap) {
        return {
          local: bestTangentSnap.local,
          world: toWorldPoint(
            activeSketchPlaneId ?? "ref-plane-xy",
            bestTangentSnap.local,
            activeSketchPlaneFrame,
          ),
          snapLabel: `Tangent to ${bestTangentSnap.circleId}`,
          snapMidpointHostLineId: null,
          snapPerpendicularHostLineId: null,
          snapEndpointHostLineId: null,
          snapTangentCircleId: bestTangentSnap.circleId,
        } satisfies SketchPreviewPoint;
      }
    }

    // Axis lock: while a draft is in progress, if the segment from
    // start → cursor lies within ~3° of the world horizontal or
    // vertical axis, pull the off-axis coordinate onto the start so
    // the line lands flat. We check H first (Fusion convention),
    // and gate on a minimum draft length so the lock doesn't fight
    // the user during the first few pixels of motion. Threshold uses
    // sin(3°) ≈ 0.0523 against `|orthogonal| / hypot`. Higher
    // priority than line-body snap by default, but we co-snap to a
    // crossed line when the locked position is within snap distance
    // of one — that way an axis-locked stroke that meets a host
    // line at right angles still gets a coincident anchor on commit
    // (the user's "go straight down to the bottom side" gesture).
    if (startPoint) {
      const ax = rawPoint.local[0] - startPoint[0];
      const ay = rawPoint.local[1] - startPoint[1];
      const hypot = Math.hypot(ax, ay);
      const minDraftLength = SKETCH_SNAP_DISTANCE * 1.5;
      if (hypot >= minDraftLength) {
        const sinThreshold = Math.sin((3 * Math.PI) / 180);
        const horizontalRatio = Math.abs(ay) / hypot;
        const verticalRatio = Math.abs(ax) / hypot;

        const buildAxisLockSnap = (
          axis: "horizontal" | "vertical",
          lockedLocal: [number, number],
        ): SketchPreviewPoint => {
          // After the axis lock fixes the off-axis coordinate, look
          // for a line the lock ray actually crosses (within the
          // line's segment) and within snap distance of the locked
          // position. We use a proper ray/segment intersection
          // rather than perpendicular projection so a line parallel
          // to the lock axis (e.g. the rectangle's other vertical
          // side under a vertical lock) doesn't generate a phantom
          // coincident anchor — those lines have no real crossing.
          const linesParamsForLock = sketchLinesRef.current;
          let crossedLine: {
            intersectionLocal: [number, number];
            lineId: string;
            t: number;
          } | null = null;
          if (linesParamsForLock) {
            let bestDistance = SKETCH_SNAP_DISTANCE;
            for (const line of linesParamsForLock.lines) {
              const dx = line.end_x - line.start_x;
              const dy = line.end_y - line.start_y;
              // Vertical lock crosses lines with non-zero dx;
              // horizontal lock crosses lines with non-zero dy.
              // Skip lines that are parallel to the lock axis
              // because the ray either misses them entirely or
              // overlaps them (no single intersection point).
              const denom = axis === "vertical" ? dx : dy;
              if (Math.abs(denom) <= 1e-9) {
                continue;
              }
              const t =
                axis === "vertical"
                  ? (startPoint[0] - line.start_x) / dx
                  : (startPoint[1] - line.start_y) / dy;
              if (t < 0 || t > 1) {
                continue;
              }
              const ix = line.start_x + t * dx;
              const iy = line.start_y + t * dy;
              // Distance is along the lock axis only — `lockedLocal`
              // shares the off-axis coordinate with the crossing.
              const distance =
                axis === "vertical"
                  ? Math.abs(iy - lockedLocal[1])
                  : Math.abs(ix - lockedLocal[0]);
              if (distance > bestDistance) {
                continue;
              }
              bestDistance = distance;
              crossedLine = {
                intersectionLocal: [ix, iy],
                lineId: line.line_id,
                t,
              };
            }
          }

          if (crossedLine) {
            return {
              local: crossedLine.intersectionLocal,
              world: toWorldPoint(
                activeSketchPlaneId ?? "ref-plane-xy",
                crossedLine.intersectionLocal,
                activeSketchPlaneFrame,
              ),
              snapLabel: axis === "horizontal" ? "Horizontal" : "Vertical",
              snapMidpointHostLineId: null,
              snapPerpendicularHostLineId: null,
              snapEndpointHostLineId: null,
              snapLineBodyHostLineId: crossedLine.lineId,
              snapLineBodyT: crossedLine.t,
              snapAxisLock: axis,
            } satisfies SketchPreviewPoint;
          }

          return {
            local: lockedLocal,
            world: toWorldPoint(
              activeSketchPlaneId ?? "ref-plane-xy",
              lockedLocal,
              activeSketchPlaneFrame,
            ),
            snapLabel: axis === "horizontal" ? "Horizontal" : "Vertical",
            snapMidpointHostLineId: null,
            snapPerpendicularHostLineId: null,
            snapEndpointHostLineId: null,
            snapAxisLock: axis,
          } satisfies SketchPreviewPoint;
        };

        if (horizontalRatio < sinThreshold) {
          return buildAxisLockSnap("horizontal", [
            rawPoint.local[0],
            startPoint[1],
          ]);
        }
        if (verticalRatio < sinThreshold) {
          return buildAxisLockSnap("vertical", [
            startPoint[0],
            rawPoint.local[1],
          ]);
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
        t: number;
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
          bestLineSnap = {
            local: [px, py],
            distance,
            lineId: line.line_id,
            t,
          };
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
          snapLineBodyHostLineId: bestLineSnap.lineId,
          snapLineBodyT: bestLineSnap.t,
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
  // Recolor every edge from its userData (selection / ghost flags) plus
  // the current hover id and the live ghost-reveal flag. Single source
  // of truth so hover changes and Tab-toggle changes don't have to
  // duplicate the visual logic.
  function paintEdgeMaterials(hoveredId: string | null) {
    const revealGhost = revealGhostEdgesRef.current;
    for (const line of edgeLineObjectsRef.current) {
      const id = line.userData.edgeId as string | undefined;
      const isSelected = line.userData.isSelected === true;
      const isGhost = line.userData.isGhost === true;
      const isHovered = id !== undefined && id === hoveredId;
      const material = line.material as THREE.LineBasicMaterial;
      applyEdgeVisualColor(material, {
        isSelected,
        isHovered,
        isGhost,
        revealGhost,
      });
    }
  }
  function setHoveredEdge(edgeId: string | null) {
    if (hoveredEdgeIdRef.current === edgeId) {
      return;
    }
    hoveredEdgeIdRef.current = edgeId;
    paintEdgeMaterials(edgeId);
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
    addSketchArcRef.current = onAddSketchArc;
    arcToolModeRef.current = arcToolMode;
    addSketchFilletRef.current = onAddSketchFillet;
    selectSketchEntityRef.current = onSelectSketchEntity;
    pickSketchPointRef.current = onPickSketchPoint;
    selectSketchDimensionRef.current = onSelectSketchDimension;
    updateSketchDimensionRef.current = onUpdateSketchDimension;
    selectSketchProfileRef.current = onSelectSketchProfile;
    setSketchToolRef.current = onSetSketchTool;
    armedSketchConstraintRef.current = armedSketchConstraint;
    mirrorFocusedSlotRef.current = mirrorFocusedSlot;
    mirrorEntityPickRef.current = onMirrorEntityPick;
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
    onAddSketchArc,
    arcToolMode,
    onAddSketchFillet,
    onSelectSketchEntity,
    onPickSketchPoint,
    onSelectSketchDimension,
    onUpdateSketchDimension,
    onSelectSketchProfile,
    onSetSketchTool,
    armedSketchConstraint,
    mirrorFocusedSlot,
    onMirrorEntityPick,
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
    setSketchPointLineAnchorRef.current = onSetSketchPointLineAnchor;
  }, [onSetSketchPointLineAnchor]);

  useEffect(() => {
    addSketchAngleDimensionRef.current = onAddSketchAngleDimension;
  }, [onAddSketchAngleDimension]);

  useEffect(() => {
    setSketchPerpendicularConstraintRef.current =
      onSetSketchPerpendicularConstraint;
  }, [onSetSketchPerpendicularConstraint]);

  useEffect(() => {
    setSketchLineConstraintRef.current = onSetSketchLineConstraint;
  }, [onSetSketchLineConstraint]);

  useEffect(() => {
    setSketchTangentConstraintRef.current = onSetSketchTangentConstraint;
  }, [onSetSketchTangentConstraint]);

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
    const pendingLine = pendingPointLineAnchorRef.current;
    const pendingAxis = pendingAxisConstraintRef.current;
    const pendingTangent = pendingTangentConstraintRef.current;
    if (!params) {
      return;
    }
    if (
      !pending &&
      !pendingPerp &&
      !pendingLine &&
      !pendingAxis &&
      !pendingTangent
    ) {
      return;
    }

    // All pending kinds use the same matching rule: the line count
    // must have grown by exactly one past the baseline. If it
    // didn't, drop every pending (they're stale).
    const baseline =
      pending?.fromLineCount ??
      pendingPerp?.fromLineCount ??
      pendingLine?.fromLineCount ??
      pendingAxis?.fromLineCount ??
      pendingTangent?.fromLineCount ??
      -1;
    if (newCount !== baseline + 1) {
      if (newCount !== previousCount) {
        pendingMidpointAnchorRef.current = null;
        pendingPerpendicularConstraintRef.current = null;
        pendingPointLineAnchorRef.current = null;
        pendingAxisConstraintRef.current = null;
        pendingTangentConstraintRef.current = null;
      }
      return;
    }

    pendingMidpointAnchorRef.current = null;
    pendingPerpendicularConstraintRef.current = null;
    pendingPointLineAnchorRef.current = null;
    pendingAxisConstraintRef.current = null;
    pendingTangentConstraintRef.current = null;
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
    // Point-on-line anchors. Per side, only fire when that side
    // wasn't already claimed by a midpoint anchor — the midpoint
    // anchor is a more specific relation and should win.
    if (pendingLine?.startHost && !pending?.startHostLineId) {
      void setSketchPointLineAnchorRef.current(
        newLine.start_point_id,
        pendingLine.startHost.lineId,
        pendingLine.startHost.t,
      );
    }
    if (pendingLine?.endHost && !pending?.endHostLineId) {
      void setSketchPointLineAnchorRef.current(
        newLine.end_point_id,
        pendingLine.endHost.lineId,
        pendingLine.endHost.t,
      );
    }
    // Axis lock takes precedence at most once per draft. Skip it if
    // a perpendicular constraint already fired for this line — the
    // two would conflict in the solver (perp's own conflict check
    // throws). Otherwise dispatch H/V as a sticky line constraint.
    if (pendingAxis && !pendingPerp) {
      void setSketchLineConstraintRef.current(
        newLine.line_id,
        pendingAxis.kind,
      );
    }
    // Tangent relation. Skipped when the new line already has a
    // perpendicular host or an axis lock — both fully determine the
    // line's direction and would over-constrain the tangent. The
    // user's explicit perp/axis intent wins; tangent is only the
    // implicit "snapped to a circle" outcome.
    if (pendingTangent && !pendingPerp && !pendingAxis) {
      void setSketchTangentConstraintRef.current(
        newLine.line_id,
        pendingTangent.circleId,
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
    // Angle dims store radians internally but the editor shows
    // degrees (matches the on-screen badge), so convert before
    // populating. `selectedSketchDimension` is null-checked above.
    const isAngle = selectedSketchDimension?.kind === "angle";
    const displayValue = isAngle
      ? selectedSketchDimensionValue * (180 / Math.PI)
      : selectedSketchDimensionValue;
    setDimensionDraftValue(String(parseFloat(displayValue.toFixed(2))));
  }, [
    selectedSketchDimensionValue,
    document?.selected_sketch_dimension_id,
    selectedSketchDimension?.kind,
  ]);

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

    controls.enableDamping = false;
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

    // -- view cube setup -------------------------------------------------
    const cubeGroup = buildViewCubeGroup();
    const cubeScene = createViewCubeScene(cubeGroup);
    const cubeCamera = createViewCubeCamera();
    const cubeRaycaster = new THREE.Raycaster();
    viewCubeGroupRef.current = cubeGroup;
    viewCubeSceneRef.current = cubeScene;
    viewCubeCameraRef.current = cubeCamera;
    viewCubeRaycasterRef.current = cubeRaycaster;

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
      renderViewCube();

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

    function renderViewCube() {
      const cubeGroup = viewCubeGroupRef.current;
      const cubeScene = viewCubeSceneRef.current;
      const cubeCam = viewCubeCameraRef.current;
      if (!cubeGroup || !cubeScene || !cubeCam) return;

      // Sync cube camera to main view direction
      syncCubeCamera(camera, controls.target, cubeCam);

      // Camera animation tick
      if (viewCubeAnimatingRef.current) {
        const done = animateCameraTowardTarget(
          camera,
          controls,
          viewCubeAnimStartPosRef.current,
          viewCubeAnimTargetPosRef.current,
          viewCubeAnimStartRef.current,
          performance.now(),
        );
        if (done) {
          viewCubeAnimatingRef.current = false;
          controls.enabled = true;
        }
      }

      const dpr = renderer.getPixelRatio();
      const w = renderer.domElement.width;
      const h = renderer.domElement.height;
      const rect = getCubeViewportRect(w, h, dpr);

      const oldAutoClear = renderer.autoClear;
      const oldViewport = new THREE.Vector4();
      const oldScissor = new THREE.Vector4();
      renderer.getViewport(oldViewport);
      renderer.getScissor(oldScissor);

      renderer.autoClear = false;
      renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
      renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
      renderer.setScissorTest(true);
      renderer.clear(true, true, false);
      renderer.render(cubeScene, cubeCam);

      renderer.setViewport(oldViewport);
      renderer.setScissor(oldScissor);
      renderer.setScissorTest(false);
      renderer.autoClear = oldAutoClear;
    }

    function intersectSceneTargets(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      raycaster.params.Line = { threshold: 1.75 };

      function pointInPolygon2d(
        point: [number, number],
        polygon: Array<[number, number]>,
      ) {
        if (polygon.length < 3) {
          return false;
        }
        let inside = false;
        for (
          let index = 0, previous = polygon.length - 1;
          index < polygon.length;
          previous = index, index += 1
        ) {
          const currentPoint = polygon[index];
          const previousPoint = polygon[previous];
          const crosses =
            currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
            point[0] <
              ((previousPoint[0] - currentPoint[0]) *
                (point[1] - currentPoint[1])) /
                (previousPoint[1] - currentPoint[1]) +
                currentPoint[0];
          if (crosses) {
            inside = !inside;
          }
        }
        return inside;
      }

      function profileArea(profile: SketchProfileScene) {
        if (profile.profileKind === "circle") {
          return Math.PI * profile.radius * profile.radius;
        }
        const polygonArea = (points: Array<[number, number]>) => {
          let area = 0;
          for (let index = 0; index < points.length; index += 1) {
            const current = points[index];
            const next = points[(index + 1) % points.length];
            area += current[0] * next[1] - next[0] * current[1];
          }
          return Math.abs(area * 0.5);
        };
        return (
          polygonArea(profile.profilePoints) -
          profile.innerLoops.reduce((sum, loop) => sum + polygonArea(loop), 0)
        );
      }

      function profileLocalPoint(profile: SketchProfileScene) {
        if (profile.planeFrame) {
          const origin = new THREE.Vector3(
            profile.planeFrame.origin[0],
            profile.planeFrame.origin[1],
            profile.planeFrame.origin[2],
          );
          const normal = new THREE.Vector3(
            profile.planeFrame.normal[0],
            profile.planeFrame.normal[1],
            profile.planeFrame.normal[2],
          );
          const xAxis = new THREE.Vector3(
            profile.planeFrame.xAxis[0],
            profile.planeFrame.xAxis[1],
            profile.planeFrame.xAxis[2],
          );
          const yAxis = new THREE.Vector3(
            profile.planeFrame.yAxis[0],
            profile.planeFrame.yAxis[1],
            profile.planeFrame.yAxis[2],
          );
          const renderOrigin = origin.clone().addScaledVector(
            normal,
            SKETCH_PLANE_OFFSET,
          );
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            normal,
            renderOrigin,
          );
          const hitPoint = new THREE.Vector3();
          const hit = raycaster.ray.intersectPlane(plane, hitPoint);
          if (!hit) {
            return null;
          }
          const relative = hitPoint.sub(renderOrigin);
          return [relative.dot(xAxis), relative.dot(yAxis)] as [number, number];
        }

        const plane =
          profile.planeId === "ref-plane-xy"
            ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -SKETCH_PLANE_OFFSET)
            : profile.planeId === "ref-plane-yz"
              ? new THREE.Plane(
                  new THREE.Vector3(1, 0, 0),
                  -SKETCH_PLANE_OFFSET,
                )
              : new THREE.Plane(
                  new THREE.Vector3(0, 0, 1),
                  -SKETCH_PLANE_OFFSET,
                );
        const hitPoint = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(plane, hitPoint);
        if (!hit) {
          return null;
        }
        if (profile.planeId === "ref-plane-xy") {
          return [hitPoint.x, hitPoint.z] as [number, number];
        }
        if (profile.planeId === "ref-plane-yz") {
          return [hitPoint.y, hitPoint.z] as [number, number];
        }
        return [hitPoint.x, hitPoint.y] as [number, number];
      }

      function containsProfilePoint(
        profile: SketchProfileScene,
        point: [number, number],
      ) {
        if (profile.profileKind === "circle") {
          const dx = point[0] - profile.start[0];
          const dy = point[1] - profile.start[1];
          return dx * dx + dy * dy <= profile.radius * profile.radius;
        }
        if (!pointInPolygon2d(point, profile.profilePoints)) {
          return false;
        }
        return !profile.innerLoops.some((loop) => pointInPolygon2d(point, loop));
      }

      function pickSketchProfileId() {
        const profiles = sceneDataRef.current?.sketchProfiles ?? [];
        const hits = profiles
          .map((profile) => {
            const point = profileLocalPoint(profile);
            if (!point || !containsProfilePoint(profile, point)) {
              return null;
            }
            return {
              profileId: profile.profileId,
              area: profileArea(profile),
            };
          })
          .filter(
            (hit): hit is { profileId: string; area: number } => hit !== null,
          );
        if (hits.length === 0) {
          return null;
        }
        hits.sort((left, right) => left.area - right.area);
        return hits[0].profileId;
      }

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

        const profileId = pickSketchProfileId();
        if (profileId) {
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
        const profileId = pickSketchProfileId();
        if (profileId) {
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

      // Cube-area drag start
      if (
        isPointerInCubeArea(
          event,
          renderer.domElement.getBoundingClientRect(),
          renderer.getPixelRatio(),
        )
      ) {
        viewCubeDraggingRef.current = true;
        viewCubeDragStartRef.current = { x: event.clientX, y: event.clientY };
        controls.enabled = false;
        pointerDown = null;
        return;
      }

      pointerDown = { x: event.clientX, y: event.clientY };
    }

    function handlePointerMove(event: PointerEvent) {
      // -- cube-area interaction ---------------------------------------
      const cubeDpr = renderer.getPixelRatio();
      const cubeCanvasRect = renderer.domElement.getBoundingClientRect();
      const inCube = isPointerInCubeArea(event, cubeCanvasRect, cubeDpr);

      if (viewCubeDraggingRef.current) {
        if (viewCubeDragStartRef.current) {
          const deltaX = event.clientX - viewCubeDragStartRef.current.x;
          const deltaY = event.clientY - viewCubeDragStartRef.current.y;
          viewCubeDragStartRef.current = { x: event.clientX, y: event.clientY };
          applyCubeDragOrbit(camera, controls, deltaX, deltaY, 0.005);
        }
        return;
      }

      if (inCube) {
        const cubeGroup = viewCubeGroupRef.current;
        const cubeCam = viewCubeCameraRef.current;
        const cubeRaycaster = viewCubeRaycasterRef.current;
        if (cubeGroup && cubeCam && cubeRaycaster) {
          const canvasWidth = renderer.domElement.width;
          const canvasHeight = renderer.domElement.height;
          const rect = getCubeViewportRect(canvasWidth, canvasHeight, cubeDpr);
          // Pointer in GL coords (origin at bottom-left)
          const glX = (event.clientX - cubeCanvasRect.left) * cubeDpr;
          const glY = canvasHeight - (event.clientY - cubeCanvasRect.top) * cubeDpr;
          const ndcX = ((glX - rect.x) / rect.width) * 2 - 1;
          const ndcY = ((glY - rect.y) / rect.height) * 2 - 1;
          cubeRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cubeCam);
          const hit = raycastViewCube(cubeRaycaster, cubeGroup);
          applyCubeHover(cubeGroup, hit);
          viewCubeHoveredRef.current = hit;
          (renderer.domElement as HTMLCanvasElement).style.cursor = hit
            ? "pointer"
            : "";
        }
        return;
      }

      // Clear cube hover when pointer leaves cube area
      if (viewCubeHoveredRef.current) {
        const cubeGroup = viewCubeGroupRef.current;
        if (cubeGroup) {
          clearCubeHover(cubeGroup);
        }
        viewCubeHoveredRef.current = null;
        (renderer.domElement as HTMLCanvasElement).style.cursor = "";
      }

      if (activeSketchPlaneId) {
        if (activeSketchToolRef.current === "select") {
          clearPreviewLine();
          clearPreviewCircle();
          clearPreviewArc();
          setSketchSnapLabel(null);
          setConstraintPreview(null);
          return;
        }

        // Project tool is a picker, not a draftsman: skip every
        // draft preview / snap-label resolution and run the body
        // face / edge / vertex hover highlight directly so the
        // user sees what they're about to pick. We can't fall
        // through to the bottom of this function because the
        // line-draft branches below `return` early before we get
        // there — instead we mirror the same hover dispatch here
        // and bail out.
        if (activeSketchToolRef.current === "project") {
          clearPreviewLine();
          clearPreviewCircle();
          clearPreviewArc();
          setSketchSnapLabel(null);
          setConstraintPreview(null);
          const projectHit = intersectSceneTargets(event);
          setHoveredReference(null);
          setHoveredPrimitive(null);
          setHoveredFace(projectHit?.kind === "face" ? projectHit.id : null);
          setHoveredEdge(projectHit?.kind === "edge" ? projectHit.id : null);
          setHoveredVertex(
            projectHit?.kind === "vertex" ? projectHit.id : null,
          );
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
          // Whole-line midpoint snaps render the "M" glyph; sub-
          // segment midpoints commit as parametric anchors and so
          // get the same "/" point-on-line glyph as a generic
          // line-body snap, keeping the visual language aligned
          // with what's actually being created on commit.
          const isWhole =
            sketchPoint.snapMidpointT !== null &&
            sketchPoint.snapMidpointT !== undefined &&
            Math.abs(sketchPoint.snapMidpointT - 0.5) < 1e-9;
          setConstraintPreview({
            kind: isWhole ? "midpoint" : "on_line",
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
        } else if (sketchPoint.snapAxisLock) {
          setConstraintPreview({
            kind: sketchPoint.snapAxisLock,
            x: previewX,
            y: previewY,
          });
        } else if (sketchPoint.snapTangentCircleId) {
          setConstraintPreview({
            kind: "tangent",
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
        clearPreviewArc();
        if (activeSketchToolRef.current === "arc") {
          // Arc preview branches on the user's progress through the
          // three-click sequence and the active arc creation mode.
          // Goal: the dashed preview should always show the *exact*
          // arc the next click will commit (or, for the early
          // single-click states, an unambiguous hint about what is
          // currently locked in).
          const arcSecondPoint = arcSecondPointRef.current;
          const cursor = sketchPoint.local;
          const arcMode = arcToolModeRef.current;

          // Build a SketchArcScene-shaped preview from a 2D
          // (center, radius, start, end, ccw) tuple. The
          // `buildSketchArcObject` renderer projects coords back
          // through the plane frame so we can hand it world-space
          // coords directly.
          const buildArcPreview = (
            centerLocal: [number, number],
            radius: number,
            startLocal: [number, number],
            endLocal: [number, number],
            ccw: boolean,
          ) => {
            if (radius < 1e-3) {
              return null;
            }
            return buildSketchArcObject(
              {
                arcId: "preview-arc",
                startPointId: "preview-arc-start",
                endPointId: "preview-arc-end",
                planeId: activeSketchPlaneId,
                center: toWorldPoint(
                  activeSketchPlaneId,
                  centerLocal,
                  activeSketchPlaneFrame,
                ),
                radius,
                start: toWorldPoint(
                  activeSketchPlaneId,
                  startLocal,
                  activeSketchPlaneFrame,
                ),
                end: toWorldPoint(
                  activeSketchPlaneId,
                  endLocal,
                  activeSketchPlaneFrame,
                ),
                ccw,
                isSelected: false,
                isConstruction: false,
                isPreview: true,
              },
              activeSketchPlaneFrame,
            );
          };

          if (arcMode === "three_point") {
            if (!arcSecondPoint) {
              // Click 2 still pending. We don't know enough to draw
              // an arc yet, so render a dashed line from start to
              // cursor as a chord-of-the-future-end hint. Mirrors
              // the existing "line preview while drafting" cue but
              // dashed so it reads as not-yet-an-arc.
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
                new THREE.LineDashedMaterial({
                  color: themeColor("--color-tertiary-plane-edge", "#ffe784"),
                  transparent: true,
                  opacity: 0.65,
                  dashSize: 1,
                  gapSize: 0.6,
                }),
              );
              preview.computeLineDistances();
              previewArcRef.current = preview;
              sketchGroupRefValue.add(preview);
            } else {
              // Click 2 captured: cursor is the bulge anchor. Solve
              // the circumcircle of (start, cursor, end) — same
              // formula as `DocumentManager::add_sketch_arc` so the
              // preview lands exactly on what we'll commit. Falls
              // through to a no-preview state when the three points
              // are colinear (degenerate arc).
              const [sx, sy] = draftStart;
              const [ex, ey] = arcSecondPoint;
              const [ax, ay] = cursor;
              const d = 2 * (sx * (ey - ay) + ex * (ay - sy) + ax * (sy - ey));
              if (Math.abs(d) > 1e-9) {
                const s2 = sx * sx + sy * sy;
                const e2 = ex * ex + ey * ey;
                const a2 = ax * ax + ay * ay;
                const cx =
                  (s2 * (ey - ay) + e2 * (ay - sy) + a2 * (sy - ey)) / d;
                const cy =
                  (s2 * (ax - ex) + e2 * (sx - ax) + a2 * (ex - sx)) / d;
                const radius = Math.hypot(sx - cx, sy - cy);
                const cross = (ax - sx) * (ey - sy) - (ay - sy) * (ex - sx);
                const ccw = cross > 0;
                const preview = buildArcPreview(
                  [cx, cy],
                  radius,
                  [sx, sy],
                  [ex, ey],
                  ccw,
                );
                if (preview) {
                  previewArcRef.current = preview;
                  sketchGroupRefValue.add(preview);
                }
              }
            }
          } else {
            // center_start_end mode.
            if (!arcSecondPoint) {
              // Click 2 still pending. Center is locked; draw a
              // dashed full circle of radius |cursor - center| so
              // the user can see the radius they're about to
              // commit. Once they click, the start position will be
              // the cursor's current position.
              const radius = Math.hypot(
                cursor[0] - draftStart[0],
                cursor[1] - draftStart[1],
              );
              if (radius >= 1e-3) {
                const preview = buildSketchCircleObject(
                  {
                    circleId: "preview-arc-circle",
                    planeId: activeSketchPlaneId,
                    center: toWorldPoint(
                      activeSketchPlaneId,
                      draftStart,
                      activeSketchPlaneFrame,
                    ),
                    radius,
                    isSelected: false,
                    // Mark as preview so it renders dashed +
                    // translucent. (LineLoop is fine here even
                    // though the ref is typed as Line — the
                    // dispose path only touches geometry/material.)
                    isPreview: true,
                  },
                  activeSketchPlaneFrame,
                );
                previewArcRef.current = preview as unknown as THREE.Line;
                sketchGroupRefValue.add(preview);
              }
            } else {
              // Click 2 captured (= start). Cursor is the end; we
              // snap it onto the circle established by
              // |center → start| just like the core does, then
              // render the arc.
              const cx = draftStart[0];
              const cy = draftStart[1];
              const sx = arcSecondPoint[0];
              const sy = arcSecondPoint[1];
              const radius = Math.hypot(sx - cx, sy - cy);
              const endDx = cursor[0] - cx;
              const endDy = cursor[1] - cy;
              const endLen = Math.hypot(endDx, endDy);
              if (radius >= 1e-3 && endLen >= 1e-3) {
                const finalEx = cx + (endDx * radius) / endLen;
                const finalEy = cy + (endDy * radius) / endLen;
                const cross =
                  (sx - cx) * (finalEy - cy) - (sy - cy) * (finalEx - cx);
                const ccw = cross > 0;
                const preview = buildArcPreview(
                  [cx, cy],
                  radius,
                  [sx, sy],
                  [finalEx, finalEy],
                  ccw,
                );
                if (preview) {
                  previewArcRef.current = preview;
                  sketchGroupRefValue.add(preview);
                }
              }
            }
          }
          return;
        }
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
                // The line/circle draft preview (drawn while the
                // user is dragging out a new circle) is not a
                // tool-generated preview entity; the renderer's
                // dashed-translucent path is gated on `isPreview`,
                // so leaving it false keeps the existing draft
                // styling intact.
                isPreview: false,
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
      if (viewCubeGroupRef.current) {
        clearCubeHover(viewCubeGroupRef.current);
      }
      viewCubeHoveredRef.current = null;
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

      // -- cube-area click ---------------------------------------------
      if (viewCubeDraggingRef.current) {
        viewCubeDraggingRef.current = false;
        const dragStart = viewCubeDragStartRef.current;
        viewCubeDragStartRef.current = null;

        // If it was a click (minimal drag), snap camera
        if (
          dragStart &&
          Math.abs(event.clientX - dragStart.x) <= 4 &&
          Math.abs(event.clientY - dragStart.y) <= 4
        ) {
          const cubeGroup = viewCubeGroupRef.current;
          const cubeCam = viewCubeCameraRef.current;
          const cubeRaycaster = viewCubeRaycasterRef.current;
          if (cubeGroup && cubeCam && cubeRaycaster) {
            const cubeDpr = renderer.getPixelRatio();
            const cubeCanvasRect = renderer.domElement.getBoundingClientRect();
            const canvasWidth = renderer.domElement.width;
            const canvasHeight = renderer.domElement.height;
            const rect = getCubeViewportRect(canvasWidth, canvasHeight, cubeDpr);
            const glX = (event.clientX - cubeCanvasRect.left) * cubeDpr;
            const glY = canvasHeight - (event.clientY - cubeCanvasRect.top) * cubeDpr;
            const ndcX = ((glX - rect.x) / rect.width) * 2 - 1;
            const ndcY = ((glY - rect.y) / rect.height) * 2 - 1;
            cubeRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cubeCam);
            const hit = raycastViewCube(cubeRaycaster, cubeGroup);
            if (hit) {
              const direction = getCubeHitTargetDirection(hit);
              const distance = camera.position.distanceTo(controls.target);
              const targetPos = controls.target.clone().add(
                direction.multiplyScalar(distance),
              );
              viewCubeAnimStartPosRef.current.copy(camera.position);
              viewCubeAnimTargetPosRef.current.copy(targetPos);
              viewCubeAnimStartRef.current = performance.now();
              viewCubeAnimatingRef.current = true;
              // controls.enabled stays false (already set on pointerDown)
            } else {
              controls.enabled = true;
            }
          }
        }
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
          // Mirror tool takes priority over the rest of the
          // selection / armed-constraint flow when one of its
          // slots is focused. We route line and circle hits to
          // the parent's mirror handler; everything else falls
          // through (so the user can still rotate the camera,
          // edit dimensions, etc. with the panel open).
          if (
            mirrorFocusedSlotRef.current &&
            hit?.kind === "sketch_entity" &&
            (hit.entityKind === "line" || hit.entityKind === "circle")
          ) {
            void mirrorEntityPickRef.current(hit.id, hit.entityKind);
            return;
          }

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
            void selectSketchProfileRef.current(
              hit.id,
              event.shiftKey || event.ctrlKey || event.metaKey,
            );
            return;
          }

          if (hit?.kind === "sketch_entity") {
            void selectSketchEntityRef.current(hit.id);
          }
          return;
        }

        // Dimension tool. Single-click on a line / circle opens its
        // unary dim editor (length / radius). Shift+click is the
        // angle-dim gesture: the first Shift+click marks a line as
        // the angle's first leg, the second Shift+click on a
        // different line creates the angle dim. Same-line Shift+
        // click clears the pending pick. Empty-space clicks also
        // clear the pending state.
        if (activeSketchToolRef.current === "dimension") {
          if (hit?.kind === "sketch_dimension") {
            dimensionToolFirstLineRef.current = null;
            setDimensionToolFirstLine(null);
            void selectSketchDimensionRef.current(hit.id);
            return;
          }
          if (hit?.kind === "sketch_entity") {
            if (hit.entityKind === "circle") {
              dimensionToolFirstLineRef.current = null;
              setDimensionToolFirstLine(null);
              const dimensionId = `dim-circle-${hit.id}`;
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
            // Line click. Shift gates the angle-pick flow.
            if (event.shiftKey) {
              const firstLineId = dimensionToolFirstLineRef.current;
              if (firstLineId === null) {
                dimensionToolFirstLineRef.current = hit.id;
                setDimensionToolFirstLine(hit.id);
                return;
              }
              if (firstLineId === hit.id) {
                // Same line picked twice — treat as a cancel rather
                // than dimensioning an angle to itself.
                dimensionToolFirstLineRef.current = null;
                setDimensionToolFirstLine(null);
                return;
              }
              dimensionToolFirstLineRef.current = null;
              setDimensionToolFirstLine(null);
              void addSketchAngleDimensionRef.current(firstLineId, hit.id);
              return;
            }
            // Plain click → length dim. Clear any pending angle
            // pick so the user doesn't accidentally bind a stale
            // first-line into the next Shift+click.
            dimensionToolFirstLineRef.current = null;
            setDimensionToolFirstLine(null);
            const dimensionId = `dim-line-${hit.id}`;
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
          // Click in empty space cancels the pending angle pick.
          dimensionToolFirstLineRef.current = null;
          setDimensionToolFirstLine(null);
          return;
        }

        // Sketch fillet tool. Clicks must land on a sketch point that
        // is shared by exactly two non-construction sketch lines and
        // is not already filleted. Anything else is a no-op (the
        // user can switch back to Select if they want to inspect).
        // Eligibility is resolved against the *current* sketch
        // snapshot in `sketchLinesRef`, not the document store, so
        // it stays in sync with what the user just sees.
        if (activeSketchToolRef.current === "fillet") {
          const filletRawPoint = resolveSketchPlanePoint(
            event,
            renderer,
            camera,
            activeSketchPlaneId,
            activeSketchPlaneFrame,
          );
          if (!filletRawPoint) {
            return;
          }
          const filletSnapped = resolveSnappedSketchPoint(filletRawPoint);
          const params = sketchLinesRef.current;
          if (!params) {
            return;
          }

          // Find the sketch point id that matches the snapped click
          // location within `kCoincidentTolerance` (same fudge the
          // core uses). We don't rely on `endpointHostLineId` from
          // the snap candidate because a corner is by definition
          // shared by *two* lines and the snap only carries one
          // host id.
          const tolerance = 0.05;
          const cornerPoint = params.points.find(
            (point) =>
              Math.hypot(
                point.x - filletSnapped.local[0],
                point.y - filletSnapped.local[1],
              ) <= tolerance,
          );
          if (!cornerPoint) {
            return;
          }

          // Lines that reference this point as an endpoint and are
          // not construction-only (construction lines don't
          // contribute to closed loops, so filleting them would
          // produce nothing useful).
          const incidentLines = params.lines.filter(
            (line) =>
              !line.is_construction &&
              (line.start_point_id === cornerPoint.point_id ||
                line.end_point_id === cornerPoint.point_id),
          );
          if (incidentLines.length !== 2) {
            return;
          }

          // Reject corners that already host a fillet referencing
          // either of the same lines — same guard the core enforces
          // in `add_sketch_fillet`. Surfaced here too so the click
          // doesn't bother round-tripping a doomed command.
          const alreadyFilleted = (params.fillets ?? []).some((fillet) =>
            incidentLines.some(
              (line) =>
                (fillet.line_a_id === line.line_id ||
                  fillet.line_b_id === line.line_id) &&
                (fillet.trim_a_point_id === cornerPoint.point_id ||
                  fillet.trim_b_point_id === cornerPoint.point_id),
            ),
          );
          if (alreadyFilleted) {
            return;
          }

          // The session radius lives in App's panel state; the
          // viewport only signals which corner was picked. App
          // dispatches `add_sketch_fillet` with whatever radius
          // the panel is showing at click time.
          void addSketchFilletRef.current(
            cornerPoint.point_id,
            incidentLines[0].line_id,
            incidentLines[1].line_id,
          );
          return;
        }

        // Modal Project tool. Clicks must land on a body face,
        // edge, or vertex; we dispatch the matching selection
        // callback (App.tsx intercepts those while the tool is
        // active and turns them into `project_*_into_sketch`
        // commands). Empty-space clicks and sketch-entity clicks
        // are no-ops so the user can't accidentally start drafting
        // a line: per the user's explicit request, the only valid
        // action while Project is armed is "pick something to
        // project". The tool stays armed across clicks.
        if (activeSketchToolRef.current === "project") {
          if (hit?.kind === "vertex") {
            void selectVertexRef.current(hit.id, /*additive=*/ false);
            return;
          }
          if (hit?.kind === "edge") {
            void selectEdgeRef.current(hit.id, /*additive=*/ false);
            return;
          }
          if (hit?.kind === "face") {
            void selectFaceRef.current(hit.id);
            return;
          }
          // No body geometry under the cursor — swallow the click
          // so we don't drop into the line-draft branch below.
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
          // Whole-line midpoint snaps (t==0.5) get a true
          // `midpoint_anchor`; sub-segment midpoints (t!=0.5,
          // e.g. quarter-line snaps after a sibling line has split
          // the host) get a parametric `point_line_anchor` instead
          // — same machinery as the line-body snap. The two
          // branches stay mutually exclusive: the snap resolver
          // can only return one host per click.
          const midpointHostLineId = sketchPoint.snapMidpointHostLineId;
          const midpointT = sketchPoint.snapMidpointT ?? null;
          const isWholeLineMidpoint =
            midpointHostLineId !== null &&
            midpointHostLineId !== undefined &&
            midpointT !== null &&
            Math.abs(midpointT - 0.5) < 1e-9;
          draftStartMidpointHostRef.current = isWholeLineMidpoint
            ? (midpointHostLineId ?? null)
            : null;
          // If the start snapped to an existing line's endpoint, arm
          // the perpendicular-foot snap for the rest of the draft.
          // (The midpoint and endpoint hosts are independent: a
          // single click can only be one or the other since they
          // come from distinct snap candidates.)
          draftStartEndpointHostRef.current =
            sketchPoint.snapEndpointHostLineId ?? null;
          // Line-body snap captures the host + parametric position
          // so the post-add effect can anchor the new line's start
          // point to the host once it lands. We funnel sub-segment
          // midpoint snaps through the same channel: they're just
          // discrete-t projections onto the line's body.
          if (
            !isWholeLineMidpoint &&
            midpointHostLineId &&
            midpointT !== null
          ) {
            draftStartLineBodyHostRef.current = {
              lineId: midpointHostLineId,
              t: midpointT,
            };
          } else {
            draftStartLineBodyHostRef.current =
              sketchPoint.snapLineBodyHostLineId &&
              typeof sketchPoint.snapLineBodyT === "number"
                ? {
                    lineId: sketchPoint.snapLineBodyHostLineId,
                    t: sketchPoint.snapLineBodyT,
                  }
                : null;
          }
          return;
        }

        const [startX, startY] = lineDraftStartRef.current;
        clearPreviewLine();
        clearPreviewCircle();
        clearPreviewArc();

        if (activeSketchToolRef.current === "arc") {
          // Three-click arc placement. The first click landed in the
          // `!lineDraftStartRef.current` branch and stored the
          // start point; the second click captures the end point and
          // returns; the third click reads the anchor and dispatches.
          if (!arcSecondPointRef.current) {
            arcSecondPointRef.current = sketchPoint.local;
            return;
          }
          const [secondX, secondY] = arcSecondPointRef.current;
          const [thirdX, thirdY] = sketchPoint.local;
          arcSecondPointRef.current = null;
          lineDraftStartRef.current = null;
          // Click order differs by mode. In `three_point` the user
          // clicks (start, end, point-on-arc), which lines up 1:1
          // with the IPC's (start, end, anchor) params. In
          // `center_start_end` the user clicks (center, start, end)
          // — center is the *third* IPC param, so we have to
          // permute. The preview rendering above already follows
          // the same per-mode interpretation; without the permute
          // here the committed arc lands on the opposite side from
          // what the preview showed because the core then treats
          // click 1 (center) as if it were the arc's start.
          const mode = arcToolModeRef.current;
          if (mode === "three_point") {
            void addSketchArcRef.current(
              startX,
              startY,
              secondX,
              secondY,
              thirdX,
              thirdY,
              mode,
            );
          } else {
            // center_start_end: IPC params are
            // (start=click2, end=click3, anchor=click1).
            void addSketchArcRef.current(
              secondX,
              secondY,
              thirdX,
              thirdY,
              startX,
              startY,
              mode,
            );
          }
          return;
        }

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

        // Capture both endpoints' midpoint hosts before the draft
        // state advances, so the post-add effect can attach anchors
        // to the just-created line. The baseline line count anchors
        // the effect's match: it will fire only when the sketch's
        // line count grows past `fromLineCount` by 1. Whole-line
        // midpoints (t==0.5) → midpoint_anchor; sub-segment
        // midpoints → point_line_anchor (handled below as part of
        // the line-body anchor path).
        const startHostLineId = draftStartMidpointHostRef.current;
        const endMidpointT = sketchPoint.snapMidpointT ?? null;
        const endIsWholeLineMidpoint =
          sketchPoint.snapMidpointHostLineId &&
          endMidpointT !== null &&
          Math.abs(endMidpointT - 0.5) < 1e-9;
        const endHostLineId = endIsWholeLineMidpoint
          ? (sketchPoint.snapMidpointHostLineId ?? null)
          : null;
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

        // Capture pending point-on-line anchor for either side that
        // landed on a line body OR a sub-segment midpoint. The
        // start-side host was stashed at the previous click (or
        // chained from the last commit); the end-side comes
        // straight from the current snap result. Sub-segment
        // midpoints (t!=0.5) ride this same channel so they
        // commit as parametric anchors.
        const endIsSubSegmentMidpoint =
          sketchPoint.snapMidpointHostLineId &&
          endMidpointT !== null &&
          !endIsWholeLineMidpoint;
        const endLineBodyHost = endIsSubSegmentMidpoint
          ? {
              lineId: sketchPoint.snapMidpointHostLineId as string,
              t: endMidpointT as number,
            }
          : sketchPoint.snapLineBodyHostLineId &&
              typeof sketchPoint.snapLineBodyT === "number"
            ? {
                lineId: sketchPoint.snapLineBodyHostLineId,
                t: sketchPoint.snapLineBodyT,
              }
            : null;
        const startLineBodyHost = draftStartLineBodyHostRef.current;
        if (startLineBodyHost || endLineBodyHost) {
          pendingPointLineAnchorRef.current = {
            fromLineCount: sketchLineCountRef.current,
            startHost: startLineBodyHost,
            endHost: endLineBodyHost,
          };
        }

        // Capture pending axis lock so the post-add effect can
        // dispatch a sticky `set_sketch_line_constraint` for the new
        // line. Skipped when the line also has a perpendicular host
        // — the solver rejects the combination.
        if (sketchPoint.snapAxisLock && !perpHostLineId) {
          pendingAxisConstraintRef.current = {
            fromLineCount: sketchLineCountRef.current,
            kind: sketchPoint.snapAxisLock,
          };
        }

        // Capture pending tangent relation when the cursor snapped
        // onto a circle's tangent point. Skipped when a perpendicular
        // host is also pending — they conflict on the line's end.
        if (sketchPoint.snapTangentCircleId && !perpHostLineId) {
          pendingTangentConstraintRef.current = {
            fromLineCount: sketchLineCountRef.current,
            circleId: sketchPoint.snapTangentCircleId,
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
        // Same chaining for the line-body host: the next draft
        // segment's start is the end we just committed.
        draftStartLineBodyHostRef.current = endLineBodyHost;
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
        void selectSketchProfileRef.current(
          hit.id,
          event.shiftKey || event.ctrlKey || event.metaKey,
        );
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
      if (viewCubeGroupRef.current) {
        disposeViewCubeGroup(viewCubeGroupRef.current);
        viewCubeGroupRef.current = null;
      }
      viewCubeSceneRef.current = null;
      viewCubeCameraRef.current = null;
      viewCubeRaycasterRef.current = null;
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
      previewArcRef.current = null;
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
    previewArcRef.current = null;

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

    for (const sketchArc of sceneData.sketchArcs) {
      // Same plane-frame resolution as circles — see the comment
      // above. Arc samples need the active sketch's frame to land
      // on the plane.
      const frame =
        activeSketchPlaneId &&
        sketchArc.planeId === activeSketchPlaneId &&
        activeSketchPlaneFrame
          ? activeSketchPlaneFrame
          : null;
      const sketchArcObject = buildSketchArcObject(sketchArc, frame);
      sketchEntityObjectsRef.current.push(sketchArcObject);
      sketchGroup.add(sketchArcObject);
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
    arcSecondPointRef.current = null;
    clearPreviewLine();
    clearPreviewCircle();
    clearPreviewArc();
    setSketchSnapLabel(null);
    setConstraintPreview(null);
    // Reset the dimension tool's pending first-line on every tool
    // switch so it can't leak across tools or sketches.
    dimensionToolFirstLineRef.current = null;
    setDimensionToolFirstLine(null);
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
        arcSecondPointRef.current = null;
        clearPreviewLine();
        clearPreviewCircle();
        clearPreviewArc();
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

  // Tab toggles ghost-edge visibility while a fillet/chamfer panel is
  // open. The handler is mounted only when at least one body has a
  // pending edge-op feature so the key keeps its default browser
  // behavior in every other context. Hold to reveal, release to hide.
  useEffect(() => {
    if (pendingEdgeOpBodyIds.size === 0) {
      return;
    }
    function isTypingTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
    }
    function setReveal(next: boolean) {
      if (revealGhostEdgesRef.current === next) {
        return;
      }
      revealGhostEdgesRef.current = next;
      paintEdgeMaterials(hoveredEdgeIdRef.current);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Tab") {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      // Suppress the default Tab focus shuffle so the panel session
      // stays in control of the input the user just typed into.
      event.preventDefault();
      setReveal(true);
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== "Tab") {
        return;
      }
      setReveal(false);
    }
    function handleBlur() {
      // Window blur (e.g. user switched apps mid-hold) loses keyup
      // events; reset so the wireframe doesn't get stuck "on".
      setReveal(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      // Drop the reveal state so the next pending session starts
      // hidden by default.
      revealGhostEdgesRef.current = false;
    };
  }, [pendingEdgeOpBodyIds]);

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

    const rawValue = Number(dimensionDraftValue);
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      setIsDimensionEditorOpen(false);
      return;
    }

    // Angle dims accept the user's input in degrees (matching the
    // badge); convert back to radians before sending to the core.
    const nextValue =
      selectedSketchDimension.kind === "angle"
        ? rawValue * (Math.PI / 180)
        : rawValue;

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
            activeSketchPlaneId &&
            activeSketchTool !== "select" &&
            activeSketchTool !== "project"
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
                : constraintPreview.kind === "horizontal"
                  ? "H"
                  : constraintPreview.kind === "vertical"
                    ? "V"
                    : constraintPreview.kind === "tangent"
                      ? "T"
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
        activeSketchTool !== "dimension" &&
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
        {/*
          Floating Dimension Tool hint panel. Active only while the
          dim tool is armed; updates from "click a line / circle" to
          "click second line for angle, or same line for length"
          after the first line is picked. Mirrors the Line Tool
          panel's placement so the user always knows where to look.
        */}
        {activeSketchPlaneId && activeSketchTool === "dimension" ? (
          <div className="cad-floating-panel pointer-events-auto absolute left-4 top-4 z-20 flex flex-col gap-1 px-3 py-2 text-xs">
            <p className="text-[10px] uppercase tracking-[0.18em] text-on-surface-dim">
              Dimension Tool <span className="opacity-60">(D)</span>
            </p>
            <p className="text-on-surface">
              {dimensionToolFirstLine === null ? (
                <>Click a line / circle. Shift+click two lines for angle.</>
              ) : (
                <>
                  Angle: pick second line. First leg ={" "}
                  <span className="font-mono text-on-surface-muted">
                    {dimensionToolFirstLine}
                  </span>
                </>
              )}
            </p>
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
                          parseFloat(
                            (selectedSketchDimension?.kind === "angle"
                              ? selectedSketchDimensionValue * (180 / Math.PI)
                              : selectedSketchDimensionValue
                            ).toFixed(2),
                          ),
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
                {/* Plane / face ids are internal — see
                    AGENTS.md UI Copy Rules. The status line just
                    reports the active tool and entity counts. */}
                {activeSketchPlaneId
                  ? `Sketching · ${activeSketchTool} · ${lineCount} line${lineCount === 1 ? "" : "s"} · ${circleCount} circle${circleCount === 1 ? "" : "s"}`
                  : "No active sketch"}
              </p>
              {activeSketchPlaneId ? (
                <p className="mt-1 text-xs text-on-surface-dim">
                  {/* Status text — never embed internal ids; see
                      AGENTS.md "UI Copy Rules". The selection
                      details (entity / point / dimension /
                      profile) just acknowledge that something is
                      selected; specifics live in the floating
                      panels keyed off those selections. */}
                  {armedSketchConstraint
                    ? armedSketchConstraint.kind === "coincident"
                      ? armedSketchConstraint.firstPointId
                        ? "Coincident armed · click second point"
                        : "Coincident armed · click first point"
                      : armedSketchConstraint.kind === "equal_length" ||
                          armedSketchConstraint.kind === "perpendicular" ||
                          armedSketchConstraint.kind === "parallel"
                        ? armedSketchConstraint.firstLineId
                          ? `${armedSketchConstraint.kind === "equal_length" ? "Equal length" : armedSketchConstraint.kind === "perpendicular" ? "Perpendicular" : "Parallel"} armed · click second line`
                          : `${armedSketchConstraint.kind === "equal_length" ? "Equal length" : armedSketchConstraint.kind === "perpendicular" ? "Perpendicular" : "Parallel"} armed · click first line`
                        : `${armedSketchConstraint.kind} constraint armed · click a line`
                    : document?.selected_sketch_entity_id
                      ? document?.selected_sketch_dimension_id
                        ? "Dimension selected"
                        : "Entity selected"
                      : document?.selected_sketch_point_id
                        ? "Point selected"
                        : document?.selected_sketch_profile_id
                          ? "Profile selected"
                          : sketchSnapLabel
                            ? `Snap: ${sketchSnapLabel}`
                            : activeSketchTool === "select"
                              ? "Selection mode · press a sketch tool to draw"
                              : activeSketchTool === "project"
                                ? "Click a face, edge, or vertex to project"
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
