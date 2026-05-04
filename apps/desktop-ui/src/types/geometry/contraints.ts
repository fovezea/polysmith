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
  | "midpoint"
  // A point bound to a host line's body at parametric position `t`.
  // Rendered as a "/" badge at the bound point's position.
  | "on_line"
  // Mirror tool (technically an editing op, not a constraint, but
  // it shares the armed-sketch-constraint flow: pick axis line,
  // pick entities, each pick mirrors immediately).
  | "mirror";

export type ArmedSketchConstraint =
  | null
  | { kind: "horizontal" | "vertical" | "clear" }
  | {
      kind: "equal_length" | "perpendicular" | "parallel";
      firstLineId: string | null;
    }
  | { kind: "coincident"; firstPointId: string | null }
  // Mirror: first pick captures the axis line, every subsequent
  // pick (line or circle) mirrors that entity across the axis.
  // Stays armed across mirrors so the user can mirror a batch.
  | { kind: "mirror"; axisLineId: string | null };
