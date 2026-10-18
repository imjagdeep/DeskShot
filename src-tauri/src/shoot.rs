//! One capture from start to finish: hide our window, wait out any delay,
//! freeze every screen, show one selection overlay per monitor, then crop,
//! keep, copy and save the result.

use crate::capture::{self, Frozen, Rect};
use crate::history;
use crate::settings::{AfterCapture, Format};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Drag a rectangle (a plain click picks the window under the cursor).
    Area,
    /// Click a window.
    Window,
    /// The whole monitor under the cursor, no overlay.
    Screen,
}

const OVERLAY: &str = "overlay-";

pub fn is_overlay(label: &str) -> bool {
    label.starts_with(OVERLAY)
}

pub fn overlay_index(label: &str) -> Option<usize> {
    label.strip_prefix(OVERLAY)?.parse().ok()
}

/// Start a capture on a background thread (the shortcut, tray and window all
/// come here). A capture already on screen is cancelled first.
///
/// `from_window`: started with DeskShot's own Capture buttons. Only then is
/// the window hidden for the picture and brought back afterwards; the
/// shortcut and the menu bar leave it alone, like macOS's own screenshots,
/// and "After a quick capture" decides what shows.
pub fn start(app: &AppHandle, mode: Mode, delay_secs: u32, from_window: bool) {
    tracing::info!("capture requested: {mode:?}, delay {delay_secs}s, from window: {from_window}");
    close_overlays(app);
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = run(&app, mode, delay_secs, from_window) {
            report_error(&app, &e);
        }
    });
}

fn run(app: &AppHandle, mode: Mode, delay_secs: u32, from_window: bool) -> Result<(), String> {
    app.state::<AppState>().lock().main_was_open = false;
    // Started from our own window: keep it out of the picture.
    if let Some(w) = app.get_webview_window("main").filter(|_| from_window) {
        let open = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        app.state::<AppState>().lock().main_was_open = open;
        if open {
            let _ = w.hide();
            std::thread::sleep(Duration::from_millis(220));
        }
    }
    if delay_secs > 0 {
        let _ = app.emit("capture-countdown", delay_secs);
        std::thread::sleep(Duration::from_secs(delay_secs.min(30) as u64));
    }
    let frozen = capture::grab_all()?;
    tracing::info!(
        "screens captured: {:?}",
        frozen
            .shots
            .iter()
            .map(|s| (s.image.width(), s.image.height()))
            .collect::<Vec<_>>()
    );
    if mode == Mode::Screen {
        let i = cursor_shot(app, &frozen);
        let shot = &frozen.shots[i];
        let full = Rect {
            x: 0,
            y: 0,
            w: shot.image.width(),
            h: shot.image.height(),
        };
        let img = capture::crop(shot, &full).ok_or("the screen picture is empty")?;
        return keep(app, img, false).map(|_| ());
    }
    let places: Vec<Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>> = frozen
        .shots
        .iter()
        .map(|s| tauri_place(app, &s.area))
        .collect();
    {
        let state = app.state::<AppState>();
        let mut st = state.lock();
        st.frozen = Some(frozen);
        st.mode = mode;
    }
    for (i, place) in places.into_iter().enumerate() {
        tracing::info!("overlay {i} at {place:?}");
        open_overlay(app, i, place).map_err(|e| format!("cannot show the capture screen: {e}"))?;
    }
    Ok(())
}

/// Where Tauri puts the monitor with this xcap area (physical pixels).
/// xcap reports physical pixels on Windows and points on macOS, so either
/// the physical position or position / scale must match.
fn tauri_place(app: &AppHandle, area: &Rect) -> Option<(PhysicalPosition<i32>, PhysicalSize<u32>)> {
    let monitors = app.available_monitors().ok()?;
    monitors
        .iter()
        .find(|m| {
            let p = m.position();
            let s = m.scale_factor();
            (p.x == area.x && p.y == area.y)
                || ((p.x as f64 / s).round() as i32 == area.x
                    && (p.y as f64 / s).round() as i32 == area.y)
        })
        .map(|m| (*m.position(), *m.size()))
}

fn cursor_shot(app: &AppHandle, f: &Frozen) -> usize {
    let Ok(pos) = app.cursor_position() else {
        return 0;
    };
    let Ok(Some(m)) = app.monitor_from_point(pos.x, pos.y) else {
        return 0;
    };
    let p = m.position();
    let s = m.scale_factor();
    f.shots
        .iter()
        .position(|shot| {
            (shot.area.x == p.x && shot.area.y == p.y)
                || (shot.area.x == (p.x as f64 / s).round() as i32
                    && shot.area.y == (p.y as f64 / s).round() as i32)
        })
        .unwrap_or_else(|| capture::monitor_at(&f.shots, pos.x as i32, pos.y as i32))
}

