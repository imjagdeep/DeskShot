//! What the commands share: folders, settings and the capture in progress.

use crate::capture::Frozen;
use crate::pin::PinInfo;
use crate::settings::Settings;
use crate::shoot::Mode;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

pub struct Inner {
    /// History and other app data.
    pub data_dir: PathBuf,
    /// settings.json lives here.
    pub config_dir: PathBuf,
    pub settings: Settings,
    /// The frozen screens while the overlays are up.
    pub frozen: Option<Frozen>,
    pub mode: Mode,
    /// Open pin windows and the capture each shows.
    pub pins: HashMap<String, PinInfo>,
    /// The DeskShot window was open when this capture started (it comes
    /// back afterwards instead of the card).
    pub main_was_open: bool,
    /// The capture the quick-capture card shows.
    pub card: Option<String>,
}

pub struct AppState(Mutex<Inner>);

impl AppState {
    pub fn new(inner: Inner) -> Self {
        AppState(Mutex::new(inner))
    }

    /// A panic elsewhere must not lock everyone out: take the data anyway.
    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }
}
