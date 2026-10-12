import { describe, expect, it } from "vitest";
import { fileStamp } from "./lib/captures";
import { targetAt, toPicture } from "./Overlay";

describe("selection maths", () => {
  it("turns a drag in any direction into picture pixels (HiDPI 2x)", () => {
    expect(toPicture({ x: 300, y: 200 }, { x: 100, y: 50 }, 2, 2, 3840, 2160)).toEqual({ x: 200, y: 100, w: 400, h: 300 });
  });
  it("clamps to the picture and drops tiny drags", () => {
    expect(toPicture({ x: -20, y: -20 }, { x: 50, y: 40 }, 1, 1, 1920, 1080)).toEqual({ x: 0, y: 0, w: 50, h: 40 });
    expect(toPicture({ x: 10, y: 10 }, { x: 11, y: 30 }, 1, 1, 1920, 1080)).toBeNull();
  });
  it("picks the topmost window under the point", () => {
    const t = [
      { title: "Dialog", app: "Notepad", rect: { x: 100, y: 100, w: 200, h: 100 } },
      { title: "Editor", app: "Notepad", rect: { x: 0, y: 0, w: 1000, h: 800 } },
    ];
    expect(targetAt(t, 150, 150)?.title).toBe("Dialog");
    expect(targetAt(t, 900, 700)?.title).toBe("Editor");
    expect(targetAt(t, 1500, 10)).toBeNull();
  });
  it("names files in local time", () => {
    const ms = new Date(2026, 9, 12, 14, 3, 22).getTime();
    expect(fileStamp(ms)).toBe("2026-10-12 at 14.03.22");
  });
});
