import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppMenus } from "./appMenu";
import logo from "./assets/logo.png";
import { Toasts } from "./components/Common";
import { PAGES, Sidebar, type Page } from "./components/Sidebar";
import { UpdateBanner } from "./components/UpdateBanner";
import { api } from "./lib/api";
import { refreshCaptures, watchCaptures } from "./lib/captures";
import { refreshAppInfo, toast, toastError, useAppInfo, useAutoUpdate, useTheme } from "./lib/store";
import { checkAndDownload, dailyCheckDue } from "./lib/updates";
import { Capture } from "./pages/Capture";
import { History } from "./pages/History";
import { SettingsPage } from "./pages/Settings";
import { ShellDialogs } from "./shell/Dialogs";
import { MenuBar } from "./shell/MenuBar";
import { applySavedZoom } from "./shell/shell";

export default function App() {
  const [page, setPageRaw] = useState<Page>("capture");
  const setPage = useCallback((p: Page) => setPageRaw(p), []);
  const [selected, setSelected] = useState<string | null>(null);
  const menus = useAppMenus(page, setPage);
  const info = useAppInfo();
  const theme = useTheme();
  const autoUpdate = useAutoUpdate();
  const content = useRef<HTMLElement>(null);

  useEffect(() => {
    void refreshAppInfo();
    void refreshCaptures();
    void applySavedZoom().catch(() => undefined);
    // A new capture: show it on the Capture page.
    const unNew = watchCaptures((e) => {
      setSelected(e.id);
      setPageRaw("capture");
    });
    const unErr = listen<string>("capture-error", (e) => toast(`Capture failed: ${e.payload}`, true));
    const unNav = listen<string>("navigate", (e) => {
      if (PAGES.some((p) => p.page === e.payload)) setPageRaw(e.payload as Page);
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
    const where = PAGES.find((p) => p.page === page)?.label ?? "";
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
        <main className="content" ref={content}>
          {page === "capture" && <Capture selected={selected} onSelect={setSelected} />}
          {page === "history" && <History selected={selected} onSelect={setSelected} />}
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
