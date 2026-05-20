use std::{
    fs,
    process::{Child, Command},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct OrcaSlicerState {
    process: Mutex<Option<ManagedOrcaProcess>>,
}

struct ManagedOrcaProcess {
    binary_path: String,
    child: Child,
    window_handle: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SlicerViewportBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrcaEmbedRequest {
    pub binary_path: String,
    pub model_file_path: String,
    pub bounds: SlicerViewportBounds,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrcaEmbedResult {
    pub platform: String,
    pub process_id: u32,
    pub status: String,
    pub message: String,
}

pub fn prepare_orca_export_path() -> Result<String, String> {
    let dir = std::env::temp_dir().join("polysmith-orca");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    Ok(dir
        .join(format!("polysmith-orca-{timestamp}.stl"))
        .to_string_lossy()
        .to_string())
}

pub fn embed_orca_window(
    window: tauri::WebviewWindow,
    state: tauri::State<OrcaSlicerState>,
    request: OrcaEmbedRequest,
) -> Result<OrcaEmbedResult, String> {
    let binary_path = request.binary_path.trim();
    if binary_path.is_empty() {
        return Err("OrcaSlicer binary path is not configured".to_string());
    }
    if request.model_file_path.trim().is_empty() {
        return Err("Model file path is empty".to_string());
    }

    let (process_id, cached_window_handle) =
        ensure_orca_process(&state, binary_path, request.model_file_path.trim())?;

    let attach_result =
        platform_attach_orca_window(&window, process_id, cached_window_handle, &request.bounds)?;
    update_window_handle(&state, attach_result.window_handle)?;

    Ok(OrcaEmbedResult {
        platform: platform_name().to_string(),
        process_id,
        status: attach_result.status,
        message: attach_result.message,
    })
}

pub fn resize_orca_window(
    state: tauri::State<OrcaSlicerState>,
    bounds: SlicerViewportBounds,
) -> Result<OrcaEmbedResult, String> {
    let (process_id, window_handle) = current_orca_window(&state)?;
    let resize_result = platform_resize_orca_window(window_handle, &bounds)?;
    Ok(OrcaEmbedResult {
        platform: platform_name().to_string(),
        process_id,
        status: resize_result.status,
        message: resize_result.message,
    })
}

pub fn hide_orca_window(state: tauri::State<OrcaSlicerState>) -> Result<OrcaEmbedResult, String> {
    let (process_id, window_handle) = current_orca_window(&state)?;
    let hide_result = platform_hide_orca_window(window_handle)?;
    Ok(OrcaEmbedResult {
        platform: platform_name().to_string(),
        process_id,
        status: hide_result.status,
        message: hide_result.message,
    })
}

fn ensure_orca_process(
    state: &tauri::State<OrcaSlicerState>,
    binary_path: &str,
    model_file_path: &str,
) -> Result<(u32, Option<i64>), String> {
    let mut process = state
        .process
        .lock()
        .map_err(|_| "OrcaSlicer process state lock poisoned".to_string())?;

    if let Some(managed) = process.as_mut() {
        if managed.binary_path == binary_path
            && managed
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none()
        {
            return Ok((managed.child.id(), managed.window_handle));
        }
    }

    let child = Command::new(binary_path)
        .arg(model_file_path)
        .spawn()
        .map_err(|error| format!("Failed to launch OrcaSlicer: {error}"))?;
    let process_id = child.id();
    *process = Some(ManagedOrcaProcess {
        binary_path: binary_path.to_string(),
        child,
        window_handle: None,
    });
    Ok((process_id, None))
}

fn update_window_handle(
    state: &tauri::State<OrcaSlicerState>,
    window_handle: Option<i64>,
) -> Result<(), String> {
    if window_handle.is_none() {
        return Ok(());
    }
    let mut process = state
        .process
        .lock()
        .map_err(|_| "OrcaSlicer process state lock poisoned".to_string())?;
    if let Some(managed) = process.as_mut() {
        managed.window_handle = window_handle;
    }
    Ok(())
}

fn current_orca_window(
    state: &tauri::State<OrcaSlicerState>,
) -> Result<(u32, Option<i64>), String> {
    let mut process = state
        .process
        .lock()
        .map_err(|_| "OrcaSlicer process state lock poisoned".to_string())?;
    let Some(managed) = process.as_mut() else {
        return Err("OrcaSlicer is not running under PolySmith control".to_string());
    };
    if managed
        .child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some()
    {
        *process = None;
        return Err("OrcaSlicer process has exited".to_string());
    }
    Ok((managed.child.id(), managed.window_handle))
}

struct PlatformWindowResult {
    status: String,
    message: String,
    window_handle: Option<i64>,
}

#[cfg(windows)]
fn platform_attach_orca_window(
    window: &tauri::WebviewWindow,
    process_id: u32,
    cached_window_handle: Option<i64>,
    bounds: &SlicerViewportBounds,
) -> Result<PlatformWindowResult, String> {
    windows_impl::attach_orca_window(window, process_id, cached_window_handle, bounds)
}

#[cfg(not(windows))]
fn platform_attach_orca_window(
    _window: &tauri::WebviewWindow,
    _process_id: u32,
    _cached_window_handle: Option<i64>,
    _bounds: &SlicerViewportBounds,
) -> Result<PlatformWindowResult, String> {
    Ok(PlatformWindowResult {
        status: "unsupported".to_string(),
        message: format!(
            "OrcaSlicer was launched, but native window embedding is not implemented on {} yet.",
            platform_name()
        ),
        window_handle: None,
    })
}

#[cfg(windows)]
fn platform_resize_orca_window(
    window_handle: Option<i64>,
    bounds: &SlicerViewportBounds,
) -> Result<PlatformWindowResult, String> {
    windows_impl::resize_orca_window(window_handle, bounds)
}

#[cfg(not(windows))]
fn platform_resize_orca_window(
    _window_handle: Option<i64>,
    _bounds: &SlicerViewportBounds,
) -> Result<PlatformWindowResult, String> {
    Ok(PlatformWindowResult {
        status: "unsupported".to_string(),
        message: format!(
            "Native OrcaSlicer window resizing is not implemented on {} yet.",
            platform_name()
        ),
        window_handle: None,
    })
}

#[cfg(windows)]
fn platform_hide_orca_window(window_handle: Option<i64>) -> Result<PlatformWindowResult, String> {
    windows_impl::hide_orca_window(window_handle)
}

#[cfg(not(windows))]
fn platform_hide_orca_window(_window_handle: Option<i64>) -> Result<PlatformWindowResult, String> {
    Ok(PlatformWindowResult {
        status: "unsupported".to_string(),
        message: format!(
            "Native OrcaSlicer window hiding is not implemented on {} yet.",
            platform_name()
        ),
        window_handle: None,
    })
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

#[cfg(windows)]
mod windows_impl {
    use std::{thread, time::Duration};

    use super::{PlatformWindowResult, SlicerViewportBounds};
    use windows_sys::Win32::{
        Foundation::{BOOL, HWND, LPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowLongPtrW, GetWindowThreadProcessId, IsWindowVisible, SetParent,
            SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOZORDER,
            SW_HIDE, SW_SHOW, WS_CAPTION, WS_CHILD, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
            WS_OVERLAPPEDWINDOW, WS_THICKFRAME,
        },
    };

    pub fn attach_orca_window(
        window: &tauri::WebviewWindow,
        process_id: u32,
        cached_window_handle: Option<i64>,
        bounds: &SlicerViewportBounds,
    ) -> Result<PlatformWindowResult, String> {
        let parent = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
        let child = match cached_window_handle {
            Some(handle) => handle as HWND,
            None => wait_for_process_window(process_id)?,
        };

        unsafe {
            SetParent(child, parent);
            strip_window_chrome(child);
            move_child_window(child, bounds)?;
            ShowWindow(child, SW_SHOW);
        }

        Ok(PlatformWindowResult {
            status: "embedded".to_string(),
            message: "OrcaSlicer window embedded in the Slicer view.".to_string(),
            window_handle: Some(child as i64),
        })
    }

    pub fn resize_orca_window(
        window_handle: Option<i64>,
        bounds: &SlicerViewportBounds,
    ) -> Result<PlatformWindowResult, String> {
        let Some(handle) = window_handle else {
            return Err("No cached OrcaSlicer window handle is available".to_string());
        };
        unsafe {
            move_child_window(handle as HWND, bounds)?;
        }
        Ok(PlatformWindowResult {
            status: "embedded".to_string(),
            message: "OrcaSlicer window resized to the Slicer view.".to_string(),
            window_handle,
        })
    }

    pub fn hide_orca_window(window_handle: Option<i64>) -> Result<PlatformWindowResult, String> {
        let Some(handle) = window_handle else {
            return Err("No cached OrcaSlicer window handle is available".to_string());
        };
        unsafe {
            ShowWindow(handle as HWND, SW_HIDE);
        }
        Ok(PlatformWindowResult {
            status: "hidden".to_string(),
            message: "OrcaSlicer window hidden; process state preserved.".to_string(),
            window_handle,
        })
    }

    unsafe fn strip_window_chrome(hwnd: HWND) {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let stripped = (style as u32
            & !(WS_OVERLAPPEDWINDOW
                | WS_CAPTION
                | WS_THICKFRAME
                | WS_MINIMIZEBOX
                | WS_MAXIMIZEBOX))
            | WS_CHILD;
        SetWindowLongPtrW(hwnd, GWL_STYLE, stripped as isize);
    }

    unsafe fn move_child_window(hwnd: HWND, bounds: &SlicerViewportBounds) -> Result<(), String> {
        let scale = if bounds.scale_factor.is_finite() && bounds.scale_factor > 0.0 {
            bounds.scale_factor
        } else {
            1.0
        };
        let x = (bounds.x * scale).round() as i32;
        let y = (bounds.y * scale).round() as i32;
        let width = (bounds.width * scale).round().max(1.0) as i32;
        let height = (bounds.height * scale).round().max(1.0) as i32;
        let ok = SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            x,
            y,
            width,
            height,
            SWP_NOZORDER | SWP_FRAMECHANGED,
        );
        if ok == 0 {
            return Err("SetWindowPos failed for OrcaSlicer window".to_string());
        }
        Ok(())
    }

    fn wait_for_process_window(process_id: u32) -> Result<HWND, String> {
        for _ in 0..80 {
            if let Some(hwnd) = find_process_window(process_id) {
                return Ok(hwnd);
            }
            thread::sleep(Duration::from_millis(125));
        }
        Err("Timed out waiting for OrcaSlicer to create a visible window".to_string())
    }

    fn find_process_window(process_id: u32) -> Option<HWND> {
        let mut search = WindowSearch {
            process_id,
            window: std::ptr::null_mut(),
        };
        unsafe {
            EnumWindows(
                Some(enum_windows_proc),
                &mut search as *mut WindowSearch as LPARAM,
            );
        }
        if search.window.is_null() {
            None
        } else {
            Some(search.window)
        }
    }

    struct WindowSearch {
        process_id: u32,
        window: HWND,
    }

    unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam as *mut WindowSearch);
        let mut window_process_id = 0;
        GetWindowThreadProcessId(hwnd, &mut window_process_id);
        if window_process_id == search.process_id && IsWindowVisible(hwnd) != 0 {
            search.window = hwnd;
            return 0;
        }
        1
    }
}
