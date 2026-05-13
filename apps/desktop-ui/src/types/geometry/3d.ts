import type {
  ExtrudeMode,
  SketchProfilePoint,
  Shape2D,
  PlaneFrame,
} from "@/types";

export interface BoxFeatureParameters {
  width: number;
  height: number;
  depth: number;
}

export interface CylinderFeatureParameters {
  radius: number;
  height: number;
}

export interface ExtrudeFeatureParameters {
  sketch_feature_id: string;
  profile_id: string;
  profile_ids: string[];
  plane_id: string;
  plane_frame: PlaneFrame | null;
  profile_kind: Shape2D;
  start_x: number;
  start_y: number;
  width: number;
  height: number;
  radius: number;
  profile_points: SketchProfilePoint[];
  inner_loops: SketchProfilePoint[][];
  additional_profile_points: SketchProfilePoint[][];
  additional_inner_loops: SketchProfilePoint[][][];
  depth: number;
  mode: ExtrudeMode;
  target_body_id: string | null;
}
