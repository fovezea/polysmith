import type {
  ViewportBoxPrimitive,
  ViewportCylinderPrimitive,
  ViewportMeshPrimitive,
  ViewportPolygonExtrudePrimitive,
  ViewportSolidFace,
  ViewportReferenceAxis,
  ViewportReferencePlane,
  ViewportSketchArc,
  ViewportSketchCircle,
  ViewportSketchConstraint,
  ViewportSketchDimension,
  ViewportSketchProfile,
  ViewportState,
  BoxScenePrimitive,
  CylinderScenePrimitive,
  MeshScenePrimitive,
  PolygonExtrudeScenePrimitive,
  ReferencePlaneScene,
  ReferenceAxisScene,
  SketchArcScene,
  SketchCircleScene,
  SketchConstraintScene,
  SketchDimensionScene,
  SketchPointScene,
  SketchProfileScene,
  SolidFaceScene,
  SceneEdge,
  SceneVertex,
  CutPreviewScene,
  ViewportScene,
  DocumentState,
  FeatureEntry,
  SketchProfileRegionEntry,
} from "@/types";

function clampDimension(value: number) {
  return Math.max(value, 1);
}

function numericBufferSignature(values: Float32Array | Uint32Array) {
  let hash = 2166136261;
  for (const value of values) {
    const quantized = Math.round(value * 1000);
    hash ^= quantized;
    hash = Math.imul(hash, 16777619);
  }
  return `${values.length}:${hash >>> 0}`;
}

function makeBoxPrimitive(box: ViewportBoxPrimitive): BoxScenePrimitive {
  return {
    kind: "box",
    primitiveId: box.primitive_id,
    label: box.label,
    size: [box.width, box.height, box.depth],
    position: [box.center.x, box.center.y, box.center.z],
    isSelected: box.is_selected,
  };
}

function makeCylinderPrimitive(
  cylinder: ViewportCylinderPrimitive,
): CylinderScenePrimitive {
  return {
    kind: "cylinder",
    primitiveId: cylinder.primitive_id,
    label: cylinder.label,
    radius: cylinder.radius,
    height: cylinder.height,
    position: [cylinder.center.x, cylinder.center.y, cylinder.center.z],
    isSelected: cylinder.is_selected,
  };
}

function makeMeshPrimitive(
  primitive: ViewportMeshPrimitive,
): MeshScenePrimitive {
  // Wire format uses plain number[] arrays. We materialize typed arrays
  // here so the renderer can hand them straight to BufferGeometry without
  // an extra copy on every frame the scene rebuilds.
  return {
    kind: "mesh",
    primitiveId: primitive.primitive_id,
    label: primitive.primitive_id,
    positions: Float32Array.from(primitive.positions),
    normals: Float32Array.from(primitive.normals),
    indices: Uint32Array.from(primitive.indices),
    isSelected: primitive.is_selected,
  };
}

function makePolygonExtrudePrimitive(
  primitive: ViewportPolygonExtrudePrimitive,
): PolygonExtrudeScenePrimitive {
  return {
    kind: "polygon_extrude",
    primitiveId: primitive.primitive_id,
    label: primitive.label,
    planeId: primitive.plane_id,
    planeFrame: primitive.plane_frame
      ? {
          origin: [
            primitive.plane_frame.origin.x,
            primitive.plane_frame.origin.y,
            primitive.plane_frame.origin.z,
          ],
          xAxis: [
            primitive.plane_frame.x_axis.x,
            primitive.plane_frame.x_axis.y,
            primitive.plane_frame.x_axis.z,
          ],
          yAxis: [
            primitive.plane_frame.y_axis.x,
            primitive.plane_frame.y_axis.y,
            primitive.plane_frame.y_axis.z,
          ],
          normal: [
            primitive.plane_frame.normal.x,
            primitive.plane_frame.normal.y,
            primitive.plane_frame.normal.z,
          ],
        }
      : null,
    profilePoints: primitive.profile_points.map(
      (point) => [point.x, point.y] as [number, number],
    ),
    innerLoops: (primitive.inner_loops ?? []).map((loop) =>
      loop.map((point) => [point.x, point.y] as [number, number]),
    ),
    depth: primitive.depth,
    isSelected: primitive.is_selected,
  };
}

