# Snap Settings - Configuration Options

## Philosophy
Users should be able to toggle **every** snap type independently. Some drawings need coarse grid snaps; others need fine geometric snaps. Some 3D workflows need face snaps; others find them distracting.

---

## 2D SKETCH SNAPS (Plane-based)

| Snap Type | Condition / Trigger | Default | Best For | Distracting When |
| :--- | :--- | :---: | :--- | :--- |
| **Grid Snap** | Cursor within tolerance distance of grid intersection | ✅ On | Orthogonal layouts, precision drafting | Freehand curves, organic shapes |
| **Grid Line Snap** | Cursor anywhere on a major grid line (not just intersections) | ⬜ Off | Aligning to axes without full grid lock | Most general sketching |
| **Endpoint Snap** | Cursor near endpoint of any line, arc, or curve | ✅ On | Connecting new geometry to existing | Dense sketches with many endpoints |
| **Midpoint Snap** | Cursor near exact middle of line or arc chord | ✅ On | Symmetry, centering features | When you always want endpoints instead |
| **Center Snap** | Cursor near center point of circle, arc, or ellipse | ✅ On | Concentric circles, radial patterns | When selecting the arc itself is the goal |
| **Quadrant Snap** | Cursor near 0°, 90°, 180°, 270° points on circle/arc | ⬜ Off | Symmetric constraints, tangent alignment | Most users (enable per-project) |
| **Intersection Snap** | Cursor where two or more entities cross (virtual intersection) | ✅ On | Finding corners of extended lines | Complex sketches with many construction lines |
| **Nearest Snap** | Cursor anywhere on line/curve (not just key points) | ✅ On | General placement, quick connections | When you overshoot intended endpoints |
| **Perpendicular Snap** | Cursor indicates 90° offset from existing line | ⬜ Off | Drawing perfect perpendiculars quickly | Accidental triggers near 85-95° ranges |
| **Parallel Snap** | Cursor indicates parallel alignment to nearest line | ⬜ Off | Drawing parallel lines without constraints | Over-sensitive in dense sketches |
| **Tangent Snap** | Cursor indicates tangent point to arc/circle from line endpoint | ✅ On | Smooth transitions, fillets | When you want to cross the circle instead |
| **Polar Snap** | Angle increments (15°, 30°, 45°) at specified distances | ⬜ Off | Isometric drawings, angular patterns | General orthogonal sketching |
| **Object Snap Override** | Temporary snap by pressing modifier key (e.g., `Shift`+`E` for Endpoint) | ✅ On | Precision when many snaps are active | N/A (user-initiated) |

---

## 3D SNAPS (For when you move to solid/surface modeling)

| Snap Type | Condition / Trigger | Default | Best For | Distracting When |
| :--- | :--- | :---: | :--- | :--- |
| **Vertex Snap** | Cursor near any 3D corner point | ✅ On | Connecting edges, placing components | High-poly meshes with dense vertices |
| **Edge Snap** | Cursor anywhere on edge of face | ✅ On | Aligning along existing geometry | When you want face selection instead |
| **Face Snap (Planar)** | Cursor on flat face, aligns sketch plane to that face | ✅ On | Starting sketches on existing parts | Rotating camera accidentally |
| **Face Snap (Offset)** | Cursor on face with specified offset distance | ⬜ Off | Creating parallel planes | Most modeling |
| **Midpoint (3D Edge)** | Midpoint of any 3D edge | ⬜ Off | Symmetrical part placement | Rarely needed |
| **Center of Mass Snap** | Snaps to computed centroid of selected solid/body | ⬜ Off | Assembly constraints, balancing | Technical/engineering workflows only |
| **Coordinate System Snap** | Snaps to origin, axes (X, Y, Z lines) | ✅ On | Starting from absolute reference | When modeling away from origin |
| **Infinite Line Snap** | Snaps along infinite extension of 3D edges | ⬜ Off | Projecting beyond physical part bounds | Confusing for new users |
| **Tangent (3D Edge)** | Tangent point on curved 3D edge (cylinder, fillet) | ⬜ Off | Pipe routing, smooth transitions | Complex curved surfaces |

---

## Global Snap Settings (Apply to both 2D & 3D)

| Setting | Description | Default |
| :--- | :--- | :---: |
| **Snap Tolerance (pixels)** | Distance in pixels for snap activation | `10 px` |
| **Snap Indicator** | Show glyph/icon when snap is active | ✅ On |
| **Snap Sound** | Optional audio feedback on snap | ⬜ Off |
| **Dynamic Highlighting** | Highlight potential snap target before clicking | ✅ On |
| **Magnetic Snap** | Cursor feels "pull" toward snap points | ✅ On |
| **Snap Order Priority** | Which snap wins when multiple are valid (e.g., Endpoint > Midpoint > Nearest) | `Endpoint > Center > Midpoint > Intersection > Nearest` |
| **Modifier Key Toggle** | Hold key to temporarily invert all snap settings | `Alt` (invert), `Shift` (override to a single type) |

---


### Priority Queue Logic

When multiple snaps are valid simultaneously:

```python
# Example priority order (configurable by user)
snap_priority = [
    "Endpoint",      # Highest priority
    "Center",
    "Midpoint",
    "Intersection",
    "Quadrant",
    "Perpendicular",
    "Tangent",
    "Nearest"        # Lowest priority
] 

## Implementation Notes for Your Settings UI


### Priority Queue Logic

When multiple snaps are valid simultaneously:

```python
# Example priority order (configurable by user)
snap_priority = [
    "Endpoint",      # Highest priority
    "Center",
    "Midpoint",
    "Intersection",
    "Quadrant",
    "Perpendicular",
    "Tangent",
    "Nearest"        # Lowest priority
]

### Code Snippet for Snap Settings Structure

class SnapSettings:
    def __init__(self):
        # 2D snaps
        self.grid_snap = True
        self.grid_line_snap = False
        self.endpoint_snap = True
        self.midpoint_snap = True
        self.center_snap = True
        self.quadrant_snap = False
        self.intersection_snap = True
        self.nearest_snap = True
        self.perpendicular_snap = False
        self.parallel_snap = False
        self.tangent_snap = True
        self.polar_snap = False
        
        # 3D snaps
        self.vertex_snap = True
        self.edge_snap = True
        self.face_planar_snap = True
        self.face_offset_snap = False
        self.midpoint_3d_snap = False
        self.center_of_mass_snap = False
        self.coord_system_snap = True
        self.infinite_line_snap = False
        self.tangent_3d_snap = False
        
        # Global
        self.tolerance_px = 10
        self.snap_priority = ["Endpoint", "Center", "Midpoint", "Intersection", "Quadrant", "Perpendicular", "Tangent", "Nearest"]
        self.show_indicator = True
        self.sound_feedback = False
        self.dynamic_highlight = True
        self.magnetic_pull = True
        self.modifier_invert = "Alt"
        self.modifier_override = "Shift"

### Recommended UI Layout
