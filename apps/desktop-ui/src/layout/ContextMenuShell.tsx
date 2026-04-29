import { useLayoutEffect, useRef, useState } from "react";

interface ContextMenuShellProps {
  // Click coordinates in viewport space (event.clientX / clientY).
  x: number;
  y: number;
  // Optional Tailwind / utility classes to compose with the base
  // chrome. Lets each call site tweak min-width, etc.
  className?: string;
  children: React.ReactNode;
}

// Floating menu that anchors at (x, y), then on first layout
// measures itself and flips up / left when it would overflow the
// viewport. Used by the feature timeline (which sits flush against
// the bottom of the window) and the document hierarchy panel — both
// have the same downward-clipped-on-edge bug.
//
// The shell renders the children inside a `<div class="cad-context-
// menu fixed ...">` portal target. The caller is responsible for
// portaling this component into `document.body` (so `position: fixed`
// resolves against the viewport rather than against any parent with
// `backdrop-filter` set, which becomes a containing block).
export function ContextMenuShell({
  x,
  y,
  className,
  children,
}: ContextMenuShellProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });
  // Hide on first paint so the user never sees the menu in its
  // pre-flip (potentially clipped) position before the layout effect
  // measures and corrects it.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const rect = node.getBoundingClientRect();
    const margin = 8;
    let nextLeft = x;
    let nextTop = y;
    if (nextLeft + rect.width + margin > window.innerWidth) {
      nextLeft = Math.max(margin, x - rect.width);
    }
    if (nextTop + rect.height + margin > window.innerHeight) {
      nextTop = Math.max(margin, y - rect.height);
    }
    setPosition({ left: nextLeft, top: nextTop });
    setReady(true);
  }, [x, y]);

  return (
    <div
      ref={containerRef}
      className={
        "cad-context-menu fixed z-30 rounded-xl p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-xl " +
        (className ?? "min-w-[160px]")
      }
      style={{
        left: position.left,
        top: position.top,
        opacity: ready ? 1 : 0,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}