function makeReferencePlane(
  plane: ViewportReferencePlane,
): ReferencePlaneScene {
  // Construction planes ship a real world-space frame; origin
  // planes leave it null and the renderer falls back to the
  // hardcoded `orientation` rotation.
  const planeFrame = plane.plane_frame
    ? {
        origin: [
          plane.plane_frame.origin.x,
          plane.plane_frame.origin.y,
          plane.plane_frame.origin.z,
        ] as [number, number, number],
        xAxis: [
          plane.plane_frame.x_axis.x,
          plane.plane_frame.x_axis.y,
          plane.plane_frame.x_axis.z,
        ] as [number, number, number],
        yAxis: [
          plane.plane_frame.y_axis.x,
          plane.plane_frame.y_axis.y,
          plane.plane_frame.y_axis.z,
        ] as [number, number, number],
        normal: [
          plane.plane_frame.normal.x,
          plane.plane_frame.normal.y,
          plane.plane_frame.normal.z,
        ] as [number, number, number],
      }
    : null;
  return {
    kind: "reference_plane",
    referenceId: plane.reference_id,
    label: plane.label,
    orientation: plane.orientation,
    position: [plane.center.x, plane.center.y, plane.center.z],
    size: [plane.size.width, plane.size.height],
    isSelected: plane.is_selected,
    isActiveSketchPlane: plane.is_active_sketch_plane,
    planeFrame,
  };
}

function makeReferenceAxis(axis: ViewportReferenceAxis): ReferenceAxisScene {
  return {
    kind: "reference_axis",
    referenceId: axis.reference_id,
    label: axis.label,
    axis: axis.axis,
    start: [axis.start.x, axis.start.y, axis.start.z],
    end: [axis.end.x, axis.end.y, axis.end.z],
  };
}

function makeSketchCircle(circle: ViewportSketchCircle): SketchCircleScene {
  return {
    isPreview: circle.is_preview,
    circleId: circle.circle_id,
    planeId: circle.plane_id,
    center: [circle.center.x, circle.center.y, circle.center.z],
    radius: circle.radius,
    isSelected: circle.is_selected,
  };
}

function makeSketchArc(arc: ViewportSketchArc): SketchArcScene {
  return {
    isPreview: arc.is_preview,
    arcId: arc.arc_id,
    startPointId: arc.start_point_id,
    endPointId: arc.end_point_id,
    planeId: arc.plane_id,
    center: [arc.center.x, arc.center.y, arc.center.z],
    radius: arc.radius,
    start: [arc.start.x, arc.start.y, arc.start.z],
    end: [arc.end.x, arc.end.y, arc.end.z],
    ccw: arc.ccw,
    isSelected: arc.is_selected,
    isConstruction: arc.is_construction,
  };
}

function makeSketchDimension(
  dimension: ViewportSketchDimension,
): SketchDimensionScene {
  return {
    dimensionId: dimension.dimension_id,
    planeId: dimension.plane_id,
    kind: dimension.kind,
    entityId: dimension.entity_id,
    label: dimension.label,
    isSelected: dimension.is_selected,
    anchorStart: [
      dimension.anchor_start.x,
      dimension.anchor_start.y,
      dimension.anchor_start.z,
    ],
    anchorEnd: [
      dimension.anchor_end.x,
      dimension.anchor_end.y,
      dimension.anchor_end.z,
    ],
    dimensionStart: [
      dimension.dimension_start.x,
      dimension.dimension_start.y,
      dimension.dimension_start.z,
    ],
    dimensionEnd: [
      dimension.dimension_end.x,
      dimension.dimension_end.y,
      dimension.dimension_end.z,
    ],
    labelPosition: [
      dimension.label_position.x,
      dimension.label_position.y,
      dimension.label_position.z,
    ],
  };
}

function makeSketchConstraint(
  constraint: ViewportSketchConstraint,
): SketchConstraintScene {
  return {
    constraintId: constraint.constraint_id,
    planeId: constraint.plane_id,
    kind: constraint.kind,
    entityId: constraint.entity_id,
    relatedEntityId: constraint.related_entity_id,
    label: constraint.label,
    isSelected: constraint.is_selected,
    position: [
      constraint.position.x,
      constraint.position.y,
      constraint.position.z,
    ],
  };
}