fn open_overlay(
    app: &AppHandle,
    i: usize,
    place: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>,
) -> tauri::Result<()> {
    let w = WebviewWindowBuilder::new(
        app,
        format!("{OVERLAY}{i}"),
        WebviewUrl::App("index.html".into()),
    )
    .title("DeskShot capture")
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .shadow(false)
    .visible_on_all_workspaces(true)
    // The page shows the window once the frozen picture is drawn.
    .visible(false)
    .build()?;
    // macOS: the frame is set in one go on the main thread (tao's own
    // position/size calls are deferred and left the picture shifted down by
    // the menu bar's height).
    #[cfg(target_os = "macos")]
    {
        let scale = place
            .and_then(|(pos, _)| {
                app.available_monitors()
                    .ok()?
                    .into_iter()
                    .find(|m| *m.position() == pos)
                    .map(|m| m.scale_factor())
            })
            .unwrap_or(1.0);
        above_menu_bar(app, &w, place, scale);
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some((pos, size)) = place {
            w.set_position(pos)?;
            w.set_size(size)?;
        } else {
            w.maximize()?;
        }
    }
    Ok(())
}

/// macOS: "always on top" is only the floating level, so the menu bar (and
/// the notch area) stayed on top of the overlay. Lift it to the screen-saver
/// level, like the system's own ⌘⇧4, on every Space. AppKit calls belong on
/// the main thread.
#[cfg(target_os = "macos")]
fn above_menu_bar(
    app: &AppHandle,
    w: &tauri::WebviewWindow,
    place: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>,
    scale: f64,
) {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    let w = w.clone();
    let done = app.run_on_main_thread(move || {
        let Ok(ptr) = w.ns_window() else { return };
        let win = ptr.cast::<AnyObject>();
        unsafe {
            // NSScreenSaverWindowLevel = 1000; collection behaviour:
            // canJoinAllSpaces (1) | stationary (16) | fullScreenAuxiliary (256).
            let _: () = objc2::msg_send![win, setLevel: 1000isize];
            let _: () = objc2::msg_send![win, setCollectionBehavior: 273usize];
            // The monitor's rectangle in points, Cocoa style (origin at the
            // bottom-left of the main screen, y going up).
            let screens: *mut AnyObject = objc2::msg_send![objc2::class!(NSScreen), screens];
            let main: *mut AnyObject = objc2::msg_send![screens, firstObject];
            if main.is_null() {
                return;
            }
            let main_frame: NSRect = objc2::msg_send![main, frame];
            let frame = match place {
                Some((pos, size)) => {
                    let (x, y) = (pos.x as f64 / scale, pos.y as f64 / scale);
                    let (wd, ht) = (size.width as f64 / scale, size.height as f64 / scale);
                    NSRect::new(
                        NSPoint::new(x, main_frame.size.height - y - ht),
                        NSSize::new(wd, ht),
                    )
                }
                None => main_frame,
            };
            let _: () = objc2::msg_send![win, setFrame: frame, display: true];
        }
    });
    if let Err(e) = done {
        tracing::warn!("cannot raise the capture screen: {e}");
    }
}

pub fn close_overlays(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if is_overlay(&label) {
            if let Err(e) = w.destroy() {
                tracing::warn!("cannot close {label}: {e}");
            }
        }
    }
}

#[derive(Serialize)]
pub struct OverlayInfo {
    pub mode: Mode,
    pub width: u32,
    pub height: u32,
    pub targets: Vec<capture::PickTarget>,
}

pub fn overlay_info(app: &AppHandle, index: usize) -> Result<OverlayInfo, String> {
    let state = app.state::<AppState>();
    let st = state.lock();
    let f = st.frozen.as_ref().ok_or("no capture in progress")?;
    let shot = f.shots.get(index).ok_or("unknown screen")?;
    Ok(OverlayInfo {
        mode: st.mode,
        width: shot.image.width(),
        height: shot.image.height(),
        targets: capture::targets_for(shot, &f.windows),
    })
}

