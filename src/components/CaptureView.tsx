// One capture, big, with what you can do with it.

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, type HistoryEntry } from "../lib/api";
import { deleteCapture, fileStamp, picturePng, pictureUrl, setCaptureText, when } from "../lib/captures";
import { toast, toastError } from "../lib/store";
import { CopyIcon, EditIcon, FolderIcon, SaveIcon, TextIcon, TrashIcon } from "./Icons";

export function CaptureView({ entry, onDeleted, onEdit }: { entry: HistoryEntry; onDeleted: () => void; onEdit: (e: HistoryEntry) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    pictureUrl(entry.id)
      .then((u) => live && setUrl(u))
      .catch(toastError);
    return () => {
      live = false;
    };
  }, [entry.id]);

  const copy = async () => {
    try {
      await api.copyPng(await picturePng(entry.id));
      toast("Copied to the clipboard");
    } catch (e) {
      toastError(e);
    }
  };

  // The words in the picture, read now if they haven't been yet.
  const copyText = async () => {
    setReading(true);
    try {
      let text = entry.text;
      if (text == null) {
        const { readText, loadImage } = await import("../lib/ocr");
        text = (await readText(await loadImage(await pictureUrl(entry.id)))).text;
        await setCaptureText(entry.id, text);
      }
      if (!text.trim()) {
        toast("No text found in this picture");
        return;
      }
      await writeText(text);
      const words = text.split(/\s+/).filter(Boolean).length;
      toast(`Copied the text (${words} word${words === 1 ? "" : "s"})`);
    } catch (e) {
      toastError(e);
    } finally {
      setReading(false);
    }
  };

  const saveAs = async () => {
    try {
      const path = await save({
        title: "Save the capture",
        defaultPath: `DeskShot ${fileStamp(entry.created)}.png`,
        filters: [
          { name: "PNG picture", extensions: ["png"] },
          { name: "JPG picture", extensions: ["jpg"] },
        ],
      });
      if (!path) return;
      await api.savePng(path, await picturePng(entry.id));
      toast("Saved");
    } catch (e) {
      toastError(e);
    }
  };

  const remove = async () => {
    try {
      await deleteCapture(entry.id);
      onDeleted();
      toast(entry.saved ? "Removed from History (the saved copy stays in your folder)" : "Removed from History");
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="shot-view">
      <div className="shot-stage">
        {url ? <img src={url} alt={`Capture from ${when(entry.created)}`} /> : <div className="shot-loading" />}
      </div>
      <div className="shot-bar">
        <div className="shot-meta">
          <strong>{when(entry.created)}</strong>
          <span className="muted small">
            {entry.width} × {entry.height}
            {entry.saved ? ` · ${entry.saved}` : " · not saved to a folder"}
          </span>
        </div>
        <div className="shot-actions">
          <button className="with-icon primary" onClick={() => onEdit(entry)} title="Draw, blur, crop (E)">
            <EditIcon size={15} /> Edit
          </button>
          <button className="with-icon" onClick={() => void copy()} title="Copy the picture">
            <CopyIcon size={15} /> Copy
          </button>
          <button className="with-icon" onClick={() => void copyText()} disabled={reading} title="Read the text in the picture and copy it">
            <TextIcon size={15} /> {reading ? "Reading…" : "Copy text"}
          </button>
          <button className="with-icon" onClick={() => void saveAs()}>
            <SaveIcon size={15} /> Save as…
          </button>
          {entry.saved && (
            <button className="icon" title="Show in folder" onClick={() => void api.revealFile(entry.saved ?? "").catch(toastError)}>
              <FolderIcon size={16} />
            </button>
          )}
          <button className="icon" title="Remove from History" onClick={() => void remove()}>
            <TrashIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
