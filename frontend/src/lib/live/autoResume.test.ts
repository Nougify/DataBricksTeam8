import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armAutoResume, disarmAutoResume, installAutoResume } from "./autoResume";
import { useSim } from "./store";
import { CLOCK, TRIP, makeState } from "./__tests__/fixtures";

const paused = { ...CLOCK, status: "PAUSED" as const };
const setTrip = (status: typeof TRIP.status) => useSim.setState({ trips: { [TRIP.id]: { ...TRIP, status } } });

describe("auto-resume after proposals", () => {
  let resume: ReturnType<typeof vi.fn<() => Promise<typeof CLOCK>>>;
  let stop: () => void;

  beforeEach(() => {
    useSim.setState(useSim.getInitialState(), true);
    useSim.getState().setSnapshot(makeState({ simulation: paused })); // TRIP is PROPOSED
    resume = vi.fn(() => Promise.resolve({ ...CLOCK, status: "RUNNING" as const }) as Promise<typeof CLOCK>);
    stop = installAutoResume(resume);
  });
  afterEach(() => stop());

  it("resumes once the last pending proposal is decided after an auto-pause", () => {
    armAutoResume();
    setTrip("APPROVED");
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("waits while a proposal is still pending", () => {
    armAutoResume();
    useSim.setState({ hoverOrigin: "x" });
    expect(resume).not.toHaveBeenCalled();
  });

  it("never undoes a pause the user made (no auto-pause)", () => {
    setTrip("REJECTED");
    expect(resume).not.toHaveBeenCalled();
  });

  it("does nothing after a reset or a manual resume", () => {
    armAutoResume();
    disarmAutoResume();
    setTrip("APPROVED");
    armAutoResume();
    useSim.setState({ clock: { ...CLOCK, status: "RUNNING" } });
    useSim.setState({ clock: paused });
    setTrip("EXPIRED");
    expect(resume).not.toHaveBeenCalled();
  });

  it("does not fire for an auto-pause that arrives before any proposal is seen", () => {
    useSim.setState({ trips: {} });
    armAutoResume();
    useSim.setState({ hoverOrigin: "x" });
    expect(resume).not.toHaveBeenCalled();
  });
});
