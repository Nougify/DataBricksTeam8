import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Label,
  LineChart,
  Skeleton,
  Slider,
  ToggleGroup,
  ToggleGroupItem,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { AlertTriangle, Bus, RotateCcw, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { HourTable } from '../components/HourTable';
import { Kpi } from '../components/Kpi';
import { OriginAccess, Recommendations, RouteCrowding, WeeklyTrend } from '../components/ContextPanels';
import { compact, dayLabel, hourLabel, pct, signed, type DayType, type Hub } from '../lib/format';
import { CROWDED_LOAD_PCT, evaluate, planAdd, planShift, type HourInput } from '../lib/planner';

type Mode = 'add' | 'shift';
const FULL_LOAD_PCT = 95;

// "99 WEST · 06-09 AM peak" -> "the westbound 99 in the 06-09 AM peak"
function describePeak(where: string): string {
  const [lineDir, period] = where.split(' · ');
  const m = /^(.*) (NORTH|SOUTH|EAST|WEST)$/.exec(lineDir ?? '');
  const line = m ? `the ${m[2].toLowerCase()}bound ${m[1]}` : `line ${lineDir}`;
  return period ? `${line} in the ${period}` : line;
}

interface PlannerPageProps {
  hub: Hub;
  dayType: DayType;
}

export function PlannerPage({ hub, dayType }: PlannerPageProps) {
  const hourParams = useMemo(() => ({ hub: sql.string(hub), day_type: sql.string(dayType) }), [hub, dayType]);
  const hubParams = useMemo(() => ({ hub: sql.string(hub) }), [hub]);
  const hoursQ = useAnalyticsQuery('hub_hours', hourParams);
  const overviewQ = useAnalyticsQuery('hub_overview', hubParams);
  const overview = overviewQ.data?.[0];
  const peakFull = overview ? Number(overview.peak_load_pct) >= FULL_LOAD_PCT : false;

  // PlannerPage is keyed by hub + day type, so this state starts fresh for every selection.
  const [modeChoice, setModeChoice] = useState<Mode | null>(null);
  const mode: Mode = modeChoice ?? (peakFull ? 'add' : 'shift');
  const [budget, setBudget] = useState(0);
  const [manual, setManual] = useState<number[]>(() => new Array<number>(24).fill(0));

  const hours: HourInput[] = useMemo(
    () =>
      (hoursQ.data ?? []).map((r) => ({
        hour: Number(r.hour),
        visits: Number(r.avg_pings),
        departures: Number(r.departures),
        peakLoad: Number(r.max_peak_load_factor),
      })),
    [hoursQ.data],
  );
  const meta = useMemo(
    () => (hoursQ.data ?? []).map((r) => ({ timePeriod: r.time_period, peakLoad: Number(r.max_peak_load_factor), crowdedLine: r.most_crowded_line })),
    [hoursQ.data],
  );

  const planDeltas = useMemo(() => (mode === 'add' ? planAdd(hours, budget) : planShift(hours, budget)), [hours, mode, budget]);
  const deltas = useMemo(() => planDeltas.map((d, i) => d + (manual[i] ?? 0)), [planDeltas, manual]);
  const result = useMemo(() => evaluate(hours, deltas), [hours, deltas]);
  const changed = deltas.some((d) => d !== 0);
  const net = result.scenario.totalDepartures - result.base.totalDepartures;
  const moved = planDeltas.filter((d) => d > 0).reduce((a, b) => a + b, 0);

  const chartData = useMemo(
    () =>
      result.rows.map((r) => ({
        hour: hourLabel(r.hour),
        'Visits, % of day': +(r.demandShare * 100).toFixed(2),
        'Departures today, % of day': +(r.baseShare * 100).toFixed(2),
        ...(changed ? { 'Departures with your plan, % of day': +(r.scenarioShare * 100).toFixed(2) } : {}),
      })),
    [result.rows, changed],
  );

  const adjust = (i: number, step: number) =>
    setManual((m) => m.map((v, j) => (j === i ? v + step : v)));
  const reset = () => {
    setBudget(0);
    setManual(new Array<number>(24).fill(0));
  };

  if (hoursQ.error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Couldn’t load hourly service data</AlertTitle>
        <AlertDescription>{hoursQ.error}</AlertDescription>
      </Alert>
    );
  }

  const loading = hoursQ.loading || !hoursQ.data;
  if (!loading && hours.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No hourly data for {hub}</EmptyTitle>
          <EmptyDescription>Rebuild the gold tables with notebook 01, then reload.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-6">
      {/* The message first (IBCS "SAY") */}
      <Card className="border-l-4 border-l-primary">
        <CardContent className="pt-6 space-y-2">
          {loading || !overview ? (
            <Skeleton className="h-7 w-3/4" />
          ) : (
            <>
              <h2 className="text-xl md:text-2xl font-semibold leading-snug">
                {hub}, {dayLabel(dayType).toLowerCase()}: {pct(result.base.visitsUnderserved)} of visits happen in hours with too little service
                {result.base.underservedHours > 0 ? ` (${result.base.underservedHours} hours).` : '.'}
              </h2>
              <p className="text-muted-foreground">
                {peakFull
                  ? `Peak buses are already full: ${describePeak(overview.peak_load_where)} runs at ${Math.round(Number(overview.peak_load_pct))}% of capacity, so the fix is new service hours, not moving buses.`
                  : `Peak buses still have room (${describePeak(overview.peak_load_where)} tops out at ${Math.round(Number(overview.peak_load_pct))}% of capacity), so service can be rebalanced at zero cost.`}{' '}
                {Number(overview.transfer_share) > 0.1 &&
                  `${pct(Number(overview.transfer_share))} of regional visitors have no direct transit ride here.`}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32" />)
        ) : (
          <>
            <Kpi title="Service–demand mismatch" description="Share of departures running at the wrong hour for demand."
              base={result.base.mismatch} scenario={result.scenario.mismatch} format={(v) => pct(v)} better="lower" changed={changed} />
            <Kpi title="Visits in underserved hours" description="Hours where visit share > 1.5× departure share."
              base={result.base.visitsUnderserved} scenario={result.scenario.visitsUnderserved} format={(v) => pct(v)} better="lower" changed={changed} />
            <Kpi title="Underserved hours" description={`Out of 24, ${dayLabel(dayType).toLowerCase()}.`}
              base={result.base.underservedHours} scenario={result.scenario.underservedHours} format={(v) => String(v)} better="lower" changed={changed} />
            <Kpi title="Departures per day" description={changed ? `Net ${signed(net)} (${signed(Math.round((net / Math.max(1, result.base.totalDepartures)) * 1000) / 10)}%).` : 'All modes calling at the hub (GTFS, fall 2026).'}
              base={result.base.totalDepartures} scenario={result.scenario.totalDepartures} format={(v) => compact(v)} better="neutral" changed={changed} />
          </>
        )}
      </div>

      <div className="grid gap-6 grid-cols-1 xl:grid-cols-3">
        <Card className="xl:col-span-2 min-w-0">
          <CardHeader>
            <CardTitle>When people are at {hub} vs. when the buses leave</CardTitle>
            <CardDescription>Share of the day’s visits and departures in each hour, {dayLabel(dayType).toLowerCase()}. Where visits sit above departures, riders wait longer and crowd more.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-[340px]" /> : (
              <LineChart data={chartData} xKey="hour" height={340} showLegend smooth={false} showSymbol
                yKey={changed ? ['Visits, % of day', 'Departures today, % of day', 'Departures with your plan, % of day'] : ['Visits, % of day', 'Departures today, % of day']}
                ariaLabel="Hourly share of visits versus share of departures" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Try a plan</CardTitle>
            <CardDescription>Pick a strategy and drag. Results update instantly; fine-tune any hour in the table below.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ToggleGroup type="single" value={mode} onValueChange={(v: string) => { if (v) { setModeChoice(v as Mode); setBudget(0); } }} className="w-full" aria-label="Plan strategy">
              <ToggleGroupItem value="add" className="flex-1 gap-1"><Bus className="h-4 w-4" />Add service</ToggleGroupItem>
              <ToggleGroupItem value="shift" className="flex-1 gap-1"><Shuffle className="h-4 w-4" />Rebalance</ToggleGroupItem>
            </ToggleGroup>

            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="budget">{mode === 'add' ? 'Extra departures per day' : 'Departures to move'}</Label>
                <span className="text-2xl font-semibold tabular-nums">{budget}</span>
              </div>
              <Slider id="budget" min={0} max={200} step={5} value={[budget]} onValueChange={(v: number[]) => setBudget(v[0] ?? 0)} disabled={loading} />
              <p className="text-xs text-muted-foreground">
                {mode === 'add'
                  ? 'Each extra departure goes to the hour whose share of service lags its share of visits the most.'
                  : `Moves departures from over-served to under-served hours at zero cost. An hour only gives up buses while its busiest line stays at or under ${CROWDED_LOAD_PCT}% full, assuming its riders spread over the buses that remain.`}
              </p>
            </div>

            {changed && (
              <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                <p>
                  {mode === 'add' ? `Adds ${net} departures/day.` : budget > 0 && moved < budget ? `Moved ${moved} departures — more would not help.` : `Moves ${moved} departures, net ${signed(net)}.`}
                </p>
                <p>
                  Mismatch {pct(result.base.mismatch)} → <span className="font-semibold">{pct(result.scenario.mismatch)}</span>; underserved hours {result.base.underservedHours} → <span className="font-semibold">{result.scenario.underservedHours}</span>.
                </p>
                <p className={result.scenario.overCapacityHours > result.base.overCapacityHours ? 'text-destructive' : ''}>
                  Hours with the busiest line over {CROWDED_LOAD_PCT}% full: {result.base.overCapacityHours} → <span className="font-semibold">{result.scenario.overCapacityHours}</span>.
                </p>
                {mode === 'shift' && peakFull && (
                  <p className="text-warning">Peak buses are full here, so rebalancing is limited. Try “Add service”.</p>
                )}
              </div>
            )}

            <Button variant="outline" className="w-full" onClick={reset} disabled={!changed}>
              <RotateCcw className="h-4 w-4 mr-2" />Reset to today’s schedule
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hour by hour</CardTitle>
          <CardDescription>Use − / + to edit any hour. Load is the busiest line’s peak load factor from TransLink’s 2025 review, re-projected onto your plan’s buses. A lock means the hour is already at its {CROWDED_LOAD_PCT}% safety floor, so rebalancing can’t take buses from it.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-[440px]" /> : <HourTable rows={result.rows} meta={meta} onAdjust={adjust} />}
        </CardContent>
      </Card>

      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        <RouteCrowding hub={hub} />
        <OriginAccess hub={hub} />
      </div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        <Recommendations hub={hub} />
        <WeeklyTrend hub={hub} />
      </div>
    </div>
  );
}
