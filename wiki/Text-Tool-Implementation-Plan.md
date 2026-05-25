# Text Tool — Implementation Plan

> **Status as of 2026-05-24:** Research complete. Plan written. Not yet implemented.

## Overview

Add text as a first-class sketch entity. Text strings become closed 2D profiles
that feed directly into the existing extrude (New Body / Join / Cut) pipeline.
A follow-up feature (Emboss/Deboss) will allow text on curved surfaces.

## How It Works

PolySmith's bundled OCCT includes `StdPrs_BRepFont` and
`StdPrs_BRepTextBuilder` (aliased as `Font_BRepFont` /
`Font_BRepTextBuilder`). These convert TrueType/OpenType font glyphs
directly into `TopoDS_Shape` objects — no manual FreeType binding needed.

```
Font file (.ttf)
    → StdPrs_BRepFont::FindAndCreate(name, aspect, size_mm)
        → StdPrs_BRepFont::RenderGlyph(unicode_char)
            → TopoDS_Shape (closed wires + faces per glyph, with holes)

StdPrs_BRepTextBuilder::Perform(font, "HELLO", position)
    → TopoDS_Compound (all glyphs, aligned, kerned, positioned)
```

Under the hood, OCCT wraps FreeType, decomposes glyph outlines (line segments
+ quadratic/cubic beziers), converts beziers to B-Spline edges, and detects
inner/outer loops (`A`, `B`, `O` holes) — all internally. The output is a
standard `TopoDS_Shape` ready for the existing face builder and extrusion
pipeline.

## Font Choice

Bundle a single open-source font as a binary resource. No dependence on
system fonts.

**Decision pending** — candidates:

| Font | License | Size | Coverage |
|------|---------|------|----------|
| Liberation Sans | SIL OFL 1.1 | ~350 KB | Latin, Greek, Cyrillic |
| Noto Sans | SIL OFL 1.1 | ~500 KB | Latin, Greek, Cyrillic, CJK |

Either ships with a copy of the license file in
`apps/desktop-ui/src-tauri/resources/`.

## Phased Plan

### Phase 0 — C++ Core (flat text on sketch)

**New files:**
- `native/cad-core/src/core/text_engine.h` — `TextEngine` class
- `native/cad-core/src/core/text_engine.cpp`
- `native/cad-core/src/core/text_feature.h` — `TextFeatureParameters` struct

**TextEngine API:**
- `loadFont(path, size_mm)` → bool
- `generateTextShapes(text_utf8, position_2d)` → `std::vector<TopoDS_Shape>`
- `getTextBounds(text_utf8)` → width, height (for UI preview)

**TextFeatureParameters:**
- `text` (string)
- `font_path` (string — path to bundled .ttf)
- `font_size` (double, mm)
- `position` (gp_Pnt2d in sketch coordinates)
- `sketch_id` (string)

**Integration points:**
- `feature.h` — new `TextFeature` type, stored in `DocumentState.features[]`
- `refresh_sketch_derived_state` — text shapes treated as closed profiles,
  same profile-detection and extrusion pipeline as other sketch entities
- `serialization.cpp` — `to_payload` / `from_payload`
- `app.cpp` — command registration: `create_text`, `update_text`, `delete_text`
- `CMakeLists.txt` — add new .cpp files

**IPC commands:**
```
create_text { text, font_path, font_size, sketch_id, position }
update_text { feature_id, text?, font_size?, position? }
delete_text { feature_id }
```

**History/Undo:** Standard `DocumentHistory::Entry` with snapshot of
parameters before and after.

### Phase 1 — React UI + Contextual Panel

**New files:**
- `apps/desktop-ui/src/layout/TextPreviewPanel.tsx`

**Modified files:**
- `apps/desktop-ui/src/types/ipc.ts` — command types + `TextFeatureParameters`
- `apps/desktop-ui/src/lib/ipcProtocol.ts` — command builders
- `apps/desktop-ui/src/hooks/useCadCore.ts` — `createText`, `updateText`, `deleteText`
- `apps/desktop-ui/src/App.tsx` — tool registration + hotkey (`T`)
- `apps/desktop-ui/src/i18n/en.json` — `panels.text.*` keys

