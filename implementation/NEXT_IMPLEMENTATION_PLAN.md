# Next Implementation Plan — PolySmith

> To continue from home: open this file in DeepSeek TUI and say "implement the plan in NEXT_IMPLEMENTATION_PLAN.md".

## What Was Shipped (PARAMETRIC_PARAMETERS_PLAN.md — All Phases Complete)

The full parametric parameters + dimension formulas pipeline is in production:

### C++ Core
- `parameter.h`: `ParameterEntry` struct (name, expression, resolved_value, has_error, error_message)
- `formula_eval.h/.cpp`: recursive-descent expression evaluator (+, -, *, /, parentheses, unary minus, param refs, cycle detection)
- `feature.h`: `expression` field on `SketchDimension`. `DocumentState.parameters` vector.
- `document.h/.cpp`: `add_parameter`, `update_parameter`, `delete_parameter` — CRUD with undo/redo, `reify_parameters`, `reify_dimension_expressions`, `refresh_history_dependencies`, `bump_geometry_revision`
- `sketch_feature.h/.cpp`: `update_sketch_dimension` accepts optional `expression`. `reify_dimension_expressions()` re-evaluates dimension expressions.
- `app.cpp`: registered `add_parameter`, `update_parameter`, `delete_parameter`. Extended `update_sketch_dimension` to accept string expressions.
- `serialization.cpp`: expression serialization + parameters array (backward compat to `[]`).

### Protocol & TypeScript
- `protocol/schema/commands.schema.json`: `add_parameter`, `update_parameter`, `delete_parameter`
- `types/ipc.ts`: `ParameterEntry`, payload types, extended `UpdateSketchDimensionCommand.value: number | string`
- `types/geometry/sketch.ts`: `expression` on `SketchDimensionEntry`
- `lib/ipcProtocol.ts`: parameter command builders + extended dimension builder
- `hooks/useCadCore.ts`: `addParameter`, `updateParameter`, `deleteParameter`, updated `updateSketchDimension`
- `lib/schemas/ipcSchema.ts`: expression + parameters schema defaults

### UI
- `layout/ParametersPanel.tsx`: floating panel with Name/Expression/Value table, inline editing, delete, error display
- `layout/header/AppHeader.tsx`: `f(x)` button toggles panel
- `App.tsx`: `parametersPanelOpen` state
- `i18n/en.json`: `parameters.*` keys
- `ViewportPanel.tsx`: dimension editor accepts formula text input

### What the fusion-style plan shipped (IMPLEMENTATION_PLAN.md)
- Auto-dimensions created by C++ on every shape commit
- TypeScript checks `draftDimensionSession.lockedFields` — if user didn't type, calls `delete_sketch_dimension`
- Only typed dimensions survive → no sketch bloat

---

## Priority 1 — Item A: Metric / Inch Unit Toggle

### Goal

The CAD core always works in millimeters. The UI translates all dimension display and input based on a user setting. When set to "inch", dimensions are displayed in inches and user input is accepted in inches, then converted to mm before reaching the core. Round-trip is lossless because the core never changes its unit.

### Architecture Decision

**Unit conversion lives in the TypeScript layer only.** The C++ core has no concept of display units — `SketchDimension.value` is always mm, `ParameterEntry.resolved_value` is always mm, `viewport_state` coordinates are always mm. The UI is the sole translator.

This keeps the boundary clean:
- C++ core: single source of truth in mm
- IPC: carries mm values only
- React: converts mm ↔ inch at the presentation boundary

### Where Units Flow

| Surface | Current state | Change |
|---|---|---|
| `DocumentState.units` | Always `"mm"` | Becomes user setting: `"mm"` or `"in"` |
| Dimension display (viewport sprites) | Raw mm value | Convert to display unit before rendering |
| Dimension editor input | Raw mm value | Accept in display unit, convert to mm before IPC |
| Draft dimension session values | Raw mm | Accept in display unit, convert to mm |
| Parameters panel Value column | Raw mm | Convert to display unit |
| Parameters panel Expression input | Already formula — no change needed | — |
| Sketch constraint labels | Raw mm/rad | Convert to display unit |
| Grid spacing | Raw mm | Convert to display unit |

### 3.1 Settings Infrastructure

