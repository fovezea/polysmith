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
    display_handle: Option<usize>,
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
    pub model_file_path: Option<String>,
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

pub fn configure_linux_windowing_environment() {
    #[cfg(target_os = "linux")]
    {
        // Wayland does not allow foreign toplevel reparenting. On Wayland
        // desktops this asks GTK/Wry and Qt-based OrcaSlicer to use XWayland
        // so both windows have X11 handles that can be embedded.
        std::env::set_var("GDK_BACKEND", "x11");
        std::env::set_var("WINIT_UNIX_BACKEND", "x11");
        std::env::set_var("QT_QPA_PLATFORM", "xcb");
    }
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
    let model_file_path = request
        .model_file_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty());

    let (process_id, cached_window_handle) =
        ensure_orca_process(&state, binary_path, model_file_path)?;

    let attach_result =
        platform_attach_orca_window(&window, process_id, cached_window_handle, &request.bounds)?;
    update_native_handles(
        &state,
        attach_result.window_handle,
        attach_result.display_handle,
    )?;

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
    let (process_id, window_handle, display_handle) = current_orca_window(&state)?;
    let resize_result = platform_resize_orca_window(window_handle, display_handle, &bounds)?;
    Ok(OrcaEmbedResult {
        platform: platform_name().to_string(),
        process_id,
        status: resize_result.status,
        message: resize_result.message,
    })
}

pub fn hide_orca_window(state: tauri::State<OrcaSlicerState>) -> Result<OrcaEmbedResult, String> {
    let (process_id, window_handle, display_handle) = current_orca_window(&state)?;
    let hide_result = platform_hide_orca_window(window_handle, display_handle)?;
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
    model_file_path: Option<&str>,
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
            if let Some(path) = model_file_path {
                spawn_orca(binary_path, Some(path))?;
            }
            return Ok((managed.child.id(), managed.window_handle));
        }
    }

    let child = spawn_orca(binary_path, model_file_path)?;
    let process_id = child.id();
    *process = Some(ManagedOrcaProcess {
        binary_path: binary_path.to_string(),
        child,
        window_handle: None,
        display_handle: None,
    });
    Ok((process_id, None))
}

fn spawn_orca(binary_path: &str, model_file_path: Option<&str>) -> Result<Child, String> {
    let mut command = Command::new(binary_path);
    if let Some(path) = model_file_path {
        command.arg(path);
    }
    configure_orca_environment(&mut command);
    command
        .spawn()
        .map_err(|error| format!("Failed to launch OrcaSlicer: {error}"))
}

fn configure_orca_environment(command: &mut Command) {
    #[cfg(target_os = "linux")]
    {
        command.env("GDK_BACKEND", "x11");
        command.env("QT_QPA_PLATFORM", "xcb");
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = command;
    }
}

fn update_native_handles(
    state: &tauri::State<OrcaSlicerState>,
    window_handle: Option<i64>,
    display_handle: Option<usize>,
) -> Result<(), String> {
    if window_handle.is_none() && display_handle.is_none() {
        return Ok(());
    }
    let mut process = state
        .process
        .lock()
        .map_err(|_| "OrcaSlicer process state lock poisoned".to_string())?;
    if let Some(managed) = process.as_mut() {
        if window_handle.is_some() {
            managed.window_handle = window_handle;
        }
        if display_handle.is_some() {
            managed.display_handle = display_handle;
        }
    }
    Ok(())
}

fn current_orca_window(
    state: &tauri::State<OrcaSlicerState>,
) -> Result<(u32, Option<i64>, Option<usize>), String> {
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
    Ok((
        managed.child.id(),
        managed.window_handle,
        managed.display_handle,
    ))
}

struct PlatformWindowResult {
    status: String,
    message: String,
    window_handle: Option<i64>,
    display_handle: Option<usize>,
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

#[cfg(target_os = "linux")]
fn platform_attach_orca_window(
    window: &tauri::WebviewWindow,
    process_id: u32,
    cached_window_handle: Option<i64>,
    bounds: &SlicerViewportBounds,
) -> Result<PlatformWindowResult, String> {
    linux_x11_impl::attach_orca_window(window, process_id, cached_window_handle, bounds)
}

#[cfg(all(not(windows), not(target_os = "linux")))]
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
        display_handle: None,
    })
}

#[cfg(windows)]
fn platform_resize_orca_window(
    window_handle: Option<i64>,
    _display_handle: Option<usize>,
    bounds: &SlicerViewportBounds,
) -> Result<PlatformWindowResult, String> {
    windows_impl::resize_orca_window(window_handle, bounds)
}

