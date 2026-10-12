// The capture overlay: one per monitor, showing that monitor frozen at the
// moment of the shortcut. Drag for an area, click a highlighted window,
// Enter for the whole screen, Esc or right-click to cancel.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { api, errorText, type OverlayInfo, type PickTarget, type Rect } from "./lib/api";

type Pt = { x: number; y: number };

/** Two corners in screen (CSS) pixels → a picture-pixel rectangle. */
export function toPicture(a: Pt, b: Pt, sx: number, sy: number, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.min(w, Math.round(Math.min(a.x, b.x) * sx)));
  const y0 = Math.max(0, Math.min(h, Math.round(Math.min(a.y, b.y) * sy)));
  const x1 = Math.max(0, Math.min(w, Math.round(Math.max(a.x, b.x) * sx)));
  const y1 = Math.max(0, Math.min(h, Math.round(Math.max(a.y, b.y) * sy)));
  return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** The topmost window under a point (picture pixels); targets are topmost first. */
export function targetAt(targets: PickTarget[], x: number, y: number): PickTarget | null {
  return targets.find((t) => x >= t.rect.x && y >= t.rect.y && x < t.rect.x + t.rect.w && y < t.rect.y + t.rect.h) ?? null;
}

const MAG = 9; // magnifier zoom
const MAG_SIZE = 132;

export function Overlay() {
  const [info, setInfo] = useState<OverlayInfo | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [start, setStart] = useState<Pt | null>(null);
  const [cur, setCur] = useState<Pt | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const mag = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let made: string | null = null;
    (async () => {
      try {
        const [i, png] = await Promise.all([api.overlayInfo(), api.overlayImage()]);
        made = URL.createObjectURL(new Blob([png], { type: "image/png" }));
        setInfo(i);
        setUrl(made);
      } catch (e) {
        setError(errorText(e));
        await getCurrentWindow().show();
      }
    })();
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, []);

  // Scale between this window's CSS pixels and the frozen picture.
  const sx = info ? info.width / window.innerWidth : 1;
  const sy = info ? info.height / window.innerHeight : 1;
  const finish = (r: Rect | null) => void api.overlayFinish(r).catch((e) => setError(errorText(e)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(null);
      else if (e.key === "Enter" && info) finish({ x: 0, y: 0, w: info.width, h: info.height });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Magnifier: the pixels around the cursor, big and crisp.
  useEffect(() => {
    const c = mag.current?.getContext("2d");
    if (!c || !cur || !img.current?.complete) return;
    c.imageSmoothingEnabled = false;
    c.fillStyle = "#111";
    c.fillRect(0, 0, MAG_SIZE, MAG_SIZE);
    const src = MAG_SIZE / MAG;
    c.drawImage(img.current, cur.x * sx - src / 2, cur.y * sy - src / 2, src, src, 0, 0, MAG_SIZE, MAG_SIZE);
    c.strokeStyle = "rgba(255,255,255,0.9)";
    c.lineWidth = 1;
    const mid = MAG_SIZE / 2;
    c.strokeRect(mid - MAG / 2 + 0.5, mid - MAG / 2 + 0.5, MAG, MAG);
  }, [cur, sx, sy]);

  if (error) {
    return (
      <div className="ov-root ov-error" onMouseDown={() => finish(null)}>
        <div className="ov-hint">Couldn't show the capture: {error}. Click to close.</div>
      </div>
    );
  }
  if (!info || !url) return <div className="ov-root" />;

  const hover = !start && cur && info.mode !== "screen" ? targetAt(info.targets, cur.x * sx, cur.y * sy) : null;
  const dragRect = start && cur ? toPicture(start, cur, sx, sy, info.width, info.height) : null;
  const shown = dragRect ?? (hover ? hover.rect : null);
  const box = shown && { left: shown.x / sx, top: shown.y / sy, width: shown.w / sx, height: shown.h / sy };
  const magLeft = cur ? (cur.x + 24 + MAG_SIZE > window.innerWidth ? cur.x - 24 - MAG_SIZE : cur.x + 24) : 0;
  const magTop = cur ? (cur.y + 24 + MAG_SIZE + 26 > window.innerHeight ? cur.y - 24 - MAG_SIZE - 26 : cur.y + 24) : 0;

  return (
    <div
      className="ov-root"
      onContextMenu={(e) => {
        e.preventDefault();
        finish(null);
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        if (info.mode === "area") setStart({ x: e.clientX, y: e.clientY });
      }}
      onMouseMove={(e) => setCur({ x: e.clientX, y: e.clientY })}
      onMouseUp={(e) => {
        if (e.button !== 0) return;
        const end = { x: e.clientX, y: e.clientY };
        const dragged = start && Math.abs(end.x - start.x) + Math.abs(end.y - start.y) > 4;
        if (dragged && start) {
          const r = toPicture(start, end, sx, sy, info.width, info.height);
          setStart(null);
          if (r) finish(r);
          return;
        }
        setStart(null);
        const t = targetAt(info.targets, end.x * sx, end.y * sy);
        if (t) finish(t.rect);
        else if (info.mode === "window") finish({ x: 0, y: 0, w: info.width, h: info.height });
      }}
    >
      <img
        ref={img}
        className="ov-shot"
        src={url}
        alt=""
        draggable={false}
        onLoad={() => {
          const w = getCurrentWindow();
          void w.show().then(() => w.setFocus());
        }}
      />
      <div className={box ? "ov-dim with-hole" : "ov-dim"} style={box ?? undefined} />
      {box && shown && (
        <div className="ov-size" style={{ left: box.left, top: Math.max(4, box.top - 28) }}>
          {hover && !dragRect ? `${hover.app || hover.title} · ` : ""}
          {shown.w} × {shown.h}
        </div>
      )}
      {!start && (
        <div className="ov-hint">
          {info.mode === "window" ? "Click a window" : "Drag to select an area, or click a window"} · Enter for the whole screen · Esc to cancel
        </div>
      )}
      {cur && (
        <>
          <div className="ov-cross-x" style={{ top: cur.y }} />
          <div className="ov-cross-y" style={{ left: cur.x }} />
          <div className="ov-mag" style={{ left: magLeft, top: magTop }}>
            <canvas ref={mag} width={MAG_SIZE} height={MAG_SIZE} />
            <div>
              {Math.round(cur.x * sx)}, {Math.round(cur.y * sy)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
