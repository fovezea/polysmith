# Parametric Parameters & Dimension Formulas — Implementation Plan

> To continue from home: open this file in DeepSeek TUI and say "implement the plan in PARAMETRIC_PARAMETERS_PLAN.md".

## Goal

Add a user-facing parameter table (name → value/expression) and make sketch dimensions accept formula expressions. This turns PolySmith from a dimension-driven sketcher into a truly parametric CAD where one parameter change cascades through multiple dimensions.

## Architecture Decision

**Parameters live in the C++ core.** They are part of `DocumentState`, serialized with the document, and evaluated by the core. The UI owns only presentation — following the project's strict boundary:

- C++ core owns: parameter definitions, formula evaluation, resolution, and parametric recompute
- React owns: the parameters panel, input UX, display of results
- IPC carries commands and state between them

### Why core-owned?

1. **Document save/load** must be symmetric — parameters must round-trip through `.polysmith` files
2. **Formula evaluation is state-dependent** — parameter `B = A * 2` must be re-evaluated when `A` changes
3. **Dimension resolution** happens in the core during `refresh_sketch_derived_state`
4. **Undo/redo** requires parameter state to live inside the document history

### Per-Document Ownership

Parameters belong to the document (the 3D project), not to the application session. They are saved inside the `.polysmith` file alongside feature history and sketch data. When the user opens a saved file, parameters are restored exactly as they were — including expressions and resolved values.

**Save path:** `save_document_to_path` calls `to_payload(DocumentState)`, which now includes the `parameters` array.

**Load path:** `load_document_from_path` calls `document_from_payload`, which reads the `parameters` array back into `DocumentState`. Older `.polysmith` files without a `parameters` field load with an empty array — fully backward compatible.

### Future: File Format Versioning (Not In This Change)

The current `.polysmith` format has no explicit version marker — it is a direct JSON dump of `DocumentState`. Before adding more structural changes, a `document_version` field should be introduced so the loader can branch on format version and migrate older payloads gracefully. For now, the `parameters` field is added defensively: deserialization defaults it to `[]` when absent, so old files open without error and new saves carry the field forward.

---

## Phase 1: Parameters Infrastructure (C++ Core + IPC)

### 1.1 Data Structures

**New file:** `native/cad-core/src/core/parameter.h`

```cpp
// A single user-defined parameter.
struct ParameterEntry {
    std::string name;           // e.g. "width", "thickness"
    std::string expression;     // e.g. "50", "width * 2", "height / 3 + 10"
    double resolved_value;      // cached evaluated result (mm)
    bool has_error;             // true if expression couldn't be resolved
    std::string error_message;  // e.g. "Unknown parameter: foo"
};
```

**Add to `DocumentState`** in `feature.h`:

```cpp
struct DocumentState {
    // ... existing fields ...
    std::vector<ParameterEntry> parameters;
};
```

### 1.2 Formula Evaluator

**New file:** `native/cad-core/src/core/formula_eval.h` / `.cpp`

A simple recursive-descent expression evaluator.

**Grammar (limited v1):**
```
expression  = term (("+" | "-") term)*
term        = factor (("*" | "/") factor)*
factor      = NUMBER | PARAM_NAME | "-" factor | "(" expression ")"
PARAM_NAME  = [a-zA-Z_][a-zA-Z0-9_]*
NUMBER      = [0-9]+(\.[0-9]+)?
```

**Resolution algorithm:**
1. Tokenize the expression string
2. Recursive-descent parse into AST
3. Evaluate AST bottom-up:
   - Numbers return themselves
   - Parameter names look up `resolved_value` from the parameter table
   - Arithmetic nodes compute from children
4. Return `std::expected<double, string>` (value or error)

**Cycle detection:** Keep a `std::unordered_set<std::string>` of names currently being resolved. If a name is already in the set, it's a cycle → error.

