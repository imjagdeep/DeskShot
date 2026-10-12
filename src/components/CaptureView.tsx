// One capture, big, with what you can do with it.

import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, type HistoryEntry } from "../lib/api";
import { deleteCapture, fileStamp, picturePng, pictureUrl, when } from "../lib/captures";
import { toast, toastError } from "../lib/store";
import { CopyIcon, FolderIcon, SaveIcon, TrashIcon } from "./Icons";

export function CaptureView({ entry, onDeleted }: { entry: HistoryEntry; onDeleted: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
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
          <button className="with-icon" onClick={() => void copy()} title="Copy the picture">
            <CopyIcon size={15} /> Copy
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
