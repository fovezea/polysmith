import { useMemo, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

type PaintMode = "body" | "face";

interface MaterialsPanelProps {
  selectedBodyId: string | null;
  selectedFaceId: string | null;
  onApplyBodyColor: (bodyId: string, color: string) => Promise<void>;
  onApplyFaceColor: (faceId: string, color: string) => Promise<void>;
  onClearBodyColor: (bodyId: string) => Promise<void>;
  onClearFaceColor: (faceId: string) => Promise<void>;
  onClearAll: () => Promise<void>;
}

const QUICK_COLORS = [
  "#d9d9d9",
  "#ff6b7a",
  "#ff9a3c",
  "#ffd166",
  "#2bd978",
  "#3da9ff",
  "#8b5cf6",
  "#1c1c1e",
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function normalizeHex(value: string) {
  const stripped = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(stripped)) {
    return `#${stripped.toUpperCase()}`;
  }
  return null;
}

function hsvToHex(hue: number, saturation: number, value: number) {
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - chroma;
  const [r1, g1, b1] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const toHex = (component: number) =>
    Math.round((component + m) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

function hexToHsv(hex: string) {
  const normalized = normalizeHex(hex) ?? "#D9D9D9";
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const hue =
    delta === 0
      ? 0
      : max === r
        ? 60 * (((g - b) / delta) % 6)
        : max === g
          ? 60 * ((b - r) / delta + 2)
          : 60 * ((r - g) / delta + 4);
  return {
    hue: hue < 0 ? hue + 360 : hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

export function MaterialsPanel({
  selectedBodyId,
  selectedFaceId,
  onApplyBodyColor,
  onApplyFaceColor,
  onClearBodyColor,
  onClearFaceColor,
  onClearAll,
}: MaterialsPanelProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<PaintMode>("body");
  const [color, setColor] = useState("#D9D9D9");
  const hsv = useMemo(() => hexToHsv(color), [color]);
  const activeTarget = mode === "body" ? selectedBodyId : selectedFaceId;

  function setFromHsv(next: { hue?: number; saturation?: number; value?: number }) {
    setColor(
      hsvToHex(
        next.hue ?? hsv.hue,
        next.saturation ?? hsv.saturation,
        next.value ?? hsv.value,
      ),
    );
  }

  function handleColorPlane(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const saturation = clamp((event.clientX - rect.left) / rect.width);
    const value = clamp(1 - (event.clientY - rect.top) / rect.height);
    setFromHsv({ saturation, value });
  }

  async function applyColor() {
    if (mode === "body" && selectedBodyId) {
      await onApplyBodyColor(selectedBodyId, color);
    } else if (mode === "face" && selectedFaceId) {
      await onApplyFaceColor(selectedFaceId, color);
    }
  }

  async function clearSelected() {
    if (mode === "body" && selectedBodyId) {
      await onClearBodyColor(selectedBodyId);
    } else if (mode === "face" && selectedFaceId) {
      await onClearFaceColor(selectedFaceId);
    }
  }

  return (
    <section className="cad-floating-panel w-[320px] p-4">
      <p className="cad-kicker">{t("materials.title")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(["body", "face"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            className={
              mode === entry
                ? "cad-ribbon-action cad-ribbon-action-primary"
                : "cad-ribbon-action"
            }
            onClick={() => setMode(entry)}
          >
            {t(`materials.mode.${entry}`)}
          </button>
        ))}
      </div>

      <p className="mt-4 text-xs uppercase tracking-[0.16em] text-on-surface-dim">
        {activeTarget
          ? t("materials.selectionReady")
          : t(`materials.noSelection.${mode}`)}
      </p>

      <div
        className="mt-3 h-32 cursor-crosshair rounded-md border border-outline/60"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.hue} 100% 50%))`,
        }}
        onPointerDown={handleColorPlane}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            handleColorPlane(event);
          }
        }}
      />

      <input
        aria-label={t("materials.hue")}
        className="mt-3 w-full accent-primary-edge"
        type="range"
        min={0}
        max={359}
        value={Math.round(hsv.hue)}
        onChange={(event) => setFromHsv({ hue: Number(event.target.value) })}
      />

      <div className="mt-3 flex items-center gap-2">
        <input
          aria-label={t("materials.nativePicker")}
          className="h-9 w-12 rounded-md border border-outline/60 bg-surface-container"
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value.toUpperCase())}
        />
        <input
          aria-label={t("materials.hex")}
          className="min-w-0 flex-1 border-b border-outline bg-transparent px-2 py-2 text-sm uppercase text-on-surface outline-none focus:border-primary-edge"
          value={color}
          onChange={(event) => {
            const next = normalizeHex(event.target.value);
            if (next) {
              setColor(next);
            }
          }}
        />
      </div>

      <div className="mt-3 grid grid-cols-8 gap-1.5">
        {QUICK_COLORS.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-label={t("materials.quickColor", { color: entry })}
            className="h-7 rounded-md border border-outline/60"
            style={{ background: entry }}
            onClick={() => setColor(entry)}
          />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="cad-ribbon-action cad-ribbon-action-primary justify-center"
          disabled={!activeTarget || !normalizeHex(color)}
          onClick={() => void applyColor()}
        >
          {t("materials.apply")}
        </button>
        <button
          type="button"
          className="cad-ribbon-action justify-center"
          disabled={!activeTarget}
          onClick={() => void clearSelected()}
        >
          {t("materials.clearSelected")}
        </button>
      </div>
      <button
        type="button"
        className="cad-ribbon-action mt-2 w-full justify-center"
        onClick={() => void onClearAll()}
      >
        {t("materials.clearAll")}
      </button>
    </section>
  );
}
