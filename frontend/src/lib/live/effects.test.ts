import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { toast, type Action } from "sonner";
import { qk } from "@/lib/api/queryKeys";
import { PAUSED_FOR_REVIEW, describeProposal, handleSimEffects, hubDisplayName, surgeToastText } from "./effects";
import { useSim } from "./store";
import { BUS, SURGE, TRIP, makeState } from "./__tests__/fixtures";

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { dismiss: vi.fn() });
  return { toast };
});

const toastMock = vi.mocked(toast);
const depotTrip = {
  ...TRIP,
  id: "trip-depot",
  hub_id: "park-royal",
  bus: { id: "bus-7" },
  donor_route: null,
  route: { ...TRIP.route, short_name: "R2" },
};

describe("toast text", () => {
  it("describes proposals from route short names", () => {
    expect(describeProposal(TRIP, "UBC")).toBe("bus from route 25 → 99 at UBC");
    expect(describeProposal(depotTrip, "Park Royal")).toBe("bus from depot → R2 at Park Royal");
  });

  it("describes surges with Vancouver time and the index format", () => {
    expect(surgeToastText(SURGE, "UBC")).toBe("Surge forecast at UBC 13:00, 1.79×");
  });

  it("names hubs from the /hubs cache, then the fallback map", () => {
    const qc = new QueryClient();
    expect(hubDisplayName("park-royal", qc)).toBe("Park Royal");
    qc.setQueryData(qk.hubs(), [{ id: "park-royal", name: "Park Royal Village" }]);
    expect(hubDisplayName("park-royal", qc)).toBe("Park Royal Village");
    expect(hubDisplayName("somewhere")).toBe("somewhere");
  });
});

describe("handleSimEffects", () => {
  beforeEach(() => {
    toastMock.mockClear();
    toastMock.dismiss.mockClear();
    useSim.setState(useSim.getInitialState(), true);
    useSim.getState().setSnapshot(
      makeState({ buses: [BUS, { ...BUS, id: depotTrip.bus.id, source: { type: "DEPOT", route: null, depot_name: "North Vancouver Transit Centre" } }] }),
    );
    handleSimEffects([{ kind: "reset", epoch: 0 }], { now: 0 });
    toastMock.dismiss.mockClear();
  });

  it("shows a proposal with a Review action, announces it, and notes an auto-pause in the same batch", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: TRIP }, { kind: "auto-paused" }], { now: 1000 });
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [title, options] = toastMock.mock.calls[0];
    expect(title).toBe("New proposal: bus from route 25 → 99 at UBC");
    expect(options).toMatchObject({ id: `proposal:${TRIP.id}`, description: PAUSED_FOR_REVIEW });
    expect(useSim.getState().announcement).toBe(`New proposal: bus from route 25 → 99 at UBC. ${PAUSED_FOR_REVIEW}`);

    const action = options?.action as Action;
    action.onClick({} as Parameters<Action["onClick"]>[0]);
    expect(useSim.getState()).toMatchObject({ selectedHubId: "ubc", tab: "dispatch", previewTripId: TRIP.id });
  });

  it("updates the same toast when the auto-pause arrives within 300 ms", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: TRIP }], { now: 1000 });
    handleSimEffects([{ kind: "auto-paused" }], { now: 1200 });
    expect(toastMock).toHaveBeenCalledTimes(2);
    expect(toastMock.mock.calls[1][1]).toMatchObject({ id: `proposal:${TRIP.id}`, description: PAUSED_FOR_REVIEW });
  });

  it("doesn't link an auto-pause that comes much later", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: TRIP }], { now: 1000 });
    handleSimEffects([{ kind: "auto-paused" }], { now: 5000 });
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("names the depot when the bus has no donor route", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: depotTrip }], { now: 1000 });
    expect(toastMock.mock.calls[0][1]).toMatchObject({ description: "From depot: North Vancouver Transit Centre." });
  });

  it("keeps at most three toasts, dismissing the oldest", () => {
    for (let i = 0; i < 4; i++) {
      handleSimEffects([{ kind: "surge-new", surge: { ...SURGE, id: `surge-${i}` } }], { now: 1000 + i });
    }
    expect(toastMock).toHaveBeenCalledTimes(4);
    expect(toastMock.dismiss).toHaveBeenCalledWith("surge:surge-0");
  });

  it("an expired proposal replaces its proposal toast", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: TRIP }], { now: 1000 });
    handleSimEffects([{ kind: "trip-expired", trip: { ...TRIP, status: "EXPIRED" } }], { now: 2000 });
    expect(toastMock.dismiss).toHaveBeenCalledWith(`proposal:${TRIP.id}`);
    expect(toastMock.mock.calls[1][0]).toBe("Proposal expired");
  });
});
