import {
  PrimitiveInteractionState,
  PrimitiveVisual,
  ReferenceAxisScene,
  ReferencePlaneInteractionState,
  ReferencePlaneScene,
  ReferencePlaneVisual,
  ScenePrimitive,
  SolidFaceInteractionState,
  SolidFaceVisual,
  SketchCircleScene,
  SketchConstraintScene,
  SketchDimensionScene,
  SketchLineScene,
  SceneEdge,
  SceneVertex,
  CutPreviewScene,
  SketchPlaneFrame,
  SketchPointScene,
  SketchProfileScene,
  SolidFaceScene,
} from "@/types";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const SKETCH_PLANE_OFFSET = 0.2;
export const REFERENCE_PLANE_RENDER_SIZE = 25;
export const REFERENCE_PLANE_MARGIN = 5;
export const SKETCH_SNAP_DISTANCE = 2.5;
export const DIMENSION_EDITOR_MARGIN = 20;

export function themeColor(token: string, fallback: string) {
  if (typeof document === "undefined") {
    return fallback;
  }

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return value || fallback;
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
    return;
  }

  material.dispose();
}

export function disposeGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);

    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Line ||
      child instanceof THREE.Sprite
    ) {
      child.geometry.dispose();
      if (
        child instanceof THREE.Sprite &&
        child.material instanceof THREE.SpriteMaterial &&
        child.material.map
      ) {
        child.material.map.dispose();
      }
      disposeMaterial(child.material);
    }
  }
}

// Visual state for body primitives. Bodies render as solid Fusion-
// style gray (opaque, no transparency) so the model reads like a real
// CAD surface. Hover lifts the body slightly toward white; selection
// is signaled mostly via the body's own edges (see
// `applyEdgeVisualColor` below) plus a small whitening of the face
// fill so highlighted geometry never disappears against the gray.
export function applyPrimitiveVisualState(
  visual: PrimitiveVisual,
  state: PrimitiveInteractionState,
) {
  visual.baseMaterial.transparent = false;
  visual.baseMaterial.opacity = 1;
  visual.baseMaterial.emissive.set(
    themeColor("--color-cad-body-emissive", "#1a1a1c"),
  );
  visual.baseMaterial.emissiveIntensity = 0.05;

  if (state.isSelected) {
    visual.baseMaterial.color.set(
      themeColor("--color-cad-body-selected", "#d0d0d4"),
    );
    visual.edgeMaterial.color.set(
      themeColor("--color-cad-edge-selected", "#ff9a3c"),
    );
    return;
  }

  if (state.isHovered) {
    visual.baseMaterial.color.set(
      themeColor("--color-cad-body-hover", "#c8c8cc"),
    );
    visual.edgeMaterial.color.set(
      themeColor("--color-cad-edge-hover", "#3da9ff"),
    );
    return;
  }

  visual.baseMaterial.color.set(themeColor("--color-cad-body", "#b8b8b8"));
  visual.edgeMaterial.color.set(themeColor("--color-cad-edge", "#2a2a2c"));
}

// Three-state color helpers used by the viewport panel to recolor
// per-edge / per-vertex materials in response to hover changes
// without rebuilding the scene. Kept here next to the build* helpers
// so the palette decisions live in one file.
export function applyEdgeVisualColor(
  material: THREE.LineBasicMaterial,
  state: { isSelected: boolean; isHovered: boolean },
) {
  if (state.isSelected) {
    material.color.set(themeColor("--color-cad-edge-selected", "#ff9a3c"));
    material.opacity = 1;
    return;
  }
  if (state.isHovered) {
    material.color.set(themeColor("--color-cad-edge-hover", "#3da9ff"));
    material.opacity = 1;
    return;
  }
  material.color.set(themeColor("--color-cad-edge", "#2a2a2c"));
  material.opacity = 0.85;
}

export function applyVertexVisualColor(
  material: THREE.MeshBasicMaterial,
  state: { isSelected: boolean; isHovered: boolean },
) {
  if (state.isSelected) {
    material.color.set(themeColor("--color-cad-vertex-selected", "#ff9a3c"));
    material.opacity = 1;
    return;
  }
  if (state.isHovered) {
    material.color.set(themeColor("--color-cad-vertex-hover", "#3da9ff"));
    material.opacity = 1;
    return;
  }
  material.color.set(themeColor("--color-cad-vertex", "#1c1c1e"));
  material.opacity = 0.95;
}

