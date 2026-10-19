//! "After a quick capture: Notification": a Windows notification with the
//! capture in it. Clicking it opens the capture in the editor; its buttons
//! edit or pin it. On other systems (and if this fails) a plain notification.

use crate::history;
use std::path::Path;
use tauri::AppHandle;

/// Notification pictures are kept this small: Windows won't show big ones.
#[cfg(windows)]
const THUMB: u32 = 728;
/// Pictures kept for notifications that may still be in the notification centre.
#[cfg(windows)]
const KEEP: usize = 20;

pub fn captured(app: &AppHandle, data: &Path, entry: &history::Entry, body: &str) {
    #[cfg(windows)]
    {
        match windows_toast(app, data, entry, body) {
            Ok(()) => return,
            Err(e) => tracing::warn!("capture notification with picture failed: {e}"),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (data, entry);
    }
    crate::notify(app, "Captured", body);
}

#[cfg(windows)]
fn windows_toast(
    app: &AppHandle,
    data: &Path,
    entry: &history::Entry,
    body: &str,
) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_winrt_notification::Toast;

    let thumb = thumbnail(data, &entry.id)?;
    // Installed copies are registered under the app's identifier (the
    // notification plugin does the same); a dev build borrows PowerShell's.
    let app_id = if cfg!(debug_assertions) {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    };
    let handle = app.clone();
    let id = entry.id.clone();
    Toast::new(&app_id)
        .title("Captured")
        .text1(body)
        .text2("Click to open it in the editor.")
        .image(&thumb, "The capture")
        .add_button("Edit", "edit")
        .add_button("Pin", "pin")
        .on_activated(move |action| {
            let app = handle.clone();
            let id = id.clone();
            let pin = action.as_deref() == Some("pin");
            // Window work belongs on the main thread.
            let queued = handle.run_on_main_thread(move || {
                if pin {
                    if let Err(e) = crate::pin::open(&app, &id) {
                        tracing::warn!("pin from notification: {e}");
                    }
                } else {
                    // A click on the notification itself, or Edit.
                    crate::tray::show_main(&app);
                    if let Err(e) = app.emit_to("main", "edit-capture", id) {
                        tracing::warn!("edit from notification: {e}");
                    }
                }
            });
            if let Err(e) = queued {
                tracing::warn!("notification click: {e}");
            }
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

/// A small PNG of the capture for the notification, next to the history.
#[cfg(windows)]
fn thumbnail(data: &Path, id: &str) -> Result<std::path::PathBuf, String> {
    let src = history::png_path(data, id)?;
    let img = image::open(&src).map_err(|e| format!("cannot read the capture: {e}"))?;
    let dir = data.join("notice");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot make {}: {e}", dir.display()))?;
    let out = dir.join(format!("{id}.png"));
    let small = img.thumbnail(THUMB, THUMB).to_rgba8();
    std::fs::write(&out, history::encode_png(&small)?)
        .map_err(|e| format!("cannot write {}: {e}", out.display()))?;
    prune(&dir, KEEP);
    Ok(out)
}

/// Keep only the newest `keep` pictures.
#[cfg(windows)]
fn prune(dir: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, p) in files.into_iter().skip(keep) {
        if let Err(e) = std::fs::remove_file(&p) {
            tracing::warn!(
                "could not remove old notification picture {}: {e}",
                p.display()
            );
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn prune_keeps_the_newest() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            let p = dir.path().join(format!("{i}.png"));
            std::fs::write(&p, b"x").unwrap();
            // Distinct, increasing times so "newest" is well defined.
            let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000 + i);
            std::fs::File::options()
                .write(true)
                .open(&p)
                .unwrap()
                .set_modified(t)
                .unwrap();
        }
        prune(dir.path(), 2);
        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["3.png", "4.png"]);
    }
}
