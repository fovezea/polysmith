// Items in the Construct ribbon that aren't wired to a real action
// yet. Kept as disabled placeholders so the user can see what's
// coming. Removed from this list as each action lands.
const placeholderTools = ["Midplane", "Axis", "Point"];

interface ConstructToolbarProps {
  disabled: boolean;
  // True when the Offset Plane button can be clicked. Driven by the
  // parent so it knows the difference between "no document yet" and
  // "an offset-plane session is already in flight" (both disable the
  // button, but only the second case is also gated by other panels
  // being closed).
  canOffsetPlane: boolean;
  onOffsetPlane: () => void;
}

export function ConstructToolbar({
  disabled,
  canOffsetPlane,
  onOffsetPlane,
}: ConstructToolbarProps) {
  return (
    <>
      <button
        type="button"
        className="cad-tool-button"
        disabled={disabled || !canOffsetPlane}
        title="Offset Plane"
        onClick={onOffsetPlane}
      >
        Offset Plane
      </button>
      {placeholderTools.map((tool) => (
        <button key={tool} className="cad-tool-button" disabled>
          {tool}
        </button>
      ))}
    </>
  );
}
