"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { APP } from "@/config/app";
import { useSim } from "@/lib/live/store";

/**
 * About (spec §10), bound to the store's `aboutOpen` so the top bar and scorecard links can open it.
 * Milestone 1 has section 1 only; milestone 4 adds how it works, the model scorecard, validation, data
 * sources, limitations and freshness.
 */
export function AboutDialog() {
  const open = useSim((s) => s.aboutOpen);
  const setOpen = useSim((s) => s.setAboutOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="pr-8 font-heading text-2xl leading-7 font-semibold">About {APP.name}</DialogTitle>
          <DialogDescription className="sr-only">What this console is and how it works.</DialogDescription>
        </DialogHeader>
        <section aria-labelledby="about-what" className="flex flex-col gap-2">
          <h3 id="about-what" className="font-heading text-lg leading-tight font-semibold">
            What this is
          </h3>
          <p className="text-sm leading-relaxed">
            TransLink plans bus service on fixed schedules, so demand spikes around exams, holidays, events and
            nightlife leave some stops overcrowded while other routes run with spare capacity. This console uses cell
            tower pings to forecast demand surges at UBC, Waterfront Station and Park Royal hours ahead, and proposes
            moving a spare bus from a low-demand route for a dispatcher to approve.
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
