import { invoke } from "@tauri-apps/api/core";

let didShowMainWindow = false;
let showMainWindowRequest: Promise<void> | null = null;

export function showMainWindow() {
  if (didShowMainWindow) {
    return Promise.resolve();
  }
  if (showMainWindowRequest) {
    return showMainWindowRequest;
  }

  showMainWindowRequest = invoke("show_main_window")
    .then(() => {
      didShowMainWindow = true;
    })
    .finally(() => {
      showMainWindowRequest = null;
    });

  return showMainWindowRequest;
}
