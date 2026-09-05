// DSH Desktop — Tauri shell around the DeepSeek Harness web UI.
//
// Lifecycle:
//   1. setup: spawn the Node sidecar (`node <runtime>/@deepseek-ai/dsh/lib/bin.js web --port <DSH_PORT>`)
//   2. poll 127.0.0.1:<DSH_PORT> until the backend is ready
//   3. navigate the webview to http://127.0.0.1:<DSH_PORT>
//   4. on exit: kill the sidecar process tree (taskkill /T /F)
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{Manager, RunEvent};

/// Port the web backend listens on. Dev builds (debug, `npm run dev`) use 30080
/// so a dev instance can run alongside the installed app (which binds 3080) and
/// the Harness GUI on 3080; release builds keep 3080.
const DSH_PORT: u16 = if cfg!(debug_assertions) { 30080 } else { 3080 };
const DSH_BACKEND_READY_TIMEOUT: Duration = Duration::from_secs(120);

struct SidecarState(Mutex<Option<Child>>);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn dsh_ready() -> bool {
    TcpStream::connect(("127.0.0.1", DSH_PORT)).is_ok()
}

fn wait_until_ready(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if dsh_ready() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    dsh_ready()
}

/// Kill a Windows process tree by root PID (node sidecars spawn children).
#[cfg(windows)]
fn kill_process_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

/// Assign the child to a job with KILL_ON_JOB_CLOSE: when this process exits —
/// even by a hard kill that skips our exit handler — the OS kills the whole
/// sidecar tree. The job handle is intentionally leaked; the OS closes it on
/// our termination, which is exactly what triggers the cleanup.
#[cfg(windows)]
fn assign_to_kill_on_close_job(child: &Child) {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if configured == 0 {
            CloseHandle(job);
            return;
        }
        let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, child.id());
        if !process.is_null() {
            AssignProcessToJobObject(job, process);
            CloseHandle(process);
        }
    }
}

/// Locate the packaged resource root (node.exe + dsh-runtime).
///
/// Dev and bundled builds disagree about `resource_dir()`: a dev build points
/// at `target/debug` with resources copied to `target/debug/resources`, while
/// a bundled build points directly at the `resources` directory. Probe both.
fn find_resource_dir(app: &tauri::App) -> Option<PathBuf> {
    let base = app.path().resource_dir().ok()?;
    for dir in [base.clone(), base.join("resources")] {
        if dir.join("node.exe").exists() && dir.join("dsh-runtime").is_dir() {
            return Some(dir);
        }
    }
    None
}

/// DSH user-data home: debug builds use the dev-only tree under
/// `<crate>/target/dsh-dev`; release builds use `%APPDATA%/.../dsh-beta` so
/// this beta build never shares profiles/credentials with the stable `dsh`
/// install.
fn dsh_home_path(app: &tauri::App) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("dsh-dev"),
        )
    } else {
        app.path().app_config_dir().ok().map(|d| d.join("dsh-beta"))
    }
}

/// Best-effort startup plugin installer (see resources/plugin-install.js).
/// Never blocks booting: missing files or a failing install are logged and
/// skipped so the desktop app always starts.
fn install_plugins(app: &tauri::App) {
    let Some(resource_dir) = find_resource_dir(app) else {
        eprintln!("dsh-desktop: plugin installer skipped (resources not found)");
        return;
    };
    let Some(home) = dsh_home_path(app) else {
        eprintln!("dsh-desktop: plugin installer skipped (no dsh home)");
        return;
    };
    let node_exe = resource_dir.join("node.exe");
    let script = resource_dir.join("plugin-install.js");
    let config = resource_dir.join("plugins.config.json");
    let archives = resource_dir.join("plugins");
    if !node_exe.exists() || !script.exists() || !config.exists() {
        eprintln!("dsh-desktop: plugin installer skipped (bundled files missing)");
        return;
    }
    let mut child = match Command::new(&node_exe)
        .arg(&script)
        .arg(&config)
        .arg(&archives)
        .arg(&home)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
    {
        Ok(c) => c,
        Err(error) => {
            eprintln!("dsh-desktop: plugin installer spawn failed: {error}");
            return;
        }
    };
    match child.wait() {
        Ok(_) => eprintln!("dsh-desktop: plugin installer finished"),
        Err(error) => eprintln!("dsh-desktop: plugin installer wait failed: {error}"),
    }
}

fn start_dsh(app: &tauri::App) -> Result<Child, Box<dyn std::error::Error>> {
    let resource_dir = find_resource_dir(app)
        .ok_or_else(|| "packaged resources (node.exe, dsh-runtime) not found".to_string())?;
    let runtime_dir = resource_dir.join("dsh-runtime");
    let node_exe = resource_dir.join("node.exe");
    let bin_js = runtime_dir.join("node_modules/@deepseek-ai/dsh/lib/bin.js");

    for required in [&node_exe, &bin_js] {
        if !required.exists() {
            return Err(format!("missing packaged file: {}", required.display()).into());
        }
    }

    // Isolate dsh user data. Release builds keep user data in %APPDATA%;
    // dev builds (debug) use a dev-only home inside the build tree
    // (`<crate>/target/dsh-dev`) so dev sessions/credentials stay gitignored
    // and are wiped together with `cargo clean`.
    let dsh_home = dsh_home_path(app)
        .ok_or_else(|| "could not resolve dsh home".to_string())?;
    std::fs::create_dir_all(&dsh_home)?;

    let child = Command::new(&node_exe)
        .arg(&bin_js)
        .arg("web")
        .arg("--port")
        .arg(DSH_PORT.to_string())
        // The UI renders inside the WebView; never hand off to the default
        // browser (the web profile would otherwise auto-open one on boot).
        .arg("--no-open")
        .current_dir(&runtime_dir)
        .env("DSH_HOME", &dsh_home)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;
    assign_to_kill_on_close_job(&child);
    Ok(child)
}

