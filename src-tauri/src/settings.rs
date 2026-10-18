//! DeskShot's settings, kept as settings.json in the app's config folder.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Png,
    Jpg,
}

/// What happens after a quick capture (shortcut, Print Screen, tray).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AfterCapture {
    /// A small card in the screen corner (Copy, Save, Edit, Pin).
    Card,
    /// Open the DeskShot window with the capture.
    Window,
    /// Only a notification.
    Notify,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Put every capture on the clipboard.
    pub copy_to_clipboard: bool,
    /// Also save a copy into `save_folder` with a readable name.
    pub save_to_folder: bool,
    /// None = Pictures\DeskShot.
    pub save_folder: Option<PathBuf>,
    pub format: Format,
    /// 1-100, for JPG only.
    pub jpg_quality: u8,
    /// After a quick capture. (Replaces the old "open_after_capture"; old
    /// settings files still load, that field is ignored.)
    pub after_capture: AfterCapture,
    /// Let the Print Screen key start an area capture (Windows asks the
    /// Snipping Tool first otherwise; see printscreen.rs).
    pub use_print_screen: bool,
    /// DeskShot switched the Snipping Tool's Print Screen setting off, so it
    /// switches it back on when Print Screen is given back.
    pub took_print_screen: bool,
    /// Captures kept in History (oldest go first).
    pub history_limit: u32,
    /// Set after the first start, when "start with the computer" was offered.
    pub autostart_applied: bool,
    /// Key combination for Snip, e.g. "Control+Shift+Digit2".
    /// None = the default (Ctrl/Cmd+Shift+2), "" = turned off.
    pub snip_shortcut: Option<String>,
    /// Key combination for Full screen. None = Ctrl/Cmd+Shift+1, "" = off.
    pub screen_shortcut: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            copy_to_clipboard: true,
            save_to_folder: true,
            save_folder: None,
            format: Format::Png,
            jpg_quality: 90,
            after_capture: AfterCapture::Card,
            use_print_screen: false,
            took_print_screen: false,
            history_limit: 300,
            autostart_applied: false,
            snip_shortcut: None,
            screen_shortcut: None,
        }
    }
}

impl Settings {
    pub fn load(dir: &Path) -> Settings {
        let path = dir.join("settings.json");
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!("{} is not valid, using defaults: {e}", path.display());
                Settings::default()
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => {
                tracing::warn!("cannot read {}: {e}", path.display());
                Settings::default()
            }
        }
    }

    /// Write through a temp file so a crash can't leave half a file.
    pub fn save(&self, dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        let tmp = dir.join("settings.json.tmp");
        std::fs::write(&tmp, json).map_err(|e| format!("cannot write settings: {e}"))?;
        std::fs::rename(&tmp, dir.join("settings.json"))
            .map_err(|e| format!("cannot save settings: {e}"))
    }

    pub fn clamp(mut self) -> Settings {
        self.jpg_quality = self.jpg_quality.clamp(1, 100);
        self.history_limit = self.history_limit.clamp(10, 5000);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_defaults_for_missing_fields() {
        let dir = tempfile::tempdir().unwrap();
        assert!(Settings::load(dir.path()).copy_to_clipboard);
        let s = Settings {
            format: Format::Jpg,
            use_print_screen: true,
            ..Settings::default()
        };
        s.save(dir.path()).unwrap();
        let back = Settings::load(dir.path());
        assert_eq!(back.format, Format::Jpg);
        assert!(back.use_print_screen);
        // An older file without newer fields still loads.
        std::fs::write(dir.path().join("settings.json"), r#"{"format":"png"}"#).unwrap();
        assert_eq!(Settings::load(dir.path()).history_limit, 300);
    }

    #[test]
    fn clamp_keeps_values_in_range() {
        let s = Settings {
            jpg_quality: 0,
            history_limit: 1,
            ..Settings::default()
        }
        .clamp();
        assert_eq!((s.jpg_quality, s.history_limit), (1, 10));
    }
}
