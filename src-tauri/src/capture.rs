//! Grabbing the screens: every monitor at once plus the list of windows, so
//! the overlay can show a frozen picture (open menus and tooltips included)
//! and offer each window as a click target.
//!
//! Units: monitor and window rectangles come from xcap in "screen units"
//! (physical pixels on Windows, points on macOS). Each monitor's picture is
//! in pixels, so `scale` = picture width / monitor width converts between them.

use image::RgbaImage;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    fn right(&self) -> i64 {
        self.x as i64 + self.w as i64
    }
    fn bottom(&self) -> i64 {
        self.y as i64 + self.h as i64
    }
    /// The overlap of two rectangles, if any.
    pub fn intersect(&self, o: &Rect) -> Option<Rect> {
        let x = self.x.max(o.x);
        let y = self.y.max(o.y);
        let r = self.right().min(o.right());
        let b = self.bottom().min(o.bottom());
        (r > x as i64 && b > y as i64).then(|| Rect {
            x,
            y,
            w: (r - x as i64) as u32,
            h: (b - y as i64) as u32,
        })
    }
}

/// One monitor, frozen.
pub struct Shot {
    /// Where the monitor is, in screen units.
    pub area: Rect,
    pub image: RgbaImage,
}

impl Shot {
    pub fn scale(&self) -> f64 {
        self.image.width() as f64 / self.area.w.max(1) as f64
    }
}

/// A window that can be picked in the overlay, in screen units.
#[derive(Debug, Clone, Serialize)]
pub struct WinInfo {
    pub title: String,
    pub app: String,
    pub area: Rect,
}

/// A window as seen on one monitor's picture (pixels of that picture).
#[derive(Debug, Clone, Serialize)]
pub struct PickTarget {
    pub title: String,
    pub app: String,
    pub rect: Rect,
}

/// Everything captured at the moment the shortcut was pressed.
pub struct Frozen {
    pub shots: Vec<Shot>,
    /// Topmost first.
    pub windows: Vec<WinInfo>,
}

fn err(what: &str, e: xcap::XCapError) -> String {
    format!("{what}: {e}")
}

/// Capture every monitor and list the visible windows (topmost first).
pub fn grab_all() -> Result<Frozen, String> {
    let monitors = xcap::Monitor::all().map_err(|e| err("cannot list the screens", e))?;
    let mut shots = Vec::new();
    for m in monitors {
        let area = Rect {
            x: m.x().map_err(|e| err("screen position", e))?,
            y: m.y().map_err(|e| err("screen position", e))?,
            w: m.width().map_err(|e| err("screen size", e))?,
            h: m.height().map_err(|e| err("screen size", e))?,
        };
        let image = m
            .capture_image()
            .map_err(|e| err("cannot capture the screen", e))?;
        shots.push(Shot { area, image });
    }
    if shots.is_empty() {
        return Err("no screen found to capture".into());
    }
    Ok(Frozen {
        shots,
        windows: list_windows(),
    })
}

/// Visible, titled windows of other apps. A window that can't be read is
/// skipped rather than failing the capture.
fn list_windows() -> Vec<WinInfo> {
    let me = std::process::id();
    let all = match xcap::Window::all() {
        Ok(w) => w,
        Err(e) => {
            tracing::warn!("cannot list windows (window picking off): {e}");
            return Vec::new();
        }
    };
    let mut out: Vec<(i32, WinInfo)> = all
        .iter()
        .filter_map(|w| {
            if w.pid().ok()? == me || w.is_minimized().ok()? {
                return None;
            }
            let title = w.title().ok()?;
            let area = Rect {
                x: w.x().ok()?,
                y: w.y().ok()?,
                w: w.width().ok()?,
                h: w.height().ok()?,
            };
            if title.trim().is_empty() || area.w < 24 || area.h < 24 {
                return None;
            }
            let app = w.app_name().unwrap_or_default();
            Some((w.z().unwrap_or(0), WinInfo { title, app, area }))
        })
        .collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.0));
    out.into_iter().map(|(_, w)| w).collect()
}

/// The windows on this monitor, mapped into its picture's pixels (topmost first).
pub fn targets_for(shot: &Shot, windows: &[WinInfo]) -> Vec<PickTarget> {
    windows
        .iter()
        .filter_map(|w| {
            let on = w.area.intersect(&shot.area)?;
            Some(PickTarget {
                title: w.title.clone(),
                app: w.app.clone(),
                rect: to_pixels(&on, shot),
            })
        })
        .collect()
}

