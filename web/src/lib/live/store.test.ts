import { beforeEach, describe, expect, it } from "vitest";
import { useSim } from "./store";
import { CLOCK, TRIP, makeState } from "./__tests__/fixtures";

const seekClock = { ...CLOCK, epoch: 4, current_time: "2026-02-11T13:00:00-08:00", local_date: "2026-02-11", hour: 13 };

describe("live store", () => {
  beforeEach(() => {
    useSim.setState(useSim.getInitialState(), true);
    useSim.getState().setSnapshot(makeState());
  });

  describe("seek bookkeeping", () => {
    it("a Clock with a newer epoch shows immediately and sets pendingSeek, without touching the store epoch", () => {
      useSim.getState().setClockOptimistic(seekClock);
      const s = useSim.getState();
      expect(s.clock).toEqual(seekClock);
      expect(s.pendingSeek).toBe(true);
      expect(s.epoch).toBe(3);
    });

    it("the post-reset snapshot clears pendingSeek", () => {
      useSim.getState().setClockOptimistic(seekClock);
      useSim.getState().setSnapshot(makeState({ epoch: 4, last_seq: 10, simulation: seekClock }));
      expect(useSim.getState().pendingSeek).toBe(false);
      expect(useSim.getState().epoch).toBe(4);
    });

    it("an older snapshot keeps a newer optimistic clock and pendingSeek", () => {
      useSim.getState().setClockOptimistic(seekClock);
      useSim.getState().setSnapshot(makeState());
      expect(useSim.getState().pendingSeek).toBe(true);
      expect(useSim.getState().clock).toEqual(seekClock);
    });

    it("a seek response that arrives after its reset was applied changes nothing", () => {
      useSim.getState().setSnapshot(makeState({ epoch: 4, last_seq: 10, simulation: { ...seekClock, status: "RUNNING" } }));
      useSim.getState().setClockOptimistic({ ...CLOCK, epoch: 3 });
      expect(useSim.getState().pendingSeek).toBe(false);
      expect(useSim.getState().clock?.epoch).toBe(4);
    });

    it("a same-epoch Clock (pause, speed) replaces the clock", () => {
      useSim.getState().setClockOptimistic({ ...CLOCK, status: "RUNNING", speed: 300 });
      expect(useSim.getState().clock).toMatchObject({ status: "RUNNING", speed: 300 });
      expect(useSim.getState().pendingSeek).toBe(false);
    });
  });

  describe("upsertTrip", () => {
    it("applies a REST response", () => {
      useSim.getState().upsertTrip({ ...TRIP, status: "APPROVED" });
      expect(useSim.getState().trips[TRIP.id].status).toBe("APPROVED");
    });

    it("never rolls a trip back to an earlier status", () => {
      useSim.getState().upsertTrip({ ...TRIP, status: "BUS_EN_ROUTE" });
      useSim.getState().upsertTrip({ ...TRIP, status: "APPROVED" });
      expect(useSim.getState().trips[TRIP.id].status).toBe("BUS_EN_ROUTE");
    });
  });

  describe("selection", () => {
    it("selecting a hub opens Now and clears hub-specific state", () => {
      const s = useSim.getState();
      s.selectHub("waterfront", "routes");
      s.startPreview(TRIP.id);
      s.setHoverOrigin("Surrey");
      useSim.getState().selectHub("ubc");
      expect(useSim.getState()).toMatchObject({
        selectedHubId: "ubc",
        tab: "now",
        previewTripId: null,
        hoverOrigin: null,
      });
    });

    it("re-selecting the same hub keeps the tab unless one is given", () => {
      useSim.getState().selectHub("ubc", "origins");
      useSim.getState().selectHub("ubc");
      expect(useSim.getState().tab).toBe("origins");
      useSim.getState().selectHub("ubc", "dispatch");
      expect(useSim.getState().tab).toBe("dispatch");
    });

    it("toggles layers", () => {
      useSim.getState().toggleLayer("routes");
      expect(useSim.getState().layers).toContain("routes");
      useSim.getState().toggleLayer("origins");
      expect(useSim.getState().layers).not.toContain("origins");
    });
  });

  it("repeated announcements still change the live region text", () => {
    useSim.getState().announce("New proposal");
    const first = useSim.getState().announcement;
    useSim.getState().announce("New proposal");
    expect(useSim.getState().announcement).not.toBe(first);
    expect(useSim.getState().announcement.trim()).toBe("New proposal");
  });
});
