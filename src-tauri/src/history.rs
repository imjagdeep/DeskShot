//! Capture history: every capture is kept as a PNG in the app's data folder
//! (`history/<id>.png`) with a small index, newest first. The copy the user
//! asked for (Pictures\DeskShot by default) is separate and theirs.

use crate::settings::Format;
use image::{ImageEncoder, RgbaImage};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    /// Unix time in milliseconds.
    pub created: i64,
    pub width: u32,
    pub height: u32,
    /// The copy saved into the user's folder, if any.
    pub saved: Option<PathBuf>,
}

fn dir(data: &Path) -> PathBuf {
    data.join("history")
}

pub fn png_path(data: &Path, id: &str) -> Result<PathBuf, String> {
    // Ids are made here; anything else (e.g. "../x") is refused.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("unknown capture".into());
    }
    Ok(dir(data).join(format!("{id}.png")))
}

pub fn list(data: &Path) -> Vec<Entry> {
    let path = dir(data).join("index.json");
    match std::fs::read_to_string(&path) {
        Ok(t) => serde_json::from_str(&t).unwrap_or_else(|e| {
            tracing::warn!("history index unreadable, starting a new one: {e}");
            Vec::new()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => {
            tracing::warn!("cannot read the history index: {e}");
            Vec::new()
        }
    }
}

fn write_index(data: &Path, entries: &[Entry]) -> Result<(), String> {
    let d = dir(data);
    std::fs::create_dir_all(&d).map_err(|e| format!("cannot create {}: {e}", d.display()))?;
    let tmp = d.join("index.json.tmp");
    let json = serde_json::to_string(entries).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| format!("cannot write the history: {e}"))?;
    std::fs::rename(&tmp, d.join("index.json")).map_err(|e| format!("cannot save the history: {e}"))
}

/// Encode as PNG (fast settings: captures are mostly flat colour).
pub fn encode_png(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut out,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Adaptive,
    )
    .write_image(
        img.as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|e| format!("cannot encode the picture: {e}"))?;
    Ok(out)
}

/// Uncompressed 32-bit BMP (for showing a picture straight away).
pub fn encode_bmp(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(img.as_raw().len() + 256);
    image::codecs::bmp::BmpEncoder::new(&mut out)
        .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("cannot prepare the picture: {e}"))?;
    Ok(out)
}

pub fn encode(img: &RgbaImage, format: Format, quality: u8) -> Result<Vec<u8>, String> {
    match format {
        Format::Png => encode_png(img),
        Format::Jpg => {
            // JPG has no transparency: drop the alpha channel.
            let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
            let mut out = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
                .write_image(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    image::ExtendedColorType::Rgb8,
                )
                .map_err(|e| format!("cannot encode the picture: {e}"))?;
            Ok(out)
        }
    }
}

/// "DeskShot 2026-10-12 at 14.03.22.png", with " (2)" etc. if taken.
pub fn free_name(folder: &Path, stamp: &str, ext: &str) -> PathBuf {
    let first = folder.join(format!("DeskShot {stamp}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| folder.join(format!("DeskShot {stamp} ({n}).{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

/// Store a capture in the history, newest first, trimming to `limit`.
pub fn add(
    data: &Path,
    id: &str,
    img: &RgbaImage,
    saved: Option<PathBuf>,
    created: i64,
    limit: usize,
) -> Result<Entry, String> {
    let path = png_path(data, id)?;
    std::fs::create_dir_all(dir(data))
        .map_err(|e| format!("cannot create the history folder: {e}"))?;
    std::fs::write(&path, encode_png(img)?).map_err(|e| format!("cannot keep the capture: {e}"))?;
    let entry = Entry {
        id: id.to_string(),
        created,
        width: img.width(),
        height: img.height(),
        saved,
    };
    let mut all = list(data);
    all.insert(0, entry.clone());
    for old in all.iter().skip(limit) {
        if let Ok(p) = png_path(data, &old.id) {
            if let Err(e) = std::fs::remove_file(&p) {
                tracing::warn!("cannot remove old capture {}: {e}", p.display());
            }
        }
    }
    all.truncate(limit);
    write_index(data, &all)?;
    Ok(entry)
}

/// Forget a capture (the copy in the user's folder stays).
pub fn remove(data: &Path, id: &str) -> Result<(), String> {
    let path = png_path(data, id)?;
    let mut all = list(data);
    all.retain(|e| e.id != id);
    write_index(data, &all)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete the capture: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_list_trim_remove() {
        let d = tempfile::tempdir().unwrap();
        let img = RgbaImage::new(4, 3);
        for (i, id) in ["a1", "a2", "a3"].iter().enumerate() {
            add(d.path(), id, &img, None, i as i64, 2).unwrap();
        }
        let ids: Vec<_> = list(d.path()).into_iter().map(|e| e.id).collect();
        assert_eq!(ids, ["a3", "a2"]);
        assert!(!png_path(d.path(), "a1").unwrap().exists());
        remove(d.path(), "a3").unwrap();
        assert_eq!(list(d.path()).len(), 1);
    }

    #[test]
    fn ids_cannot_leave_the_folder() {
        assert!(png_path(Path::new("x"), "../evil").is_err());
        assert!(png_path(Path::new("x"), "").is_err());
    }

    #[test]
    fn names_do_not_overwrite() {
        let d = tempfile::tempdir().unwrap();
        let a = free_name(d.path(), "2026-10-12 at 14.03.22", "png");
        std::fs::write(&a, b"x").unwrap();
        let b = free_name(d.path(), "2026-10-12 at 14.03.22", "png");
        assert!(b.ends_with("DeskShot 2026-10-12 at 14.03.22 (2).png"));
    }

    #[test]
    fn jpg_and_png_encode() {
        let img = RgbaImage::from_pixel(8, 8, image::Rgba([10, 20, 30, 255]));
        assert_eq!(&encode(&img, Format::Png, 90).unwrap()[1..4], b"PNG");
        assert_eq!(&encode(&img, Format::Jpg, 80).unwrap()[..2], &[0xFF, 0xD8]);
        assert_eq!(&encode_bmp(&img).unwrap()[..2], b"BM");
    }
}
