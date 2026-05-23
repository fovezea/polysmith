// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_config;
mod cad_core;
mod orca_slicer;
mod project_metadata;
mod protocol;

use std::sync::Mutex;

use cad_core::{start_cad_core_process, CadCoreState};
use orca_slicer::OrcaSlicerState;
use serde_json::Value;

#[tauri::command]
fn start_cad_core(
    app: tauri::AppHandle,
    state: tauri::State<CadCoreState>,
) -> Result<String, String> {
    start_cad_core_process(app, state)
}

#[tauri::command]
fn send_core_command(state: tauri::State<CadCoreState>, command: String) -> Result<(), String> {
    cad_core::send_core_command(state, command)
}

#[tauri::command]
fn bootstrap_app_config(
    default_config: Value,
    default_themes: Vec<app_config::ThemeFile>,
) -> Result<app_config::ConfigBootstrap, String> {
    app_config::bootstrap_app_config(default_config, default_themes)
}

#[tauri::command]
fn save_app_config(config: Value) -> Result<(), String> {
    app_config::save_app_config(config)
}

#[tauri::command]
fn load_recent_projects() -> Result<Value, String> {
    project_metadata::load_recent_projects()
}

#[tauri::command]
fn save_recent_projects(document: Value) -> Result<(), String> {
    project_metadata::save_recent_projects(document)
}

#[tauri::command]
fn read_project_thumbnail(file_path: String) -> Result<Option<String>, String> {
    project_metadata::read_project_thumbnail(file_path)
}

#[tauri::command]
fn write_project_thumbnail(
    file_path: String,
    thumbnail_data_url: Option<String>,
) -> Result<(), String> {
    project_metadata::write_project_thumbnail(file_path, thumbnail_data_url)
}

#[tauri::command]
fn delete_project_file(file_path: String) -> Result<(), String> {
    project_metadata::delete_project_file(file_path)
}

#[tauri::command]
fn project_file_exists(file_path: String) -> Result<bool, String> {
    project_metadata::project_file_exists(file_path)
}

#[tauri::command]
fn prepare_orca_export_path() -> Result<String, String> {
    orca_slicer::prepare_orca_export_path()
}

#[tauri::command]
fn embed_orca_window(
    window: tauri::WebviewWindow,
    state: tauri::State<OrcaSlicerState>,
    request: orca_slicer::OrcaEmbedRequest,
) -> Result<orca_slicer::OrcaEmbedResult, String> {
    orca_slicer::embed_orca_window(window, state, request)
}

#[tauri::command]
fn resize_orca_window(
    state: tauri::State<OrcaSlicerState>,
    bounds: orca_slicer::SlicerViewportBounds,
) -> Result<orca_slicer::OrcaEmbedResult, String> {
    orca_slicer::resize_orca_window(state, bounds)
}

#[tauri::command]
fn hide_orca_window(
    state: tauri::State<OrcaSlicerState>,
) -> Result<orca_slicer::OrcaEmbedResult, String> {
    orca_slicer::hide_orca_window(state)
}

#[tauri::command]
fn set_orca_mapped(
    state: tauri::State<OrcaSlicerState>,
    mapped: bool,
) -> Result<orca_slicer::OrcaEmbedResult, String> {
    orca_slicer::set_orca_mapped_window(state, mapped)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    orca_slicer::configure_linux_windowing_environment();

    tauri::Builder::default()
        .manage(CadCoreState {
            child: Mutex::new(None),
        })
        .manage(OrcaSlicerState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_cad_core,
            send_core_command,
            bootstrap_app_config,
            save_app_config,
            load_recent_projects,
            save_recent_projects,
            read_project_thumbnail,
            write_project_thumbnail,
            delete_project_file,
            project_file_exists,
            prepare_orca_export_path,
            embed_orca_window,
            resize_orca_window,
            hide_orca_window,
            set_orca_mapped
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
