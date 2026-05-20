# Fusion-Style On-Demand Sketch Dimensions -- Implementation Plan

> To continue from home: open this file in DeepSeek TUI and say "implement the plan in IMPLEMENTATION_PLAN.md".

## Goal

Match Fusion 360 behavior: shapes created by mouse-only drag get **no automatic dimension**. Shapes created with a **typed value** (draft dimension input during preview) keep the dimension. Prevents sketch bloat and over-constraining.

## Approach

**Keep C++ auto-dimension creation, then delete from TypeScript when user didn't type.**

1. C++ creates auto-dimension on every shape (safe, tested)
2. After shape committed, TypeScript checks `draftDimensionSession.lockedFields`
3. If lockedFields empty -> user just dragged -> call new `delete_sketch_dimension` IPC
4. If lockedFields has relevant field -> user typed -> do nothing (dimension stays)

## Files

### C++ Core
- `sketch_feature.h`: declare `void delete_sketch_dimension(FeatureEntry&, const std::string&)`
- `sketch_feature.cpp`: implement (find dim by ID, erase)
- `document.h`: declare `DocumentState delete_sketch_dimension(const std::string&)`
- `document.cpp`: wrapper (push_undo, clear_redo, call core, refresh)
- `app.cpp`: `if (command.type == "delete_sketch_dimension")`

### TS IPC
- `protocol/schema/commands.schema.json`: register `delete_sketch_dimension`
- `lib/ipcProtocol.ts`: `makeDeleteSketchDimensionCommand(dimensionId)`
- `hooks/useCadCore.ts`: `deleteSketchDimension` hook
- `App.tsx`: pass callback to ViewportPanel

### ViewportPanel.tsx commit paths to modify
- `commitDraftDimensionSession`: after line/circle/polygon commit, check lockedFields
- General pointerup: after line/circle/polygon commit, check lockedFields

### Dimension ID format (auto-created by C++)
- Line: "dim-line-line-{N}"
- Circle: "dim-circle-circle-{N}"
- Polygon: "dim-polygon-polygon-{N}"

Entity ID = "line-{N}"/"circle-{N}"/"polygon-{N}" where N = count-1 after commit.

## Build
1. `pnpm core:rebuild`
2. `pnpm dev`