/// The frozen picture for the overlay to show. Windows: an uncompressed BMP
/// (a 4K PNG took most of a second to encode, a bitmap costs almost
/// nothing). macOS: a fast PNG, because WebKit never finished loading the
/// 32-bit BMP of a Retina screen, so the overlay stayed invisible.
pub fn overlay_picture(app: &AppHandle, index: usize) -> Result<Vec<u8>, String> {
    let state = app.state::<AppState>();
    let st = state.lock();
    let f = st.frozen.as_ref().ok_or("no capture in progress")?;
    let shot = f.shots.get(index).ok_or("unknown screen")?;
    if cfg!(target_os = "macos") {
        history::encode_png(&shot.image)
    } else {
        history::encode_bmp(&shot.image)
    }
}

/// The overlay is done: a rectangle in that monitor's picture, or None to cancel.
pub fn finish(app: &AppHandle, index: usize, rect: Option<Rect>) -> Result<(), String> {
    let frozen = app.state::<AppState>().lock().frozen.take();
    close_overlays(app);
    let (Some(f), Some(r)) = (frozen, rect) else {
        // Cancelled: bring the window back if it was open.
        if std::mem::take(&mut app.state::<AppState>().lock().main_was_open) {
            crate::tray::show_main(app);
        }
        return Ok(());
    };
    let shot = f.shots.get(index).ok_or("unknown screen")?;
    let img = capture::crop(shot, &r).ok_or("the selection is empty")?;
    let app = app.clone();
    // Encoding and saving can take a moment on big screens: off this thread.
    std::thread::spawn(move || {
        if let Err(e) = keep(&app, img, false) {
            report_error(&app, &e);
        }
    });
    Ok(())
}

/// Keep a finished capture: history, clipboard, saved copy, then tell the
/// window. An edited picture (`edited`) comes from the open window itself,
/// so no window is raised and no notification shown.
pub fn keep(
    app: &AppHandle,
    img: image::RgbaImage,
    edited: bool,
) -> Result<history::Entry, String> {
    let now = chrono::Local::now();
    let id = now.format("%Y%m%d-%H%M%S-%3f").to_string();
    let (settings, data) = {
        let state = app.state::<AppState>();
        let st = state.lock();
        (st.settings.clone(), st.data_dir.clone())
    };

    let saved = if settings.save_to_folder {
        let folder = match &settings.save_folder {
            Some(f) => f.clone(),
            None => default_folder(app)?,
        };
        std::fs::create_dir_all(&folder)
            .map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
        let ext = if settings.format == Format::Jpg {
            "jpg"
        } else {
            "png"
        };
        let path = history::free_name(
            &folder,
            &now.format("%Y-%m-%d at %H.%M.%S").to_string(),
            ext,
        );
        let bytes = history::encode(&img, settings.format, settings.jpg_quality)?;
        std::fs::write(&path, bytes).map_err(|e| format!("cannot save {}: {e}", path.display()))?;
        Some(path)
    } else {
        None
    };

    let entry = history::add(
        &data,
        &id,
        &img,
        saved,
        now.timestamp_millis(),
        settings.history_limit as usize,
    )?;

    if settings.copy_to_clipboard {
        crate::clipboard::copy_image(app, &img)?;
    }

    let _ = app.emit("captured", &entry);
    if edited {
        return Ok(entry);
    }
    // Captured from the open window: it comes back with the capture.
    // Quick captures (shortcut, tray) get the card, the window or a note.
    let from_window = std::mem::take(&mut app.state::<AppState>().lock().main_was_open);
    let note = || {
        crate::notify(
            app,
            "Captured",
            if settings.copy_to_clipboard {
                "Copied to the clipboard."
            } else {
                "Saved."
            },
        )
    };
    if from_window || settings.after_capture == AfterCapture::Window {
        crate::tray::show_main(app);
    } else if settings.after_capture == AfterCapture::Card {
        if let Err(e) = crate::card::show(app, &entry) {
            tracing::warn!("quick-capture card: {e}");
            note();
        }
    } else {
        note();
    }
    Ok(entry)
}

pub fn default_folder(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .picture_dir()
        .map(|p| p.join("DeskShot"))
        .map_err(|e| format!("no Pictures folder: {e}"))
}

fn report_error(app: &AppHandle, e: &str) {
    tracing::warn!("capture failed: {e}");
    close_overlays(app);
    app.state::<AppState>().lock().frozen = None;
    let _ = app.emit("capture-error", e);
    crate::notify(app, "Capture failed", e);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_labels() {
        assert!(is_overlay("overlay-0"));
        assert_eq!(overlay_index("overlay-12"), Some(12));
        assert_eq!(overlay_index("main"), None);
        assert_eq!(overlay_index("overlay-x"), None);
    }
}