export function applyReferencePlaneVisualState(
  visual: ReferencePlaneVisual,
  state: ReferencePlaneInteractionState,
) {
  if (state.isActiveSketchPlane) {
    visual.fillMaterial.color.set(
      themeColor("--color-tertiary-plane-selected", "#f7e38a"),
    );
    visual.fillMaterial.opacity = 0.38;
    visual.edgeMaterial.color.set(
      themeColor("--color-tertiary-plane-edge-active", "#fff4b8"),
    );
    return;
  }

  if (state.isSelected) {
    visual.fillMaterial.color.set(
      themeColor("--color-tertiary-plane-selected", "#f7e38a"),
    );
    visual.fillMaterial.opacity = 0.34;
    visual.edgeMaterial.color.set(
      themeColor("--color-tertiary-plane-edge-selected", "#ffe99a"),
    );
    return;
  }

  if (state.isHovered) {
    visual.fillMaterial.color.set(
      themeColor("--color-tertiary-plane-hover", "#fff0aa"),
    );
    visual.fillMaterial.opacity = 0.3;
    visual.edgeMaterial.color.set(
      themeColor("--color-tertiary-plane-edge-hover", "#fff2b2"),
    );
    return;
  }

  visual.fillMaterial.color.set(
    themeColor("--color-tertiary-plane-fill", "#fff7c0"),
  );
  visual.fillMaterial.opacity = 0.24;
  visual.edgeMaterial.color.set(
    themeColor("--color-tertiary-plane-edge", "#ffe784"),
  );
}

export function buildPrimitiveObject(primitive: ScenePrimitive) {
  // Solid Fusion-style gray at construction time. Previous defaults
  // were `transparent: true, opacity: 0.72` (the cyan look) and were
  // only flipped to opaque when `applyPrimitiveVisualState` ran from
  // hover / selection — which meant freshly-built bodies always
  // looked translucent on first render until the user interacted.
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: themeColor("--color-cad-body", "#b8b8b8"),
    emissive: themeColor("--color-cad-body-emissive", "#1a1a1c"),
    emissiveIntensity: 0.05,
    metalness: 0.1,
    roughness: 0.55,
    transparent: false,
    opacity: 1,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: themeColor("--color-cad-edge", "#2a2a2c"),
    transparent: true,
    opacity: 0.9,
  });

  let geometry: THREE.BufferGeometry;

  if (primitive.kind === "box") {
    geometry = new THREE.BoxGeometry(...primitive.size);
  } else if (primitive.kind === "cylinder") {
    geometry = new THREE.CylinderGeometry(
      primitive.radius,
      primitive.radius,
      primitive.height,
      48,
    );
  } else if (primitive.kind === "polygon_extrude") {
    const shape = new THREE.Shape();
    primitive.profilePoints.forEach((point, index) => {
      if (index === 0) {
        shape.moveTo(point[0], point[1]);
        return;
      }
      shape.lineTo(point[0], point[1]);
    });
    shape.closePath();

    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: primitive.depth,
      bevelEnabled: false,
      curveSegments: 1,
    });
    geometry.applyMatrix4(
      primitive.planeFrame
        ? makePlaneTransformMatrixFromFrame(primitive.planeFrame)
        : makePlaneTransformMatrix(primitive.planeId),
    );
  } else {
    // Boolean'd body tessellated by the native core. Vertices are already
    // in world space, so no extra transform is needed.
    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(primitive.positions, 3),
    );
    if (primitive.normals.length === primitive.positions.length) {
      meshGeometry.setAttribute(
        "normal",
        new THREE.BufferAttribute(primitive.normals, 3),
      );
    } else {
      meshGeometry.computeVertexNormals();
    }
    meshGeometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
    geometry = meshGeometry;
  }

  const mesh = new THREE.Mesh(geometry, baseMaterial);
  if (primitive.kind === "box" || primitive.kind === "cylinder") {
    mesh.position.set(...primitive.position);
  }
  mesh.userData.primitiveId = primitive.primitiveId;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    edgeMaterial,
  );
  if (primitive.kind === "box" || primitive.kind === "cylinder") {
    edges.position.copy(mesh.position);
  }

  return {
    mesh,
    edges,
    visual: {
      baseMaterial,
      edgeMaterial,
    },
  };
}