**New file:** `apps/desktop-ui/src/state/settingsStore.ts`

```ts
// Zustand or Jotai store. Persisted to localStorage.
interface UserSettings {
  displayUnits: "mm" | "in";
}
```

Default: `"mm"`. Persisted across app restarts. A simple toggle in the app header or a settings panel.

### 3.2 Conversion Utilities

**New file:** `apps/desktop-ui/src/utils/units.ts`

```ts
const MM_PER_INCH = 25.4;

export function mmToDisplay(mm: number, units: "mm" | "in"): number {
  return units === "in" ? mm / MM_PER_INCH : mm;
}

export function displayToMm(value: number, units: "mm" | "in"): number {
  return units === "in" ? value * MM_PER_INCH : value;
}

export function formatDimension(valueMm: number, units: "mm" | "in"): string {
  const display = mmToDisplay(valueMm, units);
  return units === "in"
    ? display.toFixed(3)  // thousandths of an inch
    : display.toFixed(2); // hundredths of a mm
}

export function parseDimensionInput(input: string, units: "mm" | "in"): number | null {
  const parsed = parseFloat(input);
  if (isNaN(parsed)) return null;
  return displayToMm(parsed, units);
}
```

### 3.3 Integration Points (ViewportPanel.tsx)

Every spot that reads or writes a dimension value must go through the conversion layer:

| Code path | Current | Change |
|---|---|---|
| Dimension sprite label text | `dim.value.toFixed(2)` | `formatDimension(dim.value, settings.displayUnits)` |
| Dimension editor initial value | `dim.value.toString()` | `mmToDisplay(dim.value, settings.displayUnits).toString()` |
| Dimension editor submit | `parseFloat(rawValue)` → IPC | `parseDimensionInput(rawValue, settings.displayUnits)` → IPC |
| Draft dimension field values | Raw mm | Convert display→mm on each keystroke preview, display←mm on render |
| Parameters panel Value cell | `param.resolved_value.toFixed(2)` | `formatDimension(param.resolved_value, settings.displayUnits)` |
| Angle dimensions | Always degrees in display | `radToDeg(radians)` for display, `degToRad(degrees)` for input |

### 3.4 DocumentState.units Propagation

- `DocumentState.units` currently hardcoded to `"mm"` in C++ at document creation
- Change: make it settable from TypeScript via a `set_document_units` IPC command, or keep it set once at document creation based on the current user preference
- Simpler v1 approach: `DocumentState.units` reflects the user setting at document creation time and is persisted in `.polysmith` files. When the user changes the display unit toggle mid-session, all open documents update their display. The stored `units` field is informational.

### 3.5 Settings UI

- Add a small gear icon or "mm / in" toggle in `AppHeader.tsx` (right side, near the Parameters `f(x)` button)
- On click, toggle between `"mm"` and `"in"`
- Re-renders all dimension displays immediately (React state → prop drilling or store subscription)

### Files Changed (Item A)

| File | Change |
|---|---|
| `apps/desktop-ui/src/utils/units.ts` | **NEW** — conversion utilities |
| `apps/desktop-ui/src/state/settingsStore.ts` | **NEW** — user settings store |
| `apps/desktop-ui/src/layout/ViewportPanel.tsx` | Wire all dimension display/edit through `formatDimension` / `parseDimensionInput` |
| `apps/desktop-ui/src/layout/ParametersPanel.tsx` | Wire Value column through conversion |
| `apps/desktop-ui/src/layout/header/AppHeader.tsx` | Add mm/in toggle button |
| `apps/desktop-ui/src/i18n/en.json` | Add `settings.units` strings |

---

## Priority 1 — Item B: Manual Sketch Dimension Tool (Completion)

### Goal

The Dimension tool already exists in the sketch toolbar (icon, hotkey `D`, floating info panel, two-click flows for angle/distance between entities, dimension label dragging). What's missing is the ability to **create a dimension on a single entity that doesn't already have one**.

When the user clicks a line or circle whose auto-dimension was deleted (by the fusion-style on-demand system), the tool currently just selects the entity. It needs to **create** the missing dimension instead.

### Current State