**TextPreviewPanel behavior:**
- Text input field + font size slider
- Debounced `updateText` calls (200ms) drive live geometry preview
- Confirm/Cancel following the standard contextual modeling pattern
  (`Contextual-Modeling-Workflow`)

### Phase 2 — Emboss/Deboss on surfaces

**New IPC commands:**
```
emboss_text { text_feature_id, target_face_id, depth, mode: "emboss" | "deboss" }
```

**Two approaches:**

**Approach A — Normal Projection (cleaner, works on steep curves):**
1. Create text as 2D shapes in a tangent plane near the surface
2. `BRepProj_Projection` or `BRepOffsetAPI_NormalProjection` to project
   wires onto the curved target face
3. Build faces from projected wires
4. `BRepOffsetAPI_MakeOffsetShape` to thicken the face along the surface
   normal (positive = emboss, negative = deboss)
5. Boolean fuse/cut with target body

**Approach B — Tangential Extrusion + Boolean (simpler, good for gentle curves):**
1. Place text on a datum plane offset from the surface
2. Extrude text shapes toward the surface (or away) as a solid
3. Boolean union (emboss) or cut (deboss) with the target body
4. Limitation: on steep surfaces, extruded ends don't match the surface contour

**Recommendation:** Start with Approach A for correctness. Fall back to
Approach B for cases where normal projection fails.

### Phase 3 — Polish

- Multiple font support (user-loaded .ttf files)
- Text along a path/curve
- Vertical text orientation
- Bold/italic font aspects via the OCCT `Font_FontAspect` enum

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `StdPrs_BRepFont` produces shapes that fail `BRepCheck_Analyzer` for complex Unicode (emoji, RTL, combining chars) | Limit v1 to ASCII/Latin-1; validate with `BRepCheck_Analyzer` before committing |
| Kerning mismatch: OCCT FreeType wrapper vs UI text layout disagree on glyph positions | Render text as unified `TopoDS_Compound` from a single `StdPrs_BRepTextBuilder::Perform` call — OCCT handles all positioning internally |
| `TopoDS_Compound` with mixed wire + face shapes confuses the profile detector | Call `BRepBuilderAPI_MakeFace` on each glyph before feeding to the extrusion pipeline; pass inner/outer loops explicitly |
| Self-intersecting font outlines (decorative fonts) produce invalid topology | Ship with Noto Sans or Liberation Sans — both have clean, well-tested outlines. Validate user-loaded fonts |
| Font licensing — cannot bundle commercial fonts, cannot rely on system fonts | Bundle a single SIL OFL 1.1-licensed font as a binary resource |
| The `StdPrs_BRepFont` mutex (`myMutex`) serializes glyph rendering — concurrent access may be slow | Glyph caching minimizes repeated rendering; text feature creation is infrequent (user-initiated, not in hot loop) |

## FreeCAD Comparison

FreeCAD's ShapeString (Part workbench) uses the same approach:
1. Load TTF/OTF via FreeType
2. `FT_Outline_Decompose` to extract line/bezier segments
3. Convert each contour to `TopoDS_Wire` via `BRepBuilderAPI_MakeWire`
4. `BRepBuilderAPI_MakeFace(wire)` → extrude

OCCT 7.7+ bundles this logic into `StdPrs_BRepFont`, so PolySmith gets to
skip the manual FreeType integration. The result is the same — text as
extrudable BRep shapes — with less code.

## References

- [Sketch Selection Controls](Sketch-Selection-Controls) — selection/snap/constraint controls for sketch entities
- [Contextual Modeling Workflow](Contextual-Modeling-Workflow) — binding UX pattern
- [Trim Tool — Implementation Plan](Trim-Tool-Implementation-Plan) — same structure, already implemented
- `third_party/occt-install/include/opencascade/StdPrs_BRepFont.hxx` — OCCT font API
- `third_party/occt-install/include/opencascade/StdPrs_BRepTextBuilder.hxx` — OCCT text layout API