export function orientPlaneMesh(
  mesh: THREE.Object3D,
  orientation: ReferencePlaneScene["orientation"],
) {
  if (orientation === "xy") {
    mesh.rotation.x = -Math.PI / 2;
    return;
  }

  if (orientation === "yz") {
    mesh.rotation.y = Math.PI / 2;
  }
}

export function planeOrientationFromId(
  planeId: string,
): ReferencePlaneScene["orientation"] {
  if (planeId === "ref-plane-xy") {
    return "xy";
  }

  if (planeId === "ref-plane-yz") {
    return "yz";
  }

  return "xz";
}

export function makePlaneTransformMatrix(planeId: string, offset = 0) {
  if (planeId === "ref-plane-xy") {
    return new THREE.Matrix4().set(
      1,
      0,
      0,
      0,
      0,
      0,
      1,
      offset,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      1,
    );
  }

  if (planeId === "ref-plane-yz") {
    return new THREE.Matrix4().set(
      0,
      0,
      1,
      offset,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      1,
    );
  }

  return new THREE.Matrix4().set(
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    offset,
    0,
    0,
    0,
    1,
  );
}

export function makePlaneTransformMatrixFromFrame(
  planeFrame: {
    origin: [number, number, number] | { x: number; y: number; z: number };
    xAxis?: [number, number, number] | { x: number; y: number; z: number };
    yAxis?: [number, number, number] | { x: number; y: number; z: number };
    x_axis?: { x: number; y: number; z: number };
    y_axis?: { x: number; y: number; z: number };
    normal: [number, number, number] | { x: number; y: number; z: number };
  },
  offset = 0,
) {
  const origin = Array.isArray(planeFrame.origin)
    ? {
        x: planeFrame.origin[0],
        y: planeFrame.origin[1],
        z: planeFrame.origin[2],
      }
    : planeFrame.origin;
  const xAxis = planeFrame.x_axis
    ? planeFrame.x_axis
    : Array.isArray(planeFrame.xAxis)
      ? {
          x: planeFrame.xAxis[0],
          y: planeFrame.xAxis[1],
          z: planeFrame.xAxis[2],
        }
      : planeFrame.xAxis;
  const yAxis = planeFrame.y_axis
    ? planeFrame.y_axis
    : Array.isArray(planeFrame.yAxis)
      ? {
          x: planeFrame.yAxis[0],
          y: planeFrame.yAxis[1],
          z: planeFrame.yAxis[2],
        }
      : planeFrame.yAxis;
  const normal = Array.isArray(planeFrame.normal)
    ? {
        x: planeFrame.normal[0],
        y: planeFrame.normal[1],
        z: planeFrame.normal[2],
      }
    : planeFrame.normal;

  return new THREE.Matrix4().set(
    xAxis!.x,
    yAxis!.x,
    normal!.x,
    origin!.x + normal!.x * offset,
    xAxis!.y,
    yAxis!.y,
    normal!.y,
    origin!.y + normal!.y * offset,
    xAxis!.z,
    yAxis!.z,
    normal!.z,
    origin!.z + normal!.z * offset,
    0,
    0,
    0,
    1,
  );
}

