# Implementing a New Sketch Tool (Shape)

This guide covers adding a new drawable sketch shape (line, rectangle, circle, polygon, arc, etc.) to PolySmith. It documents every file that must be touched and the code paths involved, including pitfalls discovered during implementation.

---

## Files to Touch (Checklist)

### C++ Core

| File | What to add |
|---|---|
| `native/cad-core/src/core/feature.h` | Entity struct (`SketchPolygon`, etc.) |
| `native/cad-core/src/core/sketch_feature.h` | `add_sketch_<tool>` declaration, auto-dimension creation |
| `native/cad-core/src/core/sketch_feature.cpp` | Implementation: geometry math, entity push, auto-dimension push, `refresh_sketch_derived_state` call, validation |
| `native/cad-core/src/core/document.h` | `DocumentManager::add_sketch_<tool>` declaration |
| `native/cad-core/src/core/document.cpp` | Wrapper: `require_document`, active-sketch validation, `push_undo/clear_redo`, call core op, `refresh_linked_extrudes`, `bump_geometry_revision` |
| `native/cad-core/src/app.cpp` | Command handler: `if (command.type == "add_sketch_<tool>")` |
| `native/cad-core/src/protocol/serialization.cpp` | **Serialize** (both feature params `to_payload` AND viewport primitive), **deserialize** (`sketch_parameters_from_payload`) |
| `native/cad-core/src/core/viewport.cpp` | Viewport primitive builder if the shape renders in 3D viewport |

### Protocol / IPC

| File | What to add |
|---|---|
| `protocol/schema/commands.schema.json` | `"add_sketch_<tool>"` in the command type enum |

### TypeScript Types

| File | What to add |
|---|---|
| `apps/desktop-ui/src/types/geometry/sketch.ts` | Entity entry interface (`SketchPolygonEntry`), add to `SketchFeatureParameters` |
| `apps/desktop-ui/src/types/ipc.ts` | Command interface, add to `CoreCommand` union |
| `apps/desktop-ui/src/types/viewport.ts` | Viewport primitive interface |
| `apps/desktop-ui/src/types/scene.ts` | Scene object interface |
| `apps/desktop-ui/src/types/index.ts` | Re-export new types |

### TypeScript IPC / Hooks

| File | What to add |
|---|---|
| `apps/desktop-ui/src/lib/ipcProtocol.ts` | `makeAddSketch<Tool>Command(...)` builder |
| `apps/desktop-ui/src/hooks/useCadCore.ts` | Import builder, add `addSketch<Tool>` async function to the returned hook object |
| `apps/desktop-ui/src/lib/schemas/ipcSchema.ts` | Zod validation for the new viewport primitive fields |

### UI — Viewport (three.js rendering + interaction)

| File | What to add |
|---|---|
| `apps/desktop-ui/src/utils/viewport.utils.ts` | `buildSketch<Tool>Object(...)` — three.js geometry generation |
| `apps/desktop-ui/src/layout/ViewportPanel.tsx` | Draft/click handling, preview rendering, dimension deletion scheduling |

### UI — Toolbar

| File | What to add |
|---|---|
| `apps/desktop-ui/src/layout/SketchToolbar.tsx` | Button/icon for the new tool |
| `apps/desktop-ui/src/layout/ToolBarIcons.tsx` | SVG icon component |
| `apps/desktop-ui/src/types/geometry/contraints.ts` | `SketchTool` union type extension |

---

## The Two Commit Paths

**This is the most important concept.** Every sketch shape can be committed through two different code paths in `ViewportPanel.tsx`:

### Path 1 - `commitDraftDimensionSession` (Enter / form-submit)

Called when the user presses **Enter** in a draft dimension input, or submits the dimension form. The `session` parameter carries `lockedFields` reflecting which fields the user typed into. **After commit, the line tool switches to `"select"` mode** (matching industry-standard CAD where Enter ends the active command).

### Path 2 - Snap handler in `handlePointerUp` (click-based commits)

