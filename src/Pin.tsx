// A pinned capture: floats on top of everything. Drag to move, scroll to
// zoom, double-click or Esc to close, right-click for Copy and Close.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "./lib/api";

export function Pin() {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");
  const info = useRef<{ id: string; width: number; height: number } | null>(null);
  const win = getCurrentWindow();

  useEffect(() => {
    let made: string | null = null;
    (async () => {
      try {
        const i = await api.pinInfo();
        info.current = i;
        made = URL.createObjectURL(new Blob([await api.historyImage(i.id)], { type: "image/png" }));
        setUrl(made);
      } catch (e) {
        setError(errorText(e));
      }
    })();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void win.close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (made) URL.revokeObjectURL(made);
    };
  }, [win]);

  const flash = (t: string) => {
    setNote(t);
    window.setTimeout(() => setNote(""), 1400);
  };

  const copy = async () => {
    setMenu(null);
    const i = info.current;
    if (!i) return;
    try {
      await api.copyPng(await api.historyImage(i.id));
      flash("Copied");
    } catch (e) {
      flash(errorText(e));
    }
  };

  if (error) {
    return (
      <div className="pin pin-error" onDoubleClick={() => void win.close()}>
        {error} (double-click to close)
      </div>
    );
  }

  return (
    <div
      className="pin"
      onMouseDown={(e) => {
        if (e.button === 0 && !menu) void win.startDragging();
        if (e.button === 0 && menu) setMenu(null);
      }}
      onDoubleClick={() => void win.close()}
      onWheel={(e) => {
        // 10% per notch, around the current size.
        const step = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        void api.pinResize(window.innerWidth * step).catch((err) => flash(errorText(err)));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {url && <img src={url} alt="Pinned capture" draggable={false} />}
      {note && <div className="pin-note">{note}</div>}
      {menu && (
        <div className="pin-menu" style={{ left: Math.min(menu.x, window.innerWidth - 150), top: Math.min(menu.y, window.innerHeight - 80) }} onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => void copy()}>Copy</button>
          <button onClick={() => void win.close()}>Close</button>
        </div>
      )}
    </div>
  );
}