export function buildReferencePlaneObject(plane: ReferencePlaneScene) {
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: themeColor("--color-tertiary-plane-fill", "#fff7c0"),
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: themeColor("--color-tertiary-plane-edge", "#ffe784"),
    transparent: true,
    opacity: 0.92,
  });
  const geometry = new THREE.PlaneGeometry(
    REFERENCE_PLANE_RENDER_SIZE,
    REFERENCE_PLANE_RENDER_SIZE,
  );
  const mesh = new THREE.Mesh(geometry, fillMaterial);
  orientPlaneMesh(mesh, plane.orientation);
  // Render the origin helpers from the world origin so the visual margin is
  // measured from the axes, not from the core plane center.
  const offset = REFERENCE_PLANE_MARGIN + REFERENCE_PLANE_RENDER_SIZE / 2;
  const renderPosition: [number, number, number] =
    plane.orientation === "xy"
      ? [offset, 0, offset]
      : plane.orientation === "yz"
        ? [0, offset, offset]
        : [offset, offset, 0];
  mesh.position.set(...renderPosition);
  mesh.userData.referenceId = plane.referenceId;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    edgeMaterial,
  );
  orientPlaneMesh(edges, plane.orientation);
  edges.position.copy(mesh.position);

  return {
    mesh,
    edges,
    visual: {
      fillMaterial,
      edgeMaterial,
    },
  };
}

export function buildReferenceAxisObject(axis: ReferenceAxisScene) {
  const color =
    axis.axis === "x"
      ? themeColor("--color-axis-x", "#ff6b7a")
      : axis.axis === "y"
        ? themeColor("--color-axis-y", "#2bd978")
        : themeColor("--color-axis-z", "#6db4ff");
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
  });
  const points = [
    new THREE.Vector3(...axis.start),
    new THREE.Vector3(...axis.end),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, material);

  return { line };
}

// Build a pickable polyline for a body edge. The line carries the edge id
// in `userData.edgeId` for the raycaster, and `renderOrder = 1` plus
// `depthTest = false` keep the highlight readable on top of the body's
// face fills (which sit at `renderOrder = 0`). `userData.isSelected`
// is stashed so the viewport panel's hover handler can recompute the
// material color without re-reading the document state.
export function buildSceneEdgeObject(edge: SceneEdge): THREE.Line {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(edge.points, 3));

  const material = new THREE.LineBasicMaterial({
    transparent: true,
    linewidth: 1, // most browsers ignore this; selection still reads via color
    // depthTest stays ON so edges on the far side of an opaque body
    // are occluded by the surface, matching Fusion. With it off, the
    // wireframe shows through the body and reads as transparency.
    // `polygonOffset` plus a small `polygonOffsetUnits` keeps the line
    // visually on top of the face fill at the same depth (otherwise
    // edges z-fight with the surface they sit on).
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  applyEdgeVisualColor(material, {
    isSelected: edge.isSelected,
    isHovered: false,
  });

  const line = new THREE.Line(geometry, material);
  line.userData.edgeId = edge.edgeId;
  line.userData.isSelected = edge.isSelected;
  line.renderOrder = 1;
  return line;
}

// Build a pickable vertex marker. We use a small sphere mesh rather than
// THREE.Points so the pick is consistent across DPI / camera distances —
// a sphere has a real bounding volume the raycaster can hit reliably.
// The marker sits on top of edges/faces via `renderOrder = 2` and
// `depthTest = false` so it's never occluded.
const VERTEX_RADIUS = 0.6;
// Build the translucent red overlay mesh for a cut preview. The overlay
// is non-pickable (`raycast = no-op`) so the user keeps picking the
// underlying booleaned body's faces and edges, not this preview.
export function buildCutPreviewObject(preview: CutPreviewScene): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(preview.positions, 3),
  );
  if (preview.normals.length === preview.positions.length) {
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(preview.normals, 3),
    );
  }
  geometry.setIndex(new THREE.BufferAttribute(preview.indices, 1));
  // Solid red translucent so the user reads it as "this volume is being
  // removed". We render with depthWrite off and a higher renderOrder so
  // the overlay always reads through other geometry, matching Fusion's
  // preview behavior.
  const material = new THREE.MeshBasicMaterial({
    color: 0xff3344,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 5;
  // Preview is purely visual — never participate in raycasting.
  mesh.raycast = () => {};
  mesh.userData.cutPreviewId = preview.id;
  return mesh;
}

export function buildSceneVertexObject(vertex: SceneVertex): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(VERTEX_RADIUS, 12, 8);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    // Same reasoning as edges: keep depthTest on so back-side vertices
    // hide behind the opaque body fill instead of bleeding through.
    depthTest: true,
  });
  applyVertexVisualColor(material, {
    isSelected: vertex.isSelected,
    isHovered: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(vertex.position[0], vertex.position[1], vertex.position[2]);
  mesh.userData.vertexId = vertex.vertexId;
  mesh.userData.isSelected = vertex.isSelected;
  mesh.renderOrder = 2;
  return mesh;
}

export function orientFaceMesh(mesh: THREE.Object3D, face: SolidFaceScene) {
  if (Math.abs(face.normal[1]) > 0.5) {
    mesh.rotation.x = -Math.PI / 2;
    return;
  }

  if (Math.abs(face.normal[0]) > 0.5) {
    mesh.rotation.y = Math.PI / 2;
  }
}

export function buildSolidFaceObject(face: SolidFaceScene) {
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: themeColor("--color-primary-fixed-dim", "#00daf3"),
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Body-derived faces ship a real triangulation in world space —
  // build a BufferGeometry directly so picking and visuals match the
  // actual face shape (booleaned, filleted, plane-frame-rotated, etc.).
  // Legacy analytical faces (no triangulation) fall back to the old
  // PlaneGeometry transformed into the face's plane frame.
  let geometry: THREE.BufferGeometry;
  let appliesPlaneTransform: boolean;
  if (face.trianglePositions.length > 0 && face.triangleIndices.length > 0) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(face.trianglePositions, 3),
    );
    geometry.setIndex(new THREE.BufferAttribute(face.triangleIndices, 1));
    appliesPlaneTransform = false;
  } else {
    geometry = new THREE.PlaneGeometry(
      Math.max(face.size.width || face.size.radius * 2 || 1, 1),
      Math.max(face.size.height || face.size.radius * 2 || 1, 1),
    );
    appliesPlaneTransform = true;
  }

  const mesh = new THREE.Mesh(geometry, fillMaterial);
  if (appliesPlaneTransform) {
    mesh.applyMatrix4(makePlaneTransformMatrixFromFrame(face.planeFrame));
  }
  mesh.userData.faceId = face.faceId;
  mesh.renderOrder = 4;
  return {
    mesh,
    visual: {
      fillMaterial,
    } satisfies SolidFaceVisual,
  };
}

