import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast, type Action } from "sonner";
import { PAUSED_FOR_REVIEW, describeProposal, handleSimEffects } from "./effects";
import { useSim } from "./store";
import { BUS, EVENT, TRIP, makeState } from "./__tests__/fixtures";

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { dismiss: vi.fn() });
  return { toast };
});

const toastMock = vi.mocked(toast);

describe("v3 proposal effects", () => {
  beforeEach(() => {
    toastMock.mockClear();
    toastMock.dismiss.mockClear();
    useSim.setState(useSim.getInitialState(), true);
    useSim.getState().setSnapshot(makeState());
    handleSimEffects([{ kind: "reset", epoch: 0 }], { now: 0 });
  });

  it("describes a proposal by joining trip, bus, event, and recommendation", () => {
    expect(describeProposal(TRIP, BUS, EVENT, "UBC")).toBe("bus from route 25 → 99 at UBC");
  });

  it("shows and opens a joined proposal", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: TRIP }, { kind: "auto-paused" }], { now: 1000 });
    const [title, options] = toastMock.mock.calls[0];
    expect(title).toBe("New proposal: bus from route 25 → 99 at UBC");
    expect(options).toMatchObject({ id: `proposal:${TRIP.id}`, description: PAUSED_FOR_REVIEW });
    (options?.action as Action).onClick({} as Parameters<Action["onClick"]>[0]);
    expect(useSim.getState()).toMatchObject({ selectedHubId: "ubc", tab: "proposals", previewTripId: TRIP.id });
  });

  it("expires the existing proposal toast", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: TRIP }], { now: 1000 });
    handleSimEffects([{ kind: "trip-expired", trip: { ...TRIP, status: "EXPIRED" } }], { now: 2000 });
    expect(toastMock.dismiss).toHaveBeenCalledWith(`proposal:${TRIP.id}`);
    expect(toastMock.mock.calls[1][0]).toBe("Proposal expired");
  });
});