**Already shipped:**
- ✅ Dimension tool entry in `SketchToolbar.tsx` (line 51)
- ✅ `DimensionIcon` in `ToolBarIcons.tsx`
- ✅ Hotkey handler at line 7005 → `setSketchTool("dimension")`
- ✅ Floating info panel at line 7725 ("Click a line or circle...")
- ✅ `"dimension"` in `SketchTool` union type
- ✅ `active_sketch_tool: "dimension"` accepted by C++ core
- ✅ Two-click flow for angle (`addSketchAngleDimension` at line 5824)
- ✅ Two-click flow for distance (`addSketchDistanceDimension` at line 5831)
- ✅ Two-click flow for circle-pair distance (line 5793)
- ✅ `dimensionToolFirstLineRef` / `dimensionToolFirstLine` state for staging first pick
- ✅ `pendingDimensionPlacementRef` pattern for auto-opening the dimension editor
- ✅ Dimension label dragging on pointer down (lines 4689-4723)
- ✅ Schema gap: `add_sketch_distance_dimension` and `add_sketch_angle_dimension` exist in C++ + TS but are **missing from `protocol/schema/commands.schema.json`**

**What's missing (the gap this plan fills):**

When the Dimension tool clicks a **single** entity:
- **Line click** (line 5844-5852): checks if `dim-line-{id}` exists. If not, just selects the entity → should instead **create** a `line_length` dimension
- **Circle click** (line 5803-5812): checks if `dim-circle-{id}` exists. If not, just selects the entity → should instead **create** a `circle_radius` dimension
- **Polygon click**: no handling at all → should create a `polygon_radius` dimension

There are no IPC commands `add_sketch_line_length_dimension`, `add_sketch_circle_radius_dimension`, or `add_sketch_polygon_radius_dimension` — these need to be added end-to-end.

### 4.1 C++ Changes

#### 4.1.1 Schema Fix

**`protocol/schema/commands.schema.json`:**
Add `"add_sketch_angle_dimension"`, `"add_sketch_distance_dimension"`, `"add_sketch_line_length_dimension"`, `"add_sketch_circle_radius_dimension"`, and `"add_sketch_polygon_radius_dimension"` to the command enum.

#### 4.1.2 Single-Entity Dimension (Line Length)

**New IPC command:** `add_sketch_line_length_dimension`

**`document.h`:**
```cpp
DocumentState add_sketch_line_length_dimension(const std::string& line_id);
```

**`document.cpp`:**
- Find the active sketch feature
- Call `polysmith::core::add_sketch_line_length_dimension(feature, line_id)`
- Push undo, refresh, select the new dimension

**`sketch_feature.h/.cpp`:**
```cpp
void add_sketch_line_length_dimension(FeatureEntry& feature,
                                      const std::string& line_id);
```

Implementation reuses the existing auto-dimension creation logic from `add_sketch_line`:
1. Validate the line exists and is not construction
2. Compute current length
3. Check for duplicate `line_length` dimension on this line (skip if exists)
4. Create `SketchDimension{ id: "dim-line-" + line_id, kind: "line_length", entity_id: line_id, value: current_length }`
5. Append to `parameters.dimensions`

#### 4.1.3 Single-Entity Dimension (Circle Radius)

**New IPC command:** `add_sketch_circle_radius_dimension`

Same pattern as line length, using id `"dim-circle-" + circle_id`, kind `"circle_radius"`.

#### 4.1.4 Single-Entity Dimension (Polygon Radius)

**New IPC command:** `add_sketch_polygon_radius_dimension`

Same pattern with id `"dim-polygon-" + polygon_id`, kind `"polygon_radius"`.

### 4.2 TypeScript Changes

#### 4.2.1 Types (`types/ipc.ts`)

Add command interfaces:
```ts
export interface AddSketchLineLengthDimensionCommand {
  id: string;
  type: "add_sketch_line_length_dimension";
  payload: { line_id: string };
}
export interface AddSketchCircleRadiusDimensionCommand {
  id: string;
  type: "add_sketch_circle_radius_dimension";
  payload: { circle_id: string };
}
export interface AddSketchPolygonRadiusDimensionCommand {
  id: string;
  type: "add_sketch_polygon_radius_dimension";
  payload: { polygon_id: string };
}
```

Add to `CadCoreCommand` union.

#### 4.2.2 Protocol Builders (`lib/ipcProtocol.ts`)

