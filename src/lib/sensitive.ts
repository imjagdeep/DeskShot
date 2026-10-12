// Finding private details in recognised text: emails, phone numbers, IP
// addresses and card numbers, each with the box that covers it.

import type { OcrLine } from "./ocr";

export type Kind = "email" | "phone" | "ip" | "card";
export interface Finding {
  kind: Kind;
  text: string;
  box: { x: number; y: number; w: number; h: number };
}

const PATTERNS: { kind: Kind; re: RegExp; ok?: (m: string) => boolean }[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "card", re: /\b\d(?:[ -]?\d){12,18}\b/g, ok: (m) => luhn(m.replace(/\D/g, "")) },
  { kind: "ip", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ok: (m) => m.split(".").every((p) => Number(p) <= 255) },
  { kind: "phone", re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
];

/** The card-number checksum. */
export function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Every private detail in the lines, with a margin around each box (0 = none). */
export function findSensitive(lines: OcrLine[], pad = 3): Finding[] {
  const out: Finding[] = [];
  for (const line of lines) {
    // Where each word sits in the joined line text.
    let pos = 0;
    const spans = line.words.map((w) => {
      const s = { start: pos, end: pos + w.text.length, w };
      pos += w.text.length + 1;
      return s;
    });
    const text = line.words.map((w) => w.text).join(" ");
    const taken: [number, number][] = [];
    for (const p of PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        if (p.ok && !p.ok(m[0])) continue;
        // A card number also looks like a phone number: first match wins.
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        const ws = spans.filter((s) => s.start < end && s.end > start).map((s) => s.w);
        if (!ws.length) continue;
        // OCR often reads the dot in "alex.morgan@…" as a space: take in a
        // all-lowercase word right before an email (covering a harmless
        // "to" is the safe mistake).
        if (p.kind === "email") {
          const first = spans.findIndex((s) => s.w === ws[0]);
          const prev = first > 0 ? spans[first - 1].w : null;
          if (prev && /^[a-z0-9._%+-]{2,}$/.test(prev.text) && ws[0].x - (prev.x + prev.w) < ws[0].h * 0.8) ws.unshift(prev);
        }
        const x0 = Math.min(...ws.map((w) => w.x));
        const y0 = Math.min(...ws.map((w) => w.y));
        const x1 = Math.max(...ws.map((w) => w.x + w.w));
        const y1 = Math.max(...ws.map((w) => w.y + w.h));
        taken.push([start, end]);
        // Word boxes from OCR run a little tight: more margin for bigger text.
        const px = pad ? Math.max(pad, (y1 - y0) * 0.5) : 0;
        const py = pad ? Math.max(pad, (y1 - y0) * 0.15) : 0;
        out.push({ kind: p.kind, text: m[0], box: { x: x0 - px, y: y0 - py, w: x1 - x0 + px * 2, h: y1 - y0 + py * 2 } });
      }
    }
  }
  return out;
}

const NAMES: Record<Kind, [string, string]> = {
  email: ["email address", "email addresses"],
  phone: ["phone number", "phone numbers"],
  ip: ["IP address", "IP addresses"],
  card: ["card number", "card numbers"],
};

/** "2 email addresses and 1 IP address" */
export function describeFindings(found: Finding[]): string {
  const parts = (Object.keys(NAMES) as Kind[])
    .map((k) => ({ k, n: found.filter((f) => f.kind === k).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${NAMES[x.k][x.n === 1 ? 0 : 1]}`);
  if (parts.length > 1) return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return parts[0] ?? "nothing";
}