#[cfg(target_os = "linux")]
fn platform_resize_orca_window(
    window_handle: Option<i64>,
    display_handle: Option<usize>,
    bounds: &SlicerViewportBounds,
) -> Result<PlatformWindowResult, String> {
    linux_x11_impl::resize_orca_window(window_handle, display_handle, bounds)
}

#[cfg(all(not(windows), not(target_os = "linux")))]
fn platform_resize_orca_window(
    _window_handle: Option<i64>,
    _display_handle: Option<usize>,
    _bounds: &SlicerViewportBounds,
) -> Result<PlatformWindowResult, String> {
    Ok(PlatformWindowResult {
        status: "unsupported".to_string(),
        message: format!(
            "Native OrcaSlicer window resizing is not implemented on {} yet.",
            platform_name()
        ),
        window_handle: None,
        display_handle: None,
    })
}

#[cfg(windows)]
fn platform_hide_orca_window(
    window_handle: Option<i64>,
    _display_handle: Option<usize>,
) -> Result<PlatformWindowResult, String> {
    windows_impl::hide_orca_window(window_handle)
}

#[cfg(target_os = "linux")]
fn platform_hide_orca_window(
    window_handle: Option<i64>,
    display_handle: Option<usize>,
) -> Result<PlatformWindowResult, String> {
    linux_x11_impl::hide_orca_window(window_handle, display_handle)
}

