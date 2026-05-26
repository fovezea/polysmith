import { useEffect, useState } from "react";

export interface SelectionFilter {
  select_curves: boolean;
  select_points: boolean;
  select_construction: boolean;
  select_constraints: boolean;
  snap_endpoint: boolean;
  snap_midpoint: boolean;
  snap_center: boolean;
  snap_intersection: boolean;
  snap_nearest: boolean;
  snap_quadrant: boolean;
  snap_perpendicular: boolean;
  snap_parallel: boolean;
  snap_tangent: boolean;
  snap_grid: boolean;
  snap_grid_line: boolean;
  snap_polar: boolean;
  polar_angle_degrees: number;
  magnetic_pull: boolean;
  tolerance_px: number;
}

const STORAGE_KEY = "polysmith-selection-filter";

const defaultFilter: SelectionFilter = {
  select_curves: true,
  select_points: true,
  select_construction: false,
  select_constraints: true,
  snap_endpoint: true,
  snap_midpoint: true,
  snap_center: true,
  snap_intersection: true,
  snap_nearest: true,
  snap_quadrant: false,
  snap_perpendicular: false,
  snap_parallel: false,
  snap_tangent: true,
  snap_grid: true,
  snap_grid_line: false,
  snap_polar: false,
  polar_angle_degrees: 15,
  magnetic_pull: true,
  tolerance_px: 10,
};

export function readStoredFilter(): SelectionFilter {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...defaultFilter, ...JSON.parse(raw) };
    }
  } catch {
    // corrupted, use default
  }
  return { ...defaultFilter };
}

export function writeStoredFilter(filter: SelectionFilter): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
}

interface Props {
  currentFilter: SelectionFilter;
  open: boolean;
  onChange: (filter: SelectionFilter) => void;
  onClose: () => void;
}

export function SelectionFilterPanel({
  currentFilter,
  open,
  onChange,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<SelectionFilter>(currentFilter);

  useEffect(() => {
    setDraft(currentFilter);
  }, [currentFilter]);

  if (!open) return null;

  function toggle(key: keyof SelectionFilter) {
    const next = { ...draft, [key]: !draft[key] };
    setDraft(next);
    onChange(next);
  }

  function handleTolerance(val: string) {
    const px = parseInt(val, 10);
    if (isNaN(px) || px <= 0) return;
    const next = { ...draft, tolerance_px: px };
    setDraft(next);
    onChange(next);
  }

  return (
    <div className="selection-filter-panel" style={{
        minWidth: 320,
        background: "#1c1b1b",
        borderRadius: 8,
        padding: 16,
        boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
        color: "#e5e2e1",
      }}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>Selection &amp; Snap Filter</h3>

      <div style={{ borderBottom: "1px solid #353534", marginBottom: 12, paddingBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>Sketch Geometry</div>
        <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
          <input type="checkbox" checked={draft.select_curves} onChange={() => toggle("select_curves")} />{" "}
          Curves (lines, arcs, circles)
        </label>
        <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
          <input type="checkbox" checked={draft.select_points} onChange={() => toggle("select_points")} />{" "}
          Points (endpoints, centers)
        </label>
        <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
          <input type="checkbox" checked={draft.select_construction} onChange={() => toggle("select_construction")} />{" "}
          Construction geometry
        </label>
        <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
          <input type="checkbox" checked={draft.select_constraints} onChange={() => toggle("select_constraints")} />{" "}
          Constraints (click to edit)
        </label>
      </div>

      <div style={{ borderBottom: "1px solid #353534", marginBottom: 12, paddingBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>Snap Types</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_endpoint} onChange={() => toggle("snap_endpoint")} />{" "}
            Endpoint
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_midpoint} onChange={() => toggle("snap_midpoint")} />{" "}
            Midpoint
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_center} onChange={() => toggle("snap_center")} />{" "}
            Center
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_intersection} onChange={() => toggle("snap_intersection")} />{" "}
            Intersection
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_nearest} onChange={() => toggle("snap_nearest")} />{" "}
            Nearest
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_quadrant} onChange={() => toggle("snap_quadrant")} />{" "}
            Quadrant
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_perpendicular} onChange={() => toggle("snap_perpendicular")} />{" "}
            Perpendicular
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_parallel} onChange={() => toggle("snap_parallel")} />{" "}
            Parallel
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_tangent} onChange={() => toggle("snap_tangent")} />{" "}
            Tangent
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_grid} onChange={() => toggle("snap_grid")} />{" "}
            Grid
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_grid_line} onChange={() => toggle("snap_grid_line")} />{" "}
            Grid Line
          </label>
          <label style={{ display: "block", fontSize: 13 }}>
            <input type="checkbox" checked={draft.snap_polar} onChange={() => toggle("snap_polar")} />{" "}
            Polar
          </label>
          <label style={{ display: "block", fontSize: 13, paddingLeft: 18 }}>
            Angle: <input type="number" value={draft.polar_angle_degrees} onChange={(e) => { const v = parseInt(e.target.value,10); if (v>0 && v<=90) { const n={...draft,polar_angle_degrees:v}; setDraft(n); onChange(n); }}} min={5} max={90} step={5} style={{ width: 50, background: "#353534", border: "1px solid #555", color: "#e5e2e1", borderRadius: 4, padding: "2px 6px" }} />°
          </label>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid #353534", marginBottom: 12, paddingBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888" }}>Global</div>
        <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
          Tolerance (px):{" "}
          <input type="number" value={draft.tolerance_px} onChange={(e) => handleTolerance(e.target.value)} min={1} max={50} style={{ width: 60, background: "#353534", border: "1px solid #555", color: "#e5e2e1", borderRadius: 4, padding: "2px 6px" }} />
        </label>
        <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
          <input type="checkbox" checked={draft.magnetic_pull} onChange={() => toggle("magnetic_pull")} />{" "}
          Magnetic pull
        </label>
      </div>

      <button onClick={onClose} style={{
        background: "#353534", border: "1px solid #555", color: "#e5e2e1", borderRadius: 6, padding: "6px 16px", fontSize: 12, cursor: "pointer", width: "100%"
      }}>
        Close
      </button>
    </div>
  );
}