// Typed wrappers over the Rust commands. Errors arrive as plain strings.

import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  version: string;
  platform: string;
  /** "Ctrl+Shift+2" (or Cmd on a Mac) */
  shortcut: string;
  default_folder: string | null;
  /** Windows: the Snipping Tool owns Print Screen right now. */
  snipping_owns_print_screen: boolean;
}

export interface Settings {
  copy_to_clipboard: boolean;
  save_to_folder: boolean;
  save_folder: string | null;
  format: "png" | "jpg";
  jpg_quality: number;
  open_after_capture: boolean;
  use_print_screen: boolean;
  took_print_screen: boolean;
  history_limit: number;
  autostart_applied: boolean;
}

export interface HistoryEntry {
  id: string;
  /** Unix time, milliseconds */
  created: number;
  width: number;
  height: number;
  /** The copy saved in the user's folder, if any. */
  saved: string | null;
  /** Words read from the picture (for search); missing until read. */
  text?: string | null;
}

export type CaptureMode = "area" | "window" | "screen";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PickTarget {
  title: string;
  app: string;
  rect: Rect;
}

export interface OverlayInfo {
  mode: CaptureMode;
  width: number;
  height: number;
  targets: PickTarget[];
}

export type LabToolId = "deskzero" | "deskmedic" | "deskfolio" | "deskshot";
export interface LabTool {
  id: LabToolId;
  installed: boolean;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  getSettings: () => invoke<Settings>("get_settings"),
  /** Saved (and tidied) settings come back. */
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  startCapture: (mode: CaptureMode, delay = 0) => invoke<void>("start_capture", { mode, delay }),

  overlayInfo: () => invoke<OverlayInfo>("overlay_info"),
  /** This overlay's frozen screen as BMP bytes (shown only; the crop uses the original). */
  overlayImage: async () => new Uint8Array(await invoke<ArrayBuffer>("overlay_image")),
  /** A rectangle in the frozen picture's pixels, or null to cancel. */
  overlayFinish: (rect: Rect | null) => invoke<void>("overlay_finish", { rect }),

  historyList: () => invoke<HistoryEntry[]>("history_list"),
  historyImage: async (id: string) => new Uint8Array(await invoke<ArrayBuffer>("history_image", { id })),
  historyDelete: (id: string) => invoke<void>("history_delete", { id }),
  historySetText: (id: string, text: string) => invoke<void>("history_set_text", { id, text }),
  /** Float a capture on top of every other window. */
  pinCapture: (id: string) => invoke<void>("pin_capture", { id }),
  /** (in a pin window) which capture it shows */
  pinInfo: () => invoke<{ id: string; width: number; height: number }>("pin_info"),
  /** (in a pin window) new width in screen points; the height follows */
  pinResize: (width: number) => invoke<void>("pin_resize", { width }),
  /** Keep an edited picture (PNG bytes) as a new capture. */
  saveEdit: (png: Uint8Array) => invoke<HistoryEntry>("save_edit", png),
  /** PNG bytes onto the clipboard as a picture. */
  copyPng: (png: Uint8Array) => invoke<void>("copy_png", png),
  /** PNG bytes saved to `path` (JPG when the name ends in .jpg). */
  savePng: (path: string, png: Uint8Array) => invoke<void>("save_png", png, { headers: { "x-path": encodeURIComponent(path) } }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  openFolder: (path: string) => invoke<void>("open_folder", { path }),

  openLink: (id: "site" | "repo" | "issues" | "releases" | "developer" | "screen-permission" | LabToolId) =>
    invoke<void>("open_link", { id }),
  /** The other DeskLab tools and whether each is installed here. */
  desklabTools: () => invoke<LabTool[]>("desklab_tools"),
  /** Start an installed DeskLab tool, optionally with a file for it to open. */
  openTool: (id: LabToolId, file?: string) => invoke<void>("open_tool", { id, file: file ?? null }),
  notifyUpdate: (version: string) => invoke<void>("notify_update", { version }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