```ts
export function makeAddSketchLineLengthDimensionCommand(lineId: string) { ... }
export function makeAddSketchCircleRadiusDimensionCommand(circleId: string) { ... }
export function makeAddSketchPolygonRadiusDimensionCommand(polygonId: string) { ... }
```

#### 4.2.3 Hooks (`hooks/useCadCore.ts`)

```ts
addSketchLineLengthDimension: async (lineId: string) => { ... }
addSketchCircleRadiusDimension: async (circleId: string) => { ... }
addSketchPolygonRadiusDimension: async (polygonId: string) => { ... }
```

(The existing `addSketchDistanceDimension` and `addSketchAngleDimension` hooks are already there.)

### 4.3 ViewportPanel.tsx Wiring Changes

The existing Dimension tool click handler at lines 5839-5853 (single line) needs one change:

**Current (lines 5844-5852):**
```ts
const dimensionId = `dim-line-${hit.id}`;
const dimensionExists =
  sketchLinesRef.current?.dimensions.some(
    (dim) => dim.dimension_id === dimensionId,
  ) ?? false;
if (dimensionExists) {
  handleDimensionClick(dimensionId);
} else {
  void selectSketchEntityRef.current(hit.id, false);
}
```

**Change to:**
```ts
const dimensionId = `dim-line-${hit.id}`;
const dimensionExists =
  sketchLinesRef.current?.dimensions.some(
    (dim) => dim.dimension_id === dimensionId,
  ) ?? false;
if (dimensionExists) {
  handleDimensionClick(dimensionId);
} else {
  // Create the missing dimension and open the editor
  pendingDimensionPlacementRef.current = true;
  void addSketchLineLengthDimensionRef.current(hit.id)
    .catch(() => { pendingDimensionPlacementRef.current = false; });
}
```

Same change for the circle path (lines 5803-5812):
```ts
if (dimensionExists) {
  handleDimensionClick(dimensionId);
} else {
  pendingDimensionPlacementRef.current = true;
  void addSketchCircleRadiusDimensionRef.current(hit.id)
    .catch(() => { pendingDimensionPlacementRef.current = false; });
}
```

And add polygon handling (currently not handled by the Dimension tool at all):
```ts
if (hit.entityKind === "polygon") {
  const dimensionId = `dim-polygon-${hit.id}`;
  const dimensionExists = /* check */;
  if (dimensionExists) {
    handleDimensionClick(dimensionId);
  } else {
    pendingDimensionPlacementRef.current = true;
    void addSketchPolygonRadiusDimensionRef.current(hit.id)
      .catch(() => { pendingDimensionPlacementRef.current = false; });
  }
  return;
}
```

### 4.4 Viewport Dimension Rendering

No changes needed — the viewport already renders all `SketchDimension` entries via `ViewportSketchDimensionPrimitive`. Newly created dimensions appear immediately.

### Files Changed (Item B)

| File | Change |
|---|---|
| `protocol/schema/commands.schema.json` | Add 5 commands to the enum: `add_sketch_angle_dimension`, `add_sketch_distance_dimension`, `add_sketch_line_length_dimension`, `add_sketch_circle_radius_dimension`, `add_sketch_polygon_radius_dimension` |
| `native/cad-core/src/core/document.h` | Declare `add_sketch_line_length_dimension`, `add_sketch_circle_radius_dimension`, `add_sketch_polygon_radius_dimension` |
| `native/cad-core/src/core/document.cpp` | Implement the three new methods (reuse existing auto-dimension patterns) |
| `native/cad-core/src/core/sketch_feature.h` | Declare core helpers |
| `native/cad-core/src/core/sketch_feature.cpp` | Implement helpers (extract auto-dimension creation into reusable functions) |
| `native/cad-core/src/app.cpp` | Register 5 command handlers (3 new + 2 schema-gap fixes) |
| `apps/desktop-ui/src/types/ipc.ts` | Add 3 command interfaces + add all 5 to `CadCoreCommand` union |
| `apps/desktop-ui/src/lib/ipcProtocol.ts` | Add 3 command builders |
| `apps/desktop-ui/src/hooks/useCadCore.ts` | Add 3 hooks + refs |
| `apps/desktop-ui/src/layout/ViewportPanel.tsx` | Replace `selectSketchEntity` with dimension creation in the click handler + add polygon support |
| `docs/architecture/ai-cad-command-language.md` | Document new dimension commands |
| `docs/architecture/ipc-protocol.md` | Document new dimension commands |

