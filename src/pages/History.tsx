import { useEffect, useMemo, useState } from "react";
import { Empty, PageHeader } from "../components/Common";
import { CaptureView } from "../components/CaptureView";
import { HistoryIcon, SearchIcon } from "../components/Icons";
import type { HistoryEntry } from "../lib/api";
import { pictureUrl, useCaptures, when } from "../lib/captures";
import { toastError } from "../lib/store";

/** A small picture that loads when it scrolls into view. */
export function Thumb({
  entry,
  active,
  onClick,
  loader,
}: {
  entry: HistoryEntry;
  active: boolean;
  onClick: () => void;
  loader: (id: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [el, setEl] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!el) return;
    let live = true;
    const io = new IntersectionObserver((seen) => {
      if (!seen.some((s) => s.isIntersecting)) return;
      io.disconnect();
      loader(entry.id)
        .then((u) => live && setUrl(u))
        .catch(toastError);
    });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [el, entry.id, loader]);
  return (
    <button ref={setEl} className={active ? "thumb active" : "thumb"} onClick={onClick} title={`${when(entry.created)} · ${entry.width} × ${entry.height}`}>
      <span className="thumb-pic">{url && <img src={url} alt="" />}</span>
      <span className="thumb-cap">{when(entry.created)}</span>
    </button>
  );
}

export function History({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const list = useCaptures();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!list || !q) return list ?? [];
    return list.filter((e) => `${when(e.created)} ${e.width}x${e.height} ${e.saved ?? ""}`.toLowerCase().includes(q));
  }, [list, query]);
  const current = shown.find((e) => e.id === selected) ?? null;

  return (
    <div className="page page-wide">
      <PageHeader title="History" subtitle={list ? `${list.length} capture${list.length === 1 ? "" : "s"}, newest first` : undefined}>
        <label className="search-box">
          <SearchIcon size={14} />
          <input value={query} placeholder="Search by date, size or file name" onChange={(e) => setQuery(e.target.value)} aria-label="Search history" />
        </label>
      </PageHeader>
      {list && list.length === 0 && <Empty Icon={HistoryIcon} title="Nothing here yet" text="Every capture is kept here, newest first." />}
      {list && list.length > 0 && shown.length === 0 && <div className="empty">Nothing matches “{query.trim()}”.</div>}
      {current && <CaptureView key={current.id} entry={current} onDeleted={() => onSelect(null)} />}
      <div className="thumb-grid">
        {shown.map((e) => (
          <Thumb key={e.id} entry={e} active={e.id === current?.id} onClick={() => onSelect(e.id === selected ? null : e.id)} loader={pictureUrl} />
        ))}
      </div>
    </div>
  );
}
