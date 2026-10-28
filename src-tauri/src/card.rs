//! The quick-capture card: after a capture from the shortcut or the tray, a
//! slim strip in the screen corner (thumbnail, "Copied", and Edit, Save, Pin
//! and close on hover), like the Snipping Tool's toast. It doesn't take the
//! focus, and closes itself after a few seconds unless the pointer is on it.
//! One card at a time.

use crate::history;
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "card";
/// Card size in screen points: one slim strip, whatever the capture's shape
/// (the thumbnail is fitted inside it).
const WIDTH: f64 = 360.0;
const HEIGHT: f64 = 72.0;
const MARGIN: f64 = 16.0;

pub fn is_card(label: &str) -> bool {
    label == LABEL
}

/// Show (or update) the card for a capture, bottom right of the screen the
/// pointer is on.
pub fn show(app: &AppHandle, entry: &history::Entry) -> Result<(), String> {
    app.state::<AppState>().lock().card = Some(entry.id.clone());
    let h = HEIGHT;
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let place = monitor.map(|m| {
        let s = m.scale_factor();
        let area = m.work_area();
        let x = area.position.x as f64 + area.size.width as f64 - (WIDTH + MARGIN) * s;
        let y = area.position.y as f64 + area.size.height as f64 - (h + MARGIN) * s;
        PhysicalPosition::new(x.round() as i32, y.round() as i32)
    });

    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_size(tauri::LogicalSize::new(WIDTH, h));
        if let Some(p) = place {
            let _ = w.set_position(p);
        }
        let _ = w.show();
        return w
            .emit("card-update", &entry.id)
            .map_err(|e| format!("cannot update the card: {e}"));
    }
    let mut b = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("DeskShot")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .shadow(true)
        .inner_size(WIDTH, h);
    if let Some(p) = place {
        b = b.position(p.x as f64, p.y as f64);
    }
    let w = b
        .build()
        .map_err(|e| format!("cannot show the card: {e}"))?;
    // position() takes logical points; put it exactly where measured.
    if let Some(p) = place {
        let _ = w.set_position(p);
    }
    Ok(())
}

/// The capture the card shows.
pub fn current(app: &AppHandle) -> Result<history::Entry, String> {
    let (data, id) = {
        let state = app.state::<AppState>();
        let st = state.lock();
        (st.data_dir.clone(), st.card.clone())
    };
    let id = id.ok_or("no capture to show")?;
    history::list(&data)
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| "that capture is no longer in History".to_string())
}

pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    app.state::<AppState>().lock().card = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_card_window_is_the_card() {
        assert!(is_card("card") && !is_card("main") && !is_card("cards"));
    }
}