### Transaction Flow (Line Click Example)

```
User clicks a line in Dimension tool
  → pendingDimensionPlacementRef = true
  → IPC: add_sketch_line_length_dimension(line_id)
    → C++: validate line, check dup, compute length, push SketchDimension
    → C++: refresh_sketch_derived_state + bump_geometry_revision
    → C++: return document_state (with new dimension)
  → TS: receive document_state with new dimension
    → pendingDimensionPlacementRef fires useEffect (line 3717-3726)
    → beginDimensionPlacement(selectedSketchDimension)
    → dimension editor opens with the line length value
  → User types a new value → Enter
    → IPC: update_sketch_dimension(dim_id, new_value)
    → Line resizes (constraint behavior)
```

```
[User activates Dimension tool]
         |
         v
  Waiting for first pick
         |
    ┌────┴────┐
    v         v
Single entity   Two entities needed
(line/circle)   (first pick stored)
    |                |
    v                v
Place dimension   Waiting for 2nd pick
(auto-create)          |
                  ┌────┴────┐
                  v         v
              Valid pair   Invalid pair
                  |            |
                  v            v
           Place dimension   Reset / flash
```

### 4.3 C++ Changes

#### 4.3.1 Schema Fix

**`protocol/schema/commands.schema.json`:**
Add `"add_sketch_angle_dimension"` and `"add_sketch_distance_dimension"` to the command enum.

#### 4.3.2 Single-Entity Dimension (Line Length)

Currently, a `line_length` dimension is only created automatically at line-commit time (in `add_sketch_line`). We need an explicit IPC command to add one to an existing line.

**New IPC command:** `add_sketch_line_length_dimension`

**`document.h`:**
```cpp
DocumentState add_sketch_line_length_dimension(const std::string& line_id);
```

**`document.cpp`:**
- Find the active sketch feature
- Call `polysmith::core::add_sketch_line_length_dimension(feature, line_id)`
- Push undo, refresh, select the new dimension

**`sketch_feature.h/.cpp`:**
```cpp
void add_sketch_line_length_dimension(FeatureEntry& feature,
                                      const std::string& line_id);
```

Implementation:
1. Validate the line exists and is not construction
2. Compute current length
3. Check for duplicate `line_length` dimension on this line (skip if exists)
4. Create `SketchDimension{ id: "dim-line-" + line_id, kind: "line_length", entity_id: line_id, value: current_length }`
5. Append to `parameters.dimensions`

Actually — the auto-dimension creation in `add_sketch_line` already does exactly this. The id format `"dim-line-" + line.id` is stable. We can reuse this by having the "add" command check: if a `line_length` dimension already exists for this line, select it. If not, create it.

#### 4.3.3 Single-Entity Dimension (Circle Radius)

Similarly, circle radius dimensions are auto-created. Need an explicit IPC command.

**New IPC command:** `add_sketch_circle_radius_dimension`

Same pattern as line length: check existence, create if missing with id `"dim-circle-" + circle_id`, kind `"circle_radius"`.

#### 4.3.4 Single-Entity Dimension (Polygon Radius)

**New IPC command:** `add_sketch_polygon_radius_dimension`

Same pattern with id `"dim-polygon-" + polygon_id`, kind `"polygon_radius"`.

### 4.4 TypeScript Changes

#### 4.4.1 Types (`types/ipc.ts`)

Add command interfaces:
```ts
export interface AddSketchLineLengthDimensionCommand {
  id: string;
  type: "add_sketch_line_length_dimension";
  payload: { line_id: string };
}
export interface AddSketchCircleRadiusDimensionCommand {
  id: string;
  type: "add_sketch_circle_radius_dimension";
  payload: { circle_id: string };
}
export interface AddSketchPolygonRadiusDimensionCommand {
  id: string;
  type: "add_sketch_polygon_radius_dimension";
  payload: { polygon_id: string };
}
```

Add to `CadCoreCommand` union.

#### 4.4.2 Protocol Builders (`lib/ipcProtocol.ts`)

