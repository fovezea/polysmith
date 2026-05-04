import { z } from "zod";

const documentStateSchema = z.object({
  document_id: z.string(),
  name: z.string(),
  units: z.string(),
  revision: z.number(),
  selected_feature_id: z.string().nullable(),
  selected_reference_id: z.string().nullable(),
  selected_face_id: z.string().nullable(),
  // Multi-edge selection (Phase C). Older `.polysmith` saves used a
  // single `selected_edge_id`; the C++ loader migrates them to the
  // new array shape, so by the time the schema runs we always see an
  // array. Default `[]` keeps the schema lenient for tests that
  // hand-craft document payloads without selection state.
  selected_edge_ids: z.array(z.string()).default([]),
  // Multi-vertex selection: same shape and rationale as
  // `selected_edge_ids`. The C++ loader migrates legacy single-id
  // saves to the array form, so by the time we run we always see an
  // array. Default `[]` keeps the schema lenient.
  selected_vertex_ids: z.array(z.string()).default([]),
  active_sketch_plane_id: z.string().nullable(),
  active_sketch_face_id: z.string().nullable(),
  active_sketch_feature_id: z.string().nullable(),
  active_sketch_tool: z
    .enum(["select", "line", "rectangle", "circle", "dimension"])
    .nullable(),
  selected_sketch_point_id: z.string().nullable(),
  selected_sketch_entity_id: z.string().nullable(),
  selected_sketch_dimension_id: z.string().nullable(),
  selected_sketch_profile_id: z.string().nullable(),
  feature_history: z.array(
    z.object({
      feature_id: z.string(),
      kind: z.string(),
      name: z.string(),
      status: z.string(),
      suppressed: z.boolean().default(false),
      // Set by the core when this feature references upstream
      // geometry that no longer exists (e.g. its sketch plane was a
      // face that got fillet'd away). The timeline shows a yellow
      // warning button when true; the message is the tooltip.
      dependency_broken: z.boolean().default(false),
      dependency_warning: z.string().default(""),
      parameters_summary: z.string(),
      box_parameters: z
        .object({
          width: z.number(),
          height: z.number(),
          depth: z.number(),
        })
        .nullable(),
      cylinder_parameters: z
        .object({
          radius: z.number(),
          height: z.number(),
        })
        .nullable(),
      extrude_parameters: z
        .object({
          sketch_feature_id: z.string(),
          profile_id: z.string(),
          plane_id: z.string(),
          plane_frame: z
            .object({
              origin: z.object({ x: z.number(), y: z.number(), z: z.number() }),
              x_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
              y_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
              normal: z.object({ x: z.number(), y: z.number(), z: z.number() }),
            })
            .nullable(),
          profile_kind: z.enum(["rectangle", "circle", "polygon"]),
          start_x: z.number(),
          start_y: z.number(),
          width: z.number(),
          height: z.number(),
          radius: z.number(),
          profile_points: z.array(
            z.object({
              x: z.number(),
              y: z.number(),
            }),
          ),
          depth: z.number(),
          mode: z.enum(["new_body", "join", "cut"]).default("new_body"),
          target_body_id: z.string().nullable().default(null),
        })
        .nullable(),
      fillet_parameters: z
        .object({
          target_body_id: z.string(),
          edge_ids: z.array(z.string()),
          radius: z.number(),
        })
        .nullable()
        .default(null),
      chamfer_parameters: z
        .object({
          target_body_id: z.string(),
          edge_ids: z.array(z.string()),
          distance: z.number(),
        })
        .nullable()
        .default(null),
      sketch_parameters: z
        .object({
          plane_id: z.string(),
          plane_frame: z
            .object({
              origin: z.object({ x: z.number(), y: z.number(), z: z.number() }),
              x_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
              y_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
              normal: z.object({ x: z.number(), y: z.number(), z: z.number() }),
            })
            .nullable(),
          active_tool: z.enum([
            "select",
            "line",
            "rectangle",
            "circle",
            "dimension",
          ]),
          lines: z.array(
            z.object({
              line_id: z.string(),
              start_point_id: z.string(),
              end_point_id: z.string(),
              start_x: z.number(),
              start_y: z.number(),
              end_x: z.number(),
              end_y: z.number(),
              constraint: z.enum(["horizontal", "vertical"]).nullable(),
              // Reference-only construction lines render dashed and
              // are excluded from profile detection. Optional /
              // defaulted for back-compat with older saves.
              is_construction: z.boolean().default(false),
            }),
          ),
          // Midpoint anchors bind a sketch point (typically an
          // endpoint of some other line) to the midpoint of a host
          // line. The solver re-pulls the point on every edit so the
          // relation persists. Defaulted to empty for older saves.
          midpoint_anchors: z
            .array(
              z.object({
                anchor_id: z.string(),
                point_id: z.string(),
                line_id: z.string(),
              }),
            )
            .default([]),
          circles: z.array(
            z.object({
              circle_id: z.string(),
              center_x: z.number(),
              center_y: z.number(),
              radius: z.number(),
            }),
          ),
          points: z.array(
            z.object({
              point_id: z.string(),
              kind: z.enum(["endpoint", "center"]),
              x: z.number(),
              y: z.number(),
              is_fixed: z.boolean(),
            }),
          ),
          dimensions: z.array(
            z.object({
              dimension_id: z.string(),
              kind: z.enum(["line_length", "circle_radius", "angle"]),
              entity_id: z.string(),
              // Empty string for unary dims; second line id for angle.
              secondary_entity_id: z.string().default(""),
              value: z.number(),
            }),
          ),
          line_relations: z.array(
            z.object({
              relation_id: z.string(),
              kind: z.enum([
                "equal_length",
                "perpendicular",
                "parallel",
                "tangent_line_circle",
              ]),
              first_line_id: z.string(),
              second_line_id: z.string(),
            }),
          ),
          profiles: z.array(
            z.object({
              profile_id: z.string(),
              kind: z.enum(["polygon", "circle"]),
              point_ids: z.array(z.string()),
              line_ids: z.array(z.string()),
              points: z.array(
                z.object({
                  x: z.number(),
                  y: z.number(),
                }),
              ),
              source_circle_id: z.string().nullable(),
              center_x: z.number(),
              center_y: z.number(),
              radius: z.number(),
            }),
          ),
          // Optional pending mirror tool state. Present only while
          // the user has the mirror tool open. The UI uses the
          // presence of this object to mount the floating panel.
          pending_mirror: z
            .object({
              axis_line_id: z.string().nullable(),
              object_ids: z.array(z.string()),
              generated_lines: z.array(
                z.object({
                  line_id: z.string(),
                  start_point_id: z.string(),
                  end_point_id: z.string(),
                  start_x: z.number(),
                  start_y: z.number(),
                  end_x: z.number(),
                  end_y: z.number(),
                  is_construction: z.boolean(),
                }),
              ),
              generated_circles: z.array(
                z.object({
                  circle_id: z.string(),
                  center_x: z.number(),
                  center_y: z.number(),
                  radius: z.number(),
                }),
              ),
            })
            .nullable()
            .default(null),
        })
        .nullable(),
    }),
  ),
});

