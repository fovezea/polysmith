import { useEffect, useMemo, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { awaitDocumentChange, useCadCoreStore } from "./state";
import { useCadCore } from "./hooks";
import { findDependents } from "./lib";
import {
  AppHeader,
  BoxFeatureForm,
  CylinderFeatureForm,
  DocumentHierarchyPanel,
  EdgeOpPreviewPanel,
  ExtrudePreviewPanel,
  OffsetPlanePanel,
  SketchFilletPanel,
  MirrorToolPanel,
  FeatureTimeline,
  MessageLog,
  ViewportPanel,
} from "./layout";
import type { CategoryId } from "./layout";
import { ArmedSketchConstraint } from "./types";
import type { ExtrudeMode } from "./types";

const DEFAULT_EXTRUDE_DEPTH = 20;
const DEFAULT_FILLET_RADIUS = 1;
const DEFAULT_CHAMFER_DISTANCE = 1;
// Default seed for the Offset Plane panel. Zero would be a valid
// frame (sitting on top of the source) but gives no visible preview;
// 10 mm matches Fusion's "show me something" default.
const DEFAULT_OFFSET_PLANE_DISTANCE = 10;

// The Core Messages debug panel is hidden by default. Set
// `VITE_SHOW_DEBUG_MESSAGE_LOG=true` in `.env.local` (or your shell when
// running `pnpm dev`) to surface it again while debugging the IPC bridge.
const SHOW_DEBUG_MESSAGE_LOG =
  import.meta.env.VITE_SHOW_DEBUG_MESSAGE_LOG === "true";

interface ActiveExtrudeAction {
  phase: "pending" | "active";
  featureId: string | null;
  initialDepth: number;
  initialMode: ExtrudeMode;
  profileCount: number;
  // Snapshot of "did the document have any other solid bodies before the
  // user invoked this extrude?" — drives whether Join/Cut are offered.
  canCombineWithExistingBody: boolean;
  // Set when the panel was opened to *edit* an existing extrude (via
  // double-click in the timeline) rather than to dial in a freshly-
  // created one. On cancel we restore these values instead of calling
  // `undo`, which would clobber whatever the user did *after* the
  // extrude was originally created.
  originalSnapshot: {
    depth: number;
    mode: ExtrudeMode;
    targetBodyId: string | null;
  } | null;
}

// In-progress fillet or chamfer feature. Two-phase Fusion-style flow:
//
//   - phase "pending": panel is open but no feature exists yet. The
//     user opens this by invoking Fillet / Chamfer with no edges
//     selected. They can either type a value first or click an edge
//     first; whichever comes first, the other is honored when the
//     feature is created on the first edge click.
//
//   - phase "active": the core created the feature on the first edge
//     pick. The panel now drives live `update_*_radius` /
//     `update_*_distance` and edge clicks toggle membership through
//     `update_*_edges`. We mirror the edge list locally as the
//     authoritative source while editing — relying on the document
//     round-trip for it caused dropped edges under rapid clicking,
//     because each click read a stale snapshot of `selected_edge_ids`.
type ActiveEdgeOpAction =
  | {
      phase: "pending";
      kind: "fillet" | "chamfer";
      // Seed value displayed in the panel; the *current* typed value
      // lives in `pendingValueRef` so that an edge click placed
      // mid-typing still uses the latest input.
      initialValue: number;
    }
  | {
      phase: "active";
      kind: "fillet" | "chamfer";
      featureId: string;
      initialValue: number;
      edgeIds: string[];
    };

function App() {
  const [armedSketchConstraint, setArmedSketchConstraint] =
    useState<ArmedSketchConstraint>(null);
  // Which input slot in the floating Mirror panel is currently
  // focused (and therefore captures viewport entity clicks).
  // `null` means the panel is closed; the *open / closed* state is
  // mirrored in the document's `pending_mirror` so the UI flag
  // and the core stay in sync via the document round-trip.
  const [mirrorFocusedSlot, setMirrorFocusedSlot] = useState<
    "objects" | "axis" | null
  >(null);
  const [extrudeAction, setExtrudeAction] =
    useState<ActiveExtrudeAction | null>(null);
  const extrudeCreateInFlightRef = useRef(false);
  const lastExtrudeProfileUpdateRef = useRef("");
  // Arc tool creation mode. Defaults to three-point (Fusion's default
  // and the most ergonomic for shaping curves on the fly). The
  // SketchToolbar exposes a segmented control to toggle to
  // center+start+end without leaving the tool.
  const [arcToolMode, setArcToolMode] = useState<
    "three_point" | "center_start_end"
  >("three_point");
  // Sketch fillet panel session. Mirrors `ActiveEdgeOpAction` (the
  // 3D fillet/chamfer flow) shape-for-shape: it opens the moment
  // the user activates the Fillet tool (`pending` phase, no
  // fillets yet) and transitions to `active` as soon as they
  // click their first eligible corner. The panel's `radius`
  // applies to every fillet created in the session and is fanned
  // out across all of them on every debounced numeric change so
  // the user gets the same "select N corners, dial in one
  // radius" experience as 3D fillets give for edges.
  type SketchFilletAction =
    | { phase: "pending"; radius: number }
    | { phase: "active"; radius: number; filletIds: string[] };
  const [sketchFilletAction, setSketchFilletAction] =
    useState<SketchFilletAction | null>(null);
  // Mirror of `sketchFilletAction.filletIds` for the inline
  // viewport callback. Same trick as `activeEdgeIdsRef` in the 3D
  // edge-op flow: the click handler runs inside a closure that
  // captures the value at panel-open time, so we need a ref to
  // see the live list when each subsequent click lands.
  const sketchFilletIdsRef = useRef<string[]>([]);
  const [edgeOpAction, setEdgeOpAction] = useState<ActiveEdgeOpAction | null>(
    null,
  );
  // In-progress offset plane session. Mirrors the fillet/chamfer
  // two-phase pattern:
  //   - "pending": panel is open but no construction_plane feature
  //     exists yet. The user must click a plane / planar face in the
  //     viewport. The next valid click promotes the session to
  //     "active". `pendingOffsetRef` holds the latest typed offset
  //     so the create call uses whatever the user dialed in before
  //     clicking.
  //   - "active": the core created the feature; typing here drives
  //     `update_offset_plane` for live preview.
  type OffsetPlaneAction =
    | { phase: "pending"; initialOffset: number }
    | {
        phase: "active";
        featureId: string;
        initialOffset: number;
        sourceSummary: string;
      };
  const [offsetPlaneAction, setOffsetPlaneAction] =
    useState<OffsetPlaneAction | null>(null);
  const pendingOffsetRef = useRef<number>(DEFAULT_OFFSET_PLANE_DISTANCE);
  // Identifies which feature (if any) is being edited via the floating
  // edit panel. The panel itself reads the feature's parameters
  // directly from `document.feature_history`, so we only need the id
  // here. `null` means the panel is closed. Triggered by a
  // double-click in the timeline (see `onEditFeature` below).
  const [editingFeatureId, setEditingFeatureId] = useState<string | null>(null);
  const [hiddenFeatureIds, setHiddenFeatureIds] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [hiddenCategories, setHiddenCategories] = useState<Set<CategoryId>>(
    () => new Set<CategoryId>(),
  );
  // Hierarchy sidebar layout. Collapsed: shown as a thin vertical bar
  // labelled "Hierarchy" on the left edge. Width is user-resizable
  // via a drag handle on the sidebar's right edge.
  const [isHierarchyCollapsed, setIsHierarchyCollapsed] =
    useState<boolean>(false);
  const [hierarchyWidth, setHierarchyWidth] = useState<number>(320);
  const status = useCadCoreStore((state) => state.status);
  const messages = useCadCoreStore((state) => state.messages);
  const document = useCadCoreStore((state) => state.document);
  const session = useCadCoreStore((state) => state.session);
  const viewport = useCadCoreStore((state) => state.viewport);
  const addMessage = useCadCoreStore((state) => state.addMessage);
  const selectedReference =
    viewport?.reference_planes.find(
      (referencePlane) => referencePlane.is_selected,
    ) ?? null;
  const selectedSketchProfile =
    viewport?.sketch_profiles.find((profile) => profile.is_selected) ?? null;
  const selectedSketchProfiles =
    viewport?.sketch_profiles.filter((profile) => profile.is_selected) ?? [];
  const selectedSketchProfileIds =
    document?.selected_sketch_profile_ids ?? selectedSketchProfiles.map(
      (profile) => profile.profile_id,
    );
  const selectedSketchProfileIdsKey = selectedSketchProfileIds.join("|");
  const activeSketchPlaneId = document?.active_sketch_plane_id ?? null;
  const activeSketchTool = document?.active_sketch_tool ?? null;
  // The active sketch's pending mirror state lives in the document.
  // The UI presents the floating panel whenever this is non-null;
  // local React state only tracks which slot has keyboard / pick
  // focus.
  const activeSketchFeature =
    document?.feature_history.find(
      (entry) => entry.feature_id === document?.active_sketch_feature_id,
    ) ?? null;
  const pendingMirror =
    activeSketchFeature?.sketch_parameters?.pending_mirror ?? null;
  const isMirrorToolOpen = pendingMirror !== null;
  function toCorePlaneFrame(planeFrame: {
    origin: [number, number, number];
    xAxis: [number, number, number];
    yAxis: [number, number, number];
    normal: [number, number, number];
  }) {
    return {
      origin: {
        x: planeFrame.origin[0],
        y: planeFrame.origin[1],
        z: planeFrame.origin[2],
      },
      x_axis: {
        x: planeFrame.xAxis[0],
        y: planeFrame.xAxis[1],
        z: planeFrame.xAxis[2],
      },
      y_axis: {
        x: planeFrame.yAxis[0],
        y: planeFrame.yAxis[1],
        z: planeFrame.yAxis[2],
      },
      normal: {
        x: planeFrame.normal[0],
        y: planeFrame.normal[1],
        z: planeFrame.normal[2],
      },
    };
  }
  const {
    start,
    createDocument,
    exportDocument,
    exportDocumentStl,
    saveDocument,
    loadDocument,
    projectFaceIntoSketch,
    projectEdgeIntoSketch,
    projectVertexIntoSketch,
    addBoxFeature,
    addCylinderFeature,
    updateBoxFeature,
    updateCylinderFeature,
    updateExtrudeDepth,
    renameFeature,
    setFeatureSuppressed,
    deleteFeature,
    undo,
    redo,
    selectFeature,
    selectReference,
    selectFace,
    selectEdge,
    selectVertex,
    createFillet,
    updateFilletRadius,
    updateFilletEdges,
    createChamfer,
    updateChamferDistance,
    updateChamferEdges,
    confirmFillet,
    confirmChamfer,
    createOffsetPlane,
    updateOffsetPlane,
    startSketchOnPlane,
    startSketchOnFace,
    setSketchTool,
    setSketchLineConstraint,
    setSketchEqualLengthConstraint,
    setSketchCoincidentConstraint,
    setSketchParallelConstraint,
    setSketchPerpendicularConstraint,
    setSketchTangentConstraint,
    startMirrorPreview,
    updateMirrorPreviewAxis,
    updateMirrorPreviewObjects,
    commitMirrorPreview,
    cancelMirrorPreview,
    setSketchPointFixed,
    updateSketchDimension,
    selectSketchProfile,
    extrudeProfile,
    updateExtrudeMode,
    updateExtrudeProfiles,
    updateExtrudeTargetBody,
    addSketchLine,
    setSketchLineConstruction,
    setSketchMidpointAnchor,
    setSketchPointLineAnchor,
    addSketchAngleDimension,
    addSketchRectangle,
    addSketchCircle,
    addSketchArc,
    addSketchFillet,
    updateSketchFilletRadius,
    deleteSketchFillet,
    selectSketchPoint,
    selectSketchEntity,
    selectSketchDimension,
    finishSketch,
    reenterSketch,
    clearSelection,
  } = useCadCore();

  useEffect(() => {
    if (!activeSketchPlaneId) {
      setArmedSketchConstraint(null);
      // Mirror tool is sketch-scoped: if the user finishes the
      // sketch (or the active sketch otherwise becomes null) we
      // drop the focus state. The core's pending_mirror is
      // already gone with the sketch, so there's nothing else to
      // clean up here.
      setMirrorFocusedSlot(null);
      // Same reasoning for the in-progress sketch fillet: the
      // fillet record lives on the sketch, so once the sketch
      // closes the panel has nothing to drive. We don't try to
      // commit or cancel implicitly; the user's `finishSketch`
      // already left the fillet in the sketch in its current
      // committed state.
      setSketchFilletAction(null);
      sketchFilletIdsRef.current = [];
    }
  }, [activeSketchPlaneId]);

  // Open / close the Sketch Fillet panel in lockstep with the
  // active sketch tool. Activating the Fillet tool opens the panel
  // in `pending` phase; deactivating it (switching to any other
  // tool) implicitly *confirms* — we keep whatever fillets the
  // user already created and drop the session. Cancel-with-undo
  // remains explicit via the panel's Cancel button. This keeps
  // the door open for casual exploration: drop in a fillet, switch
  // to Line, draw something, come back later — without losing
  // work.
  useEffect(() => {
    if (
      activeSketchTool === "fillet" &&
      activeSketchPlaneId &&
      !sketchFilletAction
    ) {
      setSketchFilletAction({ phase: "pending", radius: 5 });
      sketchFilletIdsRef.current = [];
      return;
    }
    if (activeSketchTool !== "fillet" && sketchFilletAction) {
      setSketchFilletAction(null);
      sketchFilletIdsRef.current = [];
    }
  }, [activeSketchTool, activeSketchPlaneId, sketchFilletAction]);

  // Auto-startup: launch the native core as soon as the UI mounts and,
  // once the core is connected, create an empty document so the user
  // lands on a working canvas instead of an "offline" splash. Both
  // calls are gated by status so a failed start (status === "error")
  // doesn't loop, and the document creation only fires on the
  // idle -> connected transition.
  useEffect(() => {
    if (status === "idle") {
      void start();
      return;
    }
    if (status === "connected" && document === null) {
      void createDocument();
    }
  }, [status, document, start, createDocument]);

  // UI-only visibility: combine per-feature hides with category hides into
  // sets the viewport can use to filter primitives, sketch entities, and
  // reference geometry. Sketch entities are filtered by plane id since the
  // viewport snapshot does not carry the owning sketch feature id on each
  // sketch primitive.
  const BODY_KINDS = new Set(["box", "cylinder", "polygon_extrude", "extrude"]);
  const effectiveHiddenFeatureIds = useMemo(() => {
    const set = new Set<string>(hiddenFeatureIds);
    if (!document) {
      return set;
    }
    for (const feature of document.feature_history) {
      if (hiddenCategories.has("sketches") && feature.kind === "sketch") {
        set.add(feature.feature_id);
      }
      if (hiddenCategories.has("bodies") && BODY_KINDS.has(feature.kind)) {
        set.add(feature.feature_id);
      }
      // Hiding the Construction category hides every parametric
      // construction plane (and indirectly suppresses any sketch
      // anchored on one, since `hiddenSketchPlaneIds` follows from
      // these ids via the per-plane sketch grouping below).
      if (
        hiddenCategories.has("construction") &&
        feature.kind === "construction_plane"
      ) {
        set.add(feature.feature_id);
      }
    }
    return set;
  }, [document, hiddenFeatureIds, hiddenCategories]);

  const hiddenSketchPlaneIds = useMemo(() => {
    const result = new Set<string>();
    if (!document) {
      return result;
    }
    // Group sketch features by plane id so we only hide a plane when every
    // sketch attached to it is hidden.
    const planeToSketches = new Map<string, string[]>();
    for (const feature of document.feature_history) {
      if (feature.kind !== "sketch" || !feature.sketch_parameters) {
        continue;
      }
      const planeId = feature.sketch_parameters.plane_id;
      const list = planeToSketches.get(planeId) ?? [];
      list.push(feature.feature_id);
      planeToSketches.set(planeId, list);
    }
    for (const [planeId, sketchIds] of planeToSketches) {
      if (sketchIds.every((id) => effectiveHiddenFeatureIds.has(id))) {
        result.add(planeId);
      }
    }
    return result;
  }, [document, effectiveHiddenFeatureIds]);

  async function triggerExtrudeAction() {
    if (extrudeAction?.phase === "active") {
      return;
    }

    const hasExistingBody =
      (document?.feature_history ?? []).some(
        (entry) =>
          entry.kind === "box" ||
          entry.kind === "cylinder" ||
          entry.kind === "extrude",
      ) ?? false;

    setExtrudeAction({
      phase: "pending",
      featureId: null,
      initialDepth: DEFAULT_EXTRUDE_DEPTH,
      initialMode: "new_body",
      profileCount: selectedSketchProfileIds.length,
      originalSnapshot: null,
      canCombineWithExistingBody: hasExistingBody,
    });
  }

  async function createExtrudeFromSelectedProfiles(
    depth: number,
    mode: ExtrudeMode,
    targetBodyId: string | null,
  ) {
    const profileIds = selectedSketchProfileIds;
    if (profileIds.length === 0) {
      return;
    }
    if (extrudeCreateInFlightRef.current) {
      return;
    }
    extrudeCreateInFlightRef.current = true;

    // The IPC bridge is fire-and-forget: `extrudeProfile` returns as soon as
    // the command is written to cad_core stdin, before the core has emitted
    // the `document_state` event with the new feature. To capture the real
    // new feature id we subscribe to the next document update that contains
    // a freshly created extrude feature.
    const documentPromise = awaitDocumentChange((next, previous) => {
      if (!next.selected_feature_id) {
        return false;
      }
      const previousLength = previous?.feature_history.length ?? 0;
      if (next.feature_history.length <= previousLength) {
        return false;
      }
      const lastFeature = next.feature_history[next.feature_history.length - 1];
      return (
        lastFeature.feature_id === next.selected_feature_id &&
        lastFeature.kind === "extrude"
      );
    });

    await runAction(async () => {
      try {
        await extrudeProfile(profileIds, depth, mode, targetBodyId);
        const nextDocument = await documentPromise;
        const newFeatureId = nextDocument.selected_feature_id ?? null;
        if (!newFeatureId) {
          return;
        }
        lastExtrudeProfileUpdateRef.current = profileIds.join("|");
        setExtrudeAction({
          phase: "active",
          featureId: newFeatureId,
          initialDepth: depth,
          initialMode: mode,
          profileCount: profileIds.length,
          // Newly-created extrude: cancel = undo (handled below).
          originalSnapshot: null,
          canCombineWithExistingBody:
            (document?.feature_history ?? []).some(
              (entry) =>
                entry.kind === "box" ||
                entry.kind === "cylinder" ||
                entry.kind === "extrude",
            ) ?? false,
        });
      } catch (error) {
        addMessage(`extrude action error: ${String(error)}`);
      } finally {
        extrudeCreateInFlightRef.current = false;
      }
    });
  }

  useEffect(() => {
    if (!extrudeAction || selectedSketchProfileIds.length === 0) {
      return;
    }

    if (extrudeAction.phase === "pending") {
      void createExtrudeFromSelectedProfiles(
        extrudeAction.initialDepth,
        extrudeAction.initialMode,
        null,
      );
      return;
    }

    if (!extrudeAction.featureId) {
      return;
    }

    if (lastExtrudeProfileUpdateRef.current === selectedSketchProfileIdsKey) {
      return;
    }

    lastExtrudeProfileUpdateRef.current = selectedSketchProfileIdsKey;
    const nextCount = selectedSketchProfileIds.length;
    void runAction(async () => {
      await updateExtrudeProfiles(extrudeAction.featureId!, selectedSketchProfileIds);
      setExtrudeAction((current) =>
        current?.phase === "active" && current.featureId === extrudeAction.featureId
          ? {...current, profileCount: nextCount}
          : current,
      );
    });
  }, [extrudeAction, selectedSketchProfileIdsKey]);

  // Latest typed value while in the "pending" phase. The panel debounces
  // its onPreviewValue callback, so a click that lands mid-typing must
  // read the freshest value via this ref rather than from React state.
  const pendingValueRef = useRef<number>(DEFAULT_FILLET_RADIUS);

  // Live edge_ids for the in-progress fillet/chamfer feature. We mirror
  // the list in a ref (in addition to React state for the UI count) so
  // every viewport edge click can read the *current* set synchronously
  // and dispatch update_*_edges immediately. A purely state-based
  // approach can't do that — `setState` updaters run asynchronously, so
  // any IPC dispatch decided inside the updater fires after the click
  // handler has already returned, dropping the call entirely. The ref
  // sidesteps both that and the IPC-echo-lag race in one move.
  const activeEdgeIdsRef = useRef<string[]>([]);

  // Fusion-style flow for Fillet / Chamfer. The user invokes the action
  // first (button or hotkey), the panel opens in "pending" phase, and
  // the *first* edge click is what actually creates the feature in the
  // core via create_fillet / create_chamfer. If edges happen to be
  // pre-selected when the action is invoked, we honor that and create
  // immediately, jumping straight to the "active" phase. See the
  // ActiveEdgeOpAction comment above for the rationale.
  // Friendly label for a plane the user just clicked. Per AGENTS.md
  // UI Copy Rules we never expose internal ids — origin planes get
  // "XY plane" / "YZ plane" / "XZ plane", construction planes use
  // their feature name (e.g. "Offset Plane 2"), and faces use the
  // owning body name + the face's kind label.
  function describePlaneSource(referenceId: string): string {
    if (referenceId === "ref-plane-xy") return "XY plane";
    if (referenceId === "ref-plane-yz") return "YZ plane";
    if (referenceId === "ref-plane-xz") return "XZ plane";
    const feature = document?.feature_history.find(
      (entry) => entry.feature_id === referenceId,
    );
    if (feature) {
      return feature.name || feature.kind;
    }
    // Face id "<body_id>:face:<index>" — pull the face's label /
    // owning body label off the viewport snapshot if we can.
    const face = viewport?.solid_faces.find(
      (entry) => entry.face_id === referenceId,
    );
    if (face) {
      return face.label || `${face.owner_kind} face`;
    }
    return "selected plane";
  }

  // Start the Fusion-style Offset Plane flow. Opens the panel in
  // pending phase; the next viewport click on a plane / planar face
  // promotes the session to active by calling `create_offset_plane`.
  // If a plane / face is already selected we honor the
  // "select-then-invoke" shortcut and create the feature immediately.
  async function triggerOffsetPlaneAction() {
    if (
      extrudeAction ||
      edgeOpAction ||
      offsetPlaneAction ||
      activeSketchPlaneId
    ) {
      return;
    }
    pendingOffsetRef.current = DEFAULT_OFFSET_PLANE_DISTANCE;

    // Already-selected plane? Use it immediately.
    const preselectedReference = document?.selected_reference_id ?? null;
    const preselectedFaceId = document?.selected_face_id ?? null;
    const preselectedFace = preselectedFaceId
      ? (viewport?.solid_faces.find(
          (entry) => entry.face_id === preselectedFaceId,
        ) ?? null)
      : null;
    const sourceId =
      preselectedReference ??
      (preselectedFace && preselectedFace.sketchability === "planar"
        ? preselectedFaceId
        : null);
    if (sourceId) {
      await createOffsetPlaneFeature(sourceId, DEFAULT_OFFSET_PLANE_DISTANCE);
      return;
    }

    setOffsetPlaneAction({
      phase: "pending",
      initialOffset: DEFAULT_OFFSET_PLANE_DISTANCE,
    });
  }

  // Dispatch `create_offset_plane` and wait for the new feature to
  // come back over IPC, mirroring the extrude / fillet flows. Promotes
  // the panel from pending to active once the feature id is known.
  async function createOffsetPlaneFeature(sourceId: string, offset: number) {
    const documentPromise = awaitDocumentChange((next, previous) => {
      if (!next.selected_feature_id) {
        return false;
      }
      const previousLength = previous?.feature_history.length ?? 0;
      if (next.feature_history.length <= previousLength) {
        return false;
      }
      const lastFeature = next.feature_history[next.feature_history.length - 1];
      return (
        lastFeature.feature_id === next.selected_feature_id &&
        lastFeature.kind === "construction_plane"
      );
    });

    await runAction(async () => {
      await createOffsetPlane(sourceId, offset);
      try {
        const nextDocument = await documentPromise;
        const newFeatureId = nextDocument.selected_feature_id ?? null;
        if (!newFeatureId) {
          return;
        }
        setOffsetPlaneAction({
          phase: "active",
          featureId: newFeatureId,
          initialOffset: offset,
          sourceSummary: describePlaneSource(sourceId),
        });
      } catch (error) {
        addMessage(`offset plane error: ${String(error)}`);
      }
    });
  }

  async function triggerEdgeOpAction(kind: "fillet" | "chamfer") {
    if (extrudeAction || edgeOpAction || activeSketchPlaneId) {
      return;
    }
    const initialValue =
      kind === "fillet" ? DEFAULT_FILLET_RADIUS : DEFAULT_CHAMFER_DISTANCE;
    pendingValueRef.current = initialValue;

    const preSelectedEdgeIds = document?.selected_edge_ids ?? [];
    if (preSelectedEdgeIds.length === 0) {
      // No edges yet — open the panel in "pending" mode and let the
      // user pick edges in the viewport.
      setEdgeOpAction({ phase: "pending", kind, initialValue });
      return;
    }

    // Pre-selected edges: behave like Fusion's "select-then-invoke"
    // shortcut and create the feature immediately.
    await createEdgeOpFeature(kind, preSelectedEdgeIds, initialValue);
  }

  // Creates the fillet/chamfer feature in the core and transitions the
  // panel into the "active" phase once the freshly-created feature id
  // has come back over IPC.
  async function createEdgeOpFeature(
    kind: "fillet" | "chamfer",
    edgeIds: string[],
    value: number,
  ) {
    if (edgeIds.length === 0) {
      return;
    }
    // Same fire-and-forget IPC trick as triggerExtrudeAction: subscribe to
    // the next document update that contains a freshly-created feature of
    // the requested kind so we can pick up its real id.
    const documentPromise = awaitDocumentChange((next, previous) => {
      if (!next.selected_feature_id) {
        return false;
      }
      const previousLength = previous?.feature_history.length ?? 0;
      if (next.feature_history.length <= previousLength) {
        return false;
      }
      const lastFeature = next.feature_history[next.feature_history.length - 1];
      return (
        lastFeature.feature_id === next.selected_feature_id &&
        lastFeature.kind === kind
      );
    });

    await runAction(async () => {
      if (kind === "fillet") {
        await createFillet(edgeIds, value);
      } else {
        await createChamfer(edgeIds, value);
      }
      try {
        const nextDocument = await documentPromise;
        const newFeatureId = nextDocument.selected_feature_id ?? null;
        if (!newFeatureId) {
          return;
        }
        activeEdgeIdsRef.current = [...edgeIds];
        setEdgeOpAction({
          phase: "active",
          kind,
          featureId: newFeatureId,
          initialValue: value,
          edgeIds: [...edgeIds],
        });
      } catch (error) {
        addMessage(`${kind} action error: ${String(error)}`);
      }
    });
  }

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (isTypingTarget(target)) {
        return;
      }

      const isMod = event.metaKey || event.ctrlKey;

      // Undo: Cmd/Ctrl+Z (no Shift). Redo: Cmd/Ctrl+Shift+Z, or Cmd/Ctrl+Y.
      if (isMod && !event.altKey && event.code === "KeyZ") {
        event.preventDefault();
        if (event.shiftKey) {
          if (session?.can_redo) {
            void runAction(redo);
          }
        } else {
          if (session?.can_undo) {
            void runAction(undo);
          }
        }
        return;
      }

      if (isMod && !event.altKey && !event.shiftKey && event.code === "KeyY") {
        event.preventDefault();
        if (session?.can_redo) {
          void runAction(redo);
        }
        return;
      }

      // E / F: trigger extrude / fillet actions (no modifiers).
      // Chamfer intentionally has no hotkey — it's invoked from the
      // Modify ribbon button only.
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      if (event.code === "KeyE") {
        event.preventDefault();
        void triggerExtrudeAction();
        return;
      }

      // Fillet is gated to non-sketch mode — body edges aren't
      // selectable inside an active sketch anyway, but the explicit
      // guard keeps the hotkey from surprising the user during
      // sketching. No edge-selection requirement: pressing F with
      // nothing selected opens the panel in "pending" mode and the
      // user picks edges in the viewport, mirroring the toolbar
      // button. (`triggerEdgeOpAction` already handles both phases.)
      if (event.code === "KeyF") {
        if (activeSketchPlaneId) {
          return;
        }
        event.preventDefault();
        void triggerEdgeOpAction("fillet");
        return;
      }

      // P: toggle the modal Project tool inside an active sketch.
      // While the tool is active, viewport face / edge / vertex
      // clicks are routed to `project_*_into_sketch` instead of the
      // normal selection (see App.tsx click intercepts). Pressing P
      // again (or Esc, or picking another tool) switches back to
      // Select. No-op outside sketch mode.
      if (event.code === "KeyP") {
        if (!activeSketchPlaneId) {
          return;
        }
        event.preventDefault();
        const nextTool = activeSketchTool === "project" ? "select" : "project";
        void runAction(async () => {
          await setSketchTool(nextTool);
        });
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    selectedSketchProfile,
    extrudeAction,
    edgeOpAction,
    activeSketchPlaneId,
    activeSketchTool,
    document?.selected_edge_ids,
    document?.selected_face_id,
    viewport?.solid_faces,
    session?.can_undo,
    session?.can_redo,
  ]);

  function clearArmedSketchConstraint() {
    setArmedSketchConstraint(null);
  }

  async function handleSketchConstraintLinePick(lineId: string) {
    if (!armedSketchConstraint) {
      await selectSketchEntity(lineId);
      return;
    }

    if (armedSketchConstraint.kind === "coincident") {
      await selectSketchEntity(lineId);
      return;
    }

    if (armedSketchConstraint.kind === "horizontal") {
      await setSketchLineConstraint(lineId, "horizontal");
      clearArmedSketchConstraint();
      return;
    }

    if (armedSketchConstraint.kind === "vertical") {
      await setSketchLineConstraint(lineId, "vertical");
      clearArmedSketchConstraint();
      return;
    }

    if (armedSketchConstraint.kind === "clear") {
      await setSketchLineConstraint(lineId, "none");
      clearArmedSketchConstraint();
      return;
    }

    const firstLineId =
      "firstLineId" in armedSketchConstraint
        ? armedSketchConstraint.firstLineId
        : null;

    if (!firstLineId) {
      await selectSketchEntity(lineId);
      setArmedSketchConstraint({
        kind: armedSketchConstraint.kind,
        firstLineId: lineId,
      });
      return;
    }

    if (firstLineId === lineId) {
      return;
    }

    if (armedSketchConstraint.kind === "equal_length") {
      await setSketchEqualLengthConstraint(lineId, firstLineId);
    } else if (armedSketchConstraint.kind === "parallel") {
      await setSketchParallelConstraint(lineId, firstLineId);
    } else {
      await setSketchPerpendicularConstraint(lineId, firstLineId);
    }
    clearArmedSketchConstraint();
  }

  async function handleSketchConstraintPointPick(
    pointId: string,
    kind: "endpoint" | "center",
  ) {
    if (!armedSketchConstraint || armedSketchConstraint.kind !== "coincident") {
      await selectSketchPoint(pointId);
      return;
    }

    if (kind !== "endpoint") {
      await selectSketchPoint(pointId);
      return;
    }

    if (!armedSketchConstraint.firstPointId) {
      await selectSketchPoint(pointId);
      setArmedSketchConstraint({
        kind: "coincident",
        firstPointId: pointId,
      });
      return;
    }

    if (armedSketchConstraint.firstPointId === pointId) {
      return;
    }

    await setSketchCoincidentConstraint(
      pointId,
      armedSketchConstraint.firstPointId,
    );
    clearArmedSketchConstraint();
  }

  function makeDefaultExportBaseName() {
    return (
      (document?.name ?? "polysmith-part")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "polysmith-part"
    );
  }

  async function pickExportPath() {
    const filePath = await save({
      title: "Export STEP",
      defaultPath: `${makeDefaultExportBaseName()}.step`,
      filters: [
        {
          name: "STEP",
          extensions: ["step", "stp"],
        },
      ],
    });

    if (filePath === null) {
      addMessage("export canceled");
      return null;
    }

    return filePath;
  }

  async function pickExportStlPath() {
    const filePath = await save({
      title: "Export STL",
      defaultPath: `${makeDefaultExportBaseName()}.stl`,
      filters: [
        {
          name: "STL",
          extensions: ["stl"],
        },
      ],
    });

    if (filePath === null) {
      addMessage("export canceled");
      return null;
    }

    return filePath;
  }

  async function pickSaveDocumentPath() {
    const filePath = await save({
      title: "Save PolySmith document",
      defaultPath: `${makeDefaultExportBaseName()}.polysmith`,
      filters: [
        {
          name: "PolySmith document",
          extensions: ["polysmith", "json"],
        },
      ],
    });

    if (filePath === null) {
      addMessage("save canceled");
      return null;
    }
    return filePath;
  }

  async function pickLoadDocumentPath() {
    const result = await open({
      title: "Open PolySmith document",
      multiple: false,
      directory: false,
      filters: [
        {
          name: "PolySmith document",
          extensions: ["polysmith", "json"],
        },
      ],
    });

    if (result === null || Array.isArray(result)) {
      addMessage("open canceled");
      return null;
    }
    return result;
  }

  async function runAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      addMessage(`action error: ${String(error)}`);
    }
  }

  // Shared delete handler used by both the timeline and hierarchy
  // context menus. Walks the dependency graph and prompts the user
  // when downstream features would be broken; silently deletes when
  // the feature is a leaf. Also closes the edit panel if the
  // deleted feature was being edited.
  function confirmAndDeleteFeature(featureId: string) {
    if (!document) {
      return;
    }
    const dependents = findDependents(document, featureId);
    if (dependents.length > 0) {
      const names = dependents
        .map((entry) => entry.name || entry.kind)
        .join(", ");
      const confirmed = window.confirm(
        `Deleting this feature will break ${dependents.length} downstream feature(s): ${names}. Delete anyway?`,
      );
      if (!confirmed) {
        return;
      }
    }
    void runAction(async () => {
      await deleteFeature(featureId);
      setEditingFeatureId((current) =>
        current === featureId ? null : current,
      );
    });
  }

  return (
    <main className="cad-shell h-screen">
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <AppHeader
          status={status}
          disabled={status !== "connected"}
          canUndo={session?.can_undo ?? false}
          canRedo={session?.can_redo ?? false}
          activeSketchPlaneId={activeSketchPlaneId}
          activeSketchTool={activeSketchTool}
          selectedReferenceId={selectedReference?.reference_id ?? null}
          selectedFaceId={document?.selected_face_id ?? null}
          armedSketchConstraint={armedSketchConstraint}
          isMirrorToolOpen={isMirrorToolOpen}
          arcToolMode={arcToolMode}
          onSetArcToolMode={setArcToolMode}
          onStart={async () => {
            await runAction(start);
          }}
          onStartMirrorTool={async () => {
            // Idempotent: clicking Mirror while it's already open
            // re-focuses the Objects slot (a Fusion-style "I'd
            // like to redo my selection from scratch" gesture
            // would be Cancel + reopen, but we keep this lighter).
            await runAction(async () => {
              await startMirrorPreview();
              setMirrorFocusedSlot("objects");
              clearArmedSketchConstraint();
            });
          }}
          onCreateDocument={async () => {
            await runAction(createDocument);
          }}
          onExportDocument={async () => {
            const filePath = await pickExportPath();
            if (!filePath) {
              return;
            }

            await runAction(async () => {
              await exportDocument(filePath);
              addMessage(`export requested: ${filePath}`);
            });
          }}
          onExportDocumentStl={async () => {
            const filePath = await pickExportStlPath();
            if (!filePath) {
              return;
            }

            await runAction(async () => {
              await exportDocumentStl(filePath);
              addMessage(`stl export requested: ${filePath}`);
            });
          }}
          onSaveDocument={async () => {
            const filePath = await pickSaveDocumentPath();
            if (!filePath) {
              return;
            }

            await runAction(async () => {
              await saveDocument(filePath);
              addMessage(`saved: ${filePath}`);
            });
          }}
          onLoadDocument={async () => {
            const filePath = await pickLoadDocumentPath();
            if (!filePath) {
              return;
            }

            await runAction(async () => {
              await loadDocument(filePath);
              addMessage(`loaded: ${filePath}`);
            });
          }}
          onUndo={async () => {
            await runAction(undo);
          }}
          onRedo={async () => {
            await runAction(redo);
          }}
          onAddBoxFeature={async (width, height, depth) => {
            await runAction(async () => {
              await addBoxFeature(width, height, depth);
            });
          }}
          onAddCylinderFeature={async (radius, height) => {
            await runAction(async () => {
              await addCylinderFeature(radius, height);
            });
          }}
          canExtrude={!extrudeAction || extrudeAction.phase === "pending"}
          onExtrude={triggerExtrudeAction}
          // Modify ribbon: Fillet / Chamfer can be invoked at any
          // time outside a sketch / other floating action. Edge
          // selection is *not* required — the panel opens in
          // "pending" mode and waits for the user to click edges in
          // the viewport.
          canEdgeOp={!activeSketchPlaneId && !extrudeAction && !edgeOpAction}
          onFillet={async () => {
            await triggerEdgeOpAction("fillet");
          }}
          onChamfer={async () => {
            await triggerEdgeOpAction("chamfer");
          }}
          canOffsetPlane={
            !activeSketchPlaneId &&
            !extrudeAction &&
            !edgeOpAction &&
            !offsetPlaneAction
          }
          onOffsetPlane={() => {
            void triggerOffsetPlaneAction();
          }}
          onStartSketch={async () => {
            if (!selectedReference) {
              return;
            }

            await runAction(async () => {
              await startSketchOnPlane(selectedReference.reference_id);
            });
          }}
          onFinishSketch={async () => {
            await runAction(async () => {
              clearArmedSketchConstraint();
              await finishSketch();
            });
          }}
          onSetSketchTool={async (tool) => {
            await runAction(async () => {
              clearArmedSketchConstraint();
              await setSketchTool(tool);
            });
          }}
          onArmSketchConstraint={async (constraint) => {
            let shouldArm = true;

            setArmedSketchConstraint((current) => {
              const isSameConstraint =
                current &&
                current.kind === constraint &&
                (constraint !== "equal_length" &&
                constraint !== "coincident" &&
                constraint !== "perpendicular" &&
                constraint !== "parallel"
                  ? true
                  : current.kind === constraint);

              if (isSameConstraint) {
                shouldArm = false;
                return null;
              }

              // Mirror is no longer an armed constraint — the
              // toolbar's Mirror button calls
              // `onStartMirrorTool` directly. Defensively handle
              // a stray "mirror" arming request as a no-op so we
              // don't desync the toolbar's button state.
              if (constraint === "mirror") {
                shouldArm = false;
                return current;
              }
              return constraint === "equal_length" ||
                constraint === "coincident" ||
                constraint === "perpendicular" ||
                constraint === "parallel"
                ? constraint === "coincident"
                  ? { kind: constraint, firstPointId: null }
                  : { kind: constraint, firstLineId: null }
                : ({ kind: constraint } as ArmedSketchConstraint);
            });

            if (shouldArm && activeSketchTool !== "select") {
              await runAction(async () => {
                await setSketchTool("select");
              });
            }
          }}
          onCancelSketchConstraint={clearArmedSketchConstraint}
        />

        <div className="flex min-h-0 min-w-0">
          {isHierarchyCollapsed ? (
            <button
              type="button"
              className="cad-sidebar-collapsed"
              onClick={() => setIsHierarchyCollapsed(false)}
              aria-label="Expand hierarchy panel"
              title="Expand hierarchy"
            >
              <span className="cad-sidebar-collapsed-label">Hierarchy</span>
            </button>
          ) : (
            <aside
              className="cad-sidebar relative min-h-0 flex-shrink-0"
              style={{ width: hierarchyWidth }}
            >
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-center justify-between gap-2 px-3 pt-2">
                  <span className="cad-kicker">Hierarchy</span>
                  <button
                    type="button"
                    className="cad-sidebar-collapse-button"
                    onClick={() => setIsHierarchyCollapsed(true)}
                    aria-label="Collapse hierarchy panel"
                    title="Collapse"
                  >
                    ◀
                  </button>
                </div>
                <DocumentHierarchyPanel
                  document={document}
                  hiddenFeatureIds={hiddenFeatureIds}
                  hiddenCategories={hiddenCategories}
                  onToggleFeatureVisibility={(featureId) => {
                    setHiddenFeatureIds((current) => {
                      const next = new Set(current);
                      if (next.has(featureId)) {
                        next.delete(featureId);
                      } else {
                        next.add(featureId);
                      }
                      return next;
                    });
                  }}
                  onToggleCategoryVisibility={(category) => {
                    setHiddenCategories((current) => {
                      const next = new Set(current);
                      if (next.has(category)) {
                        next.delete(category);
                      } else {
                        next.add(category);
                      }
                      return next;
                    });
                  }}
                  onSelectFeature={async (featureId) => {
                    await runAction(async () => {
                      await selectFeature(featureId);
                    });
                  }}
                  onSelectReference={async (referenceId) => {
                    await runAction(async () => {
                      await selectReference(referenceId);
                    });
                  }}
                  onReenterSketch={async (featureId) => {
                    await runAction(async () => {
                      await reenterSketch(featureId);
                    });
                  }}
                  onRenameFeature={async (featureId, name) => {
                    await runAction(async () => {
                      await renameFeature(featureId, name);
                    });
                  }}
                  onDeleteFeature={async (featureId) => {
                    confirmAndDeleteFeature(featureId);
                  }}
                  onSetFeatureSuppressed={async (featureId, suppressed) => {
                    await runAction(async () => {
                      await setFeatureSuppressed(featureId, suppressed);
                    });
                  }}
                />
              </div>
              <div
                className="cad-sidebar-resizer"
                onPointerDown={(event) => {
                  // Pointer-driven drag: capture the start position
                  // and width, then update on every move until the
                  // user releases. Width is clamped to keep the
                  // panel usable.
                  event.preventDefault();
                  const startX = event.clientX;
                  const startWidth = hierarchyWidth;
                  const onMove = (moveEvent: PointerEvent) => {
                    const next = Math.max(
                      220,
                      Math.min(640, startWidth + (moveEvent.clientX - startX)),
                    );
                    setHierarchyWidth(next);
                  };
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                }}
              />
            </aside>
          )}

          <section className="relative min-h-0 min-w-0 flex-1">
            <ViewportPanel
              status={status}
              document={document}
              viewport={viewport}
              onSelectPrimitive={async (primitiveId) => {
                await runAction(async () => {
                  await selectFeature(primitiveId);
                });
              }}
              onSelectReference={async (referenceId) => {
                // Offset Plane pending phase: the next plane click is
                // the source pick. Create the feature with the
                // currently-typed offset and let the panel transition
                // to its active phase. We deliberately do *not* also
                // call selectReference here — the core's
                // create_offset_plane already routes selection state.
                if (
                  offsetPlaneAction &&
                  offsetPlaneAction.phase === "pending"
                ) {
                  await createOffsetPlaneFeature(
                    referenceId,
                    pendingOffsetRef.current,
                  );
                  return;
                }
                await runAction(async () => {
                  await selectReference(referenceId);
                });
              }}
              onSelectFace={async (faceId) => {
                // Same intercept as onSelectReference: a face click
                // during the pending phase is a valid offset-plane
                // source as long as the face is planar.
                if (
                  offsetPlaneAction &&
                  offsetPlaneAction.phase === "pending"
                ) {
                  const face = viewport?.solid_faces.find(
                    (entry) => entry.face_id === faceId,
                  );
                  if (face && face.sketchability === "planar") {
                    await createOffsetPlaneFeature(
                      faceId,
                      pendingOffsetRef.current,
                    );
                    return;
                  }
                  // Non-planar face: ignore the click, leave the
                  // panel in pending phase so the user can pick
                  // somewhere else.
                  return;
                }
                // Modal Project tool: a face click while it's active
                // projects the face's outline onto the active sketch
                // plane via `project_face_into_sketch`. The tool
                // stays armed so the user can keep clicking more
                // faces / edges / vertices without re-toggling the
                // button.
                if (activeSketchPlaneId && activeSketchTool === "project") {
                  await runAction(async () => {
                    try {
                      await projectFaceIntoSketch(faceId);
                    } catch (error) {
                      addMessage(
                        `Project face: ${error instanceof Error ? error.message : String(error)}`,
                      );
                    }
                  });
                  return;
                }
                await runAction(async () => {
                  await selectFace(faceId);
                });
              }}
              onSelectEdge={async (edgeId, additive) => {
                // Modal Project tool wins over the normal edge-pick
                // path. Same shape as the face intercept above.
                if (activeSketchPlaneId && activeSketchTool === "project") {
                  await runAction(async () => {
                    try {
                      await projectEdgeIntoSketch(edgeId);
                    } catch (error) {
                      addMessage(
                        `Project edge: ${error instanceof Error ? error.message : String(error)}`,
                      );
                    }
                  });
                  return;
                }
                // While a fillet / chamfer floating panel is open the
                // user is in "pick edges" mode: every edge click
                // toggles that edge in the feature's edge_ids set
                // rather than the document selection. The body
                // recompiles live so the user sees the fillet grow /
                // shrink as they pick. We ignore `additive` here —
                // toggle is the only meaningful gesture during edit.
                if (edgeOpAction) {
                  // Pending phase: this is the first edge — create the
                  // feature with the latest typed value (which may have
                  // been edited before any edge was clicked).
                  if (edgeOpAction.phase === "pending") {
                    await createEdgeOpFeature(
                      edgeOpAction.kind,
                      [edgeId],
                      pendingValueRef.current,
                    );
                    return;
                  }

                  // Active phase: toggle membership. We compute the
                  // next list against the ref (not against React
                  // state, whose updater runs asynchronously, and not
                  // against the document, whose echo for the previous
                  // click may not have arrived yet) so rapid
                  // successive clicks compound correctly.
                  const current = activeEdgeIdsRef.current;
                  const isMember = current.includes(edgeId);
                  const updated = isMember
                    ? current.filter((id) => id !== edgeId)
                    : [...current, edgeId];
                  if (updated.length === 0) {
                    // Last edge: refusing the toggle keeps the
                    // feature valid (the core requires at least one
                    // edge). The user can Cancel the panel to undo
                    // entirely.
                    return;
                  }
                  activeEdgeIdsRef.current = updated;
                  setEdgeOpAction((prev) =>
                    prev && prev.phase === "active"
                      ? { ...prev, edgeIds: updated }
                      : prev,
                  );
                  await runAction(async () => {
                    if (edgeOpAction.kind === "fillet") {
                      await updateFilletEdges(edgeOpAction.featureId, updated);
                    } else {
                      await updateChamferEdges(edgeOpAction.featureId, updated);
                    }
                  });
                  return;
                }
                await runAction(async () => {
                  await selectEdge(edgeId, additive);
                });
              }}
              onSelectVertex={async (vertexId, additive) => {
                // Modal Project tool: vertex click projects a fixed
                // standalone sketch point onto the active plane.
                if (activeSketchPlaneId && activeSketchTool === "project") {
                  await runAction(async () => {
                    try {
                      await projectVertexIntoSketch(vertexId);
                    } catch (error) {
                      addMessage(
                        `Project vertex: ${error instanceof Error ? error.message : String(error)}`,
                      );
                    }
                  });
                  return;
                }
                await runAction(async () => {
                  await selectVertex(vertexId, additive);
                });
              }}
              onStartSketch={async (referenceId) => {
                await runAction(async () => {
                  await startSketchOnPlane(referenceId);
                });
              }}
              onStartSketchOnFace={async (faceId, planeFrame) => {
                await runAction(async () => {
                  await startSketchOnFace(faceId, toCorePlaneFrame(planeFrame));
                });
              }}
              onAddSketchLine={async (
                startX,
                startY,
                endX,
                endY,
                isConstruction,
              ) => {
                await runAction(async () => {
                  await addSketchLine(
                    startX,
                    startY,
                    endX,
                    endY,
                    isConstruction,
                  );
                });
              }}
              onSetSketchLineConstruction={async (lineId, isConstruction) => {
                await runAction(async () => {
                  await setSketchLineConstruction(lineId, isConstruction);
                });
              }}
              onSetSketchMidpointAnchor={async (pointId, hostLineId) => {
                await runAction(async () => {
                  await setSketchMidpointAnchor(pointId, hostLineId);
                });
              }}
              onSetSketchPointLineAnchor={async (pointId, hostLineId, t) => {
                await runAction(async () => {
                  await setSketchPointLineAnchor(pointId, hostLineId, t);
                });
              }}
              onAddSketchAngleDimension={async (firstLineId, secondLineId) => {
                await runAction(async () => {
                  await addSketchAngleDimension(firstLineId, secondLineId);
                });
              }}
              onSetSketchLineConstraint={async (lineId, constraint) => {
                await runAction(async () => {
                  await setSketchLineConstraint(lineId, constraint);
                });
              }}
              onSetSketchPerpendicularConstraint={async (
                lineId,
                otherLineId,
              ) => {
                await runAction(async () => {
                  await setSketchPerpendicularConstraint(lineId, otherLineId);
                });
              }}
              onSetSketchTangentConstraint={async (lineId, circleId) => {
                await runAction(async () => {
                  await setSketchTangentConstraint(lineId, circleId);
                });
              }}
              onAddSketchRectangle={async (
                startX,
                startY,
                endX,
                endY,
                isConstruction,
              ) => {
                await runAction(async () => {
                  await addSketchRectangle(
                    startX,
                    startY,
                    endX,
                    endY,
                    isConstruction,
                  );
                });
              }}
              onAddSketchCircle={async (
                centerX,
                centerY,
                radius,
                isConstruction,
              ) => {
                await runAction(async () => {
                  await addSketchCircle(
                    centerX,
                    centerY,
                    radius,
                    isConstruction,
                  );
                });
              }}
              onAddSketchArc={async (
                startX,
                startY,
                endX,
                endY,
                anchorX,
                anchorY,
                mode,
                isConstruction,
              ) => {
                await runAction(async () => {
                  await addSketchArc(
                    startX,
                    startY,
                    endX,
                    endY,
                    anchorX,
                    anchorY,
                    mode,
                    isConstruction,
                  );
                });
              }}
              arcToolMode={arcToolMode}
              onSetArcToolMode={setArcToolMode}
              onAddSketchFillet={async (cornerPointId, lineAId, lineBId) => {
                // Panel must be open in either phase for adds to be
                // accepted. The viewport's eligibility filter is the
                // primary guard; this is just a defence against a
                // race where the user drops the panel mid-click.
                if (!sketchFilletAction) {
                  return;
                }
                const sessionRadius = sketchFilletAction.radius;
                // Same fire-and-forget IPC trick as the extrude /
                // edge-op flows: subscribe to the next document
                // update that adds a new fillet on the active
                // sketch so we can pick up the real fillet id and
                // append it to the session list.
                const documentPromise = awaitDocumentChange(
                  (next, previous) => {
                    if (!next.active_sketch_feature_id) {
                      return false;
                    }
                    const nextSketch = next.feature_history.find(
                      (entry) =>
                        entry.feature_id === next.active_sketch_feature_id,
                    );
                    const prevSketch = previous?.feature_history.find(
                      (entry) =>
                        entry.feature_id === next.active_sketch_feature_id,
                    );
                    const nextFillets =
                      nextSketch?.sketch_parameters?.fillets ?? [];
                    const prevFillets =
                      prevSketch?.sketch_parameters?.fillets ?? [];
                    return nextFillets.length > prevFillets.length;
                  },
                );

                await runAction(async () => {
                  await addSketchFillet(
                    cornerPointId,
                    lineAId,
                    lineBId,
                    sessionRadius,
                  );
                });

                try {
                  const nextDocument = await documentPromise;
                  const nextSketch = nextDocument.feature_history.find(
                    (entry) =>
                      entry.feature_id ===
                      nextDocument.active_sketch_feature_id,
                  );
                  const fillets = nextSketch?.sketch_parameters?.fillets ?? [];
                  const newFillet = fillets[fillets.length - 1];
                  if (!newFillet) {
                    return;
                  }
                  // Append the new fillet to the session and flip
                  // pending → active on the first click.
                  const updatedIds = [
                    ...sketchFilletIdsRef.current,
                    newFillet.fillet_id,
                  ];
                  sketchFilletIdsRef.current = updatedIds;
                  setSketchFilletAction({
                    phase: "active",
                    radius: sessionRadius,
                    filletIds: updatedIds,
                  });
                } catch {
                  // Document watcher timed out — leave the session
                  // state alone. The next click can recover.
                }
              }}
              onSelectSketchEntity={async (entityId) => {
                await runAction(async () => {
                  await handleSketchConstraintLinePick(entityId);
                });
              }}
              onPickSketchPoint={async (pointId, kind) => {
                await runAction(async () => {
                  await handleSketchConstraintPointPick(pointId, kind);
                });
              }}
              armedSketchConstraint={armedSketchConstraint}
              mirrorFocusedSlot={mirrorFocusedSlot}
              onMirrorEntityPick={async (entityId, entityKind) => {
                if (!pendingMirror) {
                  return;
                }
                await runAction(async () => {
                  if (mirrorFocusedSlot === "axis") {
                    // Only lines can be mirror axes. Silently
                    // ignore circles to avoid bouncing the user
                    // out of the slot.
                    if (entityKind !== "line") {
                      return;
                    }
                    await updateMirrorPreviewAxis(entityId);
                    // Auto-advance to the Objects slot if it's
                    // empty — Fusion's small UX touch that saves
                    // a click on the typical "axis first, then
                    // objects" flow. If the user explicitly
                    // re-focused Axis with objects already
                    // selected, leave focus on Axis (they're
                    // probably re-picking).
                    if (pendingMirror.object_ids.length === 0) {
                      setMirrorFocusedSlot("objects");
                    }
                    return;
                  }

                  // Objects slot. Toggle membership.
                  const current = pendingMirror.object_ids;
                  const next = current.includes(entityId)
                    ? current.filter((id) => id !== entityId)
                    : [...current, entityId];
                  await updateMirrorPreviewObjects(next);
                });
              }}
              onCancelSketchConstraint={clearArmedSketchConstraint}
              onClearSketchConstraint={async (
                kind,
                entityId,
                _relatedEntityId,
              ) => {
                await runAction(async () => {
                  if (kind === "fixed") {
                    await setSketchPointFixed(entityId, false);
                    return;
                  }

                  if (kind === "equal_length") {
                    await setSketchEqualLengthConstraint(entityId, null);
                    return;
                  }

                  if (kind === "perpendicular") {
                    await setSketchPerpendicularConstraint(entityId, null);
                    return;
                  }

                  if (kind === "parallel") {
                    await setSketchParallelConstraint(entityId, null);
                    return;
                  }

                  await setSketchLineConstraint(entityId, "none");
                });
              }}
              onSelectSketchDimension={async (dimensionId) => {
                await runAction(async () => {
                  await selectSketchDimension(dimensionId);
                });
              }}
              onUpdateSketchDimension={async (dimensionId, value) => {
                await runAction(async () => {
                  await updateSketchDimension(dimensionId, value);
                });
              }}
              onSelectSketchProfile={async (profileId, additive) => {
                await runAction(async () => {
                  await selectSketchProfile(
                    profileId,
                    extrudeAction ? true : additive,
                  );
                });
              }}
              onSetSketchTool={async (tool) => {
                await runAction(async () => {
                  clearArmedSketchConstraint();
                  await setSketchTool(tool);
                });
              }}
              hiddenFeatureIds={effectiveHiddenFeatureIds}
              hiddenSketchPlaneIds={hiddenSketchPlaneIds}
              hideReferences={hiddenCategories.has("origin")}
            />

            <div className="pointer-events-none absolute right-4 top-4 z-10 flex max-h-[calc(100%-1rem)] w-[340px] flex-col gap-3">
              {extrudeAction?.phase === "pending" ? (
                <ExtrudePreviewPanel
                  phase="pending"
                  initialDepth={extrudeAction.initialDepth}
                  initialMode={extrudeAction.initialMode}
                  selectedProfileCount={selectedSketchProfileIds.length}
                  canCombineWithExistingBody={
                    extrudeAction.canCombineWithExistingBody
                  }
                  availableTargetBodies={viewport?.bodies ?? []}
                  initialTargetBodyId={null}
                  disabled={status !== "connected"}
                  onPreviewDepth={async (depth) => {
                    setExtrudeAction((current) =>
                      current?.phase === "pending"
                        ? {...current, initialDepth: depth}
                        : current,
                    );
                  }}
                  onPreviewMode={async (mode) => {
                    setExtrudeAction((current) =>
                      current?.phase === "pending"
                        ? {...current, initialMode: mode}
                        : current,
                    );
                  }}
                  onPreviewTargetBody={async () => {}}
                  onConfirm={async (depth, mode, targetBodyId) => {
                    await createExtrudeFromSelectedProfiles(
                      depth,
                      mode,
                      targetBodyId,
                    );
                  }}
                  onCancel={async () => {
                    setExtrudeAction(null);
                  }}
                />
              ) : null}
              {extrudeAction?.phase === "active" && extrudeAction.featureId
                ? (() => {
                    const activeExtrudeFeatureId = extrudeAction.featureId;
                    if (!activeExtrudeFeatureId) {
                      return null;
                    }
                    // Bodies that the in-progress extrude can target. We
                    // exclude the extrude itself: at this point the core
                    // already created the feature in `new_body` mode and
                    // it appears as its own body in `viewport.bodies`,
                    // but targeting it would be a no-op (or nonsensical
                    // for cut). Filtering it out keeps the picker honest.
                    const availableTargetBodies = (
                      viewport?.bodies ?? []
                    ).filter((body) => body.id !== extrudeAction.featureId);
                    return (
                      <ExtrudePreviewPanel
                        initialDepth={extrudeAction.initialDepth}
                        initialMode={extrudeAction.initialMode}
                        selectedProfileCount={extrudeAction.profileCount}
                        canCombineWithExistingBody={
                          extrudeAction.canCombineWithExistingBody
                        }
                        availableTargetBodies={availableTargetBodies}
                        initialTargetBodyId={null}
                        disabled={status !== "connected"}
                        onPreviewDepth={async (depth) => {
                          await runAction(async () => {
                            await updateExtrudeDepth(
                              activeExtrudeFeatureId,
                              depth,
                            );
                          });
                        }}
                        onPreviewMode={async (mode) => {
                          await runAction(async () => {
                            await updateExtrudeMode(
                              activeExtrudeFeatureId,
                              mode,
                            );
                          });
                        }}
                        onPreviewTargetBody={async (targetBodyId) => {
                          await runAction(async () => {
                            await updateExtrudeTargetBody(
                              activeExtrudeFeatureId,
                              targetBodyId,
                            );
                          });
                        }}
                        onConfirm={async () => {
                          // Look up the just-confirmed extrude in the
                          // current document so we can apply Fusion-
                          // style post-confirm UX without round-
                          // tripping new state through the core:
                          //   - hide the source sketch (the user is
                          //     done with it; leaving it visible
                          //     clutters the body they just created)
                          //   - if the extrude was a cut, drop the
                          //     selection so the floating panel
                          //     doesn't reopen and the user is left
                          //     looking at the resulting body, not
                          //     the cutter feature itself
                          const confirmedFeature =
                            document?.feature_history.find(
                              (entry) =>
                                entry.feature_id === activeExtrudeFeatureId,
                            ) ?? null;
                          const sketchFeatureId =
                            confirmedFeature?.extrude_parameters
                              ?.sketch_feature_id ?? null;
                          const confirmedMode =
                            confirmedFeature?.extrude_parameters?.mode ?? null;
                          if (sketchFeatureId) {
                            setHiddenFeatureIds((current) => {
                              if (current.has(sketchFeatureId)) {
                                return current;
                              }
                              const next = new Set(current);
                              next.add(sketchFeatureId);
                              return next;
                            });
                          }
                          setExtrudeAction(null);
                          if (confirmedMode === "cut") {
                            await runAction(async () => {
                              await clearSelection();
                            });
                          }
                        }}
                        onCancel={async () => {
                          // Edit flow (snapshot present): restore the
                          // depth / mode / target the extrude had
                          // before the user opened the panel. Create
                          // flow (no snapshot): undo the whole new
                          // feature, since cancelling creation should
                          // leave the document untouched.
                          const snapshot = extrudeAction.originalSnapshot;
                          if (snapshot) {
                            await runAction(async () => {
                              await updateExtrudeDepth(
                                activeExtrudeFeatureId,
                                snapshot.depth,
                              );
                              await updateExtrudeMode(
                                activeExtrudeFeatureId,
                                snapshot.mode,
                              );
                              await updateExtrudeTargetBody(
                                activeExtrudeFeatureId,
                                snapshot.targetBodyId,
                              );
                            });
                          } else {
                            await runAction(async () => {
                              await undo();
                            });
                          }
                          setExtrudeAction(null);
                        }}
                      />
                    );
                  })()
                : null}
              {editingFeatureId
                ? (() => {
                    // Resolve the feature being edited from the live
                    // document so the form always reflects the latest
                    // server-confirmed values (relevant if the user
                    // undid a change while the panel was open).
                    const editing = document?.feature_history.find(
                      (entry) => entry.feature_id === editingFeatureId,
                    );
                    if (!editing) {
                      // Feature was deleted (e.g. via the hierarchy
                      // panel). Close the editor on next render — we
                      // can't call setState during render, so we use a
                      // microtask. Returning null keeps the previous
                      // panel chrome from flashing.
                      queueMicrotask(() => setEditingFeatureId(null));
                      return null;
                    }
                    if (editing.kind === "box" && editing.box_parameters) {
                      return (
                        <div className="cad-toolbar-popover pointer-events-auto">
                          <BoxFeatureForm
                            disabled={status !== "connected"}
                            mode="edit"
                            initialValues={{
                              width: editing.box_parameters.width,
                              height: editing.box_parameters.height,
                              depth: editing.box_parameters.depth,
                            }}
                            variant="toolbar"
                            onSubmit={async (width, height, depth) => {
                              await runAction(async () => {
                                await updateBoxFeature(
                                  editingFeatureId,
                                  width,
                                  height,
                                  depth,
                                );
                              });
                              setEditingFeatureId(null);
                            }}
                          />
                        </div>
                      );
                    }
                    if (
                      editing.kind === "cylinder" &&
                      editing.cylinder_parameters
                    ) {
                      return (
                        <div className="cad-toolbar-popover pointer-events-auto">
                          <CylinderFeatureForm
                            disabled={status !== "connected"}
                            mode="edit"
                            initialValues={{
                              radius: editing.cylinder_parameters.radius,
                              height: editing.cylinder_parameters.height,
                            }}
                            variant="toolbar"
                            onSubmit={async (radius, height) => {
                              await runAction(async () => {
                                await updateCylinderFeature(
                                  editingFeatureId,
                                  radius,
                                  height,
                                );
                              });
                              setEditingFeatureId(null);
                            }}
                          />
                        </div>
                      );
                    }
                    return null;
                  })()
                : null}
              {pendingMirror ? (
                <MirrorToolPanel
                  axisLineId={pendingMirror.axis_line_id}
                  objectIds={pendingMirror.object_ids}
                  generatedLineCount={pendingMirror.generated_lines.length}
                  generatedCircleCount={pendingMirror.generated_circles.length}
                  focusedSlot={mirrorFocusedSlot}
                  disabled={status !== "connected"}
                  onFocusObjects={() => setMirrorFocusedSlot("objects")}
                  onFocusAxis={() => setMirrorFocusedSlot("axis")}
                  onClearObjects={async () => {
                    await runAction(async () => {
                      await updateMirrorPreviewObjects([]);
                    });
                  }}
                  onClearAxis={async () => {
                    await runAction(async () => {
                      await updateMirrorPreviewAxis(null);
                    });
                  }}
                  onConfirm={async () => {
                    await runAction(async () => {
                      await commitMirrorPreview();
                    });
                    setMirrorFocusedSlot(null);
                  }}
                  onCancel={async () => {
                    await runAction(async () => {
                      await cancelMirrorPreview();
                    });
                    setMirrorFocusedSlot(null);
                  }}
                />
              ) : null}
              {edgeOpAction ? (
                <EdgeOpPreviewPanel
                  title={edgeOpAction.kind === "fillet" ? "Fillet" : "Chamfer"}
                  valueLabel={
                    edgeOpAction.kind === "fillet"
                      ? "Radius (mm)"
                      : "Distance (mm)"
                  }
                  initialValue={edgeOpAction.initialValue}
                  disabled={status !== "connected"}
                  edgeCount={
                    edgeOpAction.phase === "active"
                      ? edgeOpAction.edgeIds.length
                      : 0
                  }
                  onPreviewValue={async (value) => {
                    if (edgeOpAction.phase === "pending") {
                      // No feature exists yet; remember the value so
                      // the next edge click creates the feature with
                      // it.
                      pendingValueRef.current = value;
                      return;
                    }
                    await runAction(async () => {
                      if (edgeOpAction.kind === "fillet") {
                        await updateFilletRadius(edgeOpAction.featureId, value);
                      } else {
                        await updateChamferDistance(
                          edgeOpAction.featureId,
                          value,
                        );
                      }
                    });
                  }}
                  onConfirm={async () => {
                    // Pending phase: nothing to commit — just close.
                    if (edgeOpAction.phase === "active") {
                      // Active: tell the core the panel session is
                      // over so the body's edge identity stops
                      // shadowing through the pre-fillet pick_shape
                      // and follows the post-fillet topology like
                      // any other confirmed feature. Then clear the
                      // edge selection (the core kept it in sync
                      // with the live edge_ids during the session
                      // for the highlight) so the user looks at a
                      // clean body.
                      const featureId = edgeOpAction.featureId;
                      const kind = edgeOpAction.kind;
                      await runAction(async () => {
                        if (kind === "fillet") {
                          await confirmFillet(featureId);
                        } else {
                          await confirmChamfer(featureId);
                        }
                        await clearSelection();
                      });
                    }
                    activeEdgeIdsRef.current = [];
                    setEdgeOpAction(null);
                  }}
                  onCancel={async () => {
                    // Pending phase: no feature was ever created, so
                    // there is nothing to undo. Active phase: a
                    // single undo() rolls back the entire panel
                    // session because update_*_edges and
                    // update_*_radius / update_*_distance
                    // intentionally do not push undo states (see
                    // the matching comment in
                    // `DocumentManager::update_fillet_edges`).
                    if (edgeOpAction.phase === "active") {
                      await runAction(async () => {
                        await undo();
                      });
                    }
                    activeEdgeIdsRef.current = [];
                    setEdgeOpAction(null);
                  }}
                />
              ) : null}
              {offsetPlaneAction ? (
                <OffsetPlanePanel
                  isPending={offsetPlaneAction.phase === "pending"}
                  initialOffset={offsetPlaneAction.initialOffset}
                  sourceSummary={
                    offsetPlaneAction.phase === "active"
                      ? offsetPlaneAction.sourceSummary
                      : ""
                  }
                  disabled={status !== "connected"}
                  onPreviewOffset={async (offset) => {
                    if (offsetPlaneAction.phase === "pending") {
                      // No feature exists yet; remember the value so
                      // the next plane click creates the feature
                      // with it.
                      pendingOffsetRef.current = offset;
                      return;
                    }
                    await runAction(async () => {
                      await updateOffsetPlane(
                        offsetPlaneAction.featureId,
                        offset,
                      );
                    });
                  }}
                  onConfirm={async () => {
                    // Active phase only: feature stays in the
                    // document with whatever offset is currently in
                    // the panel. Selection is left as-is so the user
                    // can immediately turn around and Sketch on it.
                    setOffsetPlaneAction(null);
                  }}
                  onCancel={async () => {
                    // Pending phase: no feature was created — just
                    // close the panel. Active phase: a single
                    // undo() rolls back the entire panel session
                    // because update_offset_plane intentionally
                    // does not push undo states (see the matching
                    // comment in `DocumentManager::update_offset_plane`).
                    if (offsetPlaneAction.phase === "active") {
                      await runAction(async () => {
                        await undo();
                      });
                    }
                    setOffsetPlaneAction(null);
                  }}
                />
              ) : null}
              {sketchFilletAction ? (
                <SketchFilletPanel
                  initialValue={sketchFilletAction.radius}
                  disabled={status !== "connected"}
                  count={
                    sketchFilletAction.phase === "active"
                      ? sketchFilletAction.filletIds.length
                      : 0
                  }
                  onPreviewValue={async (value) => {
                    // Fan the new radius out across every fillet
                    // already in the session. Same model as the 3D
                    // EdgeOpPreviewPanel: one input drives every
                    // selected target. We track the panel's
                    // session radius in state so future adds use
                    // the latest value too.
                    setSketchFilletAction((prev) =>
                      prev ? { ...prev, radius: value } : prev,
                    );
                    if (sketchFilletAction.phase !== "active") {
                      return;
                    }
                    await runAction(async () => {
                      for (const filletId of sketchFilletAction.filletIds) {
                        await updateSketchFilletRadius(filletId, value);
                      }
                    });
                  }}
                  onConfirm={async () => {
                    // Confirm keeps every fillet in the session
                    // and exits the tool back to Select — same
                    // post-confirm UX as 3D fillet, which drops
                    // out of edge-pick mode after Confirm.
                    sketchFilletIdsRef.current = [];
                    setSketchFilletAction(null);
                    await runAction(async () => {
                      await setSketchTool("select");
                    });
                  }}
                  onCancel={async () => {
                    // Cancel = discard the whole session. Each
                    // fillet's `delete_sketch_fillet` restores its
                    // corner; the trim points fall off via the
                    // next `rebuild_sketch_points`. Mirrors the
                    // EdgeOpPreviewPanel cancel contract.
                    if (sketchFilletAction.phase === "active") {
                      await runAction(async () => {
                        for (const filletId of sketchFilletAction.filletIds) {
                          await deleteSketchFillet(filletId);
                        }
                      });
                    }
                    sketchFilletIdsRef.current = [];
                    setSketchFilletAction(null);
                    await runAction(async () => {
                      await setSketchTool("select");
                    });
                  }}
                />
              ) : null}
              {SHOW_DEBUG_MESSAGE_LOG ? (
                <MessageLog messages={messages} />
              ) : null}
            </div>
          </section>
        </div>

        <FeatureTimeline
          document={document}
          onSelectFeature={async (featureId) => {
            await runAction(async () => {
              await selectFeature(featureId);
            });
          }}
          onEditFeature={(featureId) => {
            // Dispatch by feature kind: box/cylinder open the inline
            // parameter form; sketch re-enters the sketch so the user
            // can edit its lines (extrudes that depend on the sketch
            // re-evaluate automatically); extrude opens the same
            // floating preview panel that creation uses, but seeded
            // with the existing depth/mode/target so cancel can
            // restore instead of undoing the whole feature.
            const feature = document?.feature_history.find(
              (entry) => entry.feature_id === featureId,
            );
            if (!feature) {
              return;
            }
            if (feature.kind === "box" || feature.kind === "cylinder") {
              setEditingFeatureId(featureId);
              return;
            }
            if (feature.kind === "sketch") {
              void runAction(async () => {
                await reenterSketch(featureId);
              });
              return;
            }
            if (feature.kind === "extrude" && feature.extrude_parameters) {
              if (extrudeAction || edgeOpAction) {
                return;
              }
              const params = feature.extrude_parameters;
              const otherBodies = (viewport?.bodies ?? []).filter(
                (body) => body.id !== featureId,
              );
              setExtrudeAction({
                phase: "active",
                featureId,
                initialDepth: params.depth,
                initialMode: params.mode,
                profileCount: params.profile_ids?.length || 1,
                canCombineWithExistingBody: otherBodies.length > 0,
                originalSnapshot: {
                  depth: params.depth,
                  mode: params.mode,
                  targetBodyId: params.target_body_id ?? null,
                },
              });
            }
          }}
          onSuppressFeature={(featureId, suppressed) => {
            void runAction(async () => {
              await setFeatureSuppressed(featureId, suppressed);
            });
          }}
          onDeleteFeature={(featureId) => {
            confirmAndDeleteFeature(featureId);
          }}
        />
      </div>
    </main>
  );
}

export default App;