fn navigate_when_ready(app: tauri::AppHandle) {
    thread::spawn(move || {
        // Give the window a moment to exist before polling.
        thread::sleep(Duration::from_secs(1));
        if !wait_until_ready(DSH_BACKEND_READY_TIMEOUT) {
            eprintln!("dsh-desktop: backend did not become ready on port {DSH_PORT}");
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            let url = format!("http://127.0.0.1:{DSH_PORT}");
            if let Err(error) = window.navigate(tauri::Url::parse(&url).expect("valid backend url")) {
                eprintln!("dsh-desktop: navigate failed: {error}");
            }
        }
    });
}

/// Exit the application for real. Called by the injected close-confirmation
/// dialog's danger-red button via `invoke('quit_app')`; remote-origin IPC is
/// scoped to localhost only through the `remote-ipc` capability.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Open a URL in the system default browser. Called by the injected
/// external-links script for non-local links.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

/// Open the WebView2 DevTools console (right-click menu "打开控制台").
/// Devtools are enabled in debug builds; on release this is a no-op.
#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(webview) = app.get_webview_window("main") {
        webview.open_devtools();
    }
}

/// JS injected into the webview when a close is requested. It renders a quit
/// confirmation dialog styled after the dsh design system (mask + blurred
/// backdrop, rounded card, outline cancel, danger-red confirm). The script
/// lives in its own file — `assets/quit-confirm.js` — embedded at compile
/// time; extend it there, no Rust changes needed for pure UI tweaks.
const QUIT_CONFIRM_SCRIPT: &str = include_str!("../assets/quit-confirm.js");

/// Context-menu script injected as a WebView2 initialization script: runs on
/// every page load (including reloads), so the menu survives the 刷新 item.
/// Lives in `assets/context-menu.js`; the webview is created with
/// `enable_clipboard_access()` so the script can read/write the clipboard from
/// plain JS (`navigator.clipboard`) — no Rust bridge command is needed.
///
/// A dev-mode flag is prepended so the injected script can gate dev-only
/// actions: the "打开控制台" DevTools item is rendered only in debug builds
/// (`window.__dshDevMode === true`), mirroring DevTools availability.
#[cfg(debug_assertions)]
const CONTEXT_MENU_SCRIPT: &str = concat!(
    "window.__dshDevMode = true;\n",
    include_str!("../assets/context-menu.js")
);
#[cfg(not(debug_assertions))]
const CONTEXT_MENU_SCRIPT: &str = concat!(
    "window.__dshDevMode = false;\n",
    include_str!("../assets/context-menu.js")
);

/// External-link script injected as a WebView2 initialization script: routes
/// left-clicks on non-local links to the system default browser via the
/// `open_url` command (see `assets/external-links.js`).
const EXTERNAL_LINKS_SCRIPT: &str = include_str!("../assets/external-links.js");

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Create the main window programmatically so we can attach a
            // WebView2 initialization script (runs on every page load,
            // including reloads — the context menu must survive 刷新) and
            // enable clipboard read access for the injected context menu.
            // The window config was moved here from tauri.conf.json.
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("DeepSeek Harness")
            .inner_size(980.0, 600.0)
            .min_inner_size(800.0, 600.0)
            .background_color(tauri::webview::Color(249, 250, 251, 255))
            .enable_clipboard_access()
            .initialization_script(CONTEXT_MENU_SCRIPT)
            .initialization_script(EXTERNAL_LINKS_SCRIPT)
            .on_new_window(|url, _features| {
                // window.open / target=_blank are swallowed by the runtime by
                // default; route them to the system browser instead.
                let _ = open::that(url.to_string());
                tauri::webview::NewWindowResponse::Deny
            })
            .build()?;

            // Install/update bundled plugins before the backend boots.
            install_plugins(app);

            match start_dsh(app) {
                Ok(child) => {
                    app.manage(SidecarState(Mutex::new(Some(child))));
                    navigate_when_ready(app.handle().clone());
                    Ok(())
                }
                Err(error) => {
                    eprintln!("dsh-desktop: failed to start backend: {error}");
                    Err(error.into())
                }
            }        })
        .invoke_handler(tauri::generate_handler![quit_app, open_url, open_devtools])
        .on_window_event(|window, event| {
            // Intercept window close: show the injected dsh-styled confirmation
            // dialog instead of quitting immediately.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Some(webview) = window.app_handle().get_webview_window("main") {
                    let _ = webview.eval(QUIT_CONFIRM_SCRIPT);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<SidecarState>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        kill_process_tree(child.id());
                    }
                }
            }
        });
}
