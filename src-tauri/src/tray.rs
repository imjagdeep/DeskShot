//! Tray (Windows) / menu-bar (macOS) icon: the capture menu.

use crate::shoot::{self, Mode};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let area = MenuItem::with_id(app, "area", "Capture area", true, Some(crate::SHORTCUT_TEXT))?;
    let window = MenuItem::with_id(app, "window", "Capture window", true, None::<&str>)?;
    let screen = MenuItem::with_id(app, "screen", "Capture full screen", true, None::<&str>)?;
    let delay = Submenu::with_items(
        app,
        "Capture area after…",
        true,
        &[
            &MenuItem::with_id(app, "delay3", "3 seconds", true, None::<&str>)?,
            &MenuItem::with_id(app, "delay5", "5 seconds", true, None::<&str>)?,
            &MenuItem::with_id(app, "delay10", "10 seconds", true, None::<&str>)?,
        ],
    )?;
    let open = MenuItem::with_id(app, "open", "Open DeskShot", true, None::<&str>)?;
    let history = MenuItem::with_id(app, "history", "History", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &area,
            &window,
            &screen,
            &delay,
            &PredefinedMenuItem::separator(app)?,
            &open,
            &history,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("DeskShot")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "area" => shoot::start(app, Mode::Area, 0),
            "window" => shoot::start(app, Mode::Window, 0),
            "screen" => shoot::start(app, Mode::Screen, 0),
            "delay3" => shoot::start(app, Mode::Area, 3),
            "delay5" => shoot::start(app, Mode::Area, 5),
            "delay10" => shoot::start(app, Mode::Area, 10),
            "open" => show_main(app),
            "history" | "settings" => {
                show_main(app);
                let _ = app.emit("navigate", event.id().as_ref());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    match tray_image() {
        Some(icon) => builder = builder.icon(icon),
        None => {
            if let Some(icon) = app.default_window_icon() {
                builder = builder.icon(icon.clone());
            }
        }
    }
    builder.build(app)?;
    Ok(())
}

/// The small icon drawn for the tray: the 32 px, or 64 px for the macOS
/// menu bar (2x).
fn tray_image() -> Option<tauri::image::Image<'static>> {
    #[cfg(target_os = "macos")]
    let bytes: &[u8] = include_bytes!("../icons/64x64.png");
    #[cfg(not(target_os = "macos"))]
    let bytes: &[u8] = include_bytes!("../icons/32x32.png");
    match tauri::image::Image::from_bytes(bytes) {
        Ok(i) => Some(i),
        Err(e) => {
            tracing::warn!("tray icon: {e}");
            None
        }
    }
}

/// macOS: in the Dock only while the window is open; otherwise DeskShot
/// lives in the menu bar alone.
#[cfg(target_os = "macos")]
pub fn set_in_dock(app: &AppHandle, visible: bool) {
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    if let Err(e) = app.set_activation_policy(policy) {
        tracing::warn!("could not change the Dock icon: {e}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_in_dock(_app: &AppHandle, _visible: bool) {}

pub fn show_main(app: &AppHandle) {
    set_in_dock(app, true);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
