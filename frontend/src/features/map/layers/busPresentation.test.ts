import { describe, expect, it } from "vitest";
import { busVisual } from "./busPresentation";

describe("busVisual", () => {
  it("maps every v3 bus lifecycle status to the operational notation", () => {
    expect(busVisual("RESERVED")).toMatchObject({ variant: "outline", token: "trip-proposed", size: 20 });
    expect(busVisual("DEADHEADING")).toMatchObject({ variant: "outline", token: "trip-active" });
    expect(busVisual("WAITING")).toMatchObject({ variant: "outline", token: "trip-active" });
    expect(busVisual("IN_SERVICE")).toMatchObject({ variant: "solid", token: "trip-active" });
    expect(busVisual("RETURNING")).toMatchObject({ variant: "solid", token: "trip-done" });
    expect(busVisual("REPOSITIONING")).toMatchObject({ variant: "solid", token: "trip-done" });
    expect(busVisual("AVAILABLE")).toEqual({ variant: "solid", token: "typical", size: 16, opacity: 0.7 });
  });
});
