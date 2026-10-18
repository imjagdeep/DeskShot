//! The global shortcuts for Snip and Full screen, chosen in Settings. Stored
//! as text like "Control+Shift+Digit2" (the global shortcut plugin's
//! format); None means the default, "" means off. Same approach as DeskZero.

use std::str::FromStr;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub const DEFAULT_SNIP: &str = "CommandOrControl+Shift+Digit2";
pub const DEFAULT_SCREEN: &str = "CommandOrControl+Shift+Digit1";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    Snip,
    Screen,
}

/// What is registered right now.
#[derive(Default)]
pub struct Keys {
    snip: Mutex<Option<Shortcut>>,
    screen: Mutex<Option<Shortcut>>,
}

impl Keys {
    fn slot(&self, a: Action) -> &Mutex<Option<Shortcut>> {
        match a {
            Action::Snip => &self.snip,
            Action::Screen => &self.screen,
        }
    }

    /// Which action a pressed shortcut belongs to.
    pub fn action_of(&self, pressed: &Shortcut) -> Option<Action> {
        [Action::Snip, Action::Screen].into_iter().find(|a| {
            self.slot(*a)
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .as_ref()
                == Some(pressed)
        })
    }
}

/// The setting's text → a shortcut (None = off). Must have a modifier,
/// except the function keys and Print Screen, so plain typing is never taken.
pub fn parse(setting: Option<&str>, default: &str) -> Result<Option<Shortcut>, String> {
    let text = setting.unwrap_or(default).trim();
    if text.is_empty() {
        return Ok(None);
    }
    let sc = Shortcut::from_str(text)
        .map_err(|e| format!("\"{text}\" isn't a key combination DeskShot can use ({e})"))?;
    let key = text
        .rsplit('+')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_uppercase();
    let lone_ok = key == "PRINTSCREEN"
        || (key.len() >= 2 && key.starts_with('F') && key[1..].chars().all(|c| c.is_ascii_digit()));
    if !text.contains('+') && !lone_ok {
        return Err("add Ctrl, Alt, Shift or ⌘ so normal typing isn't taken".into());
    }
    Ok(Some(sc))
}

/// Register `wanted` for `action` in place of what it had. If the system or
/// another app already owns the keys, the old shortcut stays.
pub fn set(
    app: &AppHandle,
    keys: &Keys,
    action: Action,
    wanted: Option<Shortcut>,
) -> Result<(), String> {
    let gs = app.global_shortcut();
    let mut slot = keys.slot(action).lock().unwrap_or_else(|p| p.into_inner());
    if *slot == wanted {
        return Ok(());
    }
    if let Some(new) = wanted {
        let other = match action {
            Action::Snip => Action::Screen,
            Action::Screen => Action::Snip,
        };
        let taken_by_other =
            *keys.slot(other).lock().unwrap_or_else(|p| p.into_inner()) == Some(new);
        if taken_by_other {
            return Err("the other DeskShot shortcut already uses these keys".into());
        }
    }
    if let Some(old) = *slot {
        if let Err(e) = gs.unregister(old) {
            tracing::warn!("could not release {old:?}: {e}");
        }
    }
    if let Some(new) = wanted {
        if let Err(e) = gs.register(new) {
            // Put the old one back so the action still has a shortcut.
            if let Some(old) = *slot {
                if let Err(e2) = gs.register(old) {
                    tracing::warn!("could not restore {old:?}: {e2}");
                    *slot = None;
                }
            }
            return Err(format!(
                "these keys are already used by the system or another app ({e})"
            ));
        }
    }
    *slot = wanted;
    Ok(())
}

/// At start: register both from the settings; a bad or taken setting is
/// logged and that action simply has no shortcut.
pub fn register_from_settings(app: &AppHandle, keys: &Keys, s: &crate::settings::Settings) {
    for (action, setting, default) in [
        (Action::Snip, s.snip_shortcut.as_deref(), DEFAULT_SNIP),
        (Action::Screen, s.screen_shortcut.as_deref(), DEFAULT_SCREEN),
    ] {
        let result = parse(setting, default).and_then(|sc| set(app, keys, action, sc));
        if let Err(e) = result {
            tracing::warn!("shortcut for {action:?}: {e}");
        }
    }
}

/// "CommandOrControl+Shift+Digit2" → "Cmd+Shift+2" on a Mac, "Ctrl+Shift+2"
/// elsewhere; "" → "".
pub fn label(text: &str) -> String {
    let mac = cfg!(target_os = "macos");
    text.split('+')
        .filter(|p| !p.trim().is_empty())
        .map(|p| {
            let p = p.trim();
            match p.to_ascii_lowercase().as_str() {
                "commandorcontrol" | "cmdorctrl" => (if mac { "Cmd" } else { "Ctrl" }).to_string(),
                "super" | "command" | "cmd" => (if mac { "Cmd" } else { "Win" }).to_string(),
                "control" | "ctrl" => "Ctrl".to_string(),
                "alt" | "option" => (if mac { "Option" } else { "Alt" }).to_string(),
                "shift" => "Shift".to_string(),
                "printscreen" => "Print Screen".to_string(),
                _ => p
                    .strip_prefix("Key")
                    .or_else(|| p.strip_prefix("Digit"))
                    .unwrap_or(p)
                    .to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_defaults_off_and_custom() {
        assert!(parse(None, DEFAULT_SNIP).unwrap().is_some());
        assert!(parse(None, DEFAULT_SCREEN).unwrap().is_some());
        assert!(parse(Some(""), DEFAULT_SNIP).unwrap().is_none());
        assert!(parse(Some("Control+Alt+KeyS"), DEFAULT_SNIP)
            .unwrap()
            .is_some());
        assert!(parse(Some("F9"), DEFAULT_SNIP).unwrap().is_some());
        assert!(parse(Some("PrintScreen"), DEFAULT_SNIP).unwrap().is_some());
    }

    #[test]
    fn refuses_plain_keys_and_nonsense() {
        assert!(parse(Some("KeyA"), DEFAULT_SNIP).is_err());
        assert!(parse(Some("Control+Banana"), DEFAULT_SNIP).is_err());
    }

    #[test]
    fn labels_read_like_keys() {
        let mac = cfg!(target_os = "macos");
        assert_eq!(
            label(DEFAULT_SNIP),
            if mac { "Cmd+Shift+2" } else { "Ctrl+Shift+2" }
        );
        assert_eq!(label("Control+Alt+KeyS"), if mac { "Ctrl+Option+S" } else { "Ctrl+Alt+S" });
        assert_eq!(label(""), "");
    }
}
