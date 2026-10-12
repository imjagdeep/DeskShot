// Small line icons for the editor's tools (same 24px style as the app's icons).

import type { Tool } from "./model";

const PATHS: Record<Tool, React.ReactNode> = {
  select: <path d="M6 4l11 7-5 1.3L9.6 18z" />,
  arrow: (
    <>
      <path d="M5 19L18 6" />
      <path d="M10 6h8v8" />
    </>
  ),
  rect: <rect x="4.5" y="6" width="15" height="12" rx="1.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  line: <path d="M5 18L19 6" />,
  pen: <path d="M4 18c3-1 4-7 7-7s2 5 5 5 3-4 4-6" />,
  highlight: (
    <>
      <path d="M14.5 4.5l5 5-8 8H6.5v-5z" />
      <path d="M4 20h16" />
    </>
  ),
  text: <path d="M6 6h12M12 6v13M9 19h6" />,
  step: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M11 9l1.5-1v8" />
    </>
  ),
  pixelate: (
    <>
      <rect x="4" y="4" width="5" height="5" />
      <rect x="9" y="9" width="5" height="5" />
      <rect x="14" y="4" width="5" height="5" />
      <rect x="4" y="14" width="5" height="5" />
      <rect x="14" y="14" width="5" height="5" />
    </>
  ),
  redact: (
    <>
      <rect x="3.5" y="8" width="17" height="8" rx="1.5" fill="currentColor" />
    </>
  ),
  crop: (
    <>
      <path d="M7 3v14h14" />
      <path d="M3 7h14v14" />
    </>
  ),
};

export function ToolIcon({ tool }: { tool: Tool }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[tool]}
    </svg>
  );
}
