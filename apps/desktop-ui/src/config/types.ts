export interface HotkeyBinding {
  code: string;
  label: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface AppHotkeys {
  global: {
    undo: HotkeyBinding;
    redo: HotkeyBinding;
  };
  toolbar: {
    extrude: HotkeyBinding;
    fillet: HotkeyBinding;
    project: HotkeyBinding;
  };
  sketchToolbar: {
    createSketch: HotkeyBinding;
    line: HotkeyBinding;
    rectangle: HotkeyBinding;
    circle: HotkeyBinding;
    dimension: HotkeyBinding;
    toggleConstruction: HotkeyBinding;
  };
}

export type CrosshairMode =
  | "default"
  | "viewport-25"
  | "viewport-50"
  | "viewport-75"
  | "infinite";

export interface ViewportConfig {
  crosshair: CrosshairMode;
}

export interface AiConfig {
  enabled: boolean;
  provider: "ollama";
  baseUrl: string;
  model: string;
  previewBeforeRun: boolean;
  maxAgentSteps: number;
}

export type ThemeSelection =
  | "system"
  | "dark"
  | "light"
  | "catppuccin-latte"
  | "catppuccin-frappe"
  | "catppuccin-macchiato"
  | "catppuccin-mocha"
  | (string & {});

export interface AppConfig {
  theme: ThemeSelection;
  hotkeys: AppHotkeys;
  viewport: ViewportConfig;
  ai: AiConfig;
}

export interface ThemeConfig {
  id: string;
  name: string;
  colors: Record<string, string>;
}
