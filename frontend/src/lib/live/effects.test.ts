import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { toast, type Action } from "sonner";
import { qk } from "@/lib/api/queryKeys";
import { PAUSED_FOR_REVIEW, describeProposal, eventToastText, handleSimEffects, tripRouteLabel } from "./effects";
import { useSim } from "./store";
import { EVENT, TRIP, makeState } from "./__tests__/fixtures";

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn() });
  return { toast };
});

const toastMock = vi.mocked(toast);
// The captured fixture: bus-02 on route fixture-99 ("99"), event valid-event at UBC.
const PROPOSAL_TITLE = "New proposal: bus-02 → extra 99 trip at UBC";

describe("toast text", () => {
  it("describes proposals as bus → extra route trip at hub", () => {
    expect(describeProposal(TRIP, "99", "UBC")).toBe("bus-02 → extra 99 trip at UBC");
    expect(describeProposal(TRIP, "99", null)).toBe("bus-02 → extra 99 trip");
  });

  it("labels the route from the /routes cache, then the feed's route key", () => {
    const qc = new QueryClient();
    expect(tripRouteLabel({ ...TRIP, source_route: "R4" }, qc)).toBe("R4");
    qc.setQueryData(qk.routes(null, false), [{ route_id: TRIP.route_id, short_name: "99 B-Line" }]);
    expect(tripRouteLabel(TRIP, qc)).toBe("99 B-Line");
    expect(tripRouteLabel({ ...TRIP, source_route: null })).toBe(TRIP.route_id);
  });

  it("describes new dispatch events with Vancouver time and the index format", () => {
    expect(eventToastText(EVENT)).toBe("Surge forecast at UBC 10:00, 2.50×");
  });
});

describe("handleSimEffects", () => {
  beforeEach(() => {
    toastMock.mockClear();
    toastMock.dismiss.mockClear();
    useSim.setState(useSim.getInitialState(), true);
    useSim.getState().setSnapshot(makeState());
    handleSimEffects([{ kind: "reset", epoch: 0 }], { now: 0 });
    toastMock.dismiss.mockClear();
  });

  it("shows a proposal with a Review action, announces it, and notes an auto-pause in the same batch", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: TRIP }, { kind: "auto-paused" }], { now: 1000 });
    expect(toastMock).toHaveBeenCalledTimes(1);
    const [title, options] = toastMock.mock.calls[0];
    expect(title).toBe(PROPOSAL_TITLE);
    expect(options).toMatchObject({ id: `proposal:${TRIP.id}`, description: PAUSED_FOR_REVIEW });
    expect(useSim.getState().announcement).toBe(`${PROPOSAL_TITLE}. ${PAUSED_FOR_REVIEW}`);

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

  it("groups new dispatch events per hub, so a busy hub updates one toast in place", () => {
    handleSimEffects([{ kind: "event-new", event: { ...EVENT, id: "e1" } }], { now: 1000 });
    handleSimEffects([{ kind: "event-new", event: { ...EVENT, id: "e2" } }], { now: 2000 });
    expect(toastMock.mock.calls.map((c) => (c[1] as { id: string }).id)).toEqual(["event:ubc", "event:ubc"]);
  });

  it("keeps at most three toasts, dismissing the oldest", () => {
    for (let i = 0; i < 4; i++) {
      handleSimEffects([{ kind: "event-new", event: { ...EVENT, id: `e${i}`, hub_id: null, source_location: `place-${i}` } }], { now: 1000 + i });
    }
    expect(toastMock).toHaveBeenCalledTimes(4);
    expect(toastMock.dismiss).toHaveBeenCalledWith("event:place-0");
  });

  it("an expired proposal replaces its proposal toast", () => {
    handleSimEffects([{ kind: "trip-proposed", trip: TRIP }], { now: 1000 });
    handleSimEffects([{ kind: "trip-expired", trip: { ...TRIP, status: "EXPIRED" } }], { now: 2000 });
    expect(toastMock.dismiss).toHaveBeenCalledWith(`proposal:${TRIP.id}`);
    expect(toastMock.mock.calls[1][0]).toBe("Proposal expired");
  });

  it("reports system.error", () => {
    handleSimEffects([{ kind: "system-error", message: "source query failed" }], { now: 1000 });
    expect(toastMock.error).toHaveBeenCalledWith("The simulation reported an error.", expect.objectContaining({ description: "source query failed" }));
  });
});
