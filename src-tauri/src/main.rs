#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf, process::{Command, Stdio}};
mod service_startup;
mod updater;
mod storage_paths;
use service_startup::ServiceEndpoint;
use sha2::{Digest, Sha256};
use tauri::{menu::{Menu, MenuItem}, tray::{TrayIconBuilder, TrayIconEvent}, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const SERVICE: &[u8] = include_bytes!("../../.cache/desktop-service/UmaTraceService.exe");
const SERVICE_DIGEST: &str = env!("UMATRACE_SERVICE_DIGEST");
const URL: &str = "http://127.0.0.1:4317";
const ICON_RGBA: &[u8] = include_bytes!("../icons/icon.rgba");

fn app_icon() -> tauri::image::Image<'static> {
    tauri::image::Image::new_owned(ICON_RGBA.to_vec(), 128, 128)
}

fn request(method: &str, path: &str, body: Option<&str>, token: Option<&str>) -> Option<serde_json::Value> {
    ServiceEndpoint { port: 4317 }.request(method, path, body, token)
}

fn health() -> Option<serde_json::Value> {
    ServiceEndpoint { port: 4317 }.health()
}

fn hidden(command: &mut Command) -> &mut Command {
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    // Every caller starts an independent app/service entry point. In particular,
    // an update may arrive through an older helper carrying a frozen service's
    // private PyInstaller environment for this same stable runtime pathname.
    command.env("PYINSTALLER_RESET_ENVIRONMENT", "1");
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW; no inherited console.
    command
}

fn data_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|_| "Could not resolve desktop executable.")?;
    let legacy = executable.parent().ok_or("Could not resolve installation folder.")?.join("Umalytics-data");
    let data = storage_paths::user_data()?;
    let _migration = storage_paths::lock(&data)?;
    if storage_paths::initialized(&data)? { return Ok(data); }
    storage_paths::regular(&legacy)?;
    // An older updater verifies the new collector at its original path. Let
    // that transaction finish before restarting once more to migrate storage.
    if legacy.join("cache/update/backup").exists() || legacy.join("cache/update/success.json").exists() {
        return Ok(legacy);
    }
    if legacy.exists() { ServiceEndpoint { port: 4317 }.stop_for_migration(&legacy)?; }
    storage_paths::migrate_once(&legacy, &data)?;
    Ok(data)
}

fn wait_for_parent(arguments: &mut Vec<String>) -> Result<(), String> {
    if arguments.first().map(String::as_str) != Some("--restart-after") { return Ok(()); }
    let pid: u32 = arguments.get(1).ok_or("Restart process is missing.")?.parse().map_err(|_| "Restart process is invalid.")?;
    #[cfg(windows)] {
        #[link(name="kernel32")] unsafe extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
            fn WaitForSingleObject(handle: *mut std::ffi::c_void, milliseconds: u32) -> u32;
            fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        }
        let handle = unsafe { OpenProcess(0x100000, 0, pid) };
        if !handle.is_null() {
            let result = unsafe { WaitForSingleObject(handle, 30000) };
            unsafe { CloseHandle(handle); }
            if result != 0 { return Err("The older window has not closed. Reopen Umalytics shortly.".into()); }
        }
    }
    #[cfg(not(windows))] { let _ = pid; std::thread::sleep(std::time::Duration::from_secs(2)); }
    arguments.drain(..2);
    Ok(())
}

