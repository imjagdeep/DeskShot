import { useState } from "react";
import { PageHeader, Empty } from "../components/Common";
import { CaptureView } from "../components/CaptureView";
import { AreaIcon, CameraIcon, ScreenIcon, TimerIcon, WindowIcon } from "../components/Icons";
import { api, type CaptureMode, type HistoryEntry } from "../lib/api";
import { pictureUrl, useCaptures, when } from "../lib/captures";
import { toastError, useAppInfo } from "../lib/store";
import { Thumb } from "./History";

const DELAYS = [0, 3, 5, 10];

export function Capture({
  selected,
  onSelect,
  onEdit,
}: {
  selected: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (e: HistoryEntry) => void;
}) {
  const info = useAppInfo();
  const list = useCaptures();
  const [delay, setDelay] = useState(0);
  const start = (mode: CaptureMode) => void api.startCapture(mode, delay).catch(toastError);
  const current = list?.find((e) => e.id === selected) ?? list?.[0] ?? null;

  return (
    <div className="page page-wide">
      <PageHeader title="Capture" subtitle={info ? `Press ${info.shortcut} anywhere to capture an area.` : undefined} />
      <div className="capture-tiles">
        <button className="capture-tile" onClick={() => start("area")}>
          <AreaIcon size={30} />
          <strong>Area</strong>
          <span className="muted small">Drag a rectangle, or click a window</span>
          {info && <kbd>{info.shortcut}</kbd>}
        </button>
        <button className="capture-tile" onClick={() => start("window")}>
          <WindowIcon size={30} />
          <strong>Window</strong>
          <span className="muted small">Click the window you want</span>
        </button>
        <button className="capture-tile" onClick={() => start("screen")}>
          <ScreenIcon size={30} />
          <strong>Full screen</strong>
          <span className="muted small">The screen your mouse is on</span>
        </button>
      </div>
      <div className="delay-row">
        <TimerIcon size={15} />
        <span className="muted small">Wait before capturing</span>
        <div className="segmented small" role="group" aria-label="Delay">
          {DELAYS.map((d) => (
            <button key={d} className={delay === d ? "active" : ""} onClick={() => setDelay(d)}>
              {d === 0 ? "No delay" : `${d} s`}
            </button>
          ))}
        </div>
        <span className="muted small">Handy for menus and hover pop-ups.</span>
      </div>

      {list && list.length === 0 && (
        <Empty Icon={CameraIcon} title="No captures yet" text="Your captures appear here, ready to copy, save or share." />
      )}
      {current && (
        <>
          <h2 className="section-title">{current.id === list?.[0]?.id ? "Latest capture" : when(current.created)}</h2>
          <CaptureView key={current.id} entry={current} onDeleted={() => onSelect(null)} onEdit={onEdit} />
        </>
      )}
      {list && list.length > 1 && (
        <div className="recent-strip">
          {list.slice(0, 10).map((e) => (
            <Thumb key={e.id} entry={e} active={e.id === current?.id} onClick={() => onSelect(e.id)} loader={pictureUrl} />
          ))}
        </div>
      )}
    </div>
  );
}
