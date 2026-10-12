import { describe, expect, it } from "vitest";
import { boxFrom, clampBox, commit, moved, nextStep, redo, startHistory, tooSmall, transformed, undo, type Shape } from "./model";

const rect: Shape = { id: "a", kind: "rect", box: { x: 10, y: 20, w: 100, h: 50 }, color: "#000", width: 3 };

describe("editor model", () => {
  it("boxes from any two corners, kept inside the picture", () => {
    expect(boxFrom(100, 80, 20, 10)).toEqual({ x: 20, y: 10, w: 80, h: 70 });
    expect(clampBox({ x: -10, y: 5, w: 50, h: 1000 }, 200, 100)).toEqual({ x: 0, y: 5, w: 40, h: 95 });
    expect(clampBox({ x: 300, y: 5, w: 50, h: 50 }, 200, 100)).toBeNull();
  });
  it("moves and transforms shapes", () => {
    expect(moved(rect, 5, -5)).toMatchObject({ box: { x: 15, y: 15, w: 100, h: 50 } });
    expect(transformed(rect, 2, 0.5, 7, 3)).toMatchObject({ box: { x: 27, y: 13, w: 200, h: 25 } });
    const pen: Shape = { id: "p", kind: "pen", points: [0, 0, 10, 20], color: "#000", width: 3 };
    expect(moved(pen, 1, 2)).toMatchObject({ points: [1, 2, 11, 22] });
  });
  it("numbers steps and ignores clicks that weren't drags", () => {
    const step = (n: number): Shape => ({ id: `n${n}`, kind: "step", x: 0, y: 0, n, color: "#000", size: 12 });
    expect(nextStep([rect, step(1), step(4)])).toBe(5);
    expect(tooSmall({ ...rect, box: { x: 0, y: 0, w: 2, h: 40 } })).toBe(true);
    expect(tooSmall({ id: "t", kind: "text", x: 0, y: 0, text: "  ", color: "#000", size: 20 })).toBe(true);
  });
  it("undoes and redoes", () => {
    let h = startHistory();
    h = commit(h, { shapes: [rect], crop: null });
    h = commit(h, { shapes: [], crop: null });
    h = undo(h);
    expect(h.now.shapes).toHaveLength(1);
    h = redo(h);
    expect(h.now.shapes).toHaveLength(0);
    h = undo(undo(undo(h)));
    expect(h.now.shapes).toHaveLength(0);
    expect(h.past).toHaveLength(0);
  });
});