const sessionStateSchema = z.object({
  document_count: z.number(),
  has_active_document: z.boolean(),
  active_document_id: z.string().nullable(),
  can_undo: z.boolean(),
  can_redo: z.boolean(),
});

const viewportStateSchema = z.object({
  has_active_document: z.boolean(),
  boxes: z.array(
    z.object({
      primitive_id: z.string(),
      label: z.string(),
      width: z.number(),
      height: z.number(),
      depth: z.number(),
      x_offset: z.number(),
      center: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      is_selected: z.boolean(),
    }),
  ),
  cylinders: z.array(
    z.object({
      primitive_id: z.string(),
      label: z.string(),
      radius: z.number(),
      height: z.number(),
      x_offset: z.number(),
      center: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      is_selected: z.boolean(),
    }),
  ),
  polygon_extrudes: z.array(
    z.object({
      primitive_id: z.string(),
      label: z.string(),
      plane_id: z.string(),
      plane_frame: z
        .object({
          origin: z.object({ x: z.number(), y: z.number(), z: z.number() }),
          x_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
          y_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
          normal: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        })
        .nullable(),
      profile_points: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
        }),
      ),
      depth: z.number(),
      is_selected: z.boolean(),
    }),
  ),
  solid_faces: z.array(
    z.object({
      face_id: z.string(),
      owner_id: z.string(),
      owner_kind: z.string(),
      label: z.string(),
      sketchability: z.string(),
      center: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      normal: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      plane_frame: z.object({
        origin: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        x_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        y_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        normal: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      }),
      size: z.object({
        width: z.number(),
        height: z.number(),
        radius: z.number(),
      }),
      // Body-derived faces carry per-face triangulation; legacy
      // analytical faces leave these empty and rely on (size, plane_frame)
      // for the UI's pick mesh.
      triangle_positions: z.array(z.number()).default([]),
      triangle_indices: z.array(z.number()).default([]),
      is_selected: z.boolean(),
    }),
  ),
  reference_planes: z.array(
    z.object({
      reference_id: z.string(),
      label: z.string(),
      orientation: z.enum(["xy", "yz", "xz"]),
      center: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      size: z.object({
        width: z.number(),
        height: z.number(),
      }),
      is_selected: z.boolean(),
      is_active_sketch_plane: z.boolean(),
    }),
  ),
  reference_axes: z.array(
    z.object({
      reference_id: z.string(),
      label: z.string(),
      axis: z.enum(["x", "y", "z"]),
      start: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      end: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
    }),
  ),
  sketch_lines: z.array(
    z.object({
      line_id: z.string(),
      start_point_id: z.string(),
      end_point_id: z.string(),
      is_construction: z.boolean().default(false),
      plane_id: z.string(),
      start: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      end: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      is_selected: z.boolean(),
      constraint: z.enum(["horizontal", "vertical"]).nullable(),
      // True for transient lines generated by the in-progress
      // Mirror tool. Rendered as a dashed translucent preview;
      // not selectable. Defaulted for back-compat with the few
      // call sites that may not yet emit it.
      is_preview: z.boolean().default(false),
    }),
  ),
  sketch_circles: z.array(
    z.object({
      circle_id: z.string(),
      plane_id: z.string(),
      center: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      radius: z.number(),
      is_selected: z.boolean(),
      // See `sketch_lines.is_preview`.
      is_preview: z.boolean().default(false),
    }),
  ),
  sketch_points: z.array(
    z.object({
      point_id: z.string(),
      plane_id: z.string(),
      kind: z.enum(["endpoint", "center"]),
      position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      is_fixed: z.boolean(),
      is_selected: z.boolean(),
    }),
  ),
  sketch_dimensions: z.array(
    z.object({
      dimension_id: z.string(),
      plane_id: z.string(),
      kind: z.enum(["line_length", "circle_radius", "angle"]),
      entity_id: z.string(),
      label: z.string(),
      is_selected: z.boolean(),
      anchor_start: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      anchor_end: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      dimension_start: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      dimension_end: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
      label_position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
    }),
  ),
  sketch_constraints: z.array(
    z.object({
      constraint_id: z.string(),
      plane_id: z.string(),
      kind: z.enum([
        "horizontal",
        "vertical",
        "equal_length",
        "perpendicular",
        "parallel",
        "fixed",
        "midpoint",
        "on_line",
        "tangent_line_circle",
      ]),
      entity_id: z.string(),
      related_entity_id: z.string().nullable(),
      label: z.string(),
      is_selected: z.boolean(),
      position: z.object({
        x: z.number(),
        y: z.number(),
        z: z.number(),
      }),
    }),
  ),
  sketch_profiles: z.array(
    z.object({
      profile_id: z.string(),
      plane_id: z.string(),
      plane_frame: z
        .object({
          origin: z.object({ x: z.number(), y: z.number(), z: z.number() }),
          x_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
          y_axis: z.object({ x: z.number(), y: z.number(), z: z.number() }),
          normal: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        })
        .nullable(),
      profile_kind: z.enum(["polygon", "circle"]),
      profile_points: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
        }),
      ),
      start_x: z.number(),
      start_y: z.number(),
      width: z.number(),
      height: z.number(),
      radius: z.number(),
      is_selected: z.boolean(),
    }),
  ),
  meshes: z
    .array(
      z.object({
        primitive_id: z.string(),
        positions: z.array(z.number()),
        normals: z.array(z.number()),
        indices: z.array(z.number()),
        is_selected: z.boolean(),
      }),
    )
    .default([]),
  cut_previews: z
    .array(
      z.object({
        id: z.string(),
        positions: z.array(z.number()),
        normals: z.array(z.number()),
        indices: z.array(z.number()),
      }),
    )
    .default([]),
  bodies: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
      }),
    )
    .default([]),
  edges: z
    .array(
      z.object({
        id: z.string(),
        owner_body_id: z.string(),
        kind: z.string(),
        points: z.array(z.number()),
        // Default 0 so older snapshots without the field still validate;
        // new core builds always populate it.
        length: z.number().default(0),
        is_selected: z.boolean(),
      }),
    )
    .default([]),
  vertices: z
    .array(
      z.object({
        id: z.string(),
        owner_body_id: z.string(),
        position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        is_selected: z.boolean(),
      }),
    )
    .default([]),
  scene_width: z.number(),
  scene_height: z.number(),
  scene_depth: z.number(),
  scene_bounds: z.object({
    center: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    }),
    size: z.object({
      x: z.number(),
      y: z.number(),
      z: z.number(),
    }),
    max_dimension: z.number(),
  }),
});