fn extract_service(path: &PathBuf) -> Result<(), String> {
    let directory = path.parent().ok_or("Could not find the collector folder.")?;
    fs::create_dir_all(directory).map_err(|_| "Could not prepare Umalytics runtime.")?;
    // Compare exact embedded bytes before reusing an extracted runtime.
    if fs::read(&path).ok().as_deref() != Some(SERVICE) {
        let temporary = directory.join(format!("service-{}.partial", std::process::id()));
        fs::write(&temporary, SERVICE).map_err(|_| "Could not extract UmaTrace runtime.")?;
        // The previous PyInstaller parent can retain its file briefly after
        // releasing the HTTP port. Never overwrite a running collector.
        let mut replaced = false;
        for _ in 0..100 {
            if !path.exists() || fs::remove_file(path).is_ok() { replaced = true; break; }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        if !replaced { return Err("The older collector is still closing. Reopen Umalytics in a moment.".into()); }
        fs::rename(&temporary, path).map_err(|_| "Could not finish Umalytics runtime extraction.")?;
    }
    Ok(())
}

fn start_service(path: &PathBuf, data: &PathBuf) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|_| "Could not resolve desktop executable.")?;
    ServiceEndpoint { port: 4317 }.ensure_service_build(path, data, Some(SERVICE_DIGEST), || {
        extract_service(path)?;
        hidden(Command::new(path).arg("--serve").arg("--data-dir").arg(data).arg("--desktop-exe").arg(executable)).spawn().map_err(|_| "Could not start UmaTrace background service.")?;
        Ok(())
    })
}

fn follow_service(path: &PathBuf, data: &PathBuf) -> bool {
    for _ in 0..120 {
        if health().is_some_and(|status| ServiceEndpoint::matches_instance(&status, path, data)) { return true; }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    false
}

fn wait_for_exit(child: &mut std::process::Child, timeout_ms: u64) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) if std::time::Instant::now() >= deadline => return,
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(200)),
        }
    }
}

fn migrate_webview(data: &std::path::Path) -> Result<(), String> {
    let old = data.join("webview");
    if !old.exists() { return Ok(()); }
    let cache = data.join("cache");
    let current = cache.join("webview");
    for path in [&old, &cache, &current] {
        if let Ok(metadata) = fs::symlink_metadata(path) {
            #[cfg(windows)] {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 { return Err("A linked browser profile cannot be migrated. Your files are unchanged.".into()); }
            }
            if metadata.file_type().is_symlink() { return Err("A linked browser profile cannot be migrated. Your files are unchanged.".into()); }
        }
    }
    if current.exists() {
        return Err("Both old and new browser profiles exist. Your files were preserved; resolve the profile folders before opening Umalytics.".into());
    }
    fs::create_dir_all(&cache).map_err(|_| "Could not prepare the browser cache.")?;
    fs::rename(&old, &current).map_err(|_| "Close the older Umalytics window before migrating its browser profile.".into())
}

fn cleanup_legacy_runtimes(data: &std::path::Path) {
    let Ok(entries) = fs::read_dir(data.join("runtime")) else { return; };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.len() != 64 || !name.bytes().all(|c| c.is_ascii_hexdigit()) { continue; }
        let Ok(metadata) = fs::symlink_metadata(entry.path()) else { continue; };
        if !metadata.is_dir() || metadata.file_type().is_symlink() { continue; }
        #[cfg(windows)] {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 { continue; }
        }
        let path = entry.path().join("UmaTraceService.exe");
        let Ok(bytes) = fs::read(&path) else { continue; };
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if digest != name.to_lowercase() { continue; }
        // Only remove the known binary, then the directory if empty. Unknown
        // contents and a still-running old collector are left untouched.
        if fs::remove_file(path).is_ok() { let _ = fs::remove_dir(entry.path()); }
    }
}

fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn show_error(message: &str) {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" { fn MessageBoxW(window: *mut std::ffi::c_void, text: *const u16, title: *const u16, flags: u32) -> i32; }
        let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "Umalytics".encode_utf16().chain(Some(0)).collect();
        unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x40); }
    }
    #[cfg(not(windows))]
    eprintln!("{}", message);
}

fn open_browser(url: &str) {
    #[cfg(windows)]
    {
        #[link(name = "shell32")]
        extern "system" { fn ShellExecuteW(window: *mut std::ffi::c_void, operation: *const u16, file: *const u16, parameters: *const u16, directory: *const u16, show: i32) -> isize; }
        let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), 1); }
    }
}