export function applySolidFaceVisualState(
  visual: SolidFaceVisual,
  state: SolidFaceInteractionState,
) {
  if (state.isSelected) {
    visual.fillMaterial.color.set(
      themeColor("--color-primary-soft", "#c3f5ff"),
    );
    visual.fillMaterial.opacity = 0.32;
    return;
  }

  if (state.isHovered) {
    visual.fillMaterial.color.set(
      themeColor("--color-primary-hover", "#86f4ff"),
    );
    visual.fillMaterial.opacity = 0.22;
    return;
  }

  visual.fillMaterial.color.set(
    themeColor("--color-primary-fixed-dim", "#00daf3"),
  );
  visual.fillMaterial.opacity = 0;
}

export function buildSketchLineObject(line: SketchLineScene) {
  const material = new THREE.LineBasicMaterial({
    color: line.isSelected
      ? themeColor("--color-primary-edge-active", "#c3f5ff")
      : themeColor("--color-tertiary-plane-fill", "#fff7c0"),
    transparent: true,
    opacity: 0.98,
    linewidth: line.isSelected ? 2 : 1,
  });
  const points = [
    new THREE.Vector3(...line.start),
    new THREE.Vector3(...line.end),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const sketchLine = new THREE.Line(geometry, material);
  sketchLine.userData.sketchEntityId = line.lineId;
  sketchLine.userData.sketchEntityKind = "line";
  return sketchLine;
}

export function buildSketchCircleObject(circle: SketchCircleScene) {
  const material = new THREE.LineBasicMaterial({
    color: circle.isSelected
      ? themeColor("--color-primary-edge-active", "#c3f5ff")
      : themeColor("--color-tertiary-plane-fill", "#fff7c0"),
    transparent: true,
    opacity: 0.98,
  });
  const curve = new THREE.EllipseCurve(
    0,
    0,
    circle.radius,
    circle.radius,
    0,
    Math.PI * 2,
    false,
    0,
  );
  const points = curve
    .getPoints(64)
    .map((point) =>
      circle.planeId === "ref-plane-xy"
        ? new THREE.Vector3(
            circle.center[0] + point.x,
            circle.center[1],
            circle.center[2] + point.y,
          )
        : circle.planeId === "ref-plane-yz"
          ? new THREE.Vector3(
              circle.center[0],
              circle.center[1] + point.x,
              circle.center[2] + point.y,
            )
          : new THREE.Vector3(
              circle.center[0] + point.x,
              circle.center[1] + point.y,
              circle.center[2],
            ),
    );
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const sketchCircle = new THREE.LineLoop(geometry, material);
  sketchCircle.userData.sketchEntityId = circle.circleId;
  sketchCircle.userData.sketchEntityKind = "circle";
  return sketchCircle;
}

export function buildSketchPointObject(point: SketchPointScene) {
  const geometry = new THREE.SphereGeometry(
    point.kind === "center" ? 0.9 : 0.7,
    12,
    12,
  );
  const material = new THREE.MeshBasicMaterial({
    color: point.isSelected
      ? themeColor("--color-primary-edge-active", "#c3f5ff")
      : point.kind === "center"
        ? themeColor("--color-axis-z", "#6db4ff")
        : themeColor("--color-tertiary-plane-edge", "#ffe784"),
    transparent: true,
    opacity: point.isSelected ? 1 : 0.92,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...point.position);
  mesh.userData.sketchPointId = point.pointId;
  mesh.userData.sketchPointKind = point.kind;
  return mesh;
}

export function makeDimensionLabelSprite(text: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true }),
    );
  }

  const fontSize = 26;
  context.font = `600 ${fontSize}px "Space Grotesk", sans-serif`;
  const textWidth = Math.ceil(context.measureText(text).width);
  canvas.width = textWidth + 28;
  canvas.height = 52;

  context.font = `600 ${fontSize}px "Space Grotesk", sans-serif`;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(7, 13, 16, 0.88)";
  context.strokeStyle = "rgba(195, 245, 255, 0.9)";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 14);
  context.fill();
  context.stroke();
  context.fillStyle = "#e7fbff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(canvas.width / 9, canvas.height / 9, 1);
  return sprite;
}