const helloEventSchema = z.object({
  type: z.literal("hello"),
  payload: z.object({
    service: z.string(),
    version: z.string(),
  }),
});

const pongEventSchema = z.object({
  id: z.string(),
  type: z.literal("pong"),
  payload: z.object({
    version: z.string(),
  }),
});

const documentCreatedEventSchema = z.object({
  id: z.string(),
  type: z.literal("document_created"),
  payload: documentStateSchema,
});

const documentStateEventSchema = z.object({
  id: z.string(),
  type: z.literal("document_state"),
  payload: documentStateSchema,
});

const sessionStateEventSchema = z.object({
  id: z.string(),
  type: z.literal("session_state"),
  payload: sessionStateSchema,
});

const viewportStateEventSchema = z.object({
  id: z.string(),
  type: z.literal("viewport_state"),
  payload: viewportStateSchema,
});

const documentExportedEventSchema = z.object({
  id: z.string(),
  type: z.literal("document_exported"),
  payload: z.object({
    file_path: z.string(),
    format: z.literal("step"),
    exported_feature_count: z.number(),
  }),
});

const errorEventSchema = z.object({
  id: z.string().optional(),
  type: z.literal("error"),
  payload: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const coreMessageSchema = z.union([
  helloEventSchema,
  pongEventSchema,
  documentCreatedEventSchema,
  documentStateEventSchema,
  sessionStateEventSchema,
  viewportStateEventSchema,
  documentExportedEventSchema,
  errorEventSchema,
]);
