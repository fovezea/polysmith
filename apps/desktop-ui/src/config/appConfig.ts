import { invoke } from "@tauri-apps/api/core";
import defaultConfig from "./config.json";
import catppuccinFrappeTheme from "./themes/catppuccin-frappe.json";
import catppuccinLatteTheme from "./themes/catppuccin-latte.json";
import catppuccinMacchiatoTheme from "./themes/catppuccin-macchiato.json";
import catppuccinMochaTheme from "./themes/catppuccin-mocha.json";
import darkTheme from "./themes/dark.json";
import lightTheme from "./themes/light.json";
import type {
  AppConfig,
  HotkeyBinding,
  ThemeConfig,
  ThemeSelection,
} from "./types";

const bundledThemes: Record<string, ThemeConfig> = {
  dark: darkTheme,
  light: lightTheme,
  "catppuccin-latte": catppuccinLatteTheme,
  "catppuccin-frappe": catppuccinFrappeTheme,
  "catppuccin-macchiato": catppuccinMacchiatoTheme,
  "catppuccin-mocha": catppuccinMochaTheme,
};

const CONFIG_STORAGE_KEY = "polysmith.appConfig";

export const DEFAULT_THEME_FILES = [
  { fileName: "dark.json", contents: darkTheme },
  { fileName: "light.json", contents: lightTheme },
  { fileName: "catppuccin-latte.json", contents: catppuccinLatteTheme },
  { fileName: "catppuccin-frappe.json", contents: catppuccinFrappeTheme },
  { fileName: "catppuccin-macchiato.json", contents: catppuccinMacchiatoTheme },
  { fileName: "catppuccin-mocha.json", contents: catppuccinMochaTheme },
];

export const defaultAppConfig = defaultConfig as AppConfig;
export const SYSTEM_THEME_ID = "system";
export const systemThemeOption = {
  id: SYSTEM_THEME_ID,
  name: "System",
} as const;
export const defaultThemes = bundledThemes;
export const defaultAvailableThemes = [
  systemThemeOption,
  ...Object.values(bundledThemes),
];

export interface AppConfigBootstrap {
  config: AppConfig;
  themes: Record<string, ThemeConfig>;
  configPath: string | null;
  themesPath: string | null;
}

interface NativeConfigBootstrap {
  config_path: string;
  themes_path: string;
  config: Partial<AppConfig>;
  themes: unknown[];
}

export function getSystemThemeId(): "dark" | "light" {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function isThemeSelection(value: string): value is ThemeSelection {
  return value.length > 0;
}

export function isThemeAvailable(
  value: string,
  themes: Record<string, unknown>,
): value is ThemeSelection {
  return value === SYSTEM_THEME_ID || value in themes;
}

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function mergeAppConfig(input: Partial<AppConfig>): AppConfig {
  return {
    ...defaultAppConfig,
    ...input,
    hotkeys: {
      ...defaultAppConfig.hotkeys,
      ...input.hotkeys,
      global: {
        ...defaultAppConfig.hotkeys.global,
        ...input.hotkeys?.global,
      },
      toolbar: {
        ...defaultAppConfig.hotkeys.toolbar,
        ...input.hotkeys?.toolbar,
      },
      sketchToolbar: {
        ...defaultAppConfig.hotkeys.sketchToolbar,
        ...input.hotkeys?.sketchToolbar,
      },
    },
  };
}

function isThemeConfig(value: unknown): value is ThemeConfig {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ThemeConfig>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Boolean(candidate.colors) &&
    typeof candidate.colors === "object"
  );
}

function themeMapFromList(themes: unknown[]): Record<string, ThemeConfig> {
  const result: Record<string, ThemeConfig> = {};
  for (const theme of themes) {
    if (isThemeConfig(theme)) {
      result[theme.id] = theme;
    }
  }
  return result;
}

function normalizeConfig(
  input: Partial<AppConfig>,
  themes: Record<string, ThemeConfig> = bundledThemes,
): AppConfig {
  const config = mergeAppConfig(input);
  if (!isThemeAvailable(config.theme, themes)) {
    return {
      ...config,
      theme: defaultAppConfig.theme,
    };
  }
  return config;
}

function loadLocalAppConfig(): AppConfig {
  if (typeof window === "undefined") {
    return cloneConfig(defaultAppConfig);
  }

  const stored = window.localStorage.getItem(CONFIG_STORAGE_KEY);
  if (!stored) {
    return cloneConfig(defaultAppConfig);
  }

  try {
    return normalizeConfig(JSON.parse(stored) as Partial<AppConfig>);
  } catch {
    return cloneConfig(defaultAppConfig);
  }
}

function saveLocalAppConfig(config: AppConfig): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
}

export function loadAppConfig(): AppConfig {
  return loadLocalAppConfig();
}

export async function bootstrapAppConfig(): Promise<AppConfigBootstrap> {
  try {
    const bootstrap = await invoke<NativeConfigBootstrap>(
      "bootstrap_app_config",
      {
        defaultConfig,
        defaultThemes: DEFAULT_THEME_FILES,
      },
    );
    const themes = themeMapFromList(bootstrap.themes);
    const usableThemes =
      Object.keys(themes).length > 0 ? themes : { ...bundledThemes };
    return {
      config: normalizeConfig(bootstrap.config, usableThemes),
      themes: usableThemes,
      configPath: bootstrap.config_path,
      themesPath: bootstrap.themes_path,
    };
  } catch {
    return {
      config: loadLocalAppConfig(),
      themes: { ...bundledThemes },
      configPath: null,
      themesPath: null,
    };
  }
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  try {
    await invoke("save_app_config", { config });
  } catch {
    saveLocalAppConfig(config);
  }
}

export function getActiveTheme(
  config: AppConfig = defaultAppConfig,
  themes: Record<string, ThemeConfig> = bundledThemes,
): ThemeConfig {
  const themeId =
    config.theme === SYSTEM_THEME_ID ? getSystemThemeId() : config.theme;
  return themes[themeId] ?? bundledThemes.dark;
}

export function applyTheme(theme: ThemeConfig = getActiveTheme()): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme.id;
  for (const [token, value] of Object.entries(theme.colors)) {
    root.style.setProperty(token, value);
  }
}

export function formatHotkey(binding: HotkeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrlOrMeta) {
    parts.push(navigator.platform.toLowerCase().includes("mac") ? "Cmd" : "Ctrl");
  }
  if (binding.shift) {
    parts.push("Shift");
  }
  if (binding.alt) {
    parts.push("Alt");
  }
  parts.push(binding.label);
  return parts.join("+");
}

export function matchesHotkey(event: KeyboardEvent, binding: HotkeyBinding) {
  if (event.code !== binding.code) {
    return false;
  }

  if (Boolean(binding.ctrlOrMeta) !== (event.metaKey || event.ctrlKey)) {
    return false;
  }

  return (
    Boolean(binding.shift) === event.shiftKey &&
    Boolean(binding.alt) === event.altKey
  );
}
