# Circle Tool

Creates a sketch circle entity. Supports multiple creation modes, typed dimension input, parameter expressions, and construction mode.

---

## Activation

- **Click** the Circle button in the sketch toolbar (Create tab)
- **Hotkey:** `C` (configurable in settings)

---

## Creation Modes

### Center-Radius (default)

1. **Click** to place the center point.
2. **Move** the mouse — a preview circle expands from the center.
3. **Click** to place a point on the circumference.

### Two-Point (Diameter)

Select "Two-Point" from the mode dropdown in the sketch tool panel.

1. **Click** to place one endpoint of the diameter.
2. **Move** the mouse — a preview circle stretches.
3. **Click** to place the opposite endpoint.

### Three-Point

Select "Three-Point" from the mode dropdown.

1. **Click** first point on the circumference.
2. **Click** second point on the circumference.
3. **Click** third point — the circle is computed from the three points.

### Tangent Modes

`tangent_two_lines` and `tangent_three_lines` are reserved for future core support.

---

## Dimension Fields

| Field      | Unit                         | Description |
|------------|------------------------------|-------------|
| Diameter   | mm (or current display unit) | Circle diameter (radius × 2 internally) |

The core stores **radius** in the `circle_radius` dimension kind.
The draft preview shows **diameter** for user-facing input.

---

## Parameter Expressions

The diameter field accepts parameter names and formulas. See
[Line Tool: Parameter Expressions](line.md#parameter-expressions) for syntax.

---

## Exiting the Tool

| Action                       | Result |
|------------------------------|--------|
| **Enter** (dimension field)  | Commits the circle, switches to Select mode |
| **Escape**                   | Cancels draft, switches to Select mode |

---

## Keyboard Shortcuts

| Key            | Context         | Action |
|----------------|-----------------|--------|
| `C`            | Select mode     | Activate Circle tool |
| `Enter`        | Dimension field | Commit, exit to Select |
| `Escape`       | Draft state     | Cancel, exit to Select |

---

## Construction Circles

Toggle **Construction** in the sketch tool panel. Construction circles:

- Render as dashed lines
- Are excluded from profile detection
- Do not generate auto-dimensions

---

## Parameter-Driven Circles

Same as lines — type a parameter name in the diameter field. The core
stores `circle_radius` dimension. Changing the parameter re-evaluates
the expression and updates geometry.

---

## Implementation Notes

### Core Command

```
type: "add_sketch_circle"
payload: { center_x, center_y, radius, is_construction }
```

### Auto-Dimension Created

| Dimension | ID Pattern              | Kind            |
|-----------|-------------------------|-----------------|
| Diameter  | `dim-circle-{circle_id}`| `circle_radius` |
