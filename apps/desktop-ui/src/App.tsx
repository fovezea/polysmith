import { useEffect, useMemo, useState } from "react";
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
  FeatureTimeline,
  MessageLog,
  SketchToolPanel,
  ViewportPanel,
} from "./layout";
import type { CategoryId } from "./layout";
import { ArmedSketchConstraint } from "./types";
import type { ExtrudeMode, ViewportSolidFace } from "./types";

const DEFAULT_EXTRUDE_DEPTH = 20;
const DEFAULT_FILLET_RADIUS = 1;
const DEFAULT_CHAMFER_DISTANCE = 1;

// The Core Messages debug panel is hidden by default. Set
// `VITE_SHOW_DEBUG_MESSAGE_LOG=true` in `.env.local` (or your shell when
// running `pnpm dev`) to surface it again while debugging the IPC bridge.
const SHOW_DEBUG_MESSAGE_LOG =
  import.meta.env.VITE_SHOW_DEBUG_MESSAGE_LOG === "true";

interface ActiveExtrudeAction {
  featureId: string;
  initialDepth: number;
  initialMode: ExtrudeMode;
  // Snapshot of "did the document have any other solid bodies before the
  // user invoked this extrude?" — drives whether Join/Cut are offered.
  canCombineWithExistingBody: boolean;
}

// In-progress fillet or chamfer feature. The native core has already
// created the feature with the initial value; the floating panel
// drives live updates and Confirm / Cancel.
interface ActiveEdgeOpAction {
  featureId: string;
  kind: "fillet" | "chamfer";
  initialValue: number;
}

