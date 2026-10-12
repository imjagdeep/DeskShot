//! The Print Screen key. Windows 11 gives it to the Snipping Tool unless
//! "Use the Print screen key to open screen capture" is off
//! (HKCU\Control Panel\Keyboard\PrintScreenKeyForSnippingEnabled; missing
//! means on in current builds). DeskShot only changes that value when the
//! user turns its own Print Screen setting on, and sets it back when they
//! turn it off. Other systems: nothing to do.

#[cfg(windows)]
mod imp {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const KEY: &str = r"HKCU\Control Panel\Keyboard";
    const VALUE: &str = "PrintScreenKeyForSnippingEnabled";
    const NO_WINDOW: u32 = 0x0800_0000;

    /// Does the Snipping Tool own Print Screen right now?
    pub fn snipping_owns_key() -> bool {
        let out = Command::new("reg")
            .args(["query", KEY, "/v", VALUE])
            .creation_flags(NO_WINDOW)
            .output();
        match out {
            Ok(o) if o.status.success() => {
                parse_query(&String::from_utf8_lossy(&o.stdout)).unwrap_or(true)
            }
            // Not set: Windows 11's default is on.
            Ok(_) => true,
            Err(e) => {
                tracing::warn!("cannot read the Print Screen setting: {e}");
                true
            }
        }
    }

    pub fn set_snipping(enabled: bool) -> Result<(), String> {
        let out = Command::new("reg")
            .args([
                "add",
                KEY,
                "/v",
                VALUE,
                "/t",
                "REG_DWORD",
                "/d",
                if enabled { "1" } else { "0" },
                "/f",
            ])
            .creation_flags(NO_WINDOW)
            .output()
            .map_err(|e| format!("cannot change the Print Screen setting: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Windows refused to change the Print Screen setting: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
    }

    /// "    PrintScreenKeyForSnippingEnabled    REG_DWORD    0x0" → Some(false)
    pub fn parse_query(text: &str) -> Option<bool> {
        let line = text.lines().find(|l| l.contains(VALUE))?;
        let v = line.split_whitespace().last()?;
        let n = u32::from_str_radix(v.trim_start_matches("0x"), 16).ok()?;
        Some(n != 0)
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn snipping_owns_key() -> bool {
        false
    }
    pub fn set_snipping(_enabled: bool) -> Result<(), String> {
        Ok(())
    }
}

pub use imp::{set_snipping, snipping_owns_key};

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn parses_reg_query_output() {
        let out = "\r\nHKEY_CURRENT_USER\\Control Panel\\Keyboard\r\n    PrintScreenKeyForSnippingEnabled    REG_DWORD    0x0\r\n";
        assert_eq!(super::imp::parse_query(out), Some(false));
        assert_eq!(
            super::imp::parse_query(&out.replace("0x0", "0x1")),
            Some(true)
        );
        assert_eq!(super::imp::parse_query("nothing"), None);
    }
}
