// The quick-capture card: the picture, then Copy, Save, Edit, Pin and close.
// Goes away by itself after a few seconds unless the pointer is on it.

import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, type HistoryEntry } from "./lib/api";

const STAY_MS = 6000;

export function Card() {
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [leaving, setLeaving] = useState(false);
  const hover = useRef(false);
  const timer = useRef(0);

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setLeaving(true);
    window.setTimeout(() => void api.cardClose(), 160);
  }, []);
  const arm = useCallback(() => {
    window.clearTimeout(timer.current);
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
    arm();
  };
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      flash(errorText(e));
    }
  };

  const copy = () =>
    act(async () => {
      if (!entry) return;
      await api.copyPng(await api.historyImage(entry.id));
      flash("Copied");
    });
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

  return (
    <div
      className={leaving ? "card-quick leaving" : "card-quick"}
      onMouseEnter={() => {
        hover.current = true;
        window.clearTimeout(timer.current);
      }}
      onMouseLeave={() => {
        hover.current = false;
        arm();
      }}
    >
      <button className="card-pic" title="Edit" aria-label="Edit this capture" onClick={edit}>
        {url ? <img src={url} alt="The new capture" draggable={false} /> : <span className="muted small">{note || "…"}</span>}
      </button>
      <div className="card-bar" role="toolbar" aria-label="Capture actions">
        <span className="card-note" aria-live="polite">
          {note || (entry?.saved ? "Copied and saved" : "Copied")}
        </span>
        <button className="card-btn" title="Copy" aria-label="Copy" onClick={copy}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="8" y="8" width="12" height="12" rx="2.5" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </svg>
        </button>
        <button className="card-btn" title="Save as…" aria-label="Save as" onClick={saveAs}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5" />
            <path d="M5 19h14" />
          </svg>
        </button>
        <button className="card-btn" title="Edit" aria-label="Edit" onClick={edit}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16z" />
          </svg>
        </button>
        <button className="card-btn" title="Pin on top" aria-label="Pin" onClick={pin}>
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
    </div>
  );
}