export function makeConstraintBadgeSprite(text: string, isSelected: boolean) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const texture = new THREE.CanvasTexture(canvas);
    return new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true }),
    );
  }

  canvas.width = 54;
  canvas.height = 54;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = isSelected
    ? "rgba(20, 50, 58, 0.94)"
    : "rgba(7, 13, 16, 0.88)";
  context.strokeStyle = isSelected
    ? "rgba(195, 245, 255, 1)"
    : "rgba(160, 228, 239, 0.92)";
  context.lineWidth = 2;
  context.beginPath();
  context.roundRect(4, 4, canvas.width - 8, canvas.height - 8, 16);
  context.fill();
  context.stroke();
  context.fillStyle = "#e7fbff";
  context.font = '700 24px "Space Grotesk", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(5.4, 5.4, 1);
  return sprite;
}

export function buildSketchDimensionObject(dimension: SketchDimensionScene) {
  const material = new THREE.LineBasicMaterial({
    color: dimension.isSelected
      ? themeColor("--color-primary-edge-active", "#c3f5ff")
      : themeColor("--color-primary-soft", "#8feaf7"),
    transparent: true,
    opacity: dimension.isSelected ? 0.98 : 0.84,
    depthTest: false,
  });
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...dimension.anchorStart),
    new THREE.Vector3(...dimension.dimensionStart),
    new THREE.Vector3(...dimension.dimensionStart),
    new THREE.Vector3(...dimension.dimensionEnd),
    new THREE.Vector3(...dimension.anchorEnd),
    new THREE.Vector3(...dimension.dimensionEnd),
  ]);
  const line = new THREE.LineSegments(geometry, material);
  line.renderOrder = 6;
  line.userData.sketchDimensionId = dimension.dimensionId;

  const label = makeDimensionLabelSprite(dimension.label);
  label.position.set(...dimension.labelPosition);
  label.renderOrder = 7;
  label.userData.sketchDimensionId = dimension.dimensionId;

  return { line, label };
}