```ts
export function makeAddSketchLineLengthDimensionCommand(lineId: string) { ... }
export function makeAddSketchCircleRadiusDimensionCommand(circleId: string) { ... }
export function makeAddSketchPolygonRadiusDimensionCommand(polygonId: string) { ... }
```

#### 4.4.3 Hooks (`hooks/useCadCore.ts`)

```ts
addSketchLineLengthDimension: async (lineId: string) => { ... }
addSketchCircleRadiusDimension: async (circleId: string) => { ... }
addSketchPolygonRadiusDimension: async (polygonId: string) => { ... }
```

(The existing `addSketchDistanceDimension` and `addSketchAngleDimension` hooks are already there.)

### 4.5 UI — Dimension Tool in Sketch Toolbar

#### 4.5.1 Tool Registration

**`apps/desktop-ui/src/layout/header/ToolBarIcons.tsx`:**
- Add a "Dimension" icon (ruler/caliper symbol) to the sketch toolbar section
- Hotkey: `D` (common CAD convention)

**`apps/desktop-ui/src/types/geometry/sketch.ts`:**
- Add `"dimension"` to `SketchTool` union type

**Active sketch tool state:**
- C++ `active_sketch_tool` already supports `"dimension"` in the enum (visible in `ai-cad-command-language.md`)
- Wire it through `set_sketch_tool` IPC

#### 4.5.2 ViewportPanel.tsx — Dimension Pick Logic

When `activeSketchTool === "dimension"`:

**PointerDown on a sketch entity:**
1. **Single entity hit:**
   - `hit.kind === "sketch_line"` → call `addSketchLineLengthDimension(lineId)` — creates/selects the dimension
   - `hit.kind === "sketch_circle"` → call `addSketchCircleRadiusDimension(circleId)`
   - `hit.kind === "sketch_polygon"` → call `addSketchPolygonRadiusDimension(polygonId)`
   - After placement: auto-open the dimension editor so user can type a value

2. **Two-entity flow:**
   - First click stores the entity id (visual: highlight it)
   - Second click on another entity:
     - Two lines sharing an endpoint → `addSketchAngleDimension(lineA, lineB)`
     - Two lines NOT sharing endpoint → `addSketchDistanceDimension(lineA, lineB)`
     - Line + circle → `addSketchDistanceDimension(lineId, circleId)`
     - Two circles → `addSketchDistanceDimension(circleA, circleB)`
   - Invalid pairs → flash / reset
   - After placement: auto-open dimension editor

**Escape or tool change:** reset the pick state.

#### 4.5.3 Dimension Deletion

Dimensions placed by the user can be deleted:
- Select the dimension (existing `select_sketch_dimension` path)
- Press Delete/Backspace → `delete_sketch_dimension`
- Right-click context menu → "Delete Dimension"

(This already exists for auto-dimensions; just works for manually-placed ones too.)

### 4.6 Viewport Dimension Rendering

The viewport already renders dimensions via `ViewportSketchDimensionPrimitive`. Manually-placed dimensions use the same rendering path — no viewport changes needed. The dimension sprites (text labels + witness lines) are already emitted by the C++ viewport builder for all `SketchDimension` entries regardless of origin.

### Files Changed (Item B)

| File | Change |
|---|---|
| `protocol/schema/commands.schema.json` | Add `add_sketch_angle_dimension`, `add_sketch_distance_dimension`, `add_sketch_line_length_dimension`, `add_sketch_circle_radius_dimension`, `add_sketch_polygon_radius_dimension` |
| `native/cad-core/src/core/document.h` | Declare new single-entity dimension adders |
| `native/cad-core/src/core/document.cpp` | Implement `add_sketch_line_length_dimension`, `add_sketch_circle_radius_dimension`, `add_sketch_polygon_radius_dimension` |
| `native/cad-core/src/core/sketch_feature.h` | Declare core helpers |
| `native/cad-core/src/core/sketch_feature.cpp` | Implement core helpers (reuse existing auto-dimension creation logic) |
| `native/cad-core/src/app.cpp` | Register new command handlers |
| `apps/desktop-ui/src/types/ipc.ts` | Add command interfaces |
| `apps/desktop-ui/src/types/geometry/sketch.ts` | Add `"dimension"` to `SketchTool` |
| `apps/desktop-ui/src/lib/ipcProtocol.ts` | Add command builders |
| `apps/desktop-ui/src/hooks/useCadCore.ts` | Add hooks |
| `apps/desktop-ui/src/layout/header/ToolBarIcons.tsx` | Add Dimension icon |
| `apps/desktop-ui/src/layout/ViewportPanel.tsx` | Dimension tool pick logic (single-click + two-click flows) |
| `apps/desktop-ui/src/i18n/en.json` | Add `sketch.dimensionTool` strings |
| `docs/architecture/ai-cad-command-language.md` | Document new dimension commands |
| `docs/architecture/ipc-protocol.md` | Document new dimension commands |

