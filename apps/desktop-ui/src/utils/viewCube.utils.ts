import * as THREE from "three";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CubeFace = "TOP" | "BOTTOM" | "FRONT" | "BACK" | "LEFT" | "RIGHT";

export type ViewCubeHit =
  | { type: "face"; face: CubeFace }
  | { type: "edge"; face1: CubeFace; face2: CubeFace }
  | { type: "corner"; faces: [CubeFace, CubeFace, CubeFace] }
  | null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUBE_SIZE = 1;
const FACE_OFFSET = 0.49;
const FACE_PANEL_SIZE = 0.88;
const FACE_THICKNESS = 0.02;
const EDGE_THICKNESS = 0.04;
const CORNER_RADIUS = 0.052;
const CUBE_VIEWPORT_SIZE = 140;
const CUBE_VIEWPORT_MARGIN = 16;
const ANIMATION_DURATION = 300;

const FACE_NORMALS: Record<CubeFace, THREE.Vector3> = {
  TOP: new THREE.Vector3(0, 1, 0),
  BOTTOM: new THREE.Vector3(0, -1, 0),
  FRONT: new THREE.Vector3(0, 0, 1),
  BACK: new THREE.Vector3(0, 0, -1),
  RIGHT: new THREE.Vector3(1, 0, 0),
  LEFT: new THREE.Vector3(-1, 0, 0),
};

const FACE_COLORS: Record<CubeFace, string> = {
  RIGHT: "#e05568",
  LEFT: "#b84455",
  TOP: "#26cc6e",
  BOTTOM: "#1fa358",
  FRONT: "#5da3f0",
  BACK: "#4a82c0",
};

const EDGE_COLOR = "#1c1c1e";
const CORNER_COLOR = "#353534";
const HOVER_COLOR = "#00e5ff";

// ---------------------------------------------------------------------------
// Face label texture
// ---------------------------------------------------------------------------

function createFaceLabelTexture(label: string, bgColor: string): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 44px "Space Grotesk", "Inter", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Build the view cube group (26 meshes)
// ---------------------------------------------------------------------------