**Important:** The evaluator receives a `std::function<double(const std::string&)>` resolver callback. This keeps the evaluator decoupled from the parameter storage — the caller provides the lookup.

### 1.3 Re-evaluation Logic

When any parameter changes, all parameters must be re-evaluated in **topological order** (dependencies first). Since v1 has no explicit dependency tracking, use iterative re-evaluation until fixpoint:

```cpp
void reify_parameters(std::vector<ParameterEntry>& params) {
    for (int pass = 0; pass < MAX_PASSES; ++pass) {
        bool changed = false;
        for (auto& p : params) {
            auto result = eval(p.expression, [&](const std::string& name) {
                // lookup: search params by name, return resolved_value
                // if that param still has has_error, fail
            });
            if (result.has_value() && result.value() != p.resolved_value) {
                p.resolved_value = result.value();
                p.has_error = false;
                changed = true;
            } else if (!result.has_value()) {
                p.has_error = true;
                p.error_message = result.error();
                changed = true;
            }
        }
        if (!changed) break;
    }
}
```

`MAX_PASSES` = 50 is generous for human-authored parameter graphs.

### 1.4 Document Manager

**`document.h`:**
```cpp
DocumentState add_parameter(const std::string& name, const std::string& expression);
DocumentState update_parameter(const std::string& name, const std::string& expression);
DocumentState delete_parameter(const std::string& name);
```

**`document.cpp`:**
- `add_parameter`: validate name uniqueness (reject duplicates), push to vector, `reify_parameters`, `bump_geometry_revision`
- `update_parameter`: find by name, update expression, `reify_parameters`, `bump_geometry_revision`
- `delete_parameter`: find by name, erase, `reify_parameters` (other params that referenced this one will now have errors), `bump_geometry_revision`
- All three: push undo, clear redo, return `DocumentState`

### 1.5 Command Handlers

**`app.cpp`:**
```
"add_parameter"        → read name, read expression → document_manager().add_parameter(name, expression)
"update_parameter"     → read name, read expression → document_manager().update_parameter(name, expression)
"delete_parameter"     → read name → document_manager().delete_parameter(name)
```

### 1.6 Serialization

**`serialization.cpp`:**
- `to_payload(DocumentState)`: add `"parameters"` array after the existing fields
- `document_from_payload`: read `"parameters"` array; default to `[]` when the key is absent (older `.polysmith` files)
- Each `ParameterEntry` serializes as: `{ name, expression, resolved_value, has_error, error_message }`

**Backward compatibility:** Old files without `"parameters"` load with an empty array. New files always write the field. No migration logic needed for v1.

### 1.7 Protocol Schema

**`protocol/schema/commands.schema.json`:**
- Add `"add_parameter"`, `"update_parameter"`, `"delete_parameter"` to command type enum

---

## Phase 2: UI — Parameters Panel

### 2.1 Button Placement

Add a button to the top ribbon in `AppHeader.tsx`. The button:

- Lives to the **right** of the workspace tabs (Create | Modify | Construct | Sketch), in the same row
- Icon: a small `f(x)` or `{}` symbol representing parameters
- Toggles a floating panel
- Tooltip: "Parameters"
- Hotkey: none for v1 (can be added later)

**Why not in SketchToolbar?** Parameters are document-scoped, not sketch-scoped. They affect all sketches and potentially future 3D features. Keeping them in the global header ribbon is correct.

### 2.2 Parameters Panel Component

**New file:** `apps/desktop-ui/src/layout/ParametersPanel.tsx`

Floating panel that appears below the parameters button. Follows the contextual modeling workflow pattern.

