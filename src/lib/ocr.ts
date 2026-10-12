// Reading text in captures, offline: tesseract (bundled with the app, English).
// One worker, started on first use and kept for the session.

import { createWorker, OEM, PSM, type Worker } from "tesseract.js";

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OcrLine {
  text: string;
  words: OcrWord[];
}
export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

let worker: Promise<Worker> | null = null;
function getWorker(): Promise<Worker> {
  if (!worker) {
    const starting = createWorker("eng", OEM.LSTM_ONLY, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/core",
      langPath: "/tesseract/lang",
      workerBlobURL: false,
      gzip: true,
      cacheMethod: "none",
    }).then(async (w) => {
      await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1" });
      return w;
    });
    worker = starting;
    // A failed start can be tried again next time.
    starting.catch(() => {
      if (worker === starting) worker = null;
    });
  }
  return worker;
}

/** Screen text is small: reading a 2x enlargement finds much more of it. */
function enlarge(img: HTMLImageElement): { canvas: HTMLCanvasElement; factor: number } {
  const factor = img.width * img.height < 4_000_000 ? 2 : 1;
  const canvas = document.createElement("canvas");
  canvas.width = img.width * factor;
  canvas.height = img.height * factor;
  const c = canvas.getContext("2d");
  if (c) {
    c.imageSmoothingQuality = "high";
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return { canvas, factor };
}

/** Read the text in a picture; word boxes are in the picture's own pixels. */
export async function readText(img: HTMLImageElement): Promise<OcrResult> {
  const w = await getWorker();
  const { canvas, factor } = enlarge(img);
  const { data } = await w.recognize(canvas, {}, { text: true, blocks: true });
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs) {
      for (const l of p.lines) {
        const words = l.words
          .filter((wd) => wd.confidence > 30 && wd.text.trim() !== "")
          .map((wd) => ({
            text: wd.text,
            x: wd.bbox.x0 / factor,
            y: wd.bbox.y0 / factor,
            w: (wd.bbox.x1 - wd.bbox.x0) / factor,
            h: (wd.bbox.y1 - wd.bbox.y0) / factor,
          }));
        if (words.length) lines.push({ text: words.map((wd) => wd.text).join(" "), words });
      }
    }
  }
  return { text: lines.map((l) => l.text).join("\n"), lines };
}

/** Load a picture URL into an <img>. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const el = new Image();
    el.onload = () => ok(el);
    el.onerror = () => fail(new Error("couldn't open the picture"));
    el.src = url;
  });
}