export function buildSketchConstraintObject(constraint: SketchConstraintScene) {
  const badge = makeConstraintBadgeSprite(
    constraint.label,
    constraint.isSelected,
  );
  badge.position.set(...constraint.position);
  badge.renderOrder = 8;
  badge.userData.sketchConstraintId = constraint.constraintId;
  badge.userData.sketchConstraintKind = constraint.kind;
  badge.userData.sketchConstraintEntityId = constraint.entityId;
  badge.userData.sketchConstraintRelatedEntityId = constraint.relatedEntityId;
  return badge;
}

export function buildSketchProfileObject(profile: SketchProfileScene) {
  const material = new THREE.MeshBasicMaterial({
    color: profile.isSelected
      ? themeColor("--color-primary-soft", "#c3f5ff")
      : themeColor("--color-tertiary-plane-fill", "#fff7c0"),
    transparent: true,
    opacity: profile.isSelected ? 0.26 : 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  if (profile.profileKind === "circle") {
    const geometry = new THREE.CircleGeometry(profile.radius, 48);
    const mesh = new THREE.Mesh(geometry, material);
    if (profile.planeFrame) {
      mesh.applyMatrix4(
        makePlaneTransformMatrixFromFrame(
          profile.planeFrame,
          SKETCH_PLANE_OFFSET,
        ),
      );
    } else {
      orientPlaneMesh(mesh, planeOrientationFromId(profile.planeId));
      mesh.position.set(...toWorldPoint(profile.planeId, profile.start));
    }
    mesh.userData.sketchProfileId = profile.profileId;
    return mesh;
  }

  const shape = new THREE.Shape();
  profile.profilePoints.forEach((point, index) => {
    if (index === 0) {
      shape.moveTo(point[0], point[1]);
      return;
    }
    shape.lineTo(point[0], point[1]);
  });
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  geometry.applyMatrix4(
    profile.planeFrame
      ? makePlaneTransformMatrixFromFrame(
          profile.planeFrame,
          SKETCH_PLANE_OFFSET,
        )
      : makePlaneTransformMatrix(profile.planeId, SKETCH_PLANE_OFFSET),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.sketchProfileId = profile.profileId;
  return mesh;
}

export function frameCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  center: [number, number, number],
  maxDimension: number,
) {
  const distance = Math.max(maxDimension * 1.8, 160);
  camera.position.set(
    center[0] + distance,
    center[1] + distance * 0.8,
    center[2] + distance,
  );
  controls.target.set(...center);
  controls.update();
}

export function frameCameraToSketchPlane(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  activePlaneId: string,
  planeFrame: SketchPlaneFrame | null,
  maxDimension: number,
) {
  const distance = Math.max(maxDimension * 1.6, 120);

  if (planeFrame) {
    const origin = new THREE.Vector3(
      planeFrame.origin.x,
      planeFrame.origin.y,
      planeFrame.origin.z,
    );
    const normal = new THREE.Vector3(
      planeFrame.normal.x,
      planeFrame.normal.y,
      planeFrame.normal.z,
    ).normalize();

    // Fusion-like up: prefer world Y; if the face normal is vertical, fall
    // back to world -Z so the sketch reads top-down without rolling.
    const worldUp = new THREE.Vector3(0, 1, 0);
    const up =
      Math.abs(normal.dot(worldUp)) > 0.95
        ? new THREE.Vector3(0, 0, -1)
        : worldUp.clone();

    camera.position.copy(origin.clone().add(normal.multiplyScalar(distance)));
    camera.up.copy(up);
    controls.target.copy(origin);
    controls.update();
    return;
  }

  if (activePlaneId === "ref-plane-xy") {
    camera.position.set(0, distance, 0);
    camera.up.set(0, 0, -1);
    controls.target.set(0, 0, 0);
    controls.update();
    return;
  }

  if (activePlaneId === "ref-plane-yz") {
    camera.position.set(distance, 0, 0);
    camera.up.set(0, 1, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    return;
  }

  camera.position.set(0, 0, distance);
  camera.up.set(0, 1, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

export function resolveSketchPlanePoint(
  event: PointerEvent,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  activePlaneId: string,
  planeFrame: SketchPlaneFrame | null,
) {
  const rect = renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);

  if (planeFrame) {
    const origin = new THREE.Vector3(
      planeFrame.origin.x,
      planeFrame.origin.y,
      planeFrame.origin.z,
    );
    const normal = new THREE.Vector3(
      planeFrame.normal.x,
      planeFrame.normal.y,
      planeFrame.normal.z,
    );
    const xAxis = new THREE.Vector3(
      planeFrame.x_axis.x,
      planeFrame.x_axis.y,
      planeFrame.x_axis.z,
    );
    const yAxis = new THREE.Vector3(
      planeFrame.y_axis.x,
      planeFrame.y_axis.y,
      planeFrame.y_axis.z,
    );
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      origin,
    );
    const hitPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(plane, hitPoint);
    if (!hit) {
      return null;
    }
    const relative = hitPoint.clone().sub(origin);
    return {
      local: [relative.dot(xAxis), relative.dot(yAxis)] as [number, number],
      world: [hitPoint.x, hitPoint.y, hitPoint.z] as [number, number, number],
    };
  }

  const plane =
    activePlaneId === "ref-plane-xy"
      ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -SKETCH_PLANE_OFFSET)
      : activePlaneId === "ref-plane-yz"
        ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -SKETCH_PLANE_OFFSET)
        : new THREE.Plane(new THREE.Vector3(0, 0, 1), -SKETCH_PLANE_OFFSET);

  const hitPoint = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(plane, hitPoint);
  if (!hit) {
    return null;
  }

  if (activePlaneId === "ref-plane-xy") {
    return {
      local: [hitPoint.x, hitPoint.z] as [number, number],
      world: [hitPoint.x, SKETCH_PLANE_OFFSET, hitPoint.z] as [
        number,
        number,
        number,
      ],
    };
  }

  if (activePlaneId === "ref-plane-yz") {
    return {
      local: [hitPoint.y, hitPoint.z] as [number, number],
      world: [SKETCH_PLANE_OFFSET, hitPoint.y, hitPoint.z] as [
        number,
        number,
        number,
      ],
    };
  }

  return {
    local: [hitPoint.x, hitPoint.y] as [number, number],
    world: [hitPoint.x, hitPoint.y, SKETCH_PLANE_OFFSET] as [
      number,
      number,
      number,
    ],
  };
}

export function toWorldPoint(
  planeId: string,
  local: [number, number],
  planeFrame: SketchPlaneFrame | null = null,
): [number, number, number] {
  if (planeFrame) {
    return [
      planeFrame.origin.x +
        planeFrame.x_axis.x * local[0] +
        planeFrame.y_axis.x * local[1],
      planeFrame.origin.y +
        planeFrame.x_axis.y * local[0] +
        planeFrame.y_axis.y * local[1],
      planeFrame.origin.z +
        planeFrame.x_axis.z * local[0] +
        planeFrame.y_axis.z * local[1],
    ];
  }
  if (planeId === "ref-plane-xy") {
    return [local[0], SKETCH_PLANE_OFFSET, local[1]];
  }

  if (planeId === "ref-plane-yz") {
    return [SKETCH_PLANE_OFFSET, local[0], local[1]];
  }

  return [local[0], local[1], SKETCH_PLANE_OFFSET];
}

export function distanceBetweenPoints(
  a: [number, number],
  b: [number, number],
) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function projectWorldPointToViewport(
  point: [number, number, number],
  camera: THREE.Camera,
  renderer: THREE.WebGLRenderer,
) {
  const projected = new THREE.Vector3(...point).project(camera);
  if (projected.z < -1 || projected.z > 1) {
    return null;
  }

  const widthHalf = renderer.domElement.clientWidth / 2;
  const heightHalf = renderer.domElement.clientHeight / 2;

  const rawX = projected.x * widthHalf + widthHalf;
  const rawY = -projected.y * heightHalf + heightHalf;

  return {
    x: Math.min(
      Math.max(rawX, DIMENSION_EDITOR_MARGIN),
      renderer.domElement.clientWidth - DIMENSION_EDITOR_MARGIN,
    ),
    y: Math.min(
      Math.max(rawY, DIMENSION_EDITOR_MARGIN),
      renderer.domElement.clientHeight - DIMENSION_EDITOR_MARGIN,
    ),
  };
}
