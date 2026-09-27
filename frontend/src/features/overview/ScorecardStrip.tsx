"use client";

// Scorecard strip (spec §8.5, DECISIONS.md "Where data comes from"): network recall and precision of the surge
// classifier at 60 min lead, from model.surge_model_metrics ("All hubs" row). Opens About.
import { Button } from "@/components/ui/button";
import { SourceNote } from "@/components/SourceNote";
import { DEFAULT_LEAD_MINUTES, METRICS_SOURCE, metricsFor } from "@/data/metrics";
import { fmtDuration, fmtPct } from "@/lib/format";
import { useSim } from "@/lib/live/store";

export function ScorecardStrip() {
  const setAboutOpen = useSim((s) => s.setAboutOpen);
  const m = metricsFor(DEFAULT_LEAD_MINUTES, null);
  if (!m) return null;
  return (
    <section aria-label="Model scorecard" className="flex flex-col gap-1 border-t pt-4">
      <p className="text-sm">
        Caught <span className="font-semibold">{fmtPct(m.recall * 100)}</span> of surge slots{" "}
        {fmtDuration(DEFAULT_LEAD_MINUTES)} ahead; <span className="font-semibold">{fmtPct(m.precision * 100)}</span> of
        its surge alerts were real.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SourceNote source={`${METRICS_SOURCE}, all hubs, ${m.slot_minutes}-min slots, backtest`} />
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setAboutOpen(true)}>
          How it&rsquo;s measured
        </Button>
      </div>
    </section>
  );
}
