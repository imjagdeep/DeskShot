//! DeskShot: screenshots that stay on your computer. Tray app, global
//! shortcut, one selection overlay per monitor, history, editor and OCR in
//! the window.

mod account;
mod capture;
mod card;
mod clipboard;
mod desklab;
mod history;
mod pin;
mod printscreen;
#[cfg(target_os = "macos")]
mod sck;
mod settings;
mod shoot;
mod state;
mod tray;

use settings::Settings;
use shoot::Mode;
use state::{AppState, Inner};
use std::path::PathBuf;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

type CmdResult<T> = Result<T, String>;

/// Cmd on macOS, Ctrl elsewhere.
#[cfg(target_os = "macos")]
const PRIMARY: Modifiers = Modifiers::SUPER;
#[cfg(not(target_os = "macos"))]
const PRIMARY: Modifiers = Modifiers::CONTROL;

/// Shown next to "Capture area" in the tray menu.
#[cfg(target_os = "macos")]
pub const SHORTCUT_TEXT: &str = "Cmd+Shift+2";
#[cfg(not(target_os = "macos"))]
pub const SHORTCUT_TEXT: &str = "Ctrl+Shift+2";

/// Ctrl/Cmd + Shift + 2: capture an area.
fn area_shortcut() -> Shortcut {
    Shortcut::new(Some(PRIMARY | Modifiers::SHIFT), Code::Digit2)
}

fn print_screen() -> Shortcut {
    Shortcut::new(None, Code::PrintScreen)
}

/// A small system notification; failures only matter to the log.
pub fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!("notification failed: {e}");
    }
}

#[derive(serde::Serialize)]
struct AppInfo {
    version: String,
    platform: &'static str,
    shortcut: &'static str,
    /// Where captures are saved when no folder is chosen.
    default_folder: Option<PathBuf>,
    /// Windows: the Snipping Tool owns Print Screen right now.
    snipping_owns_print_screen: bool,
}

