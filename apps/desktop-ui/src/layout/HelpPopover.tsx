import { useState, useRef, useEffect, useCallback } from "react";
import type { HelpEntry, HelpShortcut } from "@/lib/help-index";

interface HelpPopoverProps {
  entry: HelpEntry | null;
  /** Anchor element to position relative to. If null, popover is not rendered. */
  anchor: HTMLElement | null;
  onClose: () => void;
}

function ShortcutRow({ shortcut }: { shortcut: HelpShortcut }) {
  const keys = shortcut.key.split("+").map((k: string) => k.trim());
  return (
    <tr className="text-xs">
      <td className="py-0.5 pr-3 text-on-surface-dim whitespace-nowrap align-top">
        {keys.map((k: string, i: number) => (
          <span key={i}>
            {i > 0 && <span className="mx-0.5 opacity-40">+</span>}
            <kbd className="inline-block rounded border border-white/15 bg-white/5 px-1 py-px font-mono text-[11px]">
              {k}
            </kbd>
          </span>
        ))}
      </td>
      <td className="py-0.5 pr-3 text-on-surface-dim italic">{shortcut.context}</td>
      <td className="py-0.5 text-on-surface">{shortcut.action}</td>
    </tr>
  );
}

function SectionBlock({
  heading,
  body,
}: {
  heading: string;
  body: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left text-xs font-medium text-on-surface-dim hover:text-on-surface"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="inline-block transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▸
        </span>
        {heading}
      </button>
      {open && (
        <div className="mt-1 whitespace-pre-line pl-4 text-xs leading-relaxed text-on-surface-dim">
          {renderBody(body)}
        </div>
      )}
    </div>
  );
}

/** Minimal markdown-like inline rendering: **bold**, `code`, \n → line breaks. */
function renderBody(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    // Inline bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <div key={i}>
        {parts.map((part, j) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <strong key={j} className="text-on-surface">
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (part.startsWith("`") && part.endsWith("`")) {
            return (
              <code
                key={j}
                className="rounded bg-white/10 px-0.5 font-mono text-[11px]"
              >
                {part.slice(1, -1)}
              </code>
            );
          }
          return <span key={j}>{part}</span>;
        })}
      </div>
    );
  });
}

export function HelpPopover({ entry, anchor, onClose }: HelpPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  // Compute position from anchor alone (estimated 360px × 600px) on first
  // render, then refine with actual popover dimensions once the ref exists.
  const computePosition = useCallback(
    (anchorEl: HTMLElement, popoverEl?: HTMLElement) => {
      const anchorRect = anchorEl.getBoundingClientRect();
      const pw = popoverEl ? popoverEl.offsetWidth : 360;
      const ph = popoverEl
        ? popoverEl.offsetHeight
        : Math.min(window.innerHeight * 0.6, 600);
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      let x = anchorRect.left;
      let y = anchorRect.bottom + 4;

      if (x + pw > viewportW - 8) x = viewportW - pw - 8;
      if (y + ph > viewportH - 8) y = anchorRect.top - ph - 4;
      if (x < 8) x = 8;
      if (y < 8) y = 8;

      return { x, y };
    },
    [],
  );

  useEffect(() => {
    if (!anchor || !entry) return;
    // Set initial position from anchor alone (popover not yet in DOM)
    setPosition(computePosition(anchor));

    // Refine position once the popover element is mounted
    const raf = requestAnimationFrame(() => {
      if (popoverRef.current) {
        setPosition(computePosition(anchor, popoverRef.current));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [anchor, entry, computePosition]);

  useEffect(() => {
    if (!entry) return undefined;
    const handle = (e: PointerEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchor &&
        !anchor.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", handle);
    return () => document.removeEventListener("pointerdown", handle);
  }, [entry, anchor, onClose]);

  if (!entry) return null;

  return (
    <div
      ref={popoverRef}
      className="pointer-events-auto fixed z-[100] max-h-[60vh] w-[360px] overflow-y-auto rounded-lg border border-white/10 bg-[var(--cad-panel-bg)] p-4 shadow-xl backdrop-blur-md"
      style={{
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">
            {entry.title}
          </h3>
          <p className="mt-0.5 text-xs text-on-surface-dim">
            {entry.summary}
          </p>
        </div>
        <button
          type="button"
          className="ml-2 text-on-surface-dim hover:text-on-surface"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* Activation */}
      <p className="mb-3 text-xs text-on-surface-dim">{entry.activation}</p>

      {/* Shortcuts */}
      {entry.shortcuts.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-medium text-on-surface-dim">
            Shortcuts
          </p>
          <table className="w-full">
            <tbody>
              {entry.shortcuts.map((s: HelpShortcut, i: number) => (
                <ShortcutRow key={i} shortcut={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sections */}
      <div className="border-t border-white/5 pt-2">
        {entry.sections.map((sec, i) => (
          <SectionBlock key={i} heading={sec.heading} body={sec.body} />
        ))}
      </div>
    </div>
  );
}
