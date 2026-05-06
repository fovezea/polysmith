// Items in the Modify ribbon that aren't wired to a real action yet.
// Kept as disabled placeholders so the toolbar layout matches the
// roadmap and the user can see what's coming.
const placeholderTools = ["Press Pull", "Shell", "Move"];

interface ModifyToolbarProps {
  disabled: boolean;
  // True when at least one body edge is selected and no other
  // floating action is in flight. Drives whether Fillet / Chamfer
  // are clickable. The action handlers themselves are no-ops in
  // every other case, so this prop just controls visual affordance.
  canEdgeOp: boolean;
  onFillet: () => void;
  onChamfer: () => void;
}

export function ModifyToolbar({
  disabled,
  canEdgeOp,
  onFillet,
  onChamfer,
}: ModifyToolbarProps) {
  const edgeOpDisabled = disabled || !canEdgeOp;
  return (
    <>
      <button
        type="button"
        className="cad-tool-button"
        disabled={edgeOpDisabled}
        title="Fillet selected edge (F)"
        onClick={onFillet}
      >
        Fillet
      </button>
      <button
        type="button"
        className="cad-tool-button"
        disabled={edgeOpDisabled}
        title="Chamfer selected edge"
        onClick={onChamfer}
      >
        Chamfer
      </button>
      {placeholderTools.map((tool) => (
        <button key={tool} className="cad-tool-button" disabled>
          {tool}
        </button>
      ))}
    </>
  );
}
