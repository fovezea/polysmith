export type ConstraintType =
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "fixed"
  | "clear"
  | "coincident"
  | "tangent"
  | "equal_length"
  | "equal_radius"
  // A point bound to the midpoint of a line (Phase 2 of the sketch
  // improvements). Rendered as an "M" badge on the host line.
  | "midpoint";

export type ArmedSketchConstraint =
  | null
  | { kind: "horizontal" | "vertical" | "clear" }
  | {
      kind: "equal_length" | "perpendicular" | "parallel";
      firstLineId: string | null;
    }
  | { kind: "coincident"; firstPointId: string | null };