Called on the **second click** of a click-click sequence (or third click for 3-point modes). The `draftDimensionSessionRef.current` carries the locked-fields state at that moment. **Click commits continue chaining** by default (the line's end becomes the next start).

**Every new tool MUST handle BOTH paths.** If you only add code to one path, the tool will work in one interaction mode but silently fail in the other.

### Double-click to break chain

Industry-standard CAD uses double-click at the last endpoint to end the chain while staying in the line tool — the next click starts a fresh independent line. Implemented via:

- `chainBreakRequestedRef` in `handlePointerDown`: tracks click timing (300ms) and position (6px). Two clicks at the same location set the flag.
- Zero-length guard in pointer-up: if committed start and end are the same point (<0.01 units), the draft is cleared without calling `addSketchLine`.
- When either mechanism fires, `lineDraftStartRef` is cleared and a fresh draft starts on the next click.

### Path 2 sub-branches

Inside `handlePointerUp`, there are tool-specific branches:
- Arc
- Rectangle (with 3-point vs corner-corner/center-point sub-branches)
- Circle (with 3-point vs center-radius/2-point sub-branches)
- Polygon
- **Line (the fallthrough)** - if none of the above match, the line tool code runs

---

## Dimension Deletion - Fusion 360 Behavior

PolySmith implements Fusion 360-style on-demand dimensions:

- **Drag-only (no typing):** the auto-dimension is deleted after commit
- **Typed value during preview:** the dimension is preserved

### How it works

1. C++ core creates an auto-dimension on every non-construction shape
2. After the shape is committed, the TypeScript useEffect checks `lockedFields`
3. If no relevant field was locked, call `delete_sketch_dimension` IPC

### Adding dimension deletion for a new tool

1. **Determine the relevant draft field(s):** call `draftSessionFields(tool)` to see which `DraftDimensionField`s the tool uses (`"diameter"` for circle, `"radius"` for polygon, `"length"` for line, `"width"`+`"length"` for rectangle)

2. **Add the decision flag** to `pendingDimensionDeletionRef` in `ViewportPanel.tsx`

3. **Set the flag** in `scheduleDimensionDeletion()`:
   ```typescript
   shouldDeleteNewTool:
     tool === "newtool" && !session?.lockedFields.<relevantField>,
   ```

4. **Handle deletion** in the useEffect:
   ```typescript
   if (pending.shouldDeleteNewTool && sketch.<entities>.length > 0) {
     const entity = sketch.<entities>[sketch.<entities>.length - 1];
     if (entity && !entity.is_construction) {
       void deleteSketchDimensionRef.current(`dim-<prefix>-${entity.<id_field>}`);
     }
   }
   ```
   **Always use the last entity** (`array[array.length - 1]`), not a baseline count.

5. **Add `scheduleDimensionDeletion("newtool")`** to every commit path (both Path 1 and Path 2)

### Dimension ID Format

Auto-dimension IDs follow the pattern `dim-<prefix>-<entity_id>`:

| Tool | Prefix | Example |
|---|---|---|
| Line | `dim-line` | `dim-line-line-1` |
| Circle | `dim-circle` | `dim-circle-circle-1` |
| Polygon | `dim-polygon` | `dim-polygon-polygon-1` |

---

## Pitfalls and Lessons Learned

### 1. Stale `fromLineCount` Race Condition

**Problem:** The baseline entity count was captured from `sketchFeature` during the event handler, which reflects the *current* React render. When the user clicks rapidly (e.g., chained lines), React may not have re-rendered from the previous commit. The baseline count would be stale, causing the deletion to target the wrong entity.

**Solution:** Use the **last entity** in the array (`array[array.length - 1]`). Since entities are always appended, the last one is always the just-committed one - immune to React timing.

### 2. Null Session for Click-Based Commits

**Problem:** For click-based creation (no drag), `draftDimensionSessionRef.current` can be `null`. A `dSession?.tool === "tool"` guard would fail (`null?.tool` is `undefined`), blocking the deletion.

**Solution:** Don't guard on the session's tool field. Use `!dSession?.lockedFields.<field>` directly - with a null session, this evaluates to `!undefined` = `true`, correctly triggering deletion.

### 3. Circle `lockedFields.radius` Doesn't Exist

**Problem:** `draftSessionFields("circle")` returns `["diameter"]` only - there is no radius field in the UI. Checking `!session.lockedFields.radius` was always true (radius is never locked), but the actual relevant field is `diameter`.

**Solution:** Check the actual fields returned by `draftSessionFields(tool)`, not assumed fields. For circle, only check `lockedFields.diameter`.

### 4. Old Session Replaced Before Capture (Line Chaining)

**Problem:** In the line chaining code, `draftDimensionSessionRef.current` was replaced with a new session BEFORE reading `lockedFields`. The new session always has `lockedFields: {}`, so deletion never triggered.

**Solution:** Capture `const oldSession = draftDimensionSessionRef.current` before creating the replacement session. Pass it as `preCapturedSession` to `scheduleDimensionDeletion`.

### 5. Construction Lines Have No Auto-Dimensions

**Problem:** The C++ core only creates auto-dimensions for non-construction entities. The TS side would try to delete a dimension that never existed.

**Solution:** Check `entity.is_construction` before calling `delete_sketch_dimension`. The C++ side also silently ignores missing dimensions as a safety net.

### 6. Split Commit Paths

**Problem:** Shape commits can go through `commitDraftDimensionSession` (Enter) OR the snap handler in `handlePointerUp`. Every path must be updated independently, and it's easy to miss one.

**Solution:** Use the centralized `scheduleDimensionDeletion(tool, preCapturedSession?)` helper. Call it from every commit path. Do NOT inline the pending ref setup - that leads to drift between paths.

### 7. `polygons` Missing from Serialization

**Problem:** When adding polygon support, the `polygons` field was added to the C++ struct but forgotten in `serialization.cpp`. The TS side accessed `params.polygons.length` which threw `TypeError` because `polygons` was `undefined`.

**Solution:** Always update BOTH the serialization (`to_payload`) and deserialization (`from_payload`) in `serialization.cpp` when adding a new field. The TS side should use optional chaining (`params?.polygons?.length ?? 0`).
