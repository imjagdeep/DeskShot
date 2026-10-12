// The markup editor: draw on a capture, then copy, save or keep it.
// Konva draws; the document (shapes, crop, undo) lives in model.ts.

import Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Arrow, Circle, Ellipse, Group, Image as KImage, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import type { HistoryEntry } from "../lib/api";
import { pictureUrl } from "../lib/captures";
import { describeFindings, findSensitive } from "../lib/sensitive";
import { toast, toastError } from "../lib/store";
import {
  boxFrom,
  clampBox,
  COLORS,
  commit,
  moved,
  newId,
  nextStep,
  pixelSizeFor,
  redo,
  startHistory,
  TOOL_KEYS,
  tooSmall,
  transformed,
  undo,
  WIDTHS,
  type Box,
  type Doc,
  type Shape,
  type Tool,
} from "./model";
import { ToolIcon } from "./ToolIcon";

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "select", label: "Select and move" },
  { tool: "arrow", label: "Arrow" },
  { tool: "rect", label: "Rectangle" },
  { tool: "ellipse", label: "Ellipse" },
  { tool: "line", label: "Line" },
  { tool: "pen", label: "Pen" },
  { tool: "highlight", label: "Highlighter" },
  { tool: "text", label: "Text" },
  { tool: "step", label: "Numbered step" },
  { tool: "pixelate", label: "Pixelate (hide details)" },
  { tool: "redact", label: "Black out (safest for passwords)" },
  { tool: "crop", label: "Crop" },
];

type Edit = { x: number; y: number; value: string; id: string | null; color: string; size: number };

/** The picture as a loaded <img>. */
function useImage(id: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let live = true;
    setImg(null);
    pictureUrl(id)
      .then((url) => {
        const el = new window.Image();
        el.onload = () => live && setImg(el);
        el.src = url;
      })
      .catch(toastError);
    return () => {
      live = false;
    };
  }, [id]);
  return img;
}

/** A pixelated copy of part of the picture: the area shrunk to a few
 * pixels (each one the average of its block), then drawn back up unsmoothed. */
function pixelated(img: HTMLImageElement, box: Box): HTMLCanvasElement | null {
  const w = Math.round(box.w);
  const h = Math.round(box.h);
  if (w < 1 || h < 1) return null;
  const ps = pixelSizeFor(box);
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(w / ps));
  small.height = Math.max(1, Math.round(h / ps));
  const sc = small.getContext("2d");
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const oc = out.getContext("2d");
  if (!sc || !oc) return null;
  sc.imageSmoothingQuality = "high";
  sc.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, small.width, small.height);
  oc.imageSmoothingEnabled = false;
  oc.drawImage(small, 0, 0, w, h);
  return out;
}

function PixelBox({ img, box }: { img: HTMLImageElement; box: Box }) {
  const pic = useMemo(() => pixelated(img, box), [img, box]);
  return pic ? <KImage image={pic} x={box.x} y={box.y} width={box.w} height={box.h} /> : null;
}

function ShapeNode({ s, img }: { s: Shape; img: HTMLImageElement }) {
  switch (s.kind) {
    case "rect":
      return <Rect x={s.box.x} y={s.box.y} width={s.box.w} height={s.box.h} stroke={s.color} strokeWidth={s.width} cornerRadius={s.width} />;
    case "ellipse":
      return <Ellipse x={s.box.x + s.box.w / 2} y={s.box.y + s.box.h / 2} radiusX={s.box.w / 2} radiusY={s.box.h / 2} stroke={s.color} strokeWidth={s.width} />;
    case "arrow":
      return (
        <Arrow
          points={s.points}
          stroke={s.color}
          fill={s.color}
          strokeWidth={s.width}
          pointerLength={s.width * 3.2}
          pointerWidth={s.width * 3.2}
          lineCap="round"
          lineJoin="round"
          shadowColor="rgba(0,0,0,0.35)"
          shadowBlur={s.width}
          shadowOffsetY={1}
        />
      );
    case "line":
      return <Line points={s.points} stroke={s.color} strokeWidth={s.width} lineCap="round" />;
    case "pen":
      return <Line points={s.points} stroke={s.color} strokeWidth={s.width} lineCap="round" lineJoin="round" tension={0.4} />;
    case "highlight":
      return (
        <Line
          points={s.points}
          stroke={s.color}
          strokeWidth={s.width * 4}
          lineCap="round"
          lineJoin="round"
          opacity={0.38}
          globalCompositeOperation="multiply"
        />
      );
    case "text":
      return (
        <Text
          x={s.x}
          y={s.y}
          text={s.text}
          fontSize={s.size}
          fontStyle="bold"
          fontFamily="Segoe UI, -apple-system, system-ui, sans-serif"
          fill={s.color}
          shadowColor={s.color === "#ffffff" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.7)"}
          shadowBlur={3}
        />
      );
    case "step":
      return (
        <Group x={s.x} y={s.y}>
          <Circle radius={s.size} fill={s.color} stroke="#ffffff" strokeWidth={Math.max(2, s.size / 7)} shadowColor="rgba(0,0,0,0.35)" shadowBlur={4} />
          <Text
            text={String(s.n)}
            width={s.size * 2}
            height={s.size * 2}
            x={-s.size}
            y={-s.size}
            align="center"
            verticalAlign="middle"
            fontSize={s.size * 1.15}
            fontStyle="bold"
            fill={s.color === "#ffffff" ? "#1d1d1f" : "#ffffff"}
          />
        </Group>
      );
    case "pixelate":
      return <PixelBox img={img} box={s.box} />;
    case "redact":
      return <Rect x={s.box.x} y={s.box.y} width={s.box.w} height={s.box.h} fill="#111113" />;
  }
}

