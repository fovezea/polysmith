# Rectangle Tool

Creates a sketch rectangle entity. Supports multiple creation modes, typed dimension input, and construction mode.

---

## Activation

- **Click** the Rectangle button in the sketch toolbar (Create tab)
- **Hotkey:** `R` (configurable in settings)

---

## Creation Modes

### Corner-Corner (default)

1. **Click** to place the first corner.
2. **Move** the mouse — a preview rectangle stretches.
3. **Click** to place the opposite corner.

### Center-Point

Select "Center-Point" from the mode dropdown.

1. **Click** to place the center.
2. **Move** the mouse — a preview rectangle expands symmetrically.
3. **Click** to place a corner.

### Three-Point

Select "Three-Point" from the mode dropdown.

1. **Click** first corner.
2. **Click** second corner (defines one edge).
3. **Click** third point — perpendicular offset sets the rectangle width.

---

## Dimension Fields

| Field  | Unit                         | Description |
|--------|------------------------------|-------------|
| Width  | mm (or current display unit) | Horizontal span |
| Length | mm (or current display unit) | Vertical span |

---

## Parameter Expressions

Both fields accept parameter names and formulas. See
[Line Tool: Parameter Expressions](line.md#parameter-expressions) for syntax.

---

## Exiting the Tool

| Action                       | Result |
|------------------------------|--------|
| **Enter** (dimension field)  | Commits the rectangle, switches to Select mode |
| **Escape**                   | Cancels draft, switches to Select mode |

---

## Keyboard Shortcuts

| Key            | Context         | Action |
|----------------|-----------------|--------|
| `R`            | Select mode     | Activate Rectangle tool |
| `Enter`        | Dimension field | Commit, exit to Select |
| `Escape`       | Draft state     | Cancel, exit to Select |

---

## Construction Rectangles

Toggle **Construction** in the sketch tool panel. Construction rectangles:

- Render as dashed lines
- Are excluded from profile detection
- Do not generate auto-dimensions

---

## Implementation Notes

### Core Command

```
type: "add_sketch_rectangle"
payload: { start_x, start_y, end_x, end_y, is_construction }
```

### Auto-Dimensions Created

A rectangle creates four sketch lines internally, each with auto-dimensions.
