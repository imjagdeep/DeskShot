import { describe, expect, it } from "vitest";
import type { OcrLine } from "./ocr";
import { describeFindings, findSensitive, luhn } from "./sensitive";

/** A line of words laid out left to right, 10 px per character. */
function line(text: string, y = 100): OcrLine {
  let x = 0;
  const words = text.split(" ").map((t) => {
    const w = { text: t, x, y, w: t.length * 10, h: 16 };
    x += t.length * 10 + 10;
    return w;
  });
  return { text, words };
}

describe("private details", () => {
  it("finds an email and boxes just its word", () => {
    const f = findSensitive([line("Contact jag@example.com today")], 0);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "email", text: "jag@example.com", box: { x: 80, w: 150 } });
  });
  it("covers a name split from its email by a misread dot", () => {
    const f = findSensitive([line("Customer email: alex morgan@example.com")], 0);
    expect(f[0].box.x).toBe(160);
    // ...but not an ordinary word before it ("email:" has a colon).
    const g = findSensitive([line("email: x@example.com")], 0);
    expect(g[0].box.x).toBe(70);
  });
  it("finds phone numbers spread over several words", () => {
    const f = findSensitive([line("Call (250) 555-0123 now")], 0);
    expect(f.map((x) => x.kind)).toEqual(["phone"]);
    expect(f[0].box.x).toBe(50);
  });
  it("finds valid card numbers and IPs, ignores look-alikes", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    const f = findSensitive([line("Card 4111 1111 1111 1111 server 10.0.0.25 build 999.1.2.3")], 0);
    expect(f.map((x) => x.kind)).toEqual(["card", "ip"]);
  });
  it("describes what was found", () => {
    const f = findSensitive([line("a@b.co c@d.org 192.168.1.10")], 0);
    expect(describeFindings(f)).toBe("2 email addresses and 1 IP address");
    expect(describeFindings([])).toBe("nothing");
  });
});
