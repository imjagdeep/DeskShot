import logo from "../assets/logo.png";
import { useAppInfo } from "../lib/store";
import { SideNav, type NavGroup } from "../shell/SideNav";
import { AccountIcon, CameraIcon, HistoryIcon, SettingsIcon } from "./Icons";

export type Page = "capture" | "history" | "account" | "settings" | "editor";

/** The pages in sidebar order (the View menu and Ctrl+1… use it too). The
 * editor isn't listed: it opens from a capture's Edit button. */
export const PAGES: { page: Exclude<Page, "editor">; label: string; group: string }[] = [
  { page: "capture", label: "Capture", group: "Screenshots" },
  { page: "history", label: "History", group: "Screenshots" },
  { page: "account", label: "Account", group: "App" },
  { page: "settings", label: "Settings", group: "App" },
];

const ICONS: Record<Exclude<Page, "editor">, (p: { size?: number }) => React.ReactElement> = {
  capture: CameraIcon,
  history: HistoryIcon,
  account: AccountIcon,
  settings: SettingsIcon,
};

export function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const info = useAppInfo();
  const groups: NavGroup<Page>[] = [];
  for (const p of PAGES) {
    let g = groups.find((x) => x.title === p.group);
    if (!g) groups.push((g = { title: p.group, items: [] }));
    g.items.push({ page: p.page, label: p.label, Icon: ICONS[p.page] });
  }
  const ready = !info ? "…" : info.shortcut ? `Ready · ${info.shortcut}` : "Ready";
  return (
    <SideNav
      appName="DeskShot"
      logo={logo}
      groups={groups}
      page={page}
      onNavigate={onNavigate}
      footTitle={info?.shortcut ? `Press ${info.shortcut} anywhere to snip` : undefined}
      foot={
        <>
          <span className={info ? "dot on" : "dot"} />
          <span className="ellipsis">{ready}</span>
        </>
      }
    />
  );
}
