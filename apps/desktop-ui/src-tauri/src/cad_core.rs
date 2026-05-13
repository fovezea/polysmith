use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};

use crate::protocol::{emit_core_error, emit_core_event, emit_core_log};

mod cad_core_build_config {
    include!(concat!(env!("OUT_DIR"), "/cad_core_build_config.rs"));
}

pub struct CadCoreState {
    pub child: Mutex<Option<CadCoreProcess>>,
}

pub struct CadCoreProcess {
    #[allow(dead_code)]
    pub child: Child,
    pub stdin: ChildStdin,
}

pub fn cad_core_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = match cad_core_build_config::CAD_CORE_PATH_KIND {
        "resource" => app
            .path()
            .resolve(
                cad_core_build_config::CAD_CORE_RESOURCE_PATH,
                BaseDirectory::Resource,
            )
            .map_err(|e| format!("failed to resolve bundled cad_core resource: {e}"))?,
        "workspace" => {
            let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            path.push(cad_core_build_config::CAD_CORE_WORKSPACE_PATH);
            path
        }
        other => {
            return Err(format!(
                "unsupported cad_core path kind `{other}`; expected `workspace` or `resource`"
            ));
        }
    };

    #[cfg(target_os = "windows")]
    let path = {
        let mut path = path;
        path.set_extension("exe");
        path
    };

    if !path.exists() {
        return Err(format!("cad_core not found at {}", path.display()));
    }

    Ok(path)
}

pub fn start_cad_core_process(
    app: AppHandle,
    state: tauri::State<CadCoreState>,
) -> Result<String, String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;

    if guard.is_some() {
        return Ok("cad_core already running".to_string());
    }

    let core_path = cad_core_path(&app)?;
    eprintln!("Starting cad_core from {}", core_path.display());

    let mut child = Command::new(&core_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start cad_core at {}: {e}", core_path.display()))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to capture cad_core stdin".to_string())?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture cad_core stdout".to_string())?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture cad_core stderr".to_string())?;

    spawn_stdout_thread(app.clone(), stdout);
    spawn_stderr_thread(app.clone(), stderr);

    *guard = Some(CadCoreProcess { child, stdin });

    Ok("started".to_string())
}

pub fn send_core_command(
    state: tauri::State<CadCoreState>,
    command: String,
) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    let process = guard
        .as_mut()
        .ok_or_else(|| "cad_core is not running".to_string())?;

    writeln!(process.stdin, "{command}")
        .map_err(|e| format!("failed to write command to cad_core: {e}"))?;

    process
        .stdin
        .flush()
        .map_err(|e| format!("failed to flush cad_core stdin: {e}"))?;

    Ok(())
}

fn spawn_stdout_thread(app: AppHandle, stdout: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    if let Err(error) = emit_core_event(&app, &line) {
                        let _ = emit_core_error(
                            &app,
                            &format!("failed to parse cad_core stdout as JSON: {error}"),
                        );
                    }
                }
                Err(error) => {
                    let _ = emit_core_error(&app, &format!("stdout read error: {error}"));
                    break;
                }
            }
        }

        let _ = app.emit("cad-core-exited", "cad_core stdout closed");
    });
}

fn spawn_stderr_thread(app: AppHandle, stderr: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    let _ = emit_core_log(&app, &line);
                }
                Err(error) => {
                    let _ = emit_core_error(&app, &format!("stderr read error: {error}"));
                    break;
                }
            }
        }
    });
}
