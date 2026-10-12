// DeskShot's menus: File, Edit, View, Capture, Help.

import { exit } from "@tauri-apps/plugin-process";
import { useEffect, useMemo, useState } from "react";
import { PAGES, type Page } from "./components/Sidebar";
import { api, type CaptureMode, type LabTool } from "./lib/api";
import { setTheme, toastError, useTheme, type Theme } from "./lib/store";
import { checkAndDownload } from "./lib/updates";
import type { MenuDef } from "./shell/menu";
import {
  editCommand,
  isCompactSidebar,
  openShellDialog,
  pasteText,
  setZoom,
  textFieldFocused,
  toggleFullscreen,
  toggleSidebar,
  useCompactSidebar,
  zoomStep,
} from "./shell/shell";

const LAB_NAMES: Record<string, string> = { deskzero: "DeskZero", deskmedic: "DeskMedic", deskfolio: "DeskFolio" };

export function useAppMenus(page: Page, go: (p: Page) => void): MenuDef[] {
  const theme = useTheme();
  const compact = useCompactSidebar();
  const [lab, setLab] = useState<LabTool[]>([]);
  useEffect(() => {
    api.desklabTools().then(setLab).catch(toastError);
  }, []);

  return useMemo(() => {
    const shoot = (mode: CaptureMode, delay = 0) => api.startCapture(mode, delay);
    const editor = (what: "undo" | "redo") => window.dispatchEvent(new CustomEvent("editor-command", { detail: what }));
    const themeItem = (t: Theme, label: string) => ({
      id: `theme-${t}`,
      label,
      checked: () => theme === t,
      run: () => setTheme(t),
    });

    const file: MenuDef = {
      label: "File",
      items: [
        {
          id: "open-folder",
          label: "Open the captures folder",
          run: async () => {
            const [s, info] = await Promise.all([api.getSettings(), api.appInfo()]);
            const folder = s.save_folder ?? info.default_folder;
            if (folder) await api.openFolder(folder);
          },
        },
        "-",
        { id: "account", label: "DeskLab account…", run: () => go("account") },
        { id: "settings", label: "Settings…", accel: "Mod+,", run: () => go("settings") },
        "-",
        // Closing the window keeps DeskShot in the tray; this quits for real.
        { id: "exit", label: "Exit DeskShot", run: () => exit(0) },
      ],
    };

    const edit: MenuDef = {
      label: "Edit",
      items: [
        // In the editor these undo drawing; in a text field, typing.
        {
          id: "undo",
          label: "Undo",
          accel: "Mod+Z",
          enabled: () => textFieldFocused() || page === "editor",
          run: () => (textFieldFocused() ? editCommand("undo") : editor("undo")),
        },
        {
          id: "redo",
          label: "Redo",
          accel: "Mod+Y",
          enabled: () => textFieldFocused() || page === "editor",
          run: () => (textFieldFocused() ? editCommand("redo") : editor("redo")),
        },
        "-",
        { id: "cut", label: "Cut", accel: "Mod+X", native: "cut", hidden: true, run: () => editCommand("cut") },
        { id: "copy", label: "Copy", accel: "Mod+C", native: "copy", hidden: true, run: () => editCommand("copy") },
        { id: "paste", label: "Paste", accel: "Mod+V", native: "paste", hidden: true, run: pasteText },
        { id: "select-all", label: "Select all", accel: "Mod+A", native: "selectAll", hidden: true, run: () => editCommand("selectAll") },
        "-",
        { id: "find", label: "Find in History…", accel: "Mod+F", run: () => go("history") },
      ],
    };

    const view: MenuDef = {
      label: "View",
      items: [
        ...PAGES.map((p, i) => ({ id: `go-${p.page}`, label: p.label, accel: `Mod+${i + 1}`, checked: () => page === p.page, run: () => go(p.page) })),
        "-",
        { id: "sidebar", label: "Compact sidebar", accel: "Mod+B", checked: () => isCompactSidebar(), run: toggleSidebar },
        { id: "zoom-in", label: "Zoom in", accel: "Mod+=", run: () => zoomStep(1) },
        { id: "zoom-out", label: "Zoom out", accel: "Mod+-", run: () => zoomStep(-1) },
        { id: "zoom-reset", label: "Actual size", accel: "Mod+0", run: () => setZoom(1) },
        "-",
        { label: "Theme", items: [themeItem("system", "Match system"), themeItem("light", "Light"), themeItem("dark", "Dark")] },
        { id: "fullscreen", label: "Full screen", accel: "F11", run: toggleFullscreen },
      ],
    };

    const capture: MenuDef = {
      label: "Capture",
      items: [
        // The global shortcut works everywhere; Shift+A etc. only in this window.
        { id: "cap-area", label: "Area", accel: "Mod+Shift+A", run: () => shoot("area") },
        { id: "cap-window", label: "Window", accel: "Mod+Shift+W", run: () => shoot("window") },
        { id: "cap-screen", label: "Full screen", accel: "Mod+Shift+F", run: () => shoot("screen") },
        {
          label: "Area after a delay",
          items: [3, 5, 10].map((d) => ({ id: `cap-delay-${d}`, label: `${d} seconds`, run: () => shoot("area", d) })),
        },
      ],
    };

    const help: MenuDef = {
      label: "Help",
      items: [
        { id: "palette", label: "Search commands…", accel: "Mod+K", run: () => openShellDialog("palette") },
        { id: "shortcuts", label: "Keyboard shortcuts", accel: "F1", run: () => openShellDialog("shortcuts") },
        "-",
        { id: "updates", label: "Check for updates…", run: () => (go("settings"), void checkAndDownload(true)) },
        { id: "whats-new", label: "What's new", run: () => api.openLink("releases") },
        { id: "report", label: "Report a problem…", run: () => api.openLink("issues") },
        {
          label: "More DeskLab tools",
          items: lab.map((t) => ({
            id: `lab-${t.id}`,
            label: t.installed ? `Open ${LAB_NAMES[t.id] ?? t.id}` : `Get ${LAB_NAMES[t.id] ?? t.id}`,
            run: () => (t.installed ? api.openTool(t.id) : api.openLink(t.id)),
          })),
        },
        "-",
        { id: "about", label: "About DeskShot", run: () => openShellDialog("about") },
      ],
    };
    return [file, edit, view, capture, help];
    // `compact` re-creates the menus so the check mark stays current.
  }, [page, go, theme, lab, compact]);
}
