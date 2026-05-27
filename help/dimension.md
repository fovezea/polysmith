# Dimension Tool

Creates and edits sketch dimensions — linear, radial, angular, and
point-to-point distance.

---

## Activation

- **Click** the Dimension button in the sketch toolbar (Sketch tab)
- **Hotkey:** `D` (configurable in settings)

---

## Single-Entity Dimensions

| Click | Result |
|---|---|
| **Line** | Length dimension |
| **Circle** | Radius / diameter dimension |
| **Polygon** | Radius dimension |

After creation, drag the label to position it. Click anywhere on the canvas
to commit the automatic value.

---

## Two-Entity Dimensions

Click a first entity — a single-entity dimension is created and the entity
is staged. Click a **second, different entity** to morph into:

| Entities | Result |
|---|---|
| Two lines sharing an endpoint | Angle dimension |
| Two parallel lines | Parallel distance |
| Endpoint → endpoint | Point-to-point distance |
| Endpoint → circle centre | Point-to-centre distance |

The single-entity dimension from the first pick is deleted automatically
when the two-entity dimension is created.

---

## Placement & Commit

1. **Drag** the label to position it.
2. **Click** anywhere on the canvas — commits the automatic value and
   closes the editor.
3. **Type** a value and press **Enter** — commits the typed value.
4. **Escape** during placement — deletes the dimension entirely (cancel
   creation).

---

## Editing

- **Double-click** a dimension label to re-open the editor.
- Type a new value or expression, then **Enter** to commit.
- **Escape** restores the previous value and closes the editor.

---

## Expressions

Type a parameter name (e.g. `width`) or formula (`width * 2`) instead of
a raw number.

- **ArrowUp / ArrowDown** — navigate parameter suggestions.
- **Enter / Tab** — insert the selected suggestion.
- Expressions are stored on the dimension and re-evaluated when
  parameters change.

Angles are unitless (degrees for display, radians in the core). All other
dimensions use the document's display unit (mm or inch).

---

## Circle Radius / Diameter Toggle

Right-click a circle dimension label and choose **Show Radius** or
**Show Diameter** to toggle the display mode. The underlying value is
always stored as radius.

---

## Known Issues

- **Angle dimension label drag:** The label does not perfectly follow the
  mouse cursor direction — it moves in a slightly different direction than
  expected, reaching a limit and then going backwards. Workaround: drag
  radially outward from the corner, then sideways.
