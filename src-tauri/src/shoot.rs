//! One capture from start to finish: hide our window, wait out any delay,
//! freeze every screen, show one selection overlay per monitor, then crop,
//! keep, copy and save the result.

use crate::capture::{self, Frozen, Rect};
use crate::history;
use crate::settings::Format;
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
pub fn start(app: &AppHandle, mode: Mode, delay_secs: u32) {
    close_overlays(app);
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = run(&app, mode, delay_secs) {
            report_error(&app, &e);
        }
    });
}

fn run(app: &AppHandle, mode: Mode, delay_secs: u32) -> Result<(), String> {
    // Our own window shouldn't be in the picture.
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
            let _ = w.hide();
            std::thread::sleep(Duration::from_millis(220));
        }
    }
    if delay_secs > 0 {
        let _ = app.emit("capture-countdown", delay_secs);
        std::thread::sleep(Duration::from_secs(delay_secs.min(30) as u64));
    }
    let frozen = capture::grab_all()?;
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
        return keep(app, img);
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
    if let Some((pos, size)) = place {
        w.set_position(pos)?;
        w.set_size(size)?;
    } else {
        w.maximize()?;
    }
    Ok(())
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

/// The frozen picture for the overlay to show, as an uncompressed BMP: a 4K
/// PNG took most of a second to encode, a bitmap costs almost nothing.
pub fn overlay_bmp(app: &AppHandle, index: usize) -> Result<Vec<u8>, String> {
    let state = app.state::<AppState>();
    let st = state.lock();
    let f = st.frozen.as_ref().ok_or("no capture in progress")?;
    let shot = f.shots.get(index).ok_or("unknown screen")?;
    history::encode_bmp(&shot.image)
}

/// The overlay is done: a rectangle in that monitor's picture, or None to cancel.
pub fn finish(app: &AppHandle, index: usize, rect: Option<Rect>) -> Result<(), String> {
    let frozen = app.state::<AppState>().lock().frozen.take();
    close_overlays(app);
    let (Some(f), Some(r)) = (frozen, rect) else {
        return Ok(());
    };
    let shot = f.shots.get(index).ok_or("unknown screen")?;
    let img = capture::crop(shot, &r).ok_or("the selection is empty")?;
    let app = app.clone();
    // Encoding and saving can take a moment on big screens: off this thread.
    std::thread::spawn(move || {
        if let Err(e) = keep(&app, img) {
            report_error(&app, &e);
        }
    });
    Ok(())
}

/// Keep a finished capture: history, clipboard, saved copy, then tell the window.
fn keep(app: &AppHandle, img: image::RgbaImage) -> Result<(), String> {
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
    if settings.open_after_capture {
        crate::tray::show_main(app);
    } else {
        crate::notify(
            app,
            "Captured",
            if settings.copy_to_clipboard {
                "Copied to the clipboard."
            } else {
                "Saved."
            },
        );
    }
    Ok(())
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
