import type {
  ExtrudeMode,
  ExtrudeOperation,
  ExtrudeExtentMode,
  ExtrudeSideParameters,
  ExtrudeThinParameters,
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
  open_entity_ids: string[];
  plane_id: string;
  plane_frame: PlaneFrame | null;
  profile_kind: Shape2D | "open_chain";
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
  extent_mode: ExtrudeExtentMode;
  side1: ExtrudeSideParameters;
  side2: ExtrudeSideParameters | null;
  thin: ExtrudeThinParameters;
  mode: ExtrudeMode;
  operation: ExtrudeOperation;
  intersect_result: "replace_target" | "new_body";
  target_body_id: string | null;
}

export interface LoftSectionParameters {
  sketch_feature_id: string;
  profile_id: string;
  plane_id: string;
  plane_frame: PlaneFrame | null;
  profile_points: SketchProfilePoint[];
}

export interface LoftFeatureParameters {
  sections: LoftSectionParameters[];
  ruled: boolean;
}

export interface RevolveFeatureParameters {
  sketch_feature_id: string;
  profile_id: string;
  plane_id: string;
  plane_frame: PlaneFrame | null;
  profile_kind: Shape2D;
  profile_points: SketchProfilePoint[];
  inner_loops: SketchProfilePoint[][];
  axis_sketch_feature_id: string;
  axis_entity_id: string;
  axis_start_x: number;
  axis_start_y: number;
  axis_start_z: number;
  axis_end_x: number;
  axis_end_y: number;
  axis_end_z: number;
  angle_degrees: number;
}

export interface SweepFeatureParameters {
  path_segments?: Array<{
    entity_id: string;
    kind: "line" | "arc";
    start_x: number;
    start_y: number;
    start_z: number;
    end_x: number;
    end_y: number;
    end_z: number;
    center_x: number;
    center_y: number;
    center_z: number;
    mid_x: number;
    mid_y: number;
    mid_z: number;
    radius: number;
    ccw: boolean;
  }>;
  sketch_feature_id: string;
  profile_id: string;
  plane_id: string;
  plane_frame: PlaneFrame | null;
  profile_kind: Shape2D;
  profile_points: SketchProfilePoint[];
  inner_loops: SketchProfilePoint[][];
  path_sketch_feature_id: string;
  path_entity_id: string;
  path_start_x: number;
  path_start_y: number;
  path_start_z: number;
  path_end_x: number;
  path_end_y: number;
  path_end_z: number;
}