export function buildViewCubeGroup(): THREE.Group {
  const group = new THREE.Group();

  // -- faces ----------------------------------------------------------------
  const faceConfigs: Array<{
    face: CubeFace;
    label: string;
    position: [number, number, number];
    rotation: [number, number, number];
    color: string;
  }> = [
    {
      face: "RIGHT",
      label: "RIGHT",
      position: [FACE_OFFSET, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      color: FACE_COLORS.RIGHT,
    },
    {
      face: "LEFT",
      label: "LEFT",
      position: [-FACE_OFFSET, 0, 0],
      rotation: [0, -Math.PI / 2, 0],
      color: FACE_COLORS.LEFT,
    },
    {
      face: "TOP",
      label: "TOP",
      position: [0, FACE_OFFSET, 0],
      rotation: [-Math.PI / 2, 0, 0],
      color: FACE_COLORS.TOP,
    },
    {
      face: "BOTTOM",
      label: "BOTTOM",
      position: [0, -FACE_OFFSET, 0],
      rotation: [Math.PI / 2, 0, 0],
      color: FACE_COLORS.BOTTOM,
    },
    {
      face: "FRONT",
      label: "FRONT",
      position: [0, 0, FACE_OFFSET],
      rotation: [0, 0, 0],
      color: FACE_COLORS.FRONT,
    },
    {
      face: "BACK",
      label: "BACK",
      position: [0, 0, -FACE_OFFSET],
      rotation: [0, Math.PI, 0],
      color: FACE_COLORS.BACK,
    },
  ];

  for (const cfg of faceConfigs) {
    const geometry = new THREE.BoxGeometry(FACE_PANEL_SIZE, FACE_PANEL_SIZE, FACE_THICKNESS);
    const texture = createFaceLabelTexture(cfg.label, cfg.color);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...cfg.position);
    mesh.rotation.set(...cfg.rotation);
    mesh.userData = { cubePart: true, cubeType: "face", face: cfg.face, baseColor: cfg.color };
    mesh.renderOrder = 0;
    group.add(mesh);
  }

  // -- edges ----------------------------------------------------------------
  const et = EDGE_THICKNESS;
  const edgeConfigs: Array<{
    faces: [CubeFace, CubeFace];
    size: [number, number, number];
    position: [number, number, number];
  }> = [
    // 4 edges along X at Y=0.5
    {
      faces: ["TOP", "FRONT"],
      size: [CUBE_SIZE + et * 0.5, et, et],
      position: [0, 0.5, 0.5],
    },
    {
      faces: ["TOP", "BACK"],
      size: [CUBE_SIZE + et * 0.5, et, et],
      position: [0, 0.5, -0.5],
    },
    {
      faces: ["BOTTOM", "FRONT"],
      size: [CUBE_SIZE + et * 0.5, et, et],
      position: [0, -0.5, 0.5],
    },
    {
      faces: ["BOTTOM", "BACK"],
      size: [CUBE_SIZE + et * 0.5, et, et],
      position: [0, -0.5, -0.5],
    },
    // 4 edges along Y at X=±0.5, Z=±0.5
    {
      faces: ["FRONT", "RIGHT"],
      size: [et, CUBE_SIZE + et * 0.5, et],
      position: [0.5, 0, 0.5],
    },
    {
      faces: ["FRONT", "LEFT"],
      size: [et, CUBE_SIZE + et * 0.5, et],
      position: [-0.5, 0, 0.5],
    },
    {
      faces: ["BACK", "RIGHT"],
      size: [et, CUBE_SIZE + et * 0.5, et],
      position: [0.5, 0, -0.5],
    },
    {
      faces: ["BACK", "LEFT"],
      size: [et, CUBE_SIZE + et * 0.5, et],
      position: [-0.5, 0, -0.5],
    },
    // 4 edges along Z at Y=±0.5, X=±0.5
    {
      faces: ["TOP", "RIGHT"],
      size: [et, et, CUBE_SIZE + et * 0.5],
      position: [0.5, 0.5, 0],
    },
    {
      faces: ["TOP", "LEFT"],
      size: [et, et, CUBE_SIZE + et * 0.5],
      position: [-0.5, 0.5, 0],
    },
    {
      faces: ["BOTTOM", "RIGHT"],
      size: [et, et, CUBE_SIZE + et * 0.5],
      position: [0.5, -0.5, 0],
    },
    {
      faces: ["BOTTOM", "LEFT"],
      size: [et, et, CUBE_SIZE + et * 0.5],
      position: [-0.5, -0.5, 0],
    },
  ];

  for (const cfg of edgeConfigs) {
    const geometry = new THREE.BoxGeometry(...cfg.size);
    const material = new THREE.MeshBasicMaterial({ color: EDGE_COLOR });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...cfg.position);
    mesh.userData = {
      cubePart: true,
      cubeType: "edge",
      face1: cfg.faces[0],
      face2: cfg.faces[1],
      baseColor: EDGE_COLOR,
    };
    mesh.renderOrder = 1;
    group.add(mesh);
  }

  // -- corners --------------------------------------------------------------
  const cornerSigns: Array<[number, number, number]> = [
    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, 1],
    [-1, 1, -1],
    [-1, -1, 1],
    [-1, -1, -1],
  ];

  for (const [sx, sy, sz] of cornerSigns) {
    const faces: [CubeFace, CubeFace, CubeFace] = [
      sx > 0 ? "RIGHT" : "LEFT",
      sy > 0 ? "TOP" : "BOTTOM",
      sz > 0 ? "FRONT" : "BACK",
    ];
    const geometry = new THREE.SphereGeometry(CORNER_RADIUS, 16, 12);
    const material = new THREE.MeshBasicMaterial({ color: CORNER_COLOR });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(sx * 0.5, sy * 0.5, sz * 0.5);
    mesh.userData = {
      cubePart: true,
      cubeType: "corner",
      faces,
      baseColor: CORNER_COLOR,
    };
    mesh.renderOrder = 2;
    group.add(mesh);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Scene and camera
// ---------------------------------------------------------------------------

export function createViewCubeScene(cubeGroup: THREE.Group): THREE.Scene {
  const scene = new THREE.Scene();

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(1, 1.5, 1.2);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-0.8, 0.3, -0.6);
  scene.add(fill);

  scene.add(cubeGroup);
  return scene;
}

