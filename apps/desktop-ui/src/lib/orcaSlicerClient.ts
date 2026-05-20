import { invoke } from "@tauri-apps/api/core";

export interface SlicerViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface OrcaEmbedRequest {
  binaryPath: string;
  modelFilePath: string;
  bounds: SlicerViewportBounds;
}

export interface OrcaEmbedResult {
  platform: string;
  processId: number;
  status: "embedded" | "running" | "hidden" | "unsupported";
  message: string;
}

export function prepareOrcaExportPath(): Promise<string> {
  return invoke("prepare_orca_export_path");
}

export function embedOrcaWindow(
  request: OrcaEmbedRequest,
): Promise<OrcaEmbedResult> {
  return invoke("embed_orca_window", { request });
}

export function resizeOrcaWindow(
  bounds: SlicerViewportBounds,
): Promise<OrcaEmbedResult> {
  return invoke("resize_orca_window", { bounds });
}

export function hideOrcaWindow(): Promise<OrcaEmbedResult> {
  return invoke("hide_orca_window");
}
