// The editor's document: the capture underneath plus a list of shapes, a
// crop, and an undo history. Plain data, so it can be tested without a canvas.
// All coordinates are in the capture's own pixels.

export type Tool =
  | "select"
  | "arrow"
  | "rect"
  | "ellipse"
  | "line"
  | "pen"
  | "highlight"
  | "text"
  | "step"
  | "pixelate"
  | "redact"
  | "crop";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Base {
  id: string;
}
export type Shape =
  | (Base & { kind: "rect" | "ellipse"; box: Box; color: string; width: number })
  | (Base & { kind: "arrow" | "line"; points: [number, number, number, number]; color: string; width: number })
  | (Base & { kind: "pen" | "highlight"; points: number[]; color: string; width: number })
  | (Base & { kind: "text"; x: number; y: number; text: string; color: string; size: number })
  | (Base & { kind: "step"; x: number; y: number; n: number; color: string; size: number })
  | (Base & { kind: "pixelate" | "redact"; box: Box });

export interface Doc {
  shapes: Shape[];
  crop: Box | null;
}

export const COLORS = ["#e5484d", "#f5a524", "#30a46c", "#0091ff", "#1d1d1f", "#ffffff"] as const;
export const WIDTHS = { S: 3, M: 6, L: 10 } as const;

/** Keyboard letters for the tools (shown in tooltips too). */
export const TOOL_KEYS: Record<Tool, string> = {
  select: "V",
  arrow: "A",
  rect: "R",
  ellipse: "E",
  line: "L",
  pen: "P",
  highlight: "H",
  text: "T",
  step: "N",
  pixelate: "B",
  redact: "X",
  crop: "C",
};

let seq = 0;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A box from two corners in any order. */
export function boxFrom(x0: number, y0: number, x1: number, y1: number): Box {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** A box kept inside the picture; null if nothing is left. */
export function clampBox(b: Box, w: number, h: number): Box | null {
  const x0 = Math.max(0, Math.min(w, b.x));
  const y0 = Math.max(0, Math.min(h, b.y));
  const x1 = Math.max(0, Math.min(w, b.x + b.w));
  const y1 = Math.max(0, Math.min(h, b.y + b.h));
  return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Too small to be meant (a click rather than a drag). */
export function tooSmall(s: Shape): boolean {
  switch (s.kind) {
    case "rect":
    case "ellipse":
    case "pixelate":
    case "redact":
      return s.box.w < 4 || s.box.h < 4;
    case "arrow":
    case "line":
      return Math.hypot(s.points[2] - s.points[0], s.points[3] - s.points[1]) < 6;
    case "pen":
    case "highlight":
      return s.points.length < 4;
    case "text":
      return s.text.trim() === "";
    case "step":
      return false;
  }
}

/** The next number for a step marker. */
export function nextStep(shapes: Shape[]): number {
  return shapes.reduce((n, s) => (s.kind === "step" ? Math.max(n, s.n) : n), 0) + 1;
}

/** Move a shape by dx, dy. */
export function moved(s: Shape, dx: number, dy: number): Shape {
  switch (s.kind) {
    case "rect":
    case "ellipse":
    case "pixelate":
    case "redact":
      return { ...s, box: { ...s.box, x: s.box.x + dx, y: s.box.y + dy } };
    case "arrow":
    case "line":
      return { ...s, points: [s.points[0] + dx, s.points[1] + dy, s.points[2] + dx, s.points[3] + dy] };
    case "pen":
    case "highlight":
      return { ...s, points: s.points.map((v, i) => v + (i % 2 ? dy : dx)) };
    case "text":
    case "step":
      return { ...s, x: s.x + dx, y: s.y + dy };
  }
}

/** Undo history: a list of documents and where we are in it. */
export interface History {
  past: Doc[];
  now: Doc;
  future: Doc[];
}

export const startHistory = (): History => ({ past: [], now: { shapes: [], crop: null }, future: [] });

export function commit(h: History, next: Doc): History {
  return { past: [...h.past.slice(-99), h.now], now: next, future: [] };
}
export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  return prev ? { past: h.past.slice(0, -1), now: prev, future: [h.now, ...h.future] } : h;
}
export function redo(h: History): History {
  const next = h.future[0];
  return next ? { past: [...h.past, h.now], now: next, future: h.future.slice(1) } : h;
}

/** Pixel size for pixelating a box: coarse enough to be unreadable. */
export function pixelSizeFor(b: Box): number {
  return Math.max(10, Math.round(Math.min(b.w, b.h) / 6));
}

/** A shape after the transformer scaled its group by (sx, sy) and moved it to (gx, gy). */
export function transformed(s: Shape, sx: number, sy: number, gx: number, gy: number): Shape {
  const px = (v: number) => v * sx + gx;
  const py = (v: number) => v * sy + gy;
  switch (s.kind) {
    case "rect":
    case "ellipse":
    case "pixelate":
    case "redact":
      return { ...s, box: { x: px(s.box.x), y: py(s.box.y), w: s.box.w * sx, h: s.box.h * sy } };
    case "arrow":
    case "line":
      return { ...s, points: [px(s.points[0]), py(s.points[1]), px(s.points[2]), py(s.points[3])] };
    case "pen":
    case "highlight":
      return { ...s, points: s.points.map((v, i) => (i % 2 ? py(v) : px(v))) };
    case "text":
      return { ...s, x: px(s.x), y: py(s.y), size: Math.max(6, s.size * sy) };
    case "step":
      return { ...s, x: px(s.x), y: py(s.y), size: Math.max(6, s.size * (sx + sy) / 2) };
  }
}
