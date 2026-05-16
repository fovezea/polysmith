import { useState } from "react";
import {
  defaultAppConfig,
  formatHotkey,
  isThemeAvailable,
  useAppConfig,
} from "@/config";
import type { AppConfig, HotkeyBinding } from "@/config";
import { Dropdown, testOllamaConnection } from "@/lib";

type SettingsSection = "appearance" | "keybinds" | "ai";

interface SettingsModalProps {
  onClose: () => void;
}

interface HotkeyRow {
  group: keyof AppConfig["hotkeys"];
  key: string;
  label: string;
  binding: HotkeyBinding;
}

const RESERVED_HOTKEYS = new Set([
  "mod+KeyC",
  "mod+KeyV",
  "mod+KeyX",
  "mod+KeyQ",
  "mod+KeyW",
  "mod+KeyN",
  "mod+KeyO",
  "mod+KeyS",
  "mod+KeyP",
  "mod+KeyR",
  "mod+Comma",
]);

const BLOCKED_KEY_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
  "CapsLock",
  "Tab",
  "Escape",
  "Enter",
]);

function labelFromKeyboardEvent(event: KeyboardEvent) {
  if (event.code === "Space") {
    return "Space";
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase();
  }
  return event.key;
}

function bindingFromKeyboardEvent(event: KeyboardEvent): HotkeyBinding {
  return {
    code: event.code,
    label: labelFromKeyboardEvent(event),
    ctrlOrMeta: event.metaKey || event.ctrlKey || undefined,
    shift: event.shiftKey || undefined,
    alt: event.altKey || undefined,
  };
}

function hotkeySignature(binding: HotkeyBinding) {
  return [
    binding.ctrlOrMeta ? "mod" : "",
    binding.alt ? "alt" : "",
    binding.shift ? "shift" : "",
    binding.code,
  ]
    .filter(Boolean)
    .join("+");
}

function rowId(row: HotkeyRow) {
  return `${row.group}.${row.key}`;
}

function validateHotkey(
  binding: HotkeyBinding,
  row: HotkeyRow,
  rows: HotkeyRow[],
) {
  if (BLOCKED_KEY_CODES.has(binding.code)) {
    return "Use a letter, number, symbol, function key, or navigation key.";
  }

  if (binding.shift && !binding.ctrlOrMeta && !binding.alt) {
    return "Shift-only shortcuts are not allowed. Add Ctrl/Cmd or Alt, or use a plain key.";
  }

  if (RESERVED_HOTKEYS.has(hotkeySignature(binding))) {
    return "That shortcut is reserved by the system or common editing commands.";
  }

  const conflict = rows.find(
    (entry) =>
      rowId(entry) !== rowId(row) &&
      hotkeySignature(entry.binding) === hotkeySignature(binding),
  );
  if (conflict) {
    return `Conflicts with ${conflict.label}. Update that binding first.`;
  }

  return null;
}

