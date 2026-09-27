import { describe, expect, it } from "vitest";
import { speedHint, speedLabel } from "./speed";

describe("speedHint", () => {
  it("uses the spec wording for the contract speeds", () => {
    expect(speedHint(1)).toBe("Real time");
    expect(speedHint(60)).toBe("1 sim-hour per real minute");
    expect(speedHint(300)).toBe("1 sim-hour every 12 s");
    expect(speedHint(900)).toBe("1 sim-hour every 4 s");
    expect(speedHint(3600)).toBe("1 sim-hour per real second");
  });

  it("derives a hint for other speeds", () => {
    expect(speedHint(1800)).toBe("1 sim-hour every 2 s");
    expect(speedHint(30)).toBe("1 sim-hour every 2 min");
    expect(speedHint(7200)).toBe("1 sim-hour every 0.5 s");
  });

  it("labels speeds with a multiplication sign", () => {
    expect(speedLabel(300)).toBe("300×");
  });
});
