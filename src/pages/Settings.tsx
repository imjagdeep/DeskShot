import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/Common";
import { DeskLabTools } from "../components/DeskLab";
import { ShortcutField } from "../components/ShortcutField";
import { api, type Settings } from "../lib/api";
import { refreshAppInfo, setAutoUpdate, setTheme, toastError, useAppInfo, useAutoUpdate, useTheme, type Theme } from "../lib/store";
import { checkAndDownload, installNow, useUpdate } from "../lib/updates";

export function SettingsPage() {
  const info = useAppInfo();
  const theme = useTheme();
  const auto = useAutoUpdate();
  const st = useUpdate();
  const busy = st.kind === "checking" || st.kind === "downloading" || st.kind === "installing";
  const [s, setS] = useState<Settings | null>(null);
  const [startup, setStartup] = useState<boolean | null>(null);

  useEffect(() => {
    api.getSettings().then(setS).catch(toastError);
    isEnabled()
      .then(setStartup)
      .catch(() => setStartup(null));
  }, []);

  const save = async (patch: Partial<Settings>) => {
    if (!s) return;
    try {
      setS(await api.saveSettings({ ...s, ...patch }));
      if ("use_print_screen" in patch || "snip_shortcut" in patch || "screen_shortcut" in patch) void refreshAppInfo();
    } catch (e) {
      toastError(e);
    }
  };

  const chooseFolder = async () => {
    try {
      const dir = await open({ directory: true, multiple: false, title: "Save captures in" });
      if (typeof dir === "string") await save({ save_folder: dir, save_to_folder: true });
    } catch (e) {
      toastError(e);
    }
  };

  const setStartWith = async (on: boolean) => {
    try {
      await (on ? enable() : disable());
      setStartup(await isEnabled());
    } catch (e) {
      toastError(e);
    }
  };

  const folder = s?.save_folder ?? info?.default_folder ?? "";
  const windows = info?.platform === "windows";

  return (
    <div className="page">
      <PageHeader title="Settings" />

      {s && (
        <div className="card">
          <h2>After a capture</h2>
          <label className="check-row">
            <input type="checkbox" checked={s.copy_to_clipboard} onChange={(e) => void save({ copy_to_clipboard: e.target.checked })} />
            <span>
              Copy it to the clipboard
              <span className="muted small block">Ready to paste into an email, chat or document.</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.save_to_folder} onChange={(e) => void save({ save_to_folder: e.target.checked })} />
            <span>
              Save a copy in a folder
              <span className="muted small block">
                {folder || "Pictures › DeskShot"} ·{" "}
                <button className="link" onClick={() => void chooseFolder()}>
                  Change…
                </button>{" "}
                ·{" "}
                <button className="link" onClick={() => void api.openFolder(folder).catch(toastError)} disabled={!folder}>
                  Open
                </button>
                {s.save_folder && (
                  <>
                    {" "}
                    ·{" "}
                    <button className="link" onClick={() => void save({ save_folder: null })}>
                      Back to Pictures › DeskShot
                    </button>
                  </>
                )}
              </span>
            </span>
          </label>
          <div className="setting-line">
            <span>
              After a quick capture
              <span className="muted small block">Shortcut, Print Screen or the tray. Captures started in this window always come back here.</span>
            </span>
            <div className="segmented" role="group" aria-label="After a quick capture">
              {(
                [
                  ["card", "Small card"],
                  ["window", "Open DeskShot"],
                  ["notify", "Just a note"],
                ] as const
              ).map(([v, label]) => (
                <button key={v} className={s.after_capture === v ? "active" : ""} aria-pressed={s.after_capture === v} onClick={() => void save({ after_capture: v })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-line">
            <span>Format for saved copies</span>
            <div className="segmented" role="group" aria-label="Format">
              {(["png", "jpg"] as const).map((f) => (
                <button key={f} className={s.format === f ? "active" : ""} onClick={() => void save({ format: f })}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            {s.format === "png"
              ? "PNG keeps every pixel sharp: best for screenshots of text and apps."
              : `JPG makes photos smaller (quality ${s.jpg_quality}). Text can look slightly blurry.`}
          </p>
          {s.format === "jpg" && (
            <label className="setting-line">
              <span>JPG quality</span>
              <input
                type="range"
                min={50}
                max={100}
                value={s.jpg_quality}
                onChange={(e) => setS({ ...s, jpg_quality: Number(e.target.value) })}
                onMouseUp={() => void save({ jpg_quality: s.jpg_quality })}
                onKeyUp={() => void save({ jpg_quality: s.jpg_quality })}
                aria-label="JPG quality"
              />
            </label>
          )}
        </div>
      )}

      {s && (
        <div className="card">
          <h2>Keys and start-up</h2>
          <div className="shortcut-list">
            <ShortcutField
              label="Snip"
              value={s.snip_shortcut}
              fallback="CommandOrControl+Shift+Digit2"
              mac={info?.platform === "macos"}
              onSave={(v) => save({ snip_shortcut: v }).then(() => true)}
            />
            <ShortcutField
              label="Full screen"
              value={s.screen_shortcut}
              fallback="CommandOrControl+Shift+Digit1"
              mac={info?.platform === "macos"}
              onSave={(v) => save({ screen_shortcut: v }).then(() => true)}
            />
            <div className="muted small">Work anywhere, even when DeskShot is only in the {windows ? "tray" : "menu bar"}. Keys the system or another app already uses can't be taken.</div>
          </div>
          {windows && (
            <label className="check-row">
              <input type="checkbox" checked={s.use_print_screen} onChange={(e) => void save({ use_print_screen: e.target.checked })} />
              <span>
                Use the Print Screen key for DeskShot
                <span className="muted small block">
                  {s.use_print_screen
                    ? s.took_print_screen
                      ? "On. DeskShot turned off Windows' own Print Screen shortcut (Snipping Tool) and will turn it back on if you untick this or uninstall DeskShot."
                      : "On."
                    : info?.snipping_owns_print_screen
                      ? "Windows gives Print Screen to the Snipping Tool now. Ticking this switches that off (Settings › Accessibility › Keyboard) and lets DeskShot have the key; unticking puts it back."
                      : "Print Screen will start an area capture."}
                </span>
              </span>
            </label>
          )}
          {startup !== null && (
            <label className="check-row">
              <input type="checkbox" checked={startup} onChange={(e) => void setStartWith(e.target.checked)} />
              <span>
                Start with the computer
                <span className="muted small block">DeskShot waits quietly in the {windows ? "tray" : "menu bar"} so the shortcut always works.</span>
              </span>
            </label>
          )}
          <div className="setting-line">
            <span>Keep in History</span>
            <select value={s.history_limit} onChange={(e) => void save({ history_limit: Number(e.target.value) })} aria-label="Captures kept in History">
              {[100, 300, 1000, 3000].map((n) => (
                <option key={n} value={n}>
                  the last {n} captures
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} className={theme === t ? "active" : ""} onClick={() => setTheme(t)}>
              {t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="about-row">
          <div>
            <div className="about-title">
              DeskShot <span className="muted">{info?.version}</span>
            </div>
            <div className="muted small">
              {st.kind === "idle" && (auto ? "Updates download automatically." : "Automatic updates are off.")}
              {st.kind === "checking" && "Checking GitHub for a newer version…"}
              {st.kind === "latest" && "You have the latest version."}
              {st.kind === "downloading" && `Downloading ${st.version}${st.pct != null ? ` (${st.pct}%)` : ""}…`}
              {st.kind === "ready" && `Version ${st.version} is downloaded and ready.`}
              {st.kind === "installing" && `Installing ${st.version}… DeskShot restarts by itself.`}
              {st.kind === "error" && <span className="error-text">Couldn't update: {st.message}</span>}
            </div>
          </div>
          {st.kind === "ready" ? (
            <button className="primary" onClick={() => void installNow()}>
              Restart to update
            </button>
          ) : (
            <button disabled={busy} onClick={() => void checkAndDownload(true)}>
              Check for updates
            </button>
          )}
        </div>
        <label className="check-row">
          <input type="checkbox" checked={auto} onChange={(e) => setAutoUpdate(e.target.checked)} />
          <span>
            Download updates automatically
            <span className="muted small block">
              Checks GitHub once a day, downloads new versions in the background (signature-checked) and asks you to restart.
              That is the only time DeskShot goes online; your captures never leave this computer.
            </span>
          </span>
        </label>
        <div className="more-tools">
          <DeskLabTools own="deskshot" />
          <div className="muted small made-by">
            Open source, MIT licence. Made by Jagdeep Sandhu ·{" "}
            <button className="link" onClick={() => api.openLink("developer").catch(toastError)}>
              github.com/imjagdeep
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