#[cfg(all(not(windows), not(target_os = "linux")))]
fn platform_hide_orca_window(
    _window_handle: Option<i64>,
    _display_handle: Option<usize>,
) -> Result<PlatformWindowResult, String> {
    Ok(PlatformWindowResult {
        status: "unsupported".to_string(),
        message: format!(
            "Native OrcaSlicer window hiding is not implemented on {} yet.",
            platform_name()
        ),
        window_handle: None,
        display_handle: None,
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

#[cfg(target_os = "linux")]
mod linux_x11_impl {
    use std::{
        ffi::{c_char, c_int, c_long, c_uchar, c_uint, c_ulong, c_void, CString},
        ptr, thread,
        time::Duration,
    };

    use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};

    use super::{PlatformWindowResult, SlicerViewportBounds};

    type Display = c_void;
    type Window = c_ulong;
    type Atom = c_ulong;

    const ANY_PROPERTY_TYPE: Atom = 0;
    const PROP_MODE_REPLACE: c_int = 0;
    const MWM_HINTS_DECORATIONS: c_ulong = 1 << 1;

    #[repr(C)]
    struct MotifWmHints {
        flags: c_ulong,
        functions: c_ulong,
        decorations: c_ulong,
        input_mode: c_long,
        status: c_ulong,
    }

    #[link(name = "X11")]
    extern "C" {
        fn XDefaultRootWindow(display: *mut Display) -> Window;
        fn XQueryTree(
            display: *mut Display,
            window: Window,
            root_return: *mut Window,
            parent_return: *mut Window,
            children_return: *mut *mut Window,
            nchildren_return: *mut c_uint,
        ) -> c_int;
        fn XFree(data: *mut c_void) -> c_int;
        fn XInternAtom(
            display: *mut Display,
            atom_name: *const c_char,
            only_if_exists: c_int,
        ) -> Atom;
        fn XGetWindowProperty(
            display: *mut Display,
            window: Window,
            property: Atom,
            long_offset: c_long,
            long_length: c_long,
            delete: c_int,
            req_type: Atom,
            actual_type_return: *mut Atom,
            actual_format_return: *mut c_int,
            nitems_return: *mut c_ulong,
            bytes_after_return: *mut c_ulong,
            prop_return: *mut *mut c_uchar,
        ) -> c_int;
        fn XChangeProperty(
            display: *mut Display,
            window: Window,
            property: Atom,
            property_type: Atom,
            format: c_int,
            mode: c_int,
            data: *const c_uchar,
            nelements: c_int,
        ) -> c_int;
        fn XReparentWindow(
            display: *mut Display,
            window: Window,
            parent: Window,
            x: c_int,
            y: c_int,
        ) -> c_int;
        fn XMoveResizeWindow(
            display: *mut Display,
            window: Window,
            x: c_int,
            y: c_int,
            width: c_uint,
            height: c_uint,
        ) -> c_int;
        fn XMapRaised(display: *mut Display, window: Window) -> c_int;
        fn XUnmapWindow(display: *mut Display, window: Window) -> c_int;
        fn XFlush(display: *mut Display) -> c_int;
    }

    pub fn attach_orca_window(
        window: &tauri::WebviewWindow,
        process_id: u32,
        cached_window_handle: Option<i64>,
        bounds: &SlicerViewportBounds,
    ) -> Result<PlatformWindowResult, String> {
        let (display, parent) = x11_parent_handles(window)?;
        let child = match cached_window_handle {
            Some(handle) => handle as Window,
            None => wait_for_process_window(display, process_id)?,
        };
        let (x, y, width, height) = scaled_bounds(bounds);

        unsafe {
            strip_window_chrome(display, child);
            XReparentWindow(display, child, parent, x, y);
            XMoveResizeWindow(display, child, x, y, width, height);
            XMapRaised(display, child);
            XFlush(display);
        }

        Ok(PlatformWindowResult {
            status: "embedded".to_string(),
            message: "OrcaSlicer window embedded in the Slicer view.".to_string(),
            window_handle: Some(child as i64),
            display_handle: Some(display as usize),
        })
    }

    pub fn resize_orca_window(
        window_handle: Option<i64>,
        display_handle: Option<usize>,
        bounds: &SlicerViewportBounds,
    ) -> Result<PlatformWindowResult, String> {
        let Some(handle) = window_handle else {
            return Err("No cached OrcaSlicer X11 window is available".to_string());
        };
        let Some(display_handle) = display_handle else {
            return Err("No cached X11 display handle is available".to_string());
        };
        let display = display_handle as *mut Display;
        let (x, y, width, height) = scaled_bounds(bounds);
        unsafe {
            XMoveResizeWindow(display, handle as Window, x, y, width, height);
            XFlush(display);
        }
        Ok(PlatformWindowResult {
            status: "embedded".to_string(),
            message: "OrcaSlicer window resized to the Slicer view.".to_string(),
            window_handle,
            display_handle: Some(display_handle),
        })
    }

    pub fn hide_orca_window(
        window_handle: Option<i64>,
        display_handle: Option<usize>,
    ) -> Result<PlatformWindowResult, String> {
        let Some(handle) = window_handle else {
            return Err("No cached OrcaSlicer X11 window is available".to_string());
        };
        let Some(display_handle) = display_handle else {
            return Err("No cached X11 display handle is available".to_string());
        };
        let display = display_handle as *mut Display;
        unsafe {
            XUnmapWindow(display, handle as Window);
            XFlush(display);
        }
        Ok(PlatformWindowResult {
            status: "hidden".to_string(),
            message: "OrcaSlicer window hidden; process state preserved.".to_string(),
            window_handle,
            display_handle: Some(display_handle),
        })
    }

    fn x11_parent_handles(window: &tauri::WebviewWindow) -> Result<(*mut Display, Window), String> {
        let display_handle = window.display_handle().map_err(|error| error.to_string())?;
        let window_handle = window.window_handle().map_err(|error| error.to_string())?;

        let display = match display_handle.as_raw() {
            RawDisplayHandle::Xlib(handle) => handle
                .display
                .ok_or_else(|| "X11 display handle is unavailable".to_string())?
                .as_ptr() as *mut Display,
            RawDisplayHandle::Wayland(_) => {
                return Err(
                    "Linux OrcaSlicer embedding requires XWayland. PolySmith requested the X11 backend at startup, but the window is still running on native Wayland. Make sure XWayland is installed/enabled, then restart PolySmith.".to_string(),
                );
            }
            other => {
                return Err(format!(
                    "Linux OrcaSlicer embedding requires an Xlib window; got {other:?}."
                ));
            }
        };

        let parent = match window_handle.as_raw() {
            RawWindowHandle::Xlib(handle) => handle.window,
            RawWindowHandle::Wayland(_) => {
                return Err(
                    "Linux OrcaSlicer embedding requires XWayland. PolySmith requested the X11 backend at startup, but the window is still running on native Wayland. Make sure XWayland is installed/enabled, then restart PolySmith.".to_string(),
                );
            }
            other => {
                return Err(format!(
                    "Linux OrcaSlicer embedding requires an Xlib parent window; got {other:?}."
                ));
            }
        };

        if display.is_null() || parent == 0 {
            return Err("X11 parent window handle is unavailable".to_string());
        }

        Ok((display, parent))
    }

    fn wait_for_process_window(display: *mut Display, process_id: u32) -> Result<Window, String> {
        for _ in 0..80 {
            if let Some(window) = find_process_window(display, process_id)? {
                return Ok(window);
            }
            thread::sleep(Duration::from_millis(125));
        }
        Err("Timed out waiting for OrcaSlicer to create an X11 window".to_string())
    }

    fn find_process_window(
        display: *mut Display,
        process_id: u32,
    ) -> Result<Option<Window>, String> {
        let root = unsafe { XDefaultRootWindow(display) };
        let pid_atom = intern_atom(display, "_NET_WM_PID")?;
        find_process_window_under(display, root, pid_atom, process_id)
    }

    fn find_process_window_under(
        display: *mut Display,
        parent: Window,
        pid_atom: Atom,
        process_id: u32,
    ) -> Result<Option<Window>, String> {
        if window_pid(display, parent, pid_atom)? == Some(process_id) {
            return Ok(Some(parent));
        }

        let mut root = 0;
        let mut parent_return = 0;
        let mut children: *mut Window = ptr::null_mut();
        let mut child_count = 0;
        let query_ok = unsafe {
            XQueryTree(
                display,
                parent,
                &mut root,
                &mut parent_return,
                &mut children,
                &mut child_count,
            )
        };
        if query_ok == 0 {
            return Ok(None);
        }

        let child_slice = if children.is_null() || child_count == 0 {
            &[][..]
        } else {
            unsafe { std::slice::from_raw_parts(children, child_count as usize) }
        };
        for child in child_slice.iter().copied().rev() {
            if let Some(found) = find_process_window_under(display, child, pid_atom, process_id)? {
                if !children.is_null() {
                    unsafe {
                        XFree(children as *mut c_void);
                    }
                }
                return Ok(Some(found));
            }
        }

        if !children.is_null() {
            unsafe {
                XFree(children as *mut c_void);
            }
        }
        Ok(None)
    }

    fn window_pid(
        display: *mut Display,
        window: Window,
        pid_atom: Atom,
    ) -> Result<Option<u32>, String> {
        let mut actual_type = 0;
        let mut actual_format = 0;
        let mut item_count = 0;
        let mut bytes_after = 0;
        let mut property: *mut c_uchar = ptr::null_mut();

        let status = unsafe {
            XGetWindowProperty(
                display,
                window,
                pid_atom,
                0,
                1,
                0,
                ANY_PROPERTY_TYPE,
                &mut actual_type,
                &mut actual_format,
                &mut item_count,
                &mut bytes_after,
                &mut property,
            )
        };
        if status != 0 || property.is_null() || item_count == 0 {
            if !property.is_null() {
                unsafe {
                    XFree(property as *mut c_void);
                }
            }
            return Ok(None);
        }

        let pid = if actual_format == 32 {
            Some(unsafe { *(property as *const c_ulong) as u32 })
        } else {
            None
        };
        unsafe {
            XFree(property as *mut c_void);
        }
        Ok(pid)
    }

    unsafe fn strip_window_chrome(display: *mut Display, window: Window) {
        let hints_atom = match intern_atom(display, "_MOTIF_WM_HINTS") {
            Ok(atom) => atom,
            Err(_) => return,
        };
        let hints = MotifWmHints {
            flags: MWM_HINTS_DECORATIONS,
            functions: 0,
            decorations: 0,
            input_mode: 0,
            status: 0,
        };
        XChangeProperty(
            display,
            window,
            hints_atom,
            hints_atom,
            32,
            PROP_MODE_REPLACE,
            &hints as *const MotifWmHints as *const c_uchar,
            5,
        );
    }

    fn intern_atom(display: *mut Display, name: &str) -> Result<Atom, String> {
        let name = CString::new(name).map_err(|error| error.to_string())?;
        let atom = unsafe { XInternAtom(display, name.as_ptr(), 0) };
        if atom == 0 {
            return Err("Failed to intern X11 atom".to_string());
        }
        Ok(atom)
    }

    fn scaled_bounds(bounds: &SlicerViewportBounds) -> (c_int, c_int, c_uint, c_uint) {
        let scale = if bounds.scale_factor.is_finite() && bounds.scale_factor > 0.0 {
            bounds.scale_factor
        } else {
            1.0
        };
        let x = (bounds.x * scale).round() as c_int;
        let y = (bounds.y * scale).round() as c_int;
        let width = (bounds.width * scale).round().max(1.0) as c_uint;
        let height = (bounds.height * scale).round().max(1.0) as c_uint;
        (x, y, width, height)
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
            display_handle: None,
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
            display_handle: None,
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
            display_handle: None,
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
