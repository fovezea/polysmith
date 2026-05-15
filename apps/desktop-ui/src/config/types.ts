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
    line: HotkeyBinding;
    rectangle: HotkeyBinding;
    circle: HotkeyBinding;
    dimension: HotkeyBinding;
    toggleConstruction: HotkeyBinding;
  };
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
}

export interface ThemeConfig {
  id: string;
  name: string;
  colors: Record<string, string>;
}