function makeSketchProfile(profile: ViewportSketchProfile): SketchProfileScene {
  return {
    profileId: profile.profile_id,
    planeId: profile.plane_id,
    planeFrame: profile.plane_frame
      ? {
          origin: [
            profile.plane_frame.origin.x,
            profile.plane_frame.origin.y,
            profile.plane_frame.origin.z,
          ],
          xAxis: [
            profile.plane_frame.x_axis.x,
            profile.plane_frame.x_axis.y,
            profile.plane_frame.x_axis.z,
          ],
          yAxis: [
            profile.plane_frame.y_axis.x,
            profile.plane_frame.y_axis.y,
            profile.plane_frame.y_axis.z,
          ],
          normal: [
            profile.plane_frame.normal.x,
            profile.plane_frame.normal.y,
            profile.plane_frame.normal.z,
          ],
        }
      : null,
    profileKind: profile.profile_kind,
    profilePoints: profile.profile_points.map(
      (point) => [point.x, point.y] as [number, number],
    ),
    innerLoops: (profile.inner_loops ?? []).map((loop) =>
      loop.map((point) => [point.x, point.y] as [number, number]),
    ),
    start: [profile.start_x, profile.start_y],
    width: profile.width,
    height: profile.height,
    radius: profile.radius,
    isSelected: profile.is_selected,
  };
}

function makeSketchProfileFromDocument(
  feature: FeatureEntry,
  profile: SketchProfileRegionEntry,
  selectedProfileIds: ReadonlySet<string>,
): SketchProfileScene | null {
  const sketch = feature.sketch_parameters;
  if (!sketch) {
    return null;
  }
  return {
    profileId: profile.profile_id,
    planeId: sketch.plane_id,
    planeFrame: sketch.plane_frame
      ? {
          origin: [
            sketch.plane_frame.origin.x,
            sketch.plane_frame.origin.y,
            sketch.plane_frame.origin.z,
          ],
          xAxis: [
            sketch.plane_frame.x_axis.x,
            sketch.plane_frame.x_axis.y,
            sketch.plane_frame.x_axis.z,
          ],
          yAxis: [
            sketch.plane_frame.y_axis.x,
            sketch.plane_frame.y_axis.y,
            sketch.plane_frame.y_axis.z,
          ],
          normal: [
            sketch.plane_frame.normal.x,
            sketch.plane_frame.normal.y,
            sketch.plane_frame.normal.z,
          ],
        }
      : null,
    profileKind: profile.kind,
    profilePoints: profile.points.map(
      (point) => [point.x, point.y] as [number, number],
    ),
    innerLoops: profile.inner_loops.map((loop) =>
      loop.map((point) => [point.x, point.y] as [number, number]),
    ),
    start: [profile.center_x, profile.center_y],
    width: 0,
    height: 0,
    radius: profile.radius,
    isSelected: selectedProfileIds.has(profile.profile_id),
  };
}

function makeSolidFace(face: ViewportSolidFace): SolidFaceScene {
  return {
    faceId: face.face_id,
    ownerId: face.owner_id,
    ownerKind: face.owner_kind,
    label: face.label,
    sketchability: face.sketchability,
    center: [face.center.x, face.center.y, face.center.z],
    normal: [face.normal.x, face.normal.y, face.normal.z],
    planeFrame: {
      origin: [
        face.plane_frame.origin.x,
        face.plane_frame.origin.y,
        face.plane_frame.origin.z,
      ],
      xAxis: [
        face.plane_frame.x_axis.x,
        face.plane_frame.x_axis.y,
        face.plane_frame.x_axis.z,
      ],
      yAxis: [
        face.plane_frame.y_axis.x,
        face.plane_frame.y_axis.y,
        face.plane_frame.y_axis.z,
      ],
      normal: [
        face.plane_frame.normal.x,
        face.plane_frame.normal.y,
        face.plane_frame.normal.z,
      ],
    },
    size: face.size,
    // Materialize typed arrays up-front so the renderer hands them
    // straight to a BufferAttribute without re-allocating per frame.
    trianglePositions: Float32Array.from(face.triangle_positions ?? []),
    triangleIndices: Uint32Array.from(face.triangle_indices ?? []),
    isSelected: face.is_selected,
  };
}

