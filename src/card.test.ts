import { describe, expect, it } from "vitest";
import { savedPlace } from "./Card";

describe("quick-capture card", () => {
  it("names the folder a capture was saved in, not the whole path", () => {
    expect(savedPlace("C:\\Users\\me\\Pictures\\DeskShot\\DeskShot 2026-10-27 at 18.20.11.jpg")).toBe("Pictures\\DeskShot");
    expect(savedPlace("/Users/me/Pictures/DeskShot/shot.png")).toBe("Pictures/DeskShot");
    expect(savedPlace("D:\\shot.png")).toBe("D:");
  });
});
