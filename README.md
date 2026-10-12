<p align="center"><img src="src/assets/logo.png" width="96" alt="DeskShot logo"></p>

<h1 align="center">DeskShot</h1>

<p align="center">Free, offline screenshots for Windows and macOS.<br>No account, no uploads, no tracking: your captures never leave your computer.</p>

**Download:** [latest release](https://github.com/imjagdeep/DeskShot/releases/latest) for Windows and macOS (Apple Silicon and Intel, signed and notarized).

> This is the first version. If something doesn't work as described, please [open an issue](https://github.com/imjagdeep/DeskShot/issues).

## What it does

| | |
|---|---|
| **Capture** | An area (drag), a window (click it) or the whole screen. Everything on screen freezes the moment you press the key, so open menus and hover pop-ups are caught too. A magnifier and size readout help you pick the exact pixels; a 3, 5 or 10 second delay is there for menus that close on a click. |
| **Start a capture** | **Ctrl+Shift+2** anywhere (Cmd+Shift+2 on a Mac), the tray / menu-bar icon, or (Windows, optional) the **Print Screen** key. |
| **After a capture** | Copy to the clipboard, save to Pictures › DeskShot (PNG or JPG), and keep it in History. |
| **Edit** | Arrows, boxes, ellipses, lines, pen, highlighter, text and numbered steps (1, 2, 3…) in six colours and three thicknesses; crop; undo and redo. Then copy, save as PNG/JPG, or keep the edited picture as a new capture. |
| **Hide private details** | Pixelate or black out any area. **Find private details** reads the picture and blacks out email addresses, phone numbers, IP addresses and card numbers in one step; check the result, and one Undo brings them all back. |
| **Copy text** | Reads the text in a capture (offline, English) and puts it on the clipboard. |
| **Pin** | Floats a capture on top of every other window while you work: drag it, scroll to zoom, Esc or double-click to close. |
| **History** | Every capture, newest first, ready to copy, edit, pin or save again, and searchable by the words inside the pictures. |

## Honest limits

- Screenshots only for now; screen recording (GIF/MP4) is planned for a later version.
- **Find private details** is a helper, not a guarantee: it looks for emails, phone numbers, IP addresses and card numbers that it can read. Names, addresses and anything blurry or unusual still need your eyes. Use **Black out** for passwords and card numbers; pixelating hides text from people but is not as final.
- Text reading is English only for now.
- Windows and macOS only; Linux comes later.
- **Print Screen on Windows 11** belongs to the Snipping Tool by default. DeskShot only takes it if you turn that on in Settings; it then switches Windows' own Print Screen shortcut off, and switches it back on if you turn the option off or uninstall DeskShot.
- **macOS** asks for Screen Recording permission the first time (System Settings › Privacy & Security › Screen Recording). Until it's allowed, macOS only shows DeskShot the desktop wallpaper.
- Protected content (some video players, some password fields) captures as black: the operating system hides it on purpose.

## Building from source

Needs Node.js 22+ and Rust (stable), plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system.

```sh
npm ci
npm test            # selection maths, editor model, private-detail finder (vitest)
npm run tauri dev   # run the app
npm run tauri build # installers in src-tauri/target/release/bundle/
```

Built with [Tauri](https://tauri.app), [xcap](https://github.com/nashaofu/xcap) (screen capture), [image](https://github.com/image-rs/image), [Konva](https://konvajs.org) (editor) and [tesseract.js](https://github.com/naptha/tesseract.js) (text reading).

## More tools

Part of the DeskLab family by the same author: [DeskZero](https://github.com/imjagdeep/DeskZero) (keeps your desktop and downloads tidy), [DeskMedic](https://github.com/imjagdeep/DeskMedic) (helpdesk toolkit for Windows) and [DeskFolio](https://github.com/imjagdeep/DeskFolio) (offline PDF tool). See [jaggi.cc/tools](https://jaggi.cc/tools/).

## License

MIT. Made by Jagdeep Sandhu · [github.com/imjagdeep](https://github.com/imjagdeep)