**Layout:**
```
+-------------------------------------+
|  Parameters                         |
|                                     |
|  +----------+-----------+--------+  |
|  | Name     | Expression| Value  |  |
|  +----------+-----------+--------+  |
|  | width    | 50        | 50.00  |  |  read-only value column
|  | height   | width * 2 | 100.00 |  |
|  | offset   | height/3  | 33.33  |  |
|  | bad_ref  | foo + 1   | ERROR  |  |  errored params shown in red
|  +----------+-----------+--------+  |
|  | [empty]  | [empty]   |        |  |  inline "add" row
|  +----------+-----------+--------+  |
|                                     |
|  [+ Add Parameter]                  |
+-------------------------------------+
```

**Behavior:**
- Clicking a row enters edit mode (inline input for name + expression)
- Enter or blur commits via `update_parameter` IPC
- Escape cancels edit, reverts to stored value
- Delete button (trash icon) on hover calls `delete_parameter`
- "Add Parameter" button at bottom adds a new empty row
- Expression input accepts formulas like `50`, `width * 2`, `(a + b) / 3`
- Value column is read-only, re-rendered from `document_state` round-trip
- Expression validation feedback: if a parameter has `has_error: true`, the value column shows the `error_message` in red.

### 2.3 State Wiring

**`App.tsx`:**
- `parametersPanelOpen: boolean` state
- `onToggleParametersPanel` callback
- Thread `parametersPanelOpen` through `AppHeader` props

**`AppHeader.tsx`:**
- New button next to workspace tabs
- Renders `<ParametersPanel>` when open, positioned below the button (like `BoxFeatureForm` popover)

**`useCadCore.ts` / `ipcProtocol.ts`:**
- `addParameter(name, expression)` hook
- `updateParameter(name, expression)` hook
- `deleteParameter(name)` hook

### 2.4 i18n

**`apps/desktop-ui/src/i18n/en.json`:**
```json
"parameters": {
    "title": "Parameters",
    "name": "Name",
    "expression": "Expression",
    "value": "Value",
    "addParameter": "Add Parameter",
    "deleteParameter": "Delete Parameter",
    "emptyName": "Name cannot be empty",
    "duplicateName": "A parameter with this name already exists"
}
```

---

## Phase 3: Dimension Formulas

### 3.1 Extend `update_sketch_dimension` to Accept Formulas

Currently `update_sketch_dimension` takes `double value`. Change to accept either a number or an expression string.

**New IPC payload:**
```json
{
    "dimension_id": "dim-line-line-3",
    "value": "width * 2"
}
```

The command handler in `app.cpp`:
1. Read `value` — if it's a number, use directly (backward compatible)
2. If it's a string, evaluate as a formula using the parameter table
3. If evaluation fails, return an error
4. If successful, pass the resolved `double` to the existing update path

### 3.2 Store Expression on SketchDimension

**In `feature.h`**, add to `SketchDimension`:

```cpp
struct SketchDimension {
    // ... existing fields ...
    std::string expression;  // empty string = plain numeric value
};
```

When `expression` is non-empty, the displayed/resolved `value` is computed from it during `refresh_sketch_derived_state`. If the expression can't be resolved, the dimension falls back to its last good value and flags a warning.

### 3.3 Parametric Recomputation

When a parameter changes, the document must:
1. Re-evaluate all parameters
2. For every sketch feature, call `refresh_sketch_derived_state` — which now also re-evaluates dimension expressions
3. This triggers the existing constraint propagation, so dimension-driven geometry updates

This means `document.cpp`'s parameter methods must call `refresh_history_dependencies` after `reify_parameters`.

### 3.4 Dimension Editor UI — Formula Input

**`ViewportPanel.tsx`** dimension editor:
- Currently accepts only numeric input
- Change to accept free-form text
- On Enter: if the text can be parsed as a number, send as number (backward compatible)
- If it contains letters/operators, send as expression string through the extended `update_sketch_dimension`

---

## Files Changed (Full List)

