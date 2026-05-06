import { ConstraintType, SketchTool } from "@/types";

export const SelectIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 4.5v14l4.2-3 2.2 4.2 2.1-1.1-2.2-4.2 4.7-.7L6 4.5Z" />
  </svg>
);

export const LineIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="6" cy="18" r="1.6" />
    <circle cx="18" cy="6" r="1.6" />
    <path d="M7.4 16.6 16.6 7.4" />
  </svg>
);

export const RectangleIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="5" y="7" width="14" height="10" rx="1.5" />
  </svg>
);

export const CircleIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="6.5" />
  </svg>
);

export const ArcIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 15a6 6 0 1 1 12 0" />
    <circle cx="6" cy="15" r="1.4" />
    <circle cx="18" cy="15" r="1.4" />
  </svg>
);

export const TrimIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m7 17 10-10" />
    <path d="m9 7 8 8" />
  </svg>
);

export const HorizontalConstraintIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="m8 9-3 3 3 3" />
    <path d="m16 9 3 3-3 3" />
  </svg>
);

export const VerticalConstraintIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 5v14" />
    <path d="m9 8 3-3 3 3" />
    <path d="m9 16 3 3 3-3" />
  </svg>
);

export const PerpendicularConstraintIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M7 6v12" />
    <path d="M7 12h10" />
  </svg>
);

export const CoincidentConstraintIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="8.5" cy="12" r="3.2" />
    <circle cx="15.5" cy="12" r="3.2" />
  </svg>
);

export const ParallelConstraintIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M7 8h10" />
    <path d="M7 16h10" />
    <path d="m9 6-2 2 2 2" />
    <path d="m15 14 2 2-2 2" />
  </svg>
);

export const EqualLengthConstraintIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 9h12" />
    <path d="M6 15h12" />
  </svg>
);

export const MirrorConstraintIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* Vertical dashed mirror axis flanked by two arrow-heads
        pointing toward each other — visually conveys "reflect
        across this line". */}
    <path d="M12 4v16" strokeDasharray="2 2" />
    <path d="M4 9l4 3-4 3" />
    <path d="M20 9l-4 3 4 3" />
  </svg>
);

export const ClearConstraintIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m7 7 10 10" />
    <path d="m17 7-10 10" />
  </svg>
);

export function SketchToolIcon({ tool }: { tool: SketchTool }) {
  switch (tool) {
    case "select":
      return <SelectIcon />;
    case "line":
      return <LineIcon />;
    case "rectangle":
      return <RectangleIcon />;
    case "circle":
      return <CircleIcon />;
    case "arc":
      return <ArcIcon />;
    case "fillet":
      return <FilletIcon />;
    default:
      return <TrimIcon />;
  }
}

// 3D primitive / modeling icons. Drawn as flat-stroke SVGs in the same
// 24×24 grid as the sketch icons so they line up inside the shared
// `cad-icon-button` chrome. Isometric projection (cos30 ≈ 0.866,
// sin30 = 0.5) so the cube/cylinder/etc. read as 3D in the toolbar.

export const BoxIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 4 4 8v8l8 4 8-4V8Z" />
    <path d="m4 8 8 4 8-4" />
    <path d="M12 12v8" />
  </svg>
);

export const CylinderIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <ellipse cx="12" cy="6" rx="6" ry="2.4" />
    <path d="M6 6v12" />
    <path d="M18 6v12" />
    <path d="M6 18a6 2.4 0 0 0 12 0" />
  </svg>
);

export const SphereIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="7.5" />
    <ellipse cx="12" cy="12" rx="7.5" ry="3" />
  </svg>
);

// Fusion-style Extrude icon: dominant isometric cube taking most of
// the viewbox, with a small vertical arrow tucked into the upper-right
// corner. The size ratio (cube ~12 units wide vs. arrow ~4 units) is
// what reads "push the profile *up* to make this body" rather than
// "two equal symbols side by side".
export const ExtrudeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {/* Cube: front silhouette + top face + center vertical edge,
        spanning x=2..14, y=5..21. */}
    <path d="M8 5 2 8v10l6 3 6-3V8Z" />
    <path d="m2 8 6 3 6-3" />
    <path d="M8 11v10" />
    {/* Small upward arrow on the right, half the cube's height. */}
    <path d="M19 17v-7" />
    <path d="m17 12 2-2 2 2" />
  </svg>
);

export const LoftIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="14" width="8" height="6" rx="1" />
    <circle cx="17" cy="7" r="3" />
    <path d="m12 14 5-4" />
    <path d="m4 14 11-7" />
  </svg>
);

export const PatternIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="14" y="14" width="6" height="6" rx="1" />
  </svg>
);

export const SketchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 20 6 14 16 4l4 4L10 18Z" />
    <path d="m14 6 4 4" />
  </svg>
);

// "Project face" glyph: a planar face being dropped onto the active
// sketch plane. Reads as "stamp this face onto the sketch grid".
export const ProjectFaceIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 16h14" />
    <path d="M7 16l3-3h7l-3 3" />
    <rect x="8" y="5" width="8" height="6" rx="1" />
    <path d="M12 11v2" />
  </svg>
);

export const FilletIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 19V12a7 7 0 0 1 7-7h7" />
    <path d="M5 19h14" />
  </svg>
);

export const ChamferIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 19V10l5-5h9" />
    <path d="M5 19h14" />
  </svg>
);

// Generic fallback used by the feature timeline for the synthetic
// "root" entry and any future feature kinds we haven't drawn yet.
export const FeatureGenericIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-7 w-7"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// Small parallelogram icon shared by every parametric construction
// plane in the timeline / hierarchy. Visually distinct from the
// origin axes badge and the body / sketch glyphs.
const ConstructionPlaneIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 8h12l2 8H7Z" />
    <path d="M5 8L7 16" />
    <path d="M17 8l2 8" />
  </svg>
);

export function FeatureKindIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "box":
      return <BoxIcon />;
    case "cylinder":
      return <CylinderIcon />;
    case "extrude":
      return <ExtrudeIcon />;
    case "sphere":
      return <SphereIcon />;
    case "loft":
      return <LoftIcon />;
    case "pattern":
      return <PatternIcon />;
    case "sketch":
      return <SketchIcon />;
    case "fillet":
      return <FilletIcon />;
    case "chamfer":
      return <ChamferIcon />;
    case "construction_plane":
      return <ConstructionPlaneIcon />;
    default:
      return <FeatureGenericIcon />;
  }
}

export function ConstraintIcon({ kind }: { kind: ConstraintType }) {
  switch (kind) {
    case "horizontal":
      return <HorizontalConstraintIcon />;
    case "vertical":
      return <VerticalConstraintIcon />;
    case "perpendicular":
      return <PerpendicularConstraintIcon />;
    case "coincident":
      return <CoincidentConstraintIcon />;
    case "parallel":
      return <ParallelConstraintIcon />;
    case "equal_length":
      return <EqualLengthConstraintIcon />;
    case "mirror":
      return <MirrorConstraintIcon />;
    default:
      return <ClearConstraintIcon />;
  }
}
