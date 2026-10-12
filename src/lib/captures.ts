// The capture history as a store, plus picture URLs loaded on demand.

import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { api, type HistoryEntry } from "./api";
import { createStore, toastError } from "./store";

const listStore = createStore<HistoryEntry[] | null>(null);
export const useCaptures = () => useSyncExternalStore(listStore.subscribe, listStore.get);

export async function refreshCaptures() {
  try {
    listStore.set(await api.historyList());
  } catch (e) {
    toastError(e);
  }
}

// Blob URLs for pictures already loaded this session.
const urls = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

export function pictureUrl(id: string): Promise<string> {
  const have = urls.get(id);
  if (have) return Promise.resolve(have);
  const busy = pending.get(id);
  if (busy) return busy;
  const p = api
    .historyImage(id)
    .then((png) => {
      const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
      urls.set(id, url);
      return url;
    })
    .finally(() => pending.delete(id));
  pending.set(id, p);
  return p;
}

export async function picturePng(id: string): Promise<Uint8Array> {
  return api.historyImage(id);
}

export async function deleteCapture(id: string) {
  await api.historyDelete(id);
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
  const list = listStore.get();
  if (list) listStore.set(list.filter((e) => e.id !== id));
}

/** Keep the list current when a capture lands. Returns the unlisten promise. */
export function watchCaptures(onNew: (e: HistoryEntry) => void) {
  return listen<HistoryEntry>("captured", (ev) => {
    const list = listStore.get() ?? [];
    listStore.set([ev.payload, ...list.filter((e) => e.id !== ev.payload.id)]);
    onNew(ev.payload);
  });
}

export function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" })}, ${time}`;
}

/** "2026-10-12 at 14.03.22" in local time, for file names. */
export function fileStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

/** Remember the words read from a capture (store + History index). */
export async function setCaptureText(id: string, text: string) {
  await api.historySetText(id, text);
  const list = listStore.get();
  if (list) listStore.set(list.map((e) => (e.id === id ? { ...e, text } : e)));
}

// ---------- background reading for search ----------
let indexing = false;
// Tried this session, whatever happened, so nothing is read twice.
const tried = new Set<string>();

/** Read the text of captures that haven't been read yet, newest first, one
 * at a time, so History can be searched by the words in the pictures. */
export async function indexCaptures() {
  if (indexing) return;
  indexing = true;
  try {
    for (;;) {
      const next = (listStore.get() ?? []).find((e) => e.text == null && !tried.has(e.id));
      if (!next) break;
      tried.add(next.id);
      try {
        const png = await api.historyImage(next.id);
        const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
        try {
          const { readText, loadImage } = await import("./ocr");
          const res = await readText(await loadImage(url));
          await setCaptureText(next.id, res.text);
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        // Skip it this session; one bad picture doesn't stop the rest.
        console.warn("reading a capture failed", e);
      }
      // Leave the computer some breathing room between pictures.
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally {
    indexing = false;
  }
}