export function createViewCubeCamera(): THREE.OrthographicCamera {
  const frustum = 1.75;
  const camera = new THREE.OrthographicCamera(
    -frustum / 2,
    frustum / 2,
    frustum / 2,
    -frustum / 2,
    0.05,
    10,
  );
  camera.position.set(1.4, 0.8, 1.4);
  camera.lookAt(0, 0, 0);
  return camera;
}

// ---------------------------------------------------------------------------
// Viewport rect
// ---------------------------------------------------------------------------

export function getCubeViewportRect(
  canvasWidth: number,
  canvasHeight: number,
  dpr: number,
): { x: number; y: number; width: number; height: number } {
  const size = CUBE_VIEWPORT_SIZE * dpr;
  const margin = CUBE_VIEWPORT_MARGIN * dpr;
  return {
    x: canvasWidth - size - margin,
    y: canvasHeight - size - margin,
    width: size,
    height: size,
  };
}

// ---------------------------------------------------------------------------
// Pointer-area check
// ---------------------------------------------------------------------------

export function isPointerInCubeArea(
  event: PointerEvent,
  canvasRect: DOMRect,
  dpr: number,
): boolean {
  const size = CUBE_VIEWPORT_SIZE * dpr;
  const margin = CUBE_VIEWPORT_MARGIN * dpr;
  const canvasRight = (canvasRect.right - canvasRect.left) * dpr;
  const px = (event.clientX - canvasRect.left) * dpr;
  const py = (event.clientY - canvasRect.top) * dpr;
  return px >= canvasRight - size - margin && px <= canvasRight - margin && py >= margin && py <= margin + size;
}

// ---------------------------------------------------------------------------
// Sync cube camera to match main view direction
// ---------------------------------------------------------------------------