### C++ Core
| File | Change |
|---|---|
| `native/cad-core/src/core/parameter.h` | **NEW** — `ParameterEntry` struct |
| `native/cad-core/src/core/formula_eval.h` | **NEW** — expression evaluator header |
| `native/cad-core/src/core/formula_eval.cpp` | **NEW** — expression evaluator impl |
| `native/cad-core/src/core/feature.h` | Add `parameters` vector to `DocumentState`, add `expression` field to `SketchDimension` |
| `native/cad-core/src/core/document.h` | Declare `add_parameter`, `update_parameter`, `delete_parameter` |
| `native/cad-core/src/core/document.cpp` | Implement parameter CRUD + reify + propagate |
| `native/cad-core/src/core/sketch_feature.cpp` | Re-evaluate dimension expressions during `refresh_sketch_derived_state` |
| `native/cad-core/src/app.cpp` | Register parameter commands; extend `update_sketch_dimension` |
| `native/cad-core/src/protocol/serialization.cpp` | Serialize/deserialize `parameters` and `dimension.expression` |
| `native/cad-core/CMakeLists.txt` | Add `formula_eval.cpp`, `parameter.h` |

### Protocol
| File | Change |
|---|---|
| `protocol/schema/commands.schema.json` | Add parameter commands to enum |

### TypeScript
| File | Change |
|---|---|
| `apps/desktop-ui/src/types/ipc.ts` | Add parameter command types; extend `UpdateSketchDimensionCommand`; add `ParameterEntry` |
| `apps/desktop-ui/src/types/geometry/sketch.ts` | Add `expression` field to `SketchDimensionEntry` |
| `apps/desktop-ui/src/lib/ipcProtocol.ts` | Add parameter command builders; extend dimension builder |
| `apps/desktop-ui/src/hooks/useCadCore.ts` | Add parameter hooks |
| `apps/desktop-ui/src/lib/schemas/ipcSchema.ts` | Zod validation for new fields |

### UI Components
| File | Change |
|---|---|
| `apps/desktop-ui/src/layout/ParametersPanel.tsx` | **NEW** — floating parameter table |
| `apps/desktop-ui/src/layout/header/AppHeader.tsx` | Add Parameters button, render panel |
| `apps/desktop-ui/src/layout/ViewportPanel.tsx` | Accept formula input in dimension editor |
| `apps/desktop-ui/src/App.tsx` | `parametersPanelOpen` state |
| `apps/desktop-ui/src/i18n/en.json` | Parameter-related strings |

### Documentation
| File | Change |
|---|---|
| `docs/architecture/ipc-protocol.md` | Document new commands |
| `docs/implementation-log.md` | Log entry for this feature |

---

## Build & Test

```bash
pnpm core:rebuild    # rebuild C++ core with new files
pnpm dev             # run the app
```

### Manual test flow:
1. Open a document, start a sketch
2. Open Parameters panel → add `width = 50`
3. Add `height = width * 3` → verify resolved value is 150
4. Draw a rectangle → edit one dimension to `width` → verify it resolves to 50
5. Change `width` to 80 → verify both `height` resolves to 240 AND the rectangle dimension resolves to 80
6. Test cycle detection: `a = b + 1`, `b = a + 1` → both should show errors
7. **Save, close, re-open document** → verify all parameters restore with correct values. Verify expressions still resolve. Verify dimension formulas still drive geometry.
8. **Open an older `.polysmith` file** (pre-parameters) → verify no crash, `parameters` defaults to `[]`, panel shows empty table.
9. Undo parameter changes → verify restore
10. Undo after deleting a parameter referenced by others → verify those others now show errors

---

## Out of Scope (v1)

- Units (everything is mm)
- Parameter types (angle vs length)
- Re-ordering parameters in the panel
- Importing/exporting parameter CSV
- Trigger-based parameters (on-change scripts)
- Functions like `sin`, `cos`, `sqrt`, `min`, `max`
- Parameter-driven 3D features (extrude depth, etc.) — only sketch dimensions for now
- Parameter references in AI assistant commands
- Parameter visibility in the feature timeline