fn main() {
    let mut arguments: Vec<String> = std::env::args().skip(1).collect();
    if let Err(error) = wait_for_parent(&mut arguments) { show_error(&error); std::process::exit(1); }
    if matches!(arguments.first().map(String::as_str), Some("--apply-update" | "--rollback-update")) {
        let result = arguments.get(1).ok_or_else(|| "Update transaction is missing.".to_string())
            .and_then(|path| if arguments[0] == "--apply-update" { updater::apply(std::path::Path::new(path)) } else { updater::rollback(std::path::Path::new(path)) });
        if let Err(error) = result { show_error(&error); std::process::exit(1); }
        return;
    }
    let data = match data_path() { Ok(path) => path, Err(error) => { show_error(&error); std::process::exit(1); } };
    let migration_pending = storage_paths::user_data().is_ok_and(|target| target != data);
    match updater::recover_pending(&data) {
        Ok(true) => return,
        Ok(false) => {},
        Err(error) => { show_error(&error); std::process::exit(1); }
    }
    if let Err(error) = updater::wait_replacement_turn(&data) { show_error(&error); std::process::exit(1); }
    let path = data.join("runtime").join("UmalyticsCollector.exe");
    if let Err(error) = migrate_webview(&data) { show_error(&error); std::process::exit(1); }
    let launch_game = arguments.first().map(String::as_str) == Some("--launch-game");
    let stop_after_game = launch_game
        && !health().is_some_and(|status| ServiceEndpoint::matches_instance(&status, &path, &data));
    if std::env::var_os("UMALYTICS_FOLLOW_SERVICE").is_some() {
        if !follow_service(&path, &data) { std::process::exit(0); }
    } else if let Err(error) = start_service(&path, &data) { show_error(&error); std::process::exit(1); }
    let _ = updater::cleanup(&data);
    cleanup_legacy_runtimes(&data);
    if launch_game {
        // Steam waits on this wrapper. A tray started for this session follows
        // the collector and must not start another one, so closing Uma can stop
        // an app that Steam itself launched. An already-running tray is reused.
        let mut tray = std::env::current_exe().ok().and_then(|executable| {
            hidden(Command::new(executable).arg("--background").env("UMALYTICS_FOLLOW_SERVICE", "1")).spawn().ok()
        });
        let code = hidden(Command::new(&path).args(&arguments)).status().ok().and_then(|s| s.code()).unwrap_or(1);
        if stop_after_game {
            ServiceEndpoint { port: 4317 }.stop_owned(&path, &data);
            if let Some(child) = tray.as_mut() { wait_for_exit(child, 40000); }
        }
        std::process::exit(code);
    }
    let background = arguments.first().map(String::as_str) == Some("--background");
    let shutdown_data = data.clone();
    let shutdown_runtime = path.clone();
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|arg| arg == "--background") { show(app); }
        }))
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(URL.parse()?))
                .on_navigation(|url| url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(4317))
                .on_new_window(|url, _features| {
                    if url.as_str() == "https://umalator.app/umalator-global/" || url.as_str() == "http://127.0.0.1:4317/api/licenses"
                        || (url.scheme() == "https" && url.host_str() == Some("gametora.com") && (url.path().starts_with("/\u{0075}mamusume/supports/") || url.path().starts_with("/\u{0075}mamusume/characters/"))) {
                        open_browser(url.as_str());
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .icon(app_icon())?
                .title("Umalytics").visible(!background).data_directory(data.join("cache").join("webview")).inner_size(1440.0, 960.0).min_inner_size(900.0, 650.0).build()?;
            let open = MenuItem::with_id(app, "open", "Open Umalytics", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "Exit Umalytics and stop collection", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &exit])?;
            let tray_data = data.clone();
            let tray_runtime = path.clone();
            TrayIconBuilder::with_id("umatrace")
                .icon(app_icon()).tooltip("Umalytics — background collection service")
                .menu(&menu).show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => show(app),
                    "exit" => {
                        if let Some(status) = health() {
                            if ServiceEndpoint::matches_instance(&status, &tray_runtime, &tray_data) {
                                let stopped = request("POST", "/api/app/exit", Some("{}"), status["csrfToken"].as_str());
                                if stopped.is_none_or(|value| value["ok"] != true) {
                                    show_error("Collection could not stop. Please try Exit again.");
                                    return;
                                }
                            }
                        }
                        app.exit(0);
                    },
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| { if let TrayIconEvent::DoubleClick { .. } = event { show(tray.app_handle()); } })
                .build(app)?;
            updater::desktop_ready(&data)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut unavailable = 0;
                let mut ticks = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(750));
                    ticks += 1;
                    if ticks % 14 == 0 && data.join("cache/update/success.json").is_file() {
                        let _ = updater::cleanup(&data);
                    }
                    if migration_pending && !data.join("cache/update/backup").exists()
                        && !data.join("cache/update/transaction.json").exists()
                        && !data.join("cache/update/success.json").exists() {
                        if let Some(status) = health() {
                            if ServiceEndpoint::matches_instance(&status, &path, &data) {
                                let stopped = request("POST", "/api/app/exit", Some("{\"onlyIfIdle\":true}"), status["csrfToken"].as_str());
                                if stopped.is_some_and(|value| value["ok"] == true) {
                                    if let Ok(exe) = std::env::current_exe() {
                                        let mut restart = Command::new(exe);
                                        restart.arg("--restart-after").arg(std::process::id().to_string());
                                        if background { restart.arg("--background"); }
                                        if hidden(&mut restart).spawn().is_err() { show_error("Reopen Umalytics to finish moving your data to AppData."); }
                                    }
                                    handle.exit(0); break;
                                }
                            }
                        }
                    }
                    match health() {
                        Some(status) => {
                            unavailable = 0;
                            if !ServiceEndpoint::matches_instance(&status, &path, &data)
                                || status["runtimeBuildSha256"].as_str() != Some(SERVICE_DIGEST)
                                || status["update"]["phase"] == "restarting" {
                                handle.exit(0);
                                break;
                            }
                            {
                                let state = if status["proxy"]["collectionEnabled"] == false { "Collection paused" }
                                    else if status["certificate"]["trusted"] != true { "Certificate needed" }
                                    else if status["proxy"]["gameConnected"] == true { "Game connected" }
                                    else if status["proxy"]["listening"] == true || status["proxy"]["state"] == "running" { "Waiting for game" }
                                    else if status["proxy"]["state"] == "starting" { "Starting collector" }
                                    else { "Collection stopped" };
                                let title = format!("Umalytics — {state}");
                                if let Some(tray) = handle.tray_by_id("umatrace") { let _ = tray.set_tooltip(Some(&title)); }
                                if let Some(window) = handle.get_webview_window("main") { let _ = window.set_title(&title); }
                            }
                        }
                        None => {
                            unavailable += 1;
                            if let Some(window) = handle.get_webview_window("main") { let _ = window.set_title("Umalytics — Reconnecting to collector"); }
                            if unavailable >= 4 && !(ServiceEndpoint { port: 4317 }).listening() { handle.exit(0); break; }
                        }
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| { if let WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); } })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        // Failed tray/window setup must not leave an invisible collector.
        if let Some(status) = health() {
            if ServiceEndpoint::matches_instance(&status, &shutdown_runtime, &shutdown_data) {
                let _ = request("POST", "/api/app/exit", Some("{\"onlyIfIdle\":true}"), status["csrfToken"].as_str());
            }
        }
        show_error(&format!("Could not open Umalytics: {error}"));
        std::process::exit(1);
    }
}