function App() {
  const [armedSketchConstraint, setArmedSketchConstraint] =
    useState<ArmedSketchConstraint>(null);
  const [extrudeAction, setExtrudeAction] =
    useState<ActiveExtrudeAction | null>(null);
  const [edgeOpAction, setEdgeOpAction] = useState<ActiveEdgeOpAction | null>(
    null,
  );
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
  const activeSketchPlaneId = document?.active_sketch_plane_id ?? null;
  const activeSketchTool = document?.active_sketch_tool ?? null;
  const activeSketchFeature =
    document?.feature_history.find(
      (feature) => feature.feature_id === document.active_sketch_feature_id,
    ) ?? null;
  const sketchLineCount =
    activeSketchFeature?.sketch_parameters?.lines.length ?? 0;
  const sketchCircleCount =
    activeSketchFeature?.sketch_parameters?.circles.length ?? 0;

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
    startSketchOnPlane,
    startSketchOnFace,
    setSketchTool,
    setSketchLineConstraint,
    setSketchEqualLengthConstraint,
    setSketchCoincidentConstraint,
    setSketchParallelConstraint,
    setSketchPerpendicularConstraint,
    setSketchPointFixed,
    updateSketchDimension,
    selectSketchProfile,
    extrudeProfile,
    updateExtrudeMode,
    updateExtrudeTargetBody,
    addSketchLine,
    addSketchRectangle,
    addSketchCircle,
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
    }
  }, [activeSketchPlaneId]);

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

  // Orchestrates the face → sketch → projected outline → profile pipeline
  // so the user can press Extrude on a planar face of an existing body.
  // Returns the new profile id (which the surrounding `triggerExtrudeAction`
  // then feeds to `extrudeProfile`), or throws on failure.
  //
  // We rely on `awaitDocumentChange` between steps because each IPC
  // command is fire-and-forget — the hook helpers `await` only the
  // command being WRITTEN to cad_core stdin, not the document_state
  // event that follows. Reading state directly out of the store after
  // an `await` would race the event loop.
  async function extrudeFromFace(
    faceId: string,
    planeFrame: ViewportSolidFace["plane_frame"],
  ): Promise<string> {
    const sketchActivePromise = awaitDocumentChange(
      (next) =>
        next.active_sketch_feature_id !== null &&
        next.active_sketch_face_id === faceId,
    );
    await startSketchOnFace(faceId, planeFrame);
    const documentWithSketch = await sketchActivePromise;
    const sketchFeatureId = documentWithSketch.active_sketch_feature_id;
    if (!sketchFeatureId) {
      throw new Error(
        "face extrude: sketch did not become active after start_sketch_on_face",
      );
    }

    const profileReadyPromise = awaitDocumentChange((next) => {
      const sketch = next.feature_history.find(
        (entry) => entry.feature_id === sketchFeatureId,
      );
      return (sketch?.sketch_parameters?.profiles.length ?? 0) > 0;
    });
    await projectFaceIntoSketch(faceId);
    const documentWithProfile = await profileReadyPromise;
    const sketchWithProfile = documentWithProfile.feature_history.find(
      (entry) => entry.feature_id === sketchFeatureId,
    );
    const newProfileId =
      sketchWithProfile?.sketch_parameters?.profiles[0]?.profile_id ?? null;
    if (!newProfileId) {
      throw new Error(
        "face extrude: no closed profile detected after projecting face",
      );
    }

    const sketchExitedPromise = awaitDocumentChange(
      (next) => next.active_sketch_feature_id === null,
    );
    await finishSketch();
    await sketchExitedPromise;

    return newProfileId;
  }

  async function triggerExtrudeAction() {
    if (extrudeAction) {
      return;
    }

    // Fusion-style: Extrude can take either a closed sketch profile OR
    // a planar face on an existing body. The face path orchestrates
    // [start_sketch_on_face → project_face_into_sketch → finish_sketch
    // → extrude_profile] using existing IPC primitives, so the user
    // sees one button click that produces an extrude whose source is
    // the selected face's outline. The intermediate sketch shows up in
    // the timeline (and gets auto-hidden by the post-confirm hook
    // below), keeping the feature graph reproducible.
    let profileId = selectedSketchProfile?.profile_id ?? null;
    if (!profileId) {
      const faceId = document?.selected_face_id ?? null;
      const face = faceId
        ? (viewport?.solid_faces.find((entry) => entry.face_id === faceId) ??
          null)
        : null;
      if (
        faceId &&
        face &&
        face.sketchability === "planar" &&
        face.plane_frame
      ) {
        try {
          profileId = await extrudeFromFace(faceId, face.plane_frame);
        } catch (error) {
          addMessage(`face extrude error: ${String(error)}`);
          return;
        }
      }
    }

    if (!profileId) {
      return;
    }

    // Snapshot whether the document already contains a solid body before
    // we issue the extrude. Cut/Join target the most recent existing body,
    // so they're only meaningful when at least one is already there.
    const hasExistingBody =
      (document?.feature_history ?? []).some(
        (entry) =>
          entry.kind === "box" ||
          entry.kind === "cylinder" ||
          entry.kind === "extrude",
      ) ?? false;

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
      await extrudeProfile(profileId, DEFAULT_EXTRUDE_DEPTH);
      try {
        const nextDocument = await documentPromise;
        const newFeatureId = nextDocument.selected_feature_id ?? null;
        if (!newFeatureId) {
          return;
        }
        setExtrudeAction({
          featureId: newFeatureId,
          initialDepth: DEFAULT_EXTRUDE_DEPTH,
          initialMode: "new_body",
          canCombineWithExistingBody: hasExistingBody,
        });
      } catch (error) {
        addMessage(`extrude action error: ${String(error)}`);
      }
    });
  }

  // Common helper for fillet/chamfer hotkeys. The native core synchronously
  // creates the feature with the default value; the floating panel then
  // drives live preview via update_*_radius / update_*_distance and either
  // confirms (close) or cancels (undo).
  async function triggerEdgeOpAction(kind: "fillet" | "chamfer") {
    if (extrudeAction || edgeOpAction) {
      return;
    }
    // Multi-edge: snapshot the entire selection set at the moment the
    // hotkey fires. If the user shift-clicked three edges, we send all
    // three to create_fillet / create_chamfer in one feature. Snapshot
    // up-front because the core's create_* call clears the selection
    // before we can read it again.
    const edgeIds = document?.selected_edge_ids ?? [];
    if (edgeIds.length === 0) {
      return;
    }

    const initialValue =
      kind === "fillet" ? DEFAULT_FILLET_RADIUS : DEFAULT_CHAMFER_DISTANCE;

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
        await createFillet(edgeIds, initialValue);
      } else {
        await createChamfer(edgeIds, initialValue);
      }
      try {
        const nextDocument = await documentPromise;
        const newFeatureId = nextDocument.selected_feature_id ?? null;
        if (!newFeatureId) {
          return;
        }
        setEdgeOpAction({
          featureId: newFeatureId,
          kind,
          initialValue,
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

      // E / F / C: trigger extrude / fillet / chamfer actions (no modifiers).
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      if (event.code === "KeyE") {
        // Extrude accepts either a selected closed profile or a
        // selected planar face on an existing body. The face branch
        // is handled inside triggerExtrudeAction by orchestrating
        // sketch creation + face projection. We still gate the
        // hotkey so an empty E press doesn't no-op silently when
        // nothing is selected.
        const hasFaceCandidate = (() => {
          const faceId = document?.selected_face_id ?? null;
          if (!faceId) {
            return false;
          }
          const face = viewport?.solid_faces.find(
            (entry) => entry.face_id === faceId,
          );
          return Boolean(face && face.sketchability === "planar");
        })();
        if (!selectedSketchProfile && !hasFaceCandidate) {
          return;
        }
        event.preventDefault();
        void triggerExtrudeAction();
        return;
      }

      // Fillet / Chamfer require a selected edge. They are no-ops
      // otherwise — silently, so a stray F or C keystroke doesn't
      // surprise the user with an error toast.
      if (event.code === "KeyF") {
        if ((document?.selected_edge_ids.length ?? 0) === 0) {
          return;
        }
        event.preventDefault();
        void triggerEdgeOpAction("fillet");
        return;
      }

      if (event.code === "KeyC") {
        if ((document?.selected_edge_ids.length ?? 0) === 0) {
          return;
        }
        event.preventDefault();
        void triggerEdgeOpAction("chamfer");
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
          selectedReferenceLabel={selectedReference?.label ?? null}
          sketchLineCount={sketchLineCount}
          sketchCircleCount={sketchCircleCount}
          armedSketchConstraint={armedSketchConstraint}
          onStart={async () => {
            await runAction(start);
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
          canExtrude={(() => {
            if (selectedSketchProfile) {
              return true;
            }
            const faceId = document?.selected_face_id ?? null;
            if (!faceId) {
              return false;
            }
            const face = viewport?.solid_faces.find(
              (entry) => entry.face_id === faceId,
            );
            return Boolean(face && face.sketchability === "planar");
          })()}
          onExtrude={triggerExtrudeAction}
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

        <div className="grid min-h-0 min-w-0 grid-cols-[320px_minmax(0,1fr)]">
          <aside className="cad-sidebar min-h-0">
            <div className="flex h-full min-h-0 flex-col">
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
          </aside>

          <section className="relative min-h-0 min-w-0">
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
                await runAction(async () => {
                  await selectReference(referenceId);
                });
              }}
              onSelectFace={async (faceId) => {
                await runAction(async () => {
                  await selectFace(faceId);
                });
              }}
              onSelectEdge={async (edgeId, additive) => {
                // While a fillet / chamfer floating panel is open the
                // user is in "pick edges" mode: every edge click
                // toggles that edge in the feature's edge_ids set
                // rather than the document selection. The body
                // recompiles live so the user sees the fillet grow /
                // shrink as they pick. We ignore `additive` here —
                // toggle is the only meaningful gesture during edit.
                if (edgeOpAction && document) {
                  const feature = document.feature_history.find(
                    (entry) => entry.feature_id === edgeOpAction.featureId,
                  );
                  const current =
                    feature?.fillet_parameters?.edge_ids ??
                    feature?.chamfer_parameters?.edge_ids ??
                    [];
                  const isMember = current.includes(edgeId);
                  const next = isMember
                    ? current.filter((id) => id !== edgeId)
                    : [...current, edgeId];
                  if (next.length === 0) {
                    // Last edge: refusing the toggle keeps the feature
                    // valid (the core requires at least one edge). The
                    // user can Cancel the panel to undo entirely.
                    return;
                  }
                  await runAction(async () => {
                    if (edgeOpAction.kind === "fillet") {
                      await updateFilletEdges(edgeOpAction.featureId, next);
                    } else {
                      await updateChamferEdges(edgeOpAction.featureId, next);
                    }
                  });
                  return;
                }
                await runAction(async () => {
                  await selectEdge(edgeId, additive);
                });
              }}
              onSelectVertex={async (vertexId, additive) => {
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
              onAddSketchLine={async (startX, startY, endX, endY) => {
                await runAction(async () => {
                  await addSketchLine(startX, startY, endX, endY);
                });
              }}
              onAddSketchRectangle={async (startX, startY, endX, endY) => {
                await runAction(async () => {
                  await addSketchRectangle(startX, startY, endX, endY);
                });
              }}
              onAddSketchCircle={async (centerX, centerY, radius) => {
                await runAction(async () => {
                  await addSketchCircle(centerX, centerY, radius);
                });
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
              onSelectSketchProfile={async (profileId) => {
                await runAction(async () => {
                  await selectSketchProfile(profileId);
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
              {activeSketchPlaneId && activeSketchTool ? (
                <SketchToolPanel
                  activeSketchPlaneId={activeSketchPlaneId}
                  activeSketchTool={activeSketchTool}
                  selectedSketchPointId={
                    document?.selected_sketch_point_id ?? null
                  }
                  selectedSketchEntityId={
                    document?.selected_sketch_entity_id ?? null
                  }
                  selectedSketchProfileId={
                    document?.selected_sketch_profile_id ?? null
                  }
                  selectedFaceId={document?.selected_face_id ?? null}
                  onProjectFace={async () => {
                    const faceId = document?.selected_face_id ?? null;
                    if (!faceId) {
                      return;
                    }
                    await runAction(async () => {
                      await projectFaceIntoSketch(faceId);
                    });
                  }}
                />
              ) : null}
              {extrudeAction
                ? (() => {
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
                        canCombineWithExistingBody={
                          extrudeAction.canCombineWithExistingBody
                        }
                        availableTargetBodies={availableTargetBodies}
                        initialTargetBodyId={null}
                        disabled={status !== "connected"}
                        onPreviewDepth={async (depth) => {
                          await runAction(async () => {
                            await updateExtrudeDepth(
                              extrudeAction.featureId,
                              depth,
                            );
                          });
                        }}
                        onPreviewMode={async (mode) => {
                          await runAction(async () => {
                            await updateExtrudeMode(
                              extrudeAction.featureId,
                              mode,
                            );
                          });
                        }}
                        onPreviewTargetBody={async (targetBodyId) => {
                          await runAction(async () => {
                            await updateExtrudeTargetBody(
                              extrudeAction.featureId,
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
                                entry.feature_id === extrudeAction.featureId,
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
                          await runAction(async () => {
                            await undo();
                          });
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
                  edgeCount={(() => {
                    // Source the count off the live document so it
                    // updates the moment update_*_edges round-trips.
                    const feature = document?.feature_history.find(
                      (entry) => entry.feature_id === edgeOpAction.featureId,
                    );
                    return (
                      feature?.fillet_parameters?.edge_ids.length ??
                      feature?.chamfer_parameters?.edge_ids.length ??
                      0
                    );
                  })()}
                  onPreviewValue={async (value) => {
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
                    // Core keeps the feature's edges in
                    // `selected_edge_ids` while the panel is open so
                    // the highlight tracks live edits. On Confirm we
                    // explicitly clear selection so the user is left
                    // looking at a clean filleted body, not yellow
                    // highlights on the just-confirmed edges.
                    await runAction(async () => {
                      await clearSelection();
                    });
                    setEdgeOpAction(null);
                  }}
                  onCancel={async () => {
                    await runAction(async () => {
                      await undo();
                    });
                    setEdgeOpAction(null);
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
            // Edit only fires for kinds we have a panel for; the
            // timeline's double-click handler already filters to
            // editable kinds, but we double-check here so non-editable
            // kinds (root_part, sketch, extrude, etc.) silently no-op
            // rather than mounting a blank panel.
            const feature = document?.feature_history.find(
              (entry) => entry.feature_id === featureId,
            );
            if (!feature) {
              return;
            }
            if (feature.kind !== "box" && feature.kind !== "cylinder") {
              return;
            }
            setEditingFeatureId(featureId);
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
