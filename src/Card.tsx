// The quick-capture card: a slim strip like the Snipping Tool's toast. A small
// thumbnail, "Copied to clipboard" and where it was saved; Edit, Save and Pin
// show when the pointer is on it (the capture is already on the clipboard). Clicking it opens the editor. Goes
// away by itself after a few seconds (the line along the bottom counts down)
// unless the pointer is on it.

import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, type HistoryEntry } from "./lib/api";

const STAY_MS = 4500;

/** "C:\Users\me\Pictures\DeskShot\x.png" → "Pictures\DeskShot" (the last two folders). */
export function savedPlace(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const sep = path.includes("\\") ? "\\" : "/";
  return parts.slice(-3, -1).join(sep);
}

export function Card() {
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [round, setRound] = useState(0); // restarts the countdown line
  const [held, setHeld] = useState(false);
  const hover = useRef(false);
  const timer = useRef(0);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setLeaving(true);
    window.setTimeout(() => void api.cardClose(), 160);
  }, []);
  const arm = useCallback(() => {
    window.clearTimeout(timer.current);
    setRound((r) => r + 1);
    timer.current = window.setTimeout(() => {
      if (!hover.current) close();
    }, STAY_MS);
  }, [close]);

  const load = useCallback(async () => {
    try {
      const e = await api.cardInfo();
      const bytes = await api.historyImage(e.id);
      setUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "image/png" }));
      });
      setEntry(e);
      setLeaving(false);
      setNote("");
      arm();
    } catch (e) {
      setNote(errorText(e));
    }
  }, [arm]);

  useEffect(() => {
    void load();
    // A new capture while the card is up: show that one instead.
    const un = listen("card-update", () => void load());
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      void un.then((f) => f());
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer.current);
    };
  }, [load, close]);

  const flash = (t: string) => {
    setNote(t);
    if (!hover.current) arm();
  };
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      flash(errorText(e));
    }
  };

  const saveAs = () =>
    act(async () => {
      if (!entry) return;
      window.clearTimeout(timer.current);
      const name = `DeskShot ${new Date(entry.created).toISOString().slice(0, 19).replace("T", " at ").replace(/:/g, ".")}.png`;
      const path = await save({ title: "Save capture", defaultPath: name, filters: [{ name: "Picture", extensions: ["png", "jpg"] }] });
      if (!path) return arm();
      await api.savePng(path, await api.historyImage(entry.id));
      flash("Saved");
    });
  const edit = () =>
    act(async () => {
      if (entry) await api.cardEdit(entry.id);
    });
  const pin = () =>
    act(async () => {
      if (!entry) return;
      await api.pinCapture(entry.id);
      close();
    });

  const title = note || "Copied to clipboard";
  const sub = entry?.saved ? `Saved to ${savedPlace(entry.saved)}` : "Click to edit";

  return (
    <div
      className={"card-quick" + (leaving ? " leaving" : "") + (held ? " held" : "")}
      onMouseEnter={() => {
        hover.current = true;
        setHeld(true);
        window.clearTimeout(timer.current);
      }}
      onMouseLeave={() => {
        hover.current = false;
        setHeld(false);
        arm();
      }}
    >
      <button className="card-main" title="Open in the editor" aria-label="Open this capture in the editor" onClick={edit}>
        <span className="card-thumb">{url ? <img src={url} alt="" draggable={false} /> : null}</span>
        <span className="card-text">
          <b aria-live="polite">{title}</b>
          <small>{sub}</small>
        </span>
      </button>
      <div className="card-acts" role="toolbar" aria-label="Capture actions">
        <button className="card-btn more" title="Edit" aria-label="Edit" onClick={edit}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16z" />
          </svg>
        </button>
        <button className="card-btn more" title="Save as…" aria-label="Save as" onClick={saveAs}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5" />
            <path d="M5 19h14" />
          </svg>
        </button>
        <button className="card-btn more" title="Pin on top" aria-label="Pin" onClick={pin}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7" />
          </svg>
        </button>
        <button className="card-btn" title="Close (Esc)" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <i key={round} className="card-timer" style={{ animationDuration: `${STAY_MS}ms` }} aria-hidden="true" />
    </div>
  );
}
