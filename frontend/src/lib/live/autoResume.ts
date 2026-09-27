// Resumes the simulation once every proposal it paused for has been decided (approved, rejected or expired).
// Only a backend auto-pause (clock.updated reason AUTO_PAUSE_PROPOSAL) arms it, so a pause the user made
// themselves is never undone. Resuming by hand, a seek or a reset disarms it.
import { resumeClock } from "@/lib/api/endpoints";
import type { Clock } from "@/lib/api/schemas";
import { useSim } from "./store";
import type { SimSlice } from "./reducer";

let armed = false;
/** A proposal was pending while armed, so "none pending" means they were decided, not that none arrived yet. */
let sawProposal = false;
let inFlight = false;

const hasPending = (trips: SimSlice["trips"]) => Object.values(trips).some((t) => t.status === "PROPOSED");

/** Called for each backend auto-pause (effects.ts). */
export function armAutoResume(): void {
  armed = true;
  sawProposal = hasPending(useSim.getState().trips);
}

/** Called on a reset: the proposals the pause was for are gone. */
export function disarmAutoResume(): void {
  armed = false;
}

/** Whether an armed auto-resume should fire for this state. */
export function shouldAutoResume(s: Pick<SimSlice, "clock" | "trips" | "resyncing">, pendingSeek: boolean): boolean {
  if (s.clock?.status !== "PAUSED" || s.resyncing || pendingSeek) return false;
  return !hasPending(s.trips);
}

/** Watches the store while the live connection runs. Returns the unsubscribe. */
export function installAutoResume(resume: () => Promise<Clock> = resumeClock): () => void {
  armed = false;
  sawProposal = false;
  inFlight = false;
  return useSim.subscribe((s) => {
    if (s.clock?.status === "RUNNING") armed = false;
    if (!armed) return;
    if (hasPending(s.trips)) sawProposal = true;
    if (!sawProposal || inFlight || !shouldAutoResume(s, s.pendingSeek)) return;
    armed = false;
    inFlight = true;
    resume()
      .then((clock) => useSim.getState().setClockOptimistic(clock))
      .catch(() => {}) // The play button still works; the clock stays paused.
      .finally(() => {
        inFlight = false;
      });
  });
}