export interface ViewportSceneOptions {
  // Feature ids whose primitives must be filtered out of the rendered scene.
  // Maps 1:1 to feature.id (and therefore to primitive ids emitted by the
  // core, which use the feature id as the primitive id).
  hiddenFeatureIds?: ReadonlySet<string>;
  // Sketch plane ids whose sketch entities (lines, circles, points,
  // dimensions, constraints, profiles) must be filtered out.
  hiddenSketchPlaneIds?: ReadonlySet<string>;
  // Hide all reference planes and axes.
  hideReferences?: boolean;
  // Body ids whose edges should be tagged as ghosts because a fillet /
  // chamfer feature targeting that body is currently in its pending
  // panel session. Ghost edges stay pickable but render hidden by
  // default; the viewport can flip them visible when the user holds
  // the wireframe-toggle key.
  pendingEdgeOpBodyIds?: ReadonlySet<string>;
  // Optional core-owned document snapshot. Used only as a fallback
  // source for sketch profile regions when the viewport snapshot lags
  // behind a just-completed sketch edit.
  document?: DocumentState | null;
}

export function createViewportScene(
  viewport: ViewportState,
  options: ViewportSceneOptions = {},
): ViewportScene {
  const hiddenFeatureIds = options.hiddenFeatureIds ?? new Set<string>();
  const hiddenSketchPlaneIds =
    options.hiddenSketchPlaneIds ?? new Set<string>();
  const hideReferences = options.hideReferences ?? false;
  const pendingEdgeOpBodyIds =
    options.pendingEdgeOpBodyIds ?? new Set<string>();
  const document = options.document ?? null;

  const primitives = [
    ...viewport.boxes.map(makeBoxPrimitive),
    ...viewport.cylinders.map(makeCylinderPrimitive),
    ...viewport.polygon_extrudes.map(makePolygonExtrudePrimitive),
    ...viewport.meshes.map(makeMeshPrimitive),
  ].filter((primitive) => !hiddenFeatureIds.has(primitive.primitiveId));
  // The "Origin" hierarchy category covers the three named ref planes
  // and the XYZ axes only — *not* parametric construction planes,
  // which are a separate feature kind with their own visibility
  // toggle in the hierarchy. Match by the static ids the core emits
  // for origin geometry; everything else (construction planes) flows
  // through the per-feature `hiddenFeatureIds` filter.
  const isOriginPlaneId = (id: string) =>
    id === "ref-plane-xy" || id === "ref-plane-yz" || id === "ref-plane-xz";

  const references = [
    // Construction planes are also features in the document, so
    // they participate in per-feature visibility filtering. The
    // origin planes use static "ref-plane-*" ids that never
    // appear in `hiddenFeatureIds`, so that filter is a no-op for
    // them; `hideReferences` is what controls the origin trio.
    ...viewport.reference_planes
      .filter((plane) => !hiddenFeatureIds.has(plane.reference_id))
      .filter(
        (plane) => !(hideReferences && isOriginPlaneId(plane.reference_id)),
      )
      .map(makeReferencePlane),
    ...(hideReferences ? [] : viewport.reference_axes.map(makeReferenceAxis)),
  ];
  const isSketchPlaneVisible = (planeId: string) =>
    !hiddenSketchPlaneIds.has(planeId);

  const sketchLines = viewport.sketch_lines
    .filter((line) => isSketchPlaneVisible(line.plane_id))
    .map((line) => ({
      lineId: line.line_id,
      startPointId: line.start_point_id,
      endPointId: line.end_point_id,
      planeId: line.plane_id,
      start: [line.start.x, line.start.y, line.start.z] as [
        number,
        number,
        number,
      ],
      end: [line.end.x, line.end.y, line.end.z] as [number, number, number],
      isSelected: line.is_selected,
      constraint: line.constraint,
      isConstruction: line.is_construction,
      isPreview: line.is_preview,
    }));
  const sketchCircles = viewport.sketch_circles
    .filter((circle) => isSketchPlaneVisible(circle.plane_id))
    .map(makeSketchCircle);
  const sketchArcs = viewport.sketch_arcs
    .filter((arc) => isSketchPlaneVisible(arc.plane_id))
    .map(makeSketchArc);
  const sketchPoints: SketchPointScene[] = viewport.sketch_points
    .filter((point) => isSketchPlaneVisible(point.plane_id))
    .map((point) => ({
      pointId: point.point_id,
      kind: point.kind,
      position: [point.position.x, point.position.y, point.position.z] as [
        number,
        number,
        number,
      ],
      isFixed: point.is_fixed,
      isSelected: point.is_selected,
    }));
  const sketchDimensions = viewport.sketch_dimensions
    .filter((dimension) => isSketchPlaneVisible(dimension.plane_id))
    .map(makeSketchDimension);
  const sketchConstraints = viewport.sketch_constraints
    .filter((constraint) => isSketchPlaneVisible(constraint.plane_id))
    .map(makeSketchConstraint);
  const sketchProfiles = viewport.sketch_profiles
    .filter((profile) => isSketchPlaneVisible(profile.plane_id))
    .map(makeSketchProfile);
  const profileIds = new Set(sketchProfiles.map((profile) => profile.profileId));
  if (document) {
    const selectedProfileIds = new Set(document.selected_sketch_profile_ids);
    for (const feature of document.feature_history) {
      const sketch = feature.sketch_parameters;
      if (
        feature.kind !== "sketch" ||
        !sketch ||
        hiddenFeatureIds.has(feature.feature_id) ||
        !isSketchPlaneVisible(sketch.plane_id)
      ) {
        continue;
      }
      for (const profile of sketch.profiles) {
        if (profileIds.has(profile.profile_id)) {
          continue;
        }
        const sceneProfile = makeSketchProfileFromDocument(
          feature,
          profile,
          selectedProfileIds,
        );
        if (sceneProfile) {
          sketchProfiles.push(sceneProfile);
          profileIds.add(sceneProfile.profileId);
        }
      }
    }
  }
  const solidFaces = viewport.solid_faces
    .filter((face) => !hiddenFeatureIds.has(face.owner_id))
    .map(makeSolidFace);
  const edges: SceneEdge[] = viewport.edges
    .filter((edge) => !hiddenFeatureIds.has(edge.owner_body_id))
    .map((edge) => ({
      edgeId: edge.id,
      ownerBodyId: edge.owner_body_id,
      kind:
        edge.kind === "line" || edge.kind === "circle" ? edge.kind : "curve",
      // Materialize a typed array up-front so the renderer can hand it
      // straight to a BufferAttribute without re-allocating per frame.
      points: Float32Array.from(edge.points),
      isSelected: edge.is_selected,
      isGhost: pendingEdgeOpBodyIds.has(edge.owner_body_id),
    }));
  const vertices: SceneVertex[] = viewport.vertices
    .filter((vertex) => !hiddenFeatureIds.has(vertex.owner_body_id))
    .map((vertex) => ({
      vertexId: vertex.id,
      ownerBodyId: vertex.owner_body_id,
      position: [vertex.position.x, vertex.position.y, vertex.position.z],
      isSelected: vertex.is_selected,
    }));
  const cutPreviews: CutPreviewScene[] = (viewport.cut_previews ?? []).map(
    (preview) => ({
      id: preview.id,
      // Materialize typed arrays up-front so the renderer hands them
      // straight to a BufferAttribute without re-allocating per frame.
      positions: Float32Array.from(preview.positions),
      normals: Float32Array.from(preview.normals),
      indices: Uint32Array.from(preview.indices),
    }),
  );

  return {
    bounds: {
      center: [
        viewport.scene_bounds.center.x,
        viewport.scene_bounds.center.y,
        viewport.scene_bounds.center.z,
      ],
      size: [
        clampDimension(viewport.scene_bounds.size.x),
        clampDimension(viewport.scene_bounds.size.y),
        clampDimension(viewport.scene_bounds.size.z),
      ],
      maxDimension: clampDimension(viewport.scene_bounds.max_dimension),
    },
    primitives,
    references,
    solidFaces,
    edges,
    vertices,
    cutPreviews,
    sketchLines,
    sketchCircles,
    sketchArcs,
    sketchDimensions,
    sketchConstraints,
    sketchPoints,
    sketchProfiles,
    geometryKey: primitives
      .map((primitive) => {
        // TS narrows better in a switch than a deeply nested ternary,
        // particularly with the recently-added `mesh` variant.
        switch (primitive.kind) {
          case "box":
            return `box:${primitive.primitiveId}:${primitive.size.join(":")}:${primitive.position.join(":")}`;
          case "cylinder":
            return `cyl:${primitive.primitiveId}:${primitive.radius}:${primitive.height}:${primitive.position.join(":")}`;
          case "polygon_extrude":
            return `poly-extrude:${primitive.primitiveId}:${primitive.planeId}:${primitive.depth}:${primitive.profilePoints.map((point) => point.join(":")).join("|")}:${primitive.innerLoops.map((loop) => loop.map((point) => point.join(":")).join(",")).join(";")}`;
          case "mesh":
            return `mesh:${primitive.primitiveId}:${numericBufferSignature(primitive.positions)}:${numericBufferSignature(primitive.indices)}`;
        }
      })
      .concat(
        references.map((reference) =>
          reference.kind === "reference_plane"
            ? `plane:${reference.referenceId}:${reference.orientation}:${reference.position.join(":")}:${reference.size.join(":")}:${reference.isActiveSketchPlane}`
            : `axis:${reference.referenceId}:${reference.axis}:${reference.start.join(":")}:${reference.end.join(":")}`,
        ),
      )
      .concat(
        solidFaces.map(
          // Include triangulation lengths so the rebuild fires whenever
          // a body's topology (and thus its per-face triangulation)
          // changes — e.g. after a fillet/chamfer/cut. Otherwise the
          // pick mesh would stay frozen on the prior topology.
          (face) =>
            `solid-face:${face.faceId}:${face.ownerId}:${face.sketchability}:${face.center.join(":")}:${face.trianglePositions.length}:${face.triangleIndices.length}:${face.isSelected}`,
        ),
      )
      .concat(
        edges.map(
          // Include `points.length` so the geometry key flips whenever
          // the body's edge topology changes (Cut/Join produces a new
          // edge count). Selection state is also part of the key so the
          // visual rebuild picks up highlight changes.
          (edge) =>
            `edge:${edge.edgeId}:${edge.points.length}:${edge.isSelected}`,
        ),
      )
      .concat(
        vertices.map(
          (vertex) =>
            `vertex:${vertex.vertexId}:${vertex.position.join(":")}:${vertex.isSelected}`,
        ),
      )
      .concat(
        cutPreviews.map(
          // Include a compact content signature so the rebuild fires as
          // the user tweaks depth in the floating panel, even when the
          // tessellation keeps the same vertex/index counts.
          (preview) =>
            `cut-preview:${preview.id}:${numericBufferSignature(preview.positions)}:${numericBufferSignature(preview.indices)}`,
        ),
      )
      .concat(
        sketchLines.map(
          (line) =>
            `sketch-line:${line.lineId}:${line.planeId}:${line.start.join(":")}:${line.end.join(":")}:${line.isSelected}:${line.constraint ?? "none"}`,
        ),
      )
      .concat(
        sketchCircles.map(
          (circle) =>
            `sketch-circle:${circle.circleId}:${circle.planeId}:${circle.center.join(":")}:${circle.radius}:${circle.isSelected}`,
        ),
      )
      .concat(
        sketchArcs.map(
          (arc) =>
            `sketch-arc:${arc.arcId}:${arc.planeId}:${arc.start.join(":")}:${arc.end.join(":")}:${arc.center.join(":")}:${arc.radius}:${arc.ccw}:${arc.isSelected}`,
        ),
      )
      .concat(
        sketchDimensions.map(
          (dimension) =>
            `sketch-dimension:${dimension.dimensionId}:${dimension.kind}:${dimension.entityId}:${dimension.label}:${dimension.anchorStart.join(":")}:${dimension.anchorEnd.join(":")}:${dimension.dimensionStart.join(":")}:${dimension.dimensionEnd.join(":")}:${dimension.labelPosition.join(":")}`,
        ),
      )
      .concat(
        sketchConstraints.map(
          (constraint) =>
            `sketch-constraint:${constraint.constraintId}:${constraint.kind}:${constraint.entityId}:${constraint.relatedEntityId ?? "none"}:${constraint.label}:${constraint.position.join(":")}:${constraint.isSelected}`,
        ),
      )
      .concat(
        sketchPoints.map(
          (point) =>
            `sketch-point:${point.pointId}:${point.position.join(":")}:${point.isSelected}`,
        ),
      )
      .concat(
        sketchProfiles.map(
          (profile) =>
            `sketch-profile:${profile.profileId}:${profile.profileKind}:${profile.planeId}:${profile.profilePoints.map((point) => point.join(":")).join("|")}:${profile.innerLoops.map((loop) => loop.map((point) => point.join(":")).join(",")).join(";")}:${profile.start.join(":")}:${profile.width}:${profile.height}:${profile.radius}:${profile.isSelected}`,
        ),
      )
      .join("|"),
  };
}