#[tauri::command]
fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        shortcut: SHORTCUT_TEXT,
        default_folder: shoot::default_folder(&app).ok(),
        snipping_owns_print_screen: printscreen::snipping_owns_key(),
    }
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Settings {
    state.lock().settings.clone()
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> CmdResult<Settings> {
    let mut next = settings.clamp();
    let (before, dir) = {
        let st = state.lock();
        (st.settings.clone(), st.config_dir.clone())
    };
    // The app decides this one, not the page.
    next.took_print_screen = before.took_print_screen;
    if next.use_print_screen != before.use_print_screen {
        set_print_screen(&app, &mut next)?;
    }
    next.save(&dir)?;
    state.lock().settings = next.clone();
    Ok(next)
}

/// Take Print Screen (switching the Snipping Tool's use of it off if it had
/// it), or give it back exactly as it was.
fn set_print_screen(app: &AppHandle, s: &mut Settings) -> CmdResult<()> {
    let gs = app.global_shortcut();
    if s.use_print_screen {
        if printscreen::snipping_owns_key() {
            printscreen::set_snipping(false)?;
            s.took_print_screen = true;
        }
        gs.register(print_screen())
            .map_err(|e| format!("another app is using Print Screen: {e}"))?;
    } else {
        if gs.is_registered(print_screen()) {
            gs.unregister(print_screen())
                .map_err(|e| format!("cannot release Print Screen: {e}"))?;
        }
        if s.took_print_screen {
            printscreen::set_snipping(true)?;
            s.took_print_screen = false;
        }
    }
    Ok(())
}

#[tauri::command]
fn start_capture(app: AppHandle, mode: Mode, delay: u32) {
    shoot::start(&app, mode, delay, true);
}

fn overlay_of(window: &WebviewWindow) -> CmdResult<usize> {
    shoot::overlay_index(window.label()).ok_or_else(|| "not a capture window".to_string())
}

#[tauri::command]
fn overlay_info(app: AppHandle, window: WebviewWindow) -> CmdResult<shoot::OverlayInfo> {
    shoot::overlay_info(&app, overlay_of(&window)?)
}

/// The frozen picture of this overlay's monitor (BMP bytes, sent raw).
#[tauri::command]
fn overlay_image(app: AppHandle, window: WebviewWindow) -> CmdResult<Response> {
    Ok(Response::new(shoot::overlay_picture(
        &app,
        overlay_of(&window)?,
    )?))
}

/// The selection (pixels of this monitor's picture), or none to cancel.
#[tauri::command]
fn overlay_finish(
    app: AppHandle,
    window: WebviewWindow,
    rect: Option<capture::Rect>,
) -> CmdResult<()> {
    shoot::finish(&app, overlay_of(&window)?, rect)
}

#[tauri::command]
fn history_list(state: State<'_, AppState>) -> Vec<history::Entry> {
    history::list(&state.lock().data_dir)
}

#[tauri::command]
async fn history_image(state: State<'_, AppState>, id: String) -> CmdResult<Response> {
    let path = history::png_path(&state.lock().data_dir, &id)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("cannot open the capture: {e}"))?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn history_set_text(state: State<'_, AppState>, id: String, text: String) -> CmdResult<()> {
    history::set_text(&state.lock().data_dir, &id, &text)
}

/// Float a capture on top of every other window.
// ---------- the quick-capture card ----------

#[tauri::command]
fn card_info(app: AppHandle) -> CmdResult<history::Entry> {
    card::current(&app)
}

#[tauri::command]
fn card_close(app: AppHandle) {
    card::close(&app);
}

/// Edit: the card goes, the DeskShot window opens with the editor.
#[tauri::command]
fn card_edit(app: AppHandle, id: String) -> CmdResult<()> {
    card::close(&app);
    tray::show_main(&app);
    app.emit_to("main", "edit-capture", id)
        .map_err(|e| format!("cannot open the editor: {e}"))
}

#[tauri::command]
fn pin_capture(app: AppHandle, id: String) -> CmdResult<()> {
    pin::open(&app, &id)
}

/// Which capture this pin window shows.
#[tauri::command]
fn pin_info(app: AppHandle, window: WebviewWindow) -> CmdResult<pin::PinInfo> {
    pin::info(&app, window.label())
}

#[tauri::command]
fn pin_resize(app: AppHandle, window: WebviewWindow, width: f64) -> CmdResult<()> {
    pin::resize(&app, window.label(), width)
}

#[tauri::command]
fn history_delete(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    history::remove(&state.lock().data_dir, &id)
}

/// Put a capture (or an edited version of it, PNG bytes) on the clipboard.
#[tauri::command]
fn copy_png(app: AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected picture bytes".into());
    };
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("not a picture: {e}"))?
        .to_rgba8();
    clipboard::copy_image(&app, &img)
}

/// Keep an edited picture (PNG bytes) as a new capture: History, and the
/// clipboard and saved copy as the settings say.
#[tauri::command]
async fn save_edit(app: AppHandle, request: tauri::ipc::Request<'_>) -> CmdResult<history::Entry> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected picture bytes".into());
    };
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("not a picture: {e}"))?
        .to_rgba8();
    shoot::keep(&app, img, true)
}

/// Save PNG bytes to `path` as PNG or JPG (by the path's extension).
#[tauri::command]
fn save_png(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<()> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected picture bytes".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(|v| PathBuf::from(percent_decode(v)))
        .ok_or("no file name given")?;
    let jpg = matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("jpg" | "jpeg")
    );
    let out = if jpg {
        let img = image::load_from_memory(bytes)
            .map_err(|e| format!("not a picture: {e}"))?
            .to_rgba8();
        let q = state.lock().settings.jpg_quality;
        history::encode(&img, settings::Format::Jpg, q)?
    } else {
        bytes.clone()
    };
    let tmp = path.with_extension("deskshot-tmp");
    std::fs::write(&tmp, out).map_err(|e| format!("cannot save {}: {e}", path.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("cannot save {}: {e}", path.display()))
}

/// "%20" → " " (the page encodes the path for the header).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
fn reveal_file(app: AppHandle, path: PathBuf) -> CmdResult<()> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| format!("can't show {}: {e}", path.display()))
}

#[tauri::command]
fn open_folder(app: AppHandle, path: PathBuf) -> CmdResult<()> {
    std::fs::create_dir_all(&path).map_err(|e| format!("cannot create {}: {e}", path.display()))?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("can't open {}: {e}", path.display()))
}

