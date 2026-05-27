import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";

interface ScrollAreaProps extends ComponentPropsWithoutRef<"div"> {
  viewportClassName?: string;
}

interface ScrollMetrics {
  thumbHeight: number;
  thumbTop: number;
  visible: boolean;
}

const MIN_THUMB_SIZE = 32;

export function ScrollArea({
  className = "",
  viewportClassName = "",
  children,
  ...props
}: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    thumbHeight: MIN_THUMB_SIZE,
    thumbTop: 0,
    visible: false,
  });

  const updateMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const { clientHeight, scrollHeight, scrollTop } = viewport;
    const visible = scrollHeight > clientHeight + 1;
    if (!visible || clientHeight <= 0) {
      setMetrics((current) =>
        current.visible
          ? { thumbHeight: MIN_THUMB_SIZE, thumbTop: 0, visible: false }
          : current,
      );
      return;
    }

    const thumbHeight = Math.max(
      MIN_THUMB_SIZE,
      (clientHeight / scrollHeight) * clientHeight,
    );
    const scrollRange = scrollHeight - clientHeight;
    const thumbRange = clientHeight - thumbHeight;
    const thumbTop = scrollRange > 0 ? (scrollTop / scrollRange) * thumbRange : 0;
    setMetrics((current) => {
      const next = { thumbHeight, thumbTop, visible };
      return Math.abs(current.thumbHeight - next.thumbHeight) < 0.5 &&
        Math.abs(current.thumbTop - next.thumbTop) < 0.5 &&
        current.visible === next.visible
        ? current
        : next;
    });
  }, []);

  useEffect(() => {
    updateMetrics();
  }, [children, updateMetrics]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(updateMetrics);
    resizeObserver.observe(viewport);
    if (viewport.firstElementChild) {
      resizeObserver.observe(viewport.firstElementChild);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateMetrics]);

  return (
    <div
      className={`cad-scroll-area ${className}`.trim()}
      {...props}
    >
      <div
        ref={viewportRef}
        className={`cad-scroll-area-viewport ${viewportClassName}`.trim()}
        onScroll={updateMetrics}
      >
        {children}
      </div>
      {metrics.visible ? (
        <div className="cad-scroll-area-track" aria-hidden="true">
          <div
            className="cad-scroll-area-thumb"
            style={{
              height: metrics.thumbHeight,
              transform: `translateY(${metrics.thumbTop}px)`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