---

## Priority 2 — Hole Feature

### Goal

Parametric simple/counterbore/countersink hole on a selected face, built on top of the existing cut-extrude / boolean machinery.

### Why This Is Next

Hole is the highest-impact remaining Tier 2 feature. It reuses:
- The boolean cut path already shipping in `body_compiler.cpp`
- The contextual modeling pattern (select face → invoke → floating panel → preview → confirm/cancel)
- The target-body selection pattern from extrude
- The edge/face selection plumbing

### Architecture Sketch

```
User selects a face → presses H → HolePreviewPanel opens
    |
    ├─ Hole type: Simple | Counterbore | Countersink
    ├─ Diameter input
    ├─ Depth input (or "Through All")
    ├─ Counterbore diameter/depth (if CB)
    ├─ Countersink angle/diameter (if CS)
    |
    v
C++ core:
  1. Create a cylindrical solid at the face position/orientation
  2. Boolean-cut it from the target body
  3. Return the resulting viewport mesh
```

### Files (approximate)

| Layer | Files |
|---|---|
| C++ | `hole_feature.h/.cpp` (NEW), `body_compiler.cpp` (extend), `document.h/.cpp`, `app.cpp`, `serialization.cpp`, `viewport.cpp`, `feature.h` |
| TS | `types/ipc.ts`, `lib/ipcProtocol.ts`, `hooks/useCadCore.ts`, `layout/HolePreviewPanel.tsx` (NEW), `ViewportPanel.tsx` |

---

## Priority 3 — Pattern Features

Linear and circular patterns of features and bodies. New feature kinds that reference a source body/feature and replicate it.

### Priority 4 — Mirror

Body/feature mirror about a plane.

### Priority 5 — Measure Tool

Point-to-point distance, edge length, face area. Display-only (no state mutation). A floating info overlay that follows the cursor or selection.

### Priority 6 — Construction Axes

Axes through edges or through two points. New reference geometry kind, selectable in the viewport, usable as mirror/pattern axes.

### Priority 7 — Active Sketch Panel

Showing sketch entities (lines, circles, arcs, dimensions) in the document hierarchy panel while editing a sketch.

### Priority 8 — Sketch Slots

Slot primitive (two parallel lines with tangent end-arcs). New sketch entity kind.

---

## Build & Test

```bash
pnpm core:rebuild    # rebuild C++ core
pnpm dev             # run the app
```

### Manual Test Flow — Item A (Units)

1. Open a document with sketch dimensions visible
2. Toggle units to "in" → all dimension labels switch to inch display
3. Edit a dimension in inches → verify the geometry updates correctly (core works in mm)
4. Toggle back to "mm" → verify labels revert
5. Reload the app → verify setting persists

### Manual Test Flow — Item B (Dimension Tool)

1. Start a sketch, draw a line (no dimension visible — fusion-style on-demand deleted it)
2. Activate Dimension tool (D key)
3. Click the line → a length dimension appears
4. Type a new value → line resizes (constraint behavior)
5. Click two lines that share an endpoint → angle dimension appears
6. Edit the angle → second line rotates
7. Click two parallel lines → line_line_distance dimension appears
8. Delete → verify geometry behavior on dimension removal

---

## Out of Scope

- Units for angles (always display as degrees, core uses radians)
- Unit-aware grid (grid spacing is always mm-based for now)
- Mixed units per document (one unit setting per app session)
- Dimension tool for arcs (arc radius dimensions are follow-up — arc endpoints are fixed in v1)
- Automated dimension placement (dimension lines auto-position — v1 uses simple offset from entity)
- Dimension styles / formatting (decimal places, fraction mode, dual dimension display)