/// Screen units on this monitor → pixels of its picture.
pub fn to_pixels(r: &Rect, shot: &Shot) -> Rect {
    let s = shot.scale();
    let x0 = ((r.x - shot.area.x) as f64 * s).round() as i64;
    let y0 = ((r.y - shot.area.y) as f64 * s).round() as i64;
    let x1 = (((r.x - shot.area.x) as f64 + r.w as f64) * s).round() as i64;
    let y1 = (((r.y - shot.area.y) as f64 + r.h as f64) * s).round() as i64;
    clamp_to_image(x0, y0, x1, y1, shot.image.width(), shot.image.height()).unwrap_or(Rect {
        x: 0,
        y: 0,
        w: 0,
        h: 0,
    })
}

/// A selection (picture pixels, any corner order) kept inside the picture;
/// None when nothing is left.
pub fn clamp_to_image(x0: i64, y0: i64, x1: i64, y1: i64, w: u32, h: u32) -> Option<Rect> {
    let (l, r) = (x0.min(x1).clamp(0, w as i64), x0.max(x1).clamp(0, w as i64));
    let (t, b) = (y0.min(y1).clamp(0, h as i64), y0.max(y1).clamp(0, h as i64));
    (r - l >= 1 && b - t >= 1).then(|| Rect {
        x: l as i32,
        y: t as i32,
        w: (r - l) as u32,
        h: (b - t) as u32,
    })
}

/// Cut a rectangle (picture pixels) out of a monitor's picture.
pub fn crop(shot: &Shot, r: &Rect) -> Option<RgbaImage> {
    let r = clamp_to_image(
        r.x as i64,
        r.y as i64,
        r.x as i64 + r.w as i64,
        r.y as i64 + r.h as i64,
        shot.image.width(),
        shot.image.height(),
    )?;
    Some(image::imageops::crop_imm(&shot.image, r.x as u32, r.y as u32, r.w, r.h).to_image())
}

/// Which monitor holds this point (screen units); the first one otherwise.
pub fn monitor_at(shots: &[Shot], x: i32, y: i32) -> usize {
    shots
        .iter()
        .position(|s| {
            x >= s.area.x
                && (x as i64) < s.area.right()
                && y >= s.area.y
                && (y as i64) < s.area.bottom()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shot(x: i32, y: i32, w: u32, h: u32, scale: u32) -> Shot {
        Shot {
            area: Rect { x, y, w, h },
            image: RgbaImage::new(w * scale, h * scale),
        }
    }

    #[test]
    fn intersect_and_no_overlap() {
        let a = Rect {
            x: 0,
            y: 0,
            w: 100,
            h: 100,
        };
        let b = Rect {
            x: 50,
            y: 60,
            w: 100,
            h: 100,
        };
        assert_eq!(
            a.intersect(&b),
            Some(Rect {
                x: 50,
                y: 60,
                w: 50,
                h: 40
            })
        );
        let c = Rect {
            x: 100,
            y: 0,
            w: 10,
            h: 10,
        };
        assert_eq!(a.intersect(&c), None);
    }

    #[test]
    fn window_on_a_second_hidpi_monitor_maps_to_its_pixels() {
        // A Mac-like 2x monitor to the right of the main one.
        let s = shot(1440, 0, 1280, 800, 2);
        let w = WinInfo {
            title: "Notes".into(),
            app: "Notes".into(),
            area: Rect {
                x: 1400,
                y: 100,
                w: 400,
                h: 300,
            },
        };
        let t = targets_for(&s, &[w]);
        // Clipped at the monitor's left edge, then doubled.
        assert_eq!(
            t[0].rect,
            Rect {
                x: 0,
                y: 200,
                w: 720,
                h: 600
            }
        );
    }

    #[test]
    fn selection_any_direction_is_clamped() {
        assert_eq!(
            clamp_to_image(300, 200, -50, 10, 250, 400),
            Some(Rect {
                x: 0,
                y: 10,
                w: 250,
                h: 190
            })
        );
        assert_eq!(clamp_to_image(5, 5, 5, 90, 100, 100), None);
    }

    #[test]
    fn crop_and_monitor_lookup() {
        let s = shot(0, 0, 200, 100, 1);
        let img = crop(
            &s,
            &Rect {
                x: 150,
                y: 50,
                w: 100,
                h: 100,
            },
        )
        .unwrap();
        assert_eq!((img.width(), img.height()), (50, 50));
        let shots = vec![shot(0, 0, 100, 100, 1), shot(-100, 0, 100, 100, 1)];
        assert_eq!(monitor_at(&shots, -10, 5), 1);
        assert_eq!(monitor_at(&shots, 5000, 5), 0);
    }
}