export function syncCubeCamera(
  mainCamera: THREE.PerspectiveCamera,
  controlsTarget: THREE.Vector3,
  cubeCamera: THREE.OrthographicCamera,
): void {
  const dir = new THREE.Vector3()
    .copy(mainCamera.position)
    .sub(controlsTarget)
    .normalize();
  cubeCamera.position.copy(dir.multiplyScalar(2));
  cubeCamera.lookAt(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Raycast against cube meshes
// ---------------------------------------------------------------------------

export function raycastViewCube(
  raycaster: THREE.Raycaster,
  cubeGroup: THREE.Group,
): ViewCubeHit {
  const targets: THREE.Object3D[] = [];
  cubeGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.userData.cubePart) {
      targets.push(child);
    }
  });

  const intersections = raycaster.intersectObjects(targets, false);
  if (intersections.length === 0) return null;

  // Pick closest; faces (renderOrder 0) < edges (1) < corners (2)
  const hit = intersections[0].object as THREE.Mesh;
  const ud = hit.userData;

  if (ud.cubeType === "face") {
    return { type: "face", face: ud.face as CubeFace };
  }
  if (ud.cubeType === "edge") {
    return { type: "edge", face1: ud.face1 as CubeFace, face2: ud.face2 as CubeFace };
  }
  if (ud.cubeType === "corner") {
    return { type: "corner", faces: ud.faces as [CubeFace, CubeFace, CubeFace] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hit → world direction for snap
// ---------------------------------------------------------------------------

export function getCubeHitTargetDirection(hit: NonNullable<ViewCubeHit>): THREE.Vector3 {
  if (hit.type === "face") {
    return FACE_NORMALS[hit.face].clone();
  }
  if (hit.type === "edge") {
    return FACE_NORMALS[hit.face1]
      .clone()
      .add(FACE_NORMALS[hit.face2])
      .normalize();
  }
  // corner
  const dir = new THREE.Vector3();
  for (const f of hit.faces) {
    dir.add(FACE_NORMALS[f]);
  }
  return dir.normalize();
}

// ---------------------------------------------------------------------------
// Camera animation
// ---------------------------------------------------------------------------

export function animateCameraTowardTarget(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
  startPosition: THREE.Vector3,
  targetPosition: THREE.Vector3,
  startTime: number,
  currentTime: number,
): boolean {
  const elapsed = currentTime - startTime;
  const t = Math.min(elapsed / ANIMATION_DURATION, 1);
  // cubic ease-out matching the design system cue
  const ease = 1 - Math.pow(1 - t, 3);

  camera.position.lerpVectors(startPosition, targetPosition, ease);
  camera.lookAt(controls.target);
  controls.update();

  return t >= 1;
}

// ---------------------------------------------------------------------------
// Hover visual state
// ---------------------------------------------------------------------------

export function applyCubeHover(
  cubeGroup: THREE.Group,
  hit: ViewCubeHit,
): void {
  clearCubeHover(cubeGroup);

  if (!hit) return;

  let target: THREE.Object3D | null = null;

  cubeGroup.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh || !child.userData.cubePart) return;
    const ud = child.userData;
    if (
      hit.type === "face" &&
      ud.cubeType === "face" &&
      ud.face === hit.face
    ) {
      target = child;
    } else if (
      hit.type === "edge" &&
      ud.cubeType === "edge" &&
      ((ud.face1 === hit.face1 && ud.face2 === hit.face2) ||
        (ud.face1 === hit.face2 && ud.face2 === hit.face1))
    ) {
      target = child;
    } else if (
      hit.type === "corner" &&
      ud.cubeType === "corner" &&
      ud.faces &&
      ud.faces.length === 3 &&
      hit.faces.every((f: CubeFace) => (ud.faces as CubeFace[]).includes(f))
    ) {
      target = child;
    }
  });

  if (target) {
    const mat = (target as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.color.set(HOVER_COLOR);
  }
}

export function clearCubeHover(cubeGroup: THREE.Group): void {
  cubeGroup.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh || !child.userData.cubePart) return;
    const ud = child.userData;
    const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    mat.color.set(ud.baseColor as string);
  });
}

// ---------------------------------------------------------------------------
// Drag-to-orbit: apply pointer delta as spherical rotation
// ---------------------------------------------------------------------------

export function applyCubeDragOrbit(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
  deltaX: number,
  deltaY: number,
  sensitivity: number,
): void {
  const offset = new THREE.Vector3().copy(camera.position).sub(controls.target);
  const spherical = new THREE.Spherical();
  spherical.setFromVector3(offset);

  spherical.theta -= deltaX * sensitivity;
  spherical.phi -= deltaY * sensitivity;
  spherical.phi = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));

  const newPos = new THREE.Vector3().setFromSpherical(spherical).add(controls.target);
  camera.position.copy(newPos);
  camera.lookAt(controls.target);
  controls.update();
}

// ---------------------------------------------------------------------------
// Dispose helper
// ---------------------------------------------------------------------------

export function disposeViewCubeGroup(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.geometry.dispose();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (Array.isArray(mat)) {
      for (const m of mat) {
        const basicMat = m as THREE.MeshBasicMaterial;
        if (basicMat.map) basicMat.map.dispose();
        basicMat.dispose();
      }
    } else {
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
  });
  group.clear();
}
