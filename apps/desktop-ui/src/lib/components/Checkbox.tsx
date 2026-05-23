interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

export function Checkbox({
  checked,
  onCheckedChange,
  ariaLabel,
  className = "",
  disabled = false,
}: CheckboxProps) {
  return (
    <span className={`cad-checkbox ${className}`}>
      <input
        type="checkbox"
        className="cad-checkbox-input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span className="cad-checkbox-box" aria-hidden="true">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 8.2 6.5 11 12.5 5" />
        </svg>
      </span>
    </span>
  );
}
