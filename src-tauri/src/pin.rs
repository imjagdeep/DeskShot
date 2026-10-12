//! Pin a capture on top of every other window: a small frameless window
//! per pin ("pin-N"), sized to the picture (at most 60% of the screen).

use crate::history;
use crate::state::AppState;
use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

const PIN: &str = "pin-";
static NEXT: AtomicU32 = AtomicU32::new(1);

pub fn is_pin(label: &str) -> bool {
    label.starts_with(PIN)
}

#[derive(Serialize, Clone)]
pub struct PinInfo {
    pub id: String,
    pub width: u32,
    pub height: u32,
}

/// The window size for a picture: its own size in screen points, shrunk to
/// fit 60% of the screen.
pub fn fit(width: u32, height: u32, scale: f64, screen_w: f64, screen_h: f64) -> (f64, f64) {
    let w = width as f64 / scale.max(0.5);
    let h = height as f64 / scale.max(0.5);
    let k = (screen_w * 0.6 / w).min(screen_h * 0.6 / h).min(1.0);
    ((w * k).max(60.0), (h * k).max(40.0))
}

pub fn open(app: &AppHandle, id: &str) -> Result<(), String> {
    let (data, entry) = {
        let state = app.state::<AppState>();
        let st = state.lock();
        let entry = history::list(&st.data_dir).into_iter().find(|e| e.id == id);
        (st.data_dir.clone(), entry)
    };
    history::png_path(&data, id)?;
    let entry = entry.ok_or("that capture is no longer in History")?;
    let (scale, sw, sh) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let s = m.scale_factor();
            (s, m.size().width as f64 / s, m.size().height as f64 / s)
        })
        .unwrap_or((1.0, 1600.0, 900.0));
    let (w, h) = fit(entry.width, entry.height, scale, sw, sh);
    let label = format!("{PIN}{}", NEXT.fetch_add(1, Ordering::Relaxed));
    app.state::<AppState>().lock().pins.insert(
        label.clone(),
        PinInfo {
            id: entry.id.clone(),
            width: entry.width,
            height: entry.height,
        },
    );
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("DeskShot pin")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(w, h)
        .center()
        .build()
        .map_err(|e| format!("cannot pin the capture: {e}"))?;
    Ok(())
}

/// What a pin window shows.
pub fn info(app: &AppHandle, label: &str) -> Result<PinInfo, String> {
    app.state::<AppState>()
        .lock()
        .pins
        .get(label)
        .cloned()
        .ok_or_else(|| "not a pinned capture".to_string())
}

/// Resize a pin window, keeping its picture's shape.
pub fn resize(app: &AppHandle, label: &str, width: f64) -> Result<(), String> {
    let p = info(app, label)?;
    let w = width.clamp(60.0, 4000.0);
    let h = w * p.height as f64 / p.width.max(1) as f64;
    app.get_webview_window(label)
        .ok_or("the pinned window is gone")?
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| format!("cannot resize: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_fit_the_screen_and_keep_their_shape() {
        // A 4K capture on a 2x screen of 1920x1080 points.
        let (w, h) = fit(3840, 2160, 2.0, 1920.0, 1080.0);
        assert!((w - 1152.0).abs() < 0.5 && (h - 648.0).abs() < 0.5);
        // Small captures stay their real size.
        assert_eq!(fit(400, 300, 1.0, 1920.0, 1080.0), (400.0, 300.0));
        assert!(is_pin("pin-3") && !is_pin("main"));
    }
}