export function Editor({
  entry,
  onExport,
  onClose,
}: {
  entry: HistoryEntry;
  /** "save" keeps the edited picture as a new capture; "copy" puts it on the clipboard; "file" asks where. */
  onExport: (png: Uint8Array, how: "save" | "copy" | "file") => Promise<void>;
  onClose: () => void;
}) {
  const img = useImage(entry.id);
  const [hist, setHist] = useState(startHistory);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [width, setWidth] = useState<keyof typeof WIDTHS>("M");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [cropDraft, setCropDraft] = useState<Box | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [view, setView] = useState({ w: 800, h: 500 });
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const drawLayer = useRef<Konva.Layer>(null);
  const tr = useRef<Konva.Transformer>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const doc = hist.now;
  const set = useCallback((next: Doc) => setHist((h) => commit(h, next)), []);
  const strokeW = WIDTHS[width];

  // Fit the picture into the space available.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = img ? Math.min(1, (view.w - 32) / img.width, (view.h - 32) / img.height) : 1;
  const stageW = img ? Math.round(img.width * scale) : 0;
  const stageH = img ? Math.round(img.height * scale) : 0;

  // The transformer follows the selected shape (not for lines and pen strokes).
  useEffect(() => {
    const t = tr.current;
    if (!t) return;
    const node = selected ? stage.current?.findOne(`#${selected}`) : null;
    const s = doc.shapes.find((x) => x.id === selected);
    const resizable = s && s.kind !== "arrow" && s.kind !== "line" && s.kind !== "pen" && s.kind !== "highlight";
    t.nodes(node && resizable ? [node] : []);
    t.getLayer()?.batchDraw();
  }, [selected, doc]);

  const pointer = () => stage.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  const onDown = (ev: MouseEvent) => {
    if (!img || edit) return;
    const p = pointer();
    if (tool === "select") {
      return;
    }
    setSelected(null);
    start.current = p;
    if (tool === "crop") return setCropDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    if (tool === "text") {
      // Keep the click from taking focus away from the new text box.
      ev.preventDefault();
      setEdit({ x: p.x, y: p.y, value: "", id: null, color, size: Math.round(strokeW * 4 + 10) });
      start.current = null;
      return;
    }
    if (tool === "step") {
      set({ ...doc, shapes: [...doc.shapes, { id: newId(), kind: "step", x: p.x, y: p.y, n: nextStep(doc.shapes), color, size: strokeW * 2 + 10 }] });
      start.current = null;
      return;
    }
    const id = newId();
    if (tool === "arrow" || tool === "line") setDraft({ id, kind: tool, points: [p.x, p.y, p.x, p.y], color, width: strokeW });
    else if (tool === "pen" || tool === "highlight") setDraft({ id, kind: tool, points: [p.x, p.y], color, width: strokeW });
    else if (tool === "rect" || tool === "ellipse") setDraft({ id, kind: tool, box: { x: p.x, y: p.y, w: 0, h: 0 }, color, width: strokeW });
    else setDraft({ id, kind: tool, box: { x: p.x, y: p.y, w: 0, h: 0 } });
  };

  const onMove = () => {
    const s = start.current;
    if (!s) return;
    const p = pointer();
    if (cropDraft) return setCropDraft(boxFrom(s.x, s.y, p.x, p.y));
    setDraft((d) => {
      if (!d) return d;
      if (d.kind === "arrow" || d.kind === "line") return { ...d, points: [s.x, s.y, p.x, p.y] };
      if (d.kind === "pen" || d.kind === "highlight") return { ...d, points: [...d.points, p.x, p.y] };
      if ("box" in d) return { ...d, box: boxFrom(s.x, s.y, p.x, p.y) };
      return d;
    });
  };

  const onUp = () => {
    if (!img || !start.current) return;
    start.current = null;
    if (cropDraft) {
      const c = clampBox(cropDraft, img.width, img.height);
      setCropDraft(null);
      if (c && c.w > 8 && c.h > 8) set({ ...doc, crop: c });
      return;
    }
    if (draft && !tooSmall(draft)) set({ ...doc, shapes: [...doc.shapes, draft] });
    setDraft(null);
  };

  const commitText = () => {
    if (!edit) return;
    const text = edit.value.replace(/\s+$/, "");
    const rest = doc.shapes.filter((s) => s.id !== edit.id);
    if (text) set({ ...doc, shapes: [...rest, { id: edit.id ?? newId(), kind: "text", x: edit.x, y: edit.y, text, color: edit.color, size: edit.size }] });
    else if (edit.id) set({ ...doc, shapes: rest });
    setEdit(null);
  };

  const remove = useCallback(() => {
    if (!selected) return;
    set({ ...doc, shapes: doc.shapes.filter((s) => s.id !== selected) });
    setSelected(null);
  }, [selected, doc, set]);

  // Edit menu (Ctrl+Z / Ctrl+Y) and the editor's own keys.
  useEffect(() => {
    const onCmd = (e: Event) => {
      const what = e instanceof CustomEvent ? e.detail : null;
      if (what === "undo") setHist(undo);
      else if (what === "redo") setHist(redo);
    };
    const onKey = (e: KeyboardEvent) => {
      if (edit || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
        return;
      }
      if (e.key === "Escape") {
        setSelected(null);
        setDraft(null);
        setCropDraft(null);
        start.current = null;
        return;
      }
      const t = (Object.keys(TOOL_KEYS) as Tool[]).find((k) => TOOL_KEYS[k] === e.key.toUpperCase());
      if (t) {
        setTool(t);
        setSelected(null);
      }
    };
    window.addEventListener("editor-command", onCmd);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("editor-command", onCmd);
      window.removeEventListener("keydown", onKey);
    };
  }, [edit, remove]);

  // Read the picture and black out emails, phone numbers, IPs and card
  // numbers in one step (one Undo brings them all back).
  const findPrivate = async () => {
    if (!img) return;
    setFinding(true);
    try {
      const { readText } = await import("../lib/ocr");
      const found = findSensitive((await readText(img)).lines);
      if (!found.length) {
        toast("Found no email addresses, phone numbers, IP addresses or card numbers. Check names and other details yourself.");
        return;
      }
      const boxes = found.map((f) => clampBox(f.box, img.width, img.height)).filter((b): b is Box => b !== null);
      set({ ...doc, shapes: [...doc.shapes, ...boxes.map((box): Shape => ({ id: newId(), kind: "redact", box }))] });
      toast(`Blacked out ${describeFindings(found)}. Check the picture; Undo brings them back.`);
    } catch (e) {
      toastError(e);
    } finally {
      setFinding(false);
    }
  };

  // Render the drawing layer (picture + shapes) inside the crop at full size.
  const exportPng = async (how: "save" | "copy" | "file") => {
    const layer = drawLayer.current;
    if (!layer || !img) return;
    setBusy(true);
    try {
      const c = doc.crop ?? { x: 0, y: 0, w: img.width, h: img.height };
      const canvas = layer.toCanvas({ x: c.x * scale, y: c.y * scale, width: c.w * scale, height: c.h * scale, pixelRatio: 1 / scale });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("couldn't draw the picture");
      await onExport(new Uint8Array(await blob.arrayBuffer()), how);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const shapes = useMemo(() => (draft ? [...doc.shapes, draft] : doc.shapes), [doc.shapes, draft]);
  const crop = cropDraft ?? doc.crop;
  const changed = hist.past.length > 0;

  return (
    <div className="editor">
      <div className="editor-bar">
        <div className="tool-group" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              className={tool === t.tool ? "tool active" : "tool"}
              title={`${t.label} (${TOOL_KEYS[t.tool]})`}
              aria-label={t.label}
              aria-pressed={tool === t.tool}
              onClick={() => {
                setTool(t.tool);
                setSelected(null);
              }}
            >
              <ToolIcon tool={t.tool} />
            </button>
          ))}
        </div>
        <div className="tool-group" aria-label="Colour">
          {COLORS.map((c) => (
            <button key={c} className={color === c ? "swatch active" : "swatch"} style={{ background: c }} title={c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />
          ))}
        </div>
        <div className="segmented small" role="group" aria-label="Thickness">
          {(Object.keys(WIDTHS) as (keyof typeof WIDTHS)[]).map((k) => (
            <button key={k} className={width === k ? "active" : ""} onClick={() => setWidth(k)}>
              {k}
            </button>
          ))}
        </div>
        <div className="editor-actions">
          <button className="icon" title="Undo (Ctrl+Z)" disabled={!hist.past.length} onClick={() => setHist(undo)}>
            ↶
          </button>
          <button className="icon" title="Redo (Ctrl+Y)" disabled={!hist.future.length} onClick={() => setHist(redo)}>
            ↷
          </button>
          {doc.crop && (
            <button onClick={() => set({ ...doc, crop: null })} title="Show the whole picture again">
              Uncrop
            </button>
          )}
          <button onClick={() => void findPrivate()} disabled={finding} title="Black out emails, phone numbers, IP addresses and card numbers">
            {finding ? "Reading…" : "Find private details"}
          </button>
          <button onClick={onClose}>Close</button>
          <button disabled={busy} onClick={() => void exportPng("copy")}>
            Copy
          </button>
          <button disabled={busy} onClick={() => void exportPng("file")}>
            Save as…
          </button>
          <button className="primary" disabled={busy || !changed} onClick={() => void exportPng("save")} title="Keep the edited picture as a new capture">
            Done
          </button>
        </div>
      </div>
      <div className="editor-canvas" ref={wrap}>
        {img && (
          <div className="editor-stage" style={{ width: stageW, height: stageH }} data-tool={tool}>
            <Stage
              ref={stage}
              width={stageW}
              height={stageH}
              scaleX={scale}
              scaleY={scale}
              onMouseDown={(e) => onDown(e.evt)}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
            >
              <Layer ref={drawLayer}>
                <KImage image={img} />
                {shapes.map((s) => (
                  <Group
                    key={s.id}
                    id={s.id}
                    draggable={tool === "select"}
                    onMouseDown={(e) => {
                      if (tool !== "select") return;
                      e.cancelBubble = true;
                      setSelected(s.id);
                    }}
                    onDblClick={(e) => {
                      e.evt.preventDefault();
                      if (s.kind === "text") setEdit({ x: s.x, y: s.y, value: s.text, id: s.id, color: s.color, size: s.size });
                    }}
                    onDragEnd={(e) => {
                      const g = e.target;
                      const dx = g.x();
                      const dy = g.y();
                      g.position({ x: 0, y: 0 });
                      set({ ...doc, shapes: doc.shapes.map((x) => (x.id === s.id ? moved(x, dx, dy) : x)) });
                    }}
                    onTransformEnd={(e) => {
                      const g = e.target;
                      const next = transformed(s, g.scaleX(), g.scaleY(), g.x(), g.y());
                      g.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
                      set({ ...doc, shapes: doc.shapes.map((x) => (x.id === s.id ? next : x)) });
                    }}
                  >
                    <ShapeNode s={s} img={img} />
                  </Group>
                ))}
              </Layer>
              <Layer listening={tool === "select"}>
                <Transformer ref={tr} rotateEnabled={false} keepRatio={false} borderStroke="#0091ff" anchorStroke="#0091ff" anchorSize={9} />
                {crop && (
                  <>
                    <Rect x={0} y={0} width={img.width} height={crop.y} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect x={0} y={crop.y + crop.h} width={img.width} height={img.height - crop.y - crop.h} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect x={0} y={crop.y} width={crop.x} height={crop.h} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect x={crop.x + crop.w} y={crop.y} width={img.width - crop.x - crop.w} height={crop.h} fill="rgba(0,0,0,0.5)" listening={false} />
                    <Rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} stroke="#ffffff" strokeWidth={1.5 / scale} dash={[6 / scale, 4 / scale]} listening={false} />
                  </>
                )}
              </Layer>
            </Stage>
            {edit && (
              <textarea
                className="text-edit"
                autoFocus
                value={edit.value}
                style={{ left: edit.x * scale, top: edit.y * scale, fontSize: edit.size * scale, color: edit.color }}
                placeholder="Type, then press Enter"
                onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                onBlur={commitText}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    commitText();
                  } else if (e.key === "Escape") setEdit(null);
                }}
              />
            )}
          </div>
        )}
      </div>
      <div className="editor-foot muted small">
        {tool === "pixelate" && "Pixelate makes text unreadable. For passwords and card numbers, Black out is the safe choice."}
        {tool === "redact" && "Black out covers the area completely in the saved picture."}
        {tool === "crop" && "Drag the area to keep. Uncrop brings the whole picture back."}
        {tool === "select" && "Click a shape to move or resize it. Delete removes it. Double-click text to change it."}
        {tool === "text" && "Click where the text should go."}
        {tool === "step" && "Click to drop numbered markers: 1, 2, 3…"}
        {!["pixelate", "redact", "crop", "select", "text", "step"].includes(tool) && "Drag on the picture. Shift+Enter makes a new line in text."}
        {img && ` · ${doc.crop ? `${Math.round(doc.crop.w)} × ${Math.round(doc.crop.h)}` : `${img.width} × ${img.height}`}`}
      </div>
    </div>
  );
}