function getDefaultHotkey(row: HotkeyRow): HotkeyBinding {
  const groupDefaults = defaultAppConfig.hotkeys[row.group];
  return groupDefaults[row.key as keyof typeof groupDefaults] as HotkeyBinding;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const {
    config,
    availableThemes,
    configPath,
    themesPath,
    setConfig,
    updateConfig,
  } = useAppConfig();
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [activeHotkeyId, setActiveHotkeyId] = useState<string | null>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [isConfirmingResetAll, setIsConfirmingResetAll] = useState(false);
  const [aiConnectionStatus, setAiConnectionStatus] = useState<string | null>(
    null,
  );
  const [isTestingAiConnection, setIsTestingAiConnection] = useState(false);

  const hotkeyRows: HotkeyRow[] = [
    {
      group: "global",
      key: "undo",
      label: "Undo",
      binding: config.hotkeys.global.undo,
    },
    {
      group: "global",
      key: "redo",
      label: "Redo",
      binding: config.hotkeys.global.redo,
    },
    {
      group: "toolbar",
      key: "extrude",
      label: "Extrude",
      binding: config.hotkeys.toolbar.extrude,
    },
    {
      group: "toolbar",
      key: "fillet",
      label: "Fillet",
      binding: config.hotkeys.toolbar.fillet,
    },
    {
      group: "toolbar",
      key: "project",
      label: "Project",
      binding: config.hotkeys.toolbar.project,
    },
    {
      group: "viewport",
      key: "toggleGrid",
      label: "Toggle Grid",
      binding: config.hotkeys.viewport.toggleGrid,
    },
    {
      group: "sketchToolbar",
      key: "createSketch",
      label: "Create Sketch",
      binding: config.hotkeys.sketchToolbar.createSketch,
    },
    {
      group: "sketchToolbar",
      key: "line",
      label: "Sketch Line",
      binding: config.hotkeys.sketchToolbar.line,
    },
    {
      group: "sketchToolbar",
      key: "rectangle",
      label: "Sketch Rectangle",
      binding: config.hotkeys.sketchToolbar.rectangle,
    },
    {
      group: "sketchToolbar",
      key: "circle",
      label: "Sketch Circle",
      binding: config.hotkeys.sketchToolbar.circle,
    },
    {
      group: "sketchToolbar",
      key: "dimension",
      label: "Sketch Dimension",
      binding: config.hotkeys.sketchToolbar.dimension,
    },
    {
      group: "sketchToolbar",
      key: "toggleConstruction",
      label: "Toggle Construction",
      binding: config.hotkeys.sketchToolbar.toggleConstruction,
    },
  ];

  function updateHotkey(row: HotkeyRow, binding: HotkeyBinding) {
    setHotkeyError(null);
    updateConfig((current) => ({
      ...current,
      hotkeys: {
        ...current.hotkeys,
        [row.group]: {
          ...current.hotkeys[row.group],
          [row.key]: binding,
        },
      },
    }));
  }

  function captureHotkey(row: HotkeyRow, event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.code === "Escape") {
      setActiveHotkeyId(null);
      setHotkeyError(null);
      return;
    }

    const binding = bindingFromKeyboardEvent(event);
    const error = validateHotkey(binding, row, hotkeyRows);
    if (error) {
      setHotkeyError(error);
      return;
    }

    updateHotkey(row, binding);
    setActiveHotkeyId(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-6 py-8 backdrop-blur-sm">
      <section className="cad-floating-panel grid h-[min(680px,calc(100vh-64px))] min-h-0 w-[min(920px,calc(100vw-48px))] grid-cols-[220px_minmax(0,1fr)] overflow-hidden p-0">
        <aside className="border-r border-white/10 bg-black/15 p-3">
          <div className="px-2 py-2">
            <p className="cad-kicker">Settings</p>
          </div>
          <nav className="mt-3 flex flex-col gap-1">
            {[
              ["appearance", "Appearance"],
              ["keybinds", "Keybinds"],
              ["ai", "AI"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={
                  section === id
                    ? "rounded-md bg-white/10 px-3 py-2 text-left text-sm text-on-surface"
                    : "rounded-md px-3 py-2 text-left text-sm text-on-surface-muted transition-colors hover:bg-white/[0.04] hover:text-on-surface"
                }
                onClick={() => setSection(id as SettingsSection)}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
            <h2 className="font-display text-lg text-on-surface">
              {section === "appearance"
                ? "Appearance"
                : section === "keybinds"
                  ? "Keybinds"
                  : "AI"}
            </h2>
          </header>

          <div className="cad-scrollbar min-h-0 flex-1 overflow-auto p-5">
            {section === "appearance" ? (
              <div className="block max-w-sm">
                <span className="cad-kicker">Theme</span>
                <Dropdown
                  label="Theme"
                  className="mt-3 w-full"
                  value={config.theme}
                  options={availableThemes.map((theme) => ({
                    value: theme.id,
                    label: theme.name,
                  }))}
                  onChange={(theme) => {
                    const themeMap = Object.fromEntries(
                      availableThemes.map((entry) => [entry.id, entry]),
                    );
                    if (!isThemeAvailable(theme, themeMap)) {
                      return;
                    }
                    updateConfig((current) => ({
                      ...current,
                      theme,
                    }));
                  }}
                />
                {configPath && themesPath ? (
                  <div className="mt-4 space-y-1 text-xs text-on-surface-muted">
                    <p>Config: {configPath}</p>
                    <p>Themes: {themesPath}</p>
                  </div>
                ) : null}
              </div>
            ) : section === "keybinds" ? (
              <div className="space-y-2">
                {hotkeyError ? (
                  <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {hotkeyError}
                  </p>
                ) : null}
                {hotkeyRows.map((row) => (
                  <div
                    key={`${row.group}.${row.key}`}
                    className="grid grid-cols-[minmax(0,1fr)_180px_auto] items-center gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2"
                  >
                    <span className="text-sm text-on-surface">
                      {row.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`Set ${row.label} hotkey`}
                      className={
                        activeHotkeyId === rowId(row)
                          ? "cad-ribbon-action justify-center border-primary-edge text-on-surface"
                          : "cad-ribbon-action justify-center"
                      }
                      onClick={() => {
                        setActiveHotkeyId(rowId(row));
                        setHotkeyError(null);
                      }}
                      onKeyDown={(event) => {
                        if (activeHotkeyId !== rowId(row)) {
                          return;
                        }
                        captureHotkey(row, event.nativeEvent);
                      }}
                    >
                      {activeHotkeyId === rowId(row)
                        ? "Press shortcut"
                        : formatHotkey(row.binding)}
                    </button>
                    <button
                      type="button"
                      className="cad-ribbon-action"
                      onClick={() => {
                        const binding = getDefaultHotkey(row);
                        const error = validateHotkey(binding, row, hotkeyRows);
                        if (error) {
                          setHotkeyError(error);
                          return;
                        }
                        updateHotkey(row, binding);
                        setActiveHotkeyId(null);
                      }}
                    >
                      Reset
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="max-w-xl space-y-5">
                <div className="rounded-md border border-white/10 bg-white/[0.025] px-4 py-4">
                  <label className="flex items-center justify-between gap-4">
                    <span>
                      <span className="block text-sm font-medium text-on-surface">
                        Enable AI assistant
                      </span>
                      <span className="mt-1 block text-xs text-on-surface-muted">
                        Connects to a local Ollama server and previews validated
                        CAD commands before execution.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={config.ai.enabled}
                      onChange={(event) => {
                        updateConfig((current) => ({
                          ...current,
                          ai: {
                            ...current.ai,
                            enabled: event.target.checked,
                          },
                        }));
                      }}
                    />
                  </label>
                </div>

                <div className="space-y-3">
                  <label className="block">
                    <span className="cad-kicker">Ollama URL</span>
                    <input
                      className="mt-2 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-edge"
                      value={config.ai.baseUrl}
                      placeholder="http://localhost:11434"
                      onChange={(event) => {
                        setAiConnectionStatus(null);
                        updateConfig((current) => ({
                          ...current,
                          ai: {
                            ...current.ai,
                            baseUrl: event.target.value,
                          },
                        }));
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="cad-kicker">Model</span>
                    <input
                      className="mt-2 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-edge"
                      value={config.ai.model}
                      placeholder="gemma3:4b"
                      onChange={(event) => {
                        setAiConnectionStatus(null);
                        updateConfig((current) => ({
                          ...current,
                          ai: {
                            ...current.ai,
                            model: event.target.value,
                          },
                        }));
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="cad-kicker">Max Agent Steps</span>
                    <input
                      className="mt-2 w-28 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-on-surface outline-none transition-colors focus:border-primary-edge"
                      type="number"
                      min={1}
                      max={10}
                      value={config.ai.maxAgentSteps}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        updateConfig((current) => ({
                          ...current,
                          ai: {
                            ...current.ai,
                            maxAgentSteps: Number.isFinite(value) ? value : 5,
                          },
                        }));
                      }}
                    />
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="cad-ribbon-action"
                    disabled={isTestingAiConnection}
                    onClick={() => {
                      setIsTestingAiConnection(true);
                      setAiConnectionStatus("Testing connection...");
                      void testOllamaConnection(config.ai)
                        .then((message) => {
                          setAiConnectionStatus(message);
                        })
                        .catch((error) => {
                          setAiConnectionStatus(
                            `Connection failed: ${String(error)}`,
                          );
                        })
                        .finally(() => {
                          setIsTestingAiConnection(false);
                        });
                    }}
                  >
                    Test Connection
                  </button>
                  {aiConnectionStatus ? (
                    <span className="text-sm text-on-surface-muted">
                      {aiConnectionStatus}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-3">
            {isConfirmingResetAll ? (
              <>
                <span className="mr-auto text-sm text-on-surface-muted">
                  Reset all settings?
                </span>
                <button
                  type="button"
                  className="cad-ribbon-action"
                  onClick={() => setIsConfirmingResetAll(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cad-ribbon-action"
                  onClick={() => {
                    setConfig(defaultAppConfig);
                    setActiveHotkeyId(null);
                    setHotkeyError(null);
                    setIsConfirmingResetAll(false);
                  }}
                >
                  Confirm Reset
                </button>
              </>
            ) : (
              <button
                type="button"
                className="cad-ribbon-action"
                onClick={() => setIsConfirmingResetAll(true)}
              >
                Reset All
              </button>
            )}
            <button
              type="button"
              className="cad-ribbon-action"
              onClick={onClose}
            >
              Close
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
