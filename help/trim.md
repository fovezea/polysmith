# Trim Tool

Deletes sketch curve segments by cutting them at intersection points with
other curves. Click a segment to delete it — the entity shortens or splits
at the nearest intersection boundaries.

---

## Activation

- **Click** the Trim button in the sketch toolbar (Modify tab)
- **Hotkey:** `T`

The cursor changes to scissors crosshairs.

---

## How It Works

The Trim tool sees only **segments** — not geometric shapes. Every curve is
split at every intersection with any other sketch entity (lines, circles,
arcs). The split produces segments. Clicking a segment deletes it:

| Segment type | Result |
|---|---|
| End segment (one free end) | Curve shortens to the intersection |
| Middle segment (between two intersections) | Curve splits into two curves |
| Only segment (no intersections) | Entity deleted entirely |

**One trim operation affects exactly one entity at a time.** Other entities
are used only as "cutting edges" — they remain untouched.

---

## Entity Transformations

| Entity | After Trim |
|---|---|
| **Line** | Shortened line or split into two lines |
| **Circle** | Converted to an arc (complementary arc to the deleted segment) |
| **Arc** | Shortened arc or split into two arcs |
| **Polygon line** | Polygon dissolves — remaining lines become independent entities |

---

## Constraints

Trim is destructive. All constraints, relations, dimensions, anchors, and
fillets on the trimmed entity are deleted. Shared endpoints are severed —
every surviving entity gets its own independent point IDs. No constraints
survive a trim operation.

If you need constraints on the result, re-add them manually after trimming.

---

## Hover Preview

While the Trim tool is active, hovering over a curve segment highlights it
in **red**. The red segment is the one that will be deleted if you click.
Intersection points between the hovered entity and other curves are
computed in real time.

---

## Multi-Click Repeat

The Trim tool stays active after each operation. You can trim multiple
segments in sequence without re-selecting the tool. Press **Escape** or
switch to another tool to exit.

---

## Keyboard Shortcuts

| Key | Context | Action |
|---|---|---|
| `T` | Select mode | Activate Trim tool |
| `Escape` | Trim mode | Exit to Select mode |

---

## Design Rationale

- **Segment-level, not entity-level.** Trim doesn't know about "lines" or
  "circles" — it knows about segments between intersection points.
- **Click to delete.** The clicked segment is removed; everything else
  survives (possibly split).
- **No constraint migration.** Constraints are not re-evaluated or
  automatically re-assigned after trim. This prevents silent geometry
  corruption from stale coincident or relational constraints.
- **Complete severance.** Shared point IDs from chained drafting are
  broken so no entity can pull another via a lingering shared endpoint.
