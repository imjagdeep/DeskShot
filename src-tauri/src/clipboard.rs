//! Putting a capture on the clipboard as a picture.

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

pub fn copy_image(app: &AppHandle, img: &image::RgbaImage) -> Result<(), String> {
    let pic = tauri::image::Image::new_owned(img.as_raw().clone(), img.width(), img.height());
    app.clipboard()
        .write_image(&pic)
        .map_err(|e| format!("cannot copy to the clipboard: {e}"))
}
