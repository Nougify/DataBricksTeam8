import { describe, expect, it } from "vitest";
import { contrastRatio, isDarkColor, normaliseHex, parseHex } from "./color";

describe("colour maths", () => {
  it("parses GTFS colours with or without #", () => {
    expect(parseHex("#0060A9")).toEqual([0, 96, 169]);
    expect(parseHex("0060a9")).toEqual([0, 96, 169]);
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex(null)).toBeNull();
    expect(parseHex("teal")).toBeNull();
    expect(normaliseHex("0060A9")).toBe("#0060a9");
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // DESIGN.md §4.1: foreground on background is 13.26:1 in light mode.
    expect(contrastRatio("#0b2b33", "#ecf3f2")).toBeCloseTo(13.26, 1);
    // A white route plate on the light panel is below 3:1, so it gets a ring.
    expect(contrastRatio("#ffffff", "#ecf3f2")!).toBeLessThan(3);
    expect(contrastRatio("#0060A9", null)).toBeNull();
  });

  it("tells dark theme backgrounds from light ones", () => {
    expect(isDarkColor("#0a171b")).toBe(true);
    expect(isDarkColor("#ecf3f2")).toBe(false);
  });
});
