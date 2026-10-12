import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useAppMenus } from "./appMenu";
import logo from "./assets/logo.png";
import { Toasts } from "./components/Common";
import { PAGES, Sidebar, type Page } from "./components/Sidebar";
import { UpdateBanner } from "./components/UpdateBanner";
import { api, type HistoryEntry } from "./lib/api";
import { fileStamp, indexCaptures, refreshCaptures, useCaptures, watchCaptures } from "./lib/captures";
import { refreshAppInfo, toast, toastError, useAppInfo, useAutoUpdate, useTheme } from "./lib/store";
import { checkAndDownload, dailyCheckDue } from "./lib/updates";
import { Capture } from "./pages/Capture";
import { History } from "./pages/History";
import { SettingsPage } from "./pages/Settings";
import { AccountPage } from "./account/AccountPage";
import { ShellDialogs } from "./shell/Dialogs";
import { MenuBar } from "./shell/MenuBar";
import { applySavedZoom } from "./shell/shell";

// The editor (and Konva) load the first time it's opened.
const Editor = lazy(() => import("./editor/Editor").then((m) => ({ default: m.Editor })));

export default function App() {
  const [page, setPageRaw] = useState<Page>("capture");
  const setPage = useCallback((p: Page) => setPageRaw(p), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const captures = useCaptures();
  const editEntry = captures?.find((e) => e.id === editing) ?? null;
  const openEditor = useCallback((e: HistoryEntry) => {
    setEditing(e.id);
    setPageRaw("editor");
  }, []);

  // The editor's three ways out.
  const onExport = async (png: Uint8Array, how: "save" | "copy" | "file") => {
    if (how === "copy") {
      await api.copyPng(png);
      toast("Copied to the clipboard");
    } else if (how === "file") {
      const path = await save({
        title: "Save the edited picture",
        defaultPath: `DeskShot ${fileStamp(Date.now())} (edited).png`,
        filters: [
          { name: "PNG picture", extensions: ["png"] },
          { name: "JPG picture", extensions: ["jpg"] },
        ],
      });
      if (!path) return;
      await api.savePng(path, png);
      toast("Saved");
    } else {
      // Arrives as a new capture ("captured" event): shown on the Capture page.
      await api.saveEdit(png);
      toast("Kept as a new capture");
    }
  };
  const menus = useAppMenus(page, setPage);
  const info = useAppInfo();
  const theme = useTheme();
  const autoUpdate = useAutoUpdate();
  const content = useRef<HTMLElement>(null);

  useEffect(() => {
    void refreshAppInfo();
    // Then read the words in captures (for History search), quietly.
    void refreshCaptures().then(() => window.setTimeout(() => void indexCaptures(), 8000));
    void applySavedZoom().catch(() => undefined);
    // A new capture: show it on the Capture page.
    const unNew = watchCaptures((e) => {
      setSelected(e.id);
      setPageRaw("capture");
      window.setTimeout(() => void indexCaptures(), 1500);
    });
    const unErr = listen<string>("capture-error", (e) => toast(`Capture failed: ${e.payload}`, true));
    const unNav = listen<string>("navigate", (e) => {
      const target = PAGES.find((p) => p.page === e.payload);
      if (target) setPageRaw(target.page);
    });
    return () => {
      for (const un of [unNew, unErr, unNav]) void un.then((f) => f());
    };
  }, []);

  // Automatic updates: soon after start, then daily while DeskShot keeps
  // running in the tray. Same as the sister apps.
  useEffect(() => {
    if (!autoUpdate) return;
    const run = () => {
      if (!dailyCheckDue()) return;
      void checkAndDownload(false).then((v) => {
        if (v) void api.notifyUpdate(v).catch(() => undefined);
      });
    };
    const first = window.setTimeout(run, 30_000);
    const every = window.setInterval(run, 3 * 3600 * 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [autoUpdate]);

  // "system" leaves the attribute off so the CSS media query decides.
  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // The window title names the page, like any desktop app.
  useEffect(() => {
    const where = page === "editor" ? "Edit" : (PAGES.find((p) => p.page === page)?.label ?? "");
    void getCurrentWindow()
      .setTitle(page === "capture" ? "DeskShot" : `${where} — DeskShot`)
      .catch(() => undefined);
    content.current?.scrollTo(0, 0);
  }, [page]);

  return (
    <div className="app-frame">
      <MenuBar appName="DeskShot" menus={menus} onError={toastError} />
      <div className="app">
        <Sidebar page={page} onNavigate={setPage} />
        <main className={page === "editor" ? "content content-editor" : "content"} ref={content}>
          {page === "capture" && <Capture selected={selected} onSelect={setSelected} onEdit={openEditor} />}
          {page === "history" && <History selected={selected} onSelect={setSelected} onEdit={openEditor} />}
          {page === "editor" && editEntry && (
            <Suspense fallback={<div className="page muted">Opening the editor…</div>}>
              <Editor key={editEntry.id} entry={editEntry} onExport={onExport} onClose={() => setPageRaw("capture")} />
            </Suspense>
          )}
          {page === "account" && <AccountPage app="DeskShot" toast={toast} />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
      <ShellDialogs
        menus={menus}
        onError={toastError}
        about={{
          name: "DeskShot",
          logo,
          version: info?.version ?? "",
          tagline: "Capture an area, a window or the whole screen, then copy, save, mark up, blur and pin it. All on your own computer.",
          links: [
            { label: "Website", open: () => void api.openLink("site").catch(toastError) },
            { label: "Source code", open: () => void api.openLink("repo").catch(toastError) },
            { label: "What's new", open: () => void api.openLink("releases").catch(toastError) },
            { label: "Report a problem", open: () => void api.openLink("issues").catch(toastError) },
          ],
        }}
      />
      <UpdateBanner app="DeskShot" />
      <Toasts />
    </div>
  );
}
