// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_config;
mod cad_core;
mod protocol;

use std::sync::Mutex;

use cad_core::{start_cad_core_process, CadCoreState};
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CadCoreState {
            child: Mutex::new(None),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_cad_core,
            send_core_command,
            bootstrap_app_config,
            save_app_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