/// Only these pages can be opened from the app.
#[tauri::command]
fn open_link(app: AppHandle, id: String) -> CmdResult<()> {
    let url = match id.as_str() {
        "site" => "https://jaggi.cc/tools/#deskshot",
        "repo" => "https://github.com/imjagdeep/DeskShot",
        "issues" => "https://github.com/imjagdeep/DeskShot/issues",
        "releases" => "https://github.com/imjagdeep/DeskShot/releases/latest",
        "developer" => "https://github.com/imjagdeep",
        "deskzero" => "https://github.com/imjagdeep/DeskZero/releases/latest",
        "deskmedic" => "https://github.com/imjagdeep/DeskMedic/releases/latest",
        "deskfolio" => "https://github.com/imjagdeep/DeskFolio/releases/latest",
        "deskshot" => "https://github.com/imjagdeep/DeskShot/releases/latest",
        // macOS: System Settings › Privacy & Security › Screen Recording.
        "screen-permission" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        _ => return Err(format!("unknown link {id}")),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// The other DeskLab tools and whether each is installed here.
#[tauri::command]
fn desklab_tools() -> Vec<desklab::LabTool> {
    desklab::list("deskshot")
}

/// Start another DeskLab tool, optionally handing it one file.
#[tauri::command]
fn open_tool(id: String, file: Option<PathBuf>) -> CmdResult<()> {
    desklab::open(&id, file.as_deref())
}

// ---------- the optional DeskLab account (all calls go through account.rs) ----------

type Acct<'a> = State<'a, account::Account>;

#[tauri::command]
async fn account_status(acct: Acct<'_>) -> CmdResult<account::Status> {
    acct.status().await.map_err(account::plain)
}

#[tauri::command]
async fn account_send_code(acct: Acct<'_>, email: String) -> CmdResult<()> {
    acct.send_code(&email).await.map_err(account::plain)
}

#[tauri::command]
async fn account_verify(acct: Acct<'_>, email: String, code: String) -> CmdResult<()> {
    acct.verify(&email, &code).await.map_err(account::plain)
}

#[tauri::command]
async fn account_login(acct: Acct<'_>, email: String, password: String) -> CmdResult<()> {
    acct.login(&email, &password).await.map_err(account::plain)
}

#[tauri::command]
async fn account_logout(acct: Acct<'_>) -> CmdResult<()> {
    acct.logout().await.map_err(account::plain)
}

#[tauri::command]
async fn account_set_password(
    acct: Acct<'_>,
    password: String,
    current: Option<String>,
) -> CmdResult<()> {
    acct.set_password(&password, current.as_deref())
        .await
        .map_err(account::plain)
}

#[tauri::command]
async fn account_remove_password(acct: Acct<'_>) -> CmdResult<()> {
    acct.remove_password().await.map_err(account::plain)
}

#[tauri::command]
async fn account_sign_out_device(acct: Acct<'_>, id: String) -> CmdResult<()> {
    acct.sign_out_device(&id).await.map_err(account::plain)
}

#[tauri::command]
async fn account_delete(acct: Acct<'_>, confirm: String) -> CmdResult<()> {
    acct.delete(&confirm).await.map_err(account::plain)
}

/// A downloaded update is ready: tell someone who only has the tray icon.
#[tauri::command]
fn notify_update(app: AppHandle, version: String) {
    notify(
        &app,
        &format!("DeskShot {version} is ready"),
        "Open DeskShot and choose Restart to update. It takes a few seconds.",
    );
}

/// Installed copies start with the computer (tray + shortcut ready); asked
/// once, then it's the user's setting.
fn first_start_autostart(app: &AppHandle, s: &mut Settings) {
    use tauri_plugin_autostart::ManagerExt;
    if s.autostart_applied {
        return;
    }
    s.autostart_applied = true;
    let installed = std::env::current_exe()
        .map(|p| {
            let p = p.to_string_lossy().to_lowercase();
            p.contains("appdata") || p.starts_with("/applications")
        })
        .unwrap_or(false);
    if installed {
        if let Err(e) = app.autolaunch().enable() {
            tracing::warn!("could not turn on start with the computer: {e}");
        }
    }
}

/// The uninstaller runs `deskshot --release-print-screen`: if DeskShot took
/// Print Screen from the Snipping Tool, give it back, then quit.
#[cfg(windows)]
fn release_print_screen_and_exit() {
    let Some(appdata) = std::env::var_os("APPDATA") else {
        return;
    };
    let dir = PathBuf::from(appdata).join("app.deskshot.desktop");
    let mut s = Settings::load(&dir);
    if s.took_print_screen {
        match printscreen::set_snipping(true) {
            Ok(()) => {
                s.took_print_screen = false;
                s.use_print_screen = false;
                if let Err(e) = s.save(&dir) {
                    tracing::warn!("{e}");
                }
            }
            Err(e) => tracing::warn!("{e}"),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ignored if a subscriber is already set (tests).
    let _ = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_max_level(tracing::Level::INFO)
        .with_ansi(false)
        .try_init();
    #[cfg(windows)]
    if std::env::args().any(|a| a == "--release-print-screen") {
        release_print_screen_and_exit();
        return;
    }
    tauri::Builder::default()
        // Must be first: a second launch opens the running window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Reopen where it was left, never hidden; overlays place themselves.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_filter(|label| {
                    !shoot::is_overlay(label) && !pin::is_pin(label) && !card::is_card(label)
                })
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && (shortcut == &area_shortcut() || shortcut == &print_screen())
                    {
                        shoot::start(app, Mode::Area, 0, false);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // DESKSHOT_DATA_DIR points it elsewhere (testing, portable use).
            let data_dir = match std::env::var_os("DESKSHOT_DATA_DIR") {
                Some(d) => PathBuf::from(d),
                None => app.path().app_data_dir()?,
            };
            std::fs::create_dir_all(&data_dir)?;
            let mut settings = Settings::load(&data_dir);
            first_start_autostart(app.handle(), &mut settings);
            if let Err(e) = settings.save(&data_dir) {
                tracing::warn!("{e}");
            }

            let gs = app.global_shortcut();
            if let Err(e) = gs.register(area_shortcut()) {
                // Another app owns the key: the tray and window still work.
                tracing::warn!("could not register {SHORTCUT_TEXT}: {e}");
            }
            if settings.use_print_screen {
                if let Err(e) = gs.register(print_screen()) {
                    tracing::warn!("could not register Print Screen: {e}");
                }
            }

            app.manage(AppState::new(Inner {
                config_dir: data_dir.clone(),
                data_dir,
                settings,
                frozen: None,
                mode: Mode::Area,
                pins: Default::default(),
                main_was_open: false,
                card: None,
            }));
            app.manage(account::Account::new("deskshot")?);
            tray::build(app.handle())?;

            // Started with the computer: stay in the tray.
            if std::env::args().any(|a| a == "--background") {
                tray::set_in_dock(app.handle(), false);
            } else {
                tray::show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps DeskShot in the tray, ready for the shortcut.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                    tray::set_in_dock(window.app_handle(), false);
                }
            }
            // A closed pin forgets its capture.
            if let WindowEvent::Destroyed = event {
                if pin::is_pin(window.label()) {
                    window
                        .app_handle()
                        .state::<AppState>()
                        .lock()
                        .pins
                        .remove(window.label());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            get_settings,
            save_settings,
            start_capture,
            overlay_info,
            overlay_image,
            overlay_finish,
            history_list,
            history_image,
            history_delete,
            history_set_text,
            pin_capture,
            card_info,
            card_close,
            card_edit,
            pin_info,
            pin_resize,
            copy_png,
            save_edit,
            save_png,
            reveal_file,
            open_folder,
            open_link,
            desklab_tools,
            open_tool,
            notify_update,
            account_status,
            account_send_code,
            account_verify,
            account_login,
            account_logout,
            account_set_password,
            account_remove_password,
            account_sign_out_device,
            account_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskShot");
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_header_paths() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5Cme%5Cshot%201.png"),
            r"C:\Users\me\shot 1.png"
        );
        assert_eq!(percent_decode("100%"), "100%");
    }
}
