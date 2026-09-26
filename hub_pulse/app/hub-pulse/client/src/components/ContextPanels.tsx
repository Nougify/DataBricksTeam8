import {
  Alert,
  AlertDescription,
  Badge,
  BarChart,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  LineChart,
  Skeleton,
  useAnalyticsQuery,
} from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import type { Hub } from '../lib/format';

function useHubParams(hub: Hub) {
  return useMemo(() => ({ hub: sql.string(hub) }), [hub]);
}

function LoadingRows({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

function NoData({ what }: { what: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No {what}</EmptyTitle>
        <EmptyDescription>Try another hub, or rebuild the gold tables with notebook 01.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function RouteCrowding({ hub }: { hub: Hub }) {
  const params = useHubParams(hub);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lines feeding {hub} are already crowded</CardTitle>
        <CardDescription>% of 2025 trips overcrowded, per TransLink’s Transit Service Performance Review</CardDescription>
      </CardHeader>
      <CardContent>
        <BarChart queryKey="route_crowding" parameters={params} xKey="line_name" yKey="pct_trips_overcrowded"
          orientation="horizontal" height={300} showLegend={false} ariaLabel="Percent of trips overcrowded by bus line" />
      </CardContent>
    </Card>
  );
}

export function OriginAccess({ hub }: { hub: Hub }) {
  const params = useHubParams(hub);
  const { data, loading, error } = useAnalyticsQuery('origin_access', params);
  const transfer = (data ?? []).filter((r) => r.access_type === 'Transfer required');
  const transferShare = transfer.reduce((a, r) => a + Number(r.share_pct), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who has no direct ride?</CardTitle>
        <CardDescription>
          Top origins of regional visitors. A one-seat ride means a line serving {hub} also stops within 1 km (bus) or 2 km (rail/SeaBus) of the area.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <LoadingRows n={6} />}
        {error && <Alert variant="destructive"><AlertDescription>Couldn’t load origins: {error}</AlertDescription></Alert>}
        {data && data.length === 0 && <NoData what="origin data" />}
        {data && data.length > 0 && (
          <div className="space-y-3">
            {transfer.length > 0 && (
              <p className="text-sm">
                <span className="font-semibold text-destructive">{transferShare.toFixed(0)}%</span> of the listed visitors come from areas that need a transfer.
              </p>
            )}
            <ul className="space-y-2">
              {data.map((r) => (
                <li key={r.origin} className="flex items-center gap-3 text-sm">
                  <span className="w-40 truncate">{r.origin}</span>
                  <div className="flex-1 h-2 rounded bg-muted overflow-hidden" aria-hidden>
                    <div className={r.access_type === 'Transfer required' ? 'h-full bg-destructive' : 'h-full bg-success'}
                      style={{ width: `${Math.min(100, Number(r.share_pct) * 4)}%` }} />
                  </div>
                  <span className="w-12 text-right tabular-nums">{Number(r.share_pct).toFixed(1)}%</span>
                  <Badge variant={r.access_type === 'Transfer required' ? 'destructive' : 'secondary'} className="w-28 justify-center"
                    title={r.direct_lines ? `Direct lines: ${r.direct_lines}` : undefined}>
                    {r.access_type === 'Transfer required' ? 'Transfer' : 'Direct'}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WeeklyTrend({ hub }: { hub: Hub }) {
  const params = useHubParams(hub);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly visits and ai_forecast() to October 2026</CardTitle>
        <CardDescription>Surges (exam season, cruise season, holidays) arrive on a fixed schedule — so do the buses.</CardDescription>
      </CardHeader>
      <CardContent>
        <LineChart queryKey="weekly_trend" parameters={params} xKey="week" yKey={['visits', 'forecast']} height={280}
          showLegend smooth={false} ariaLabel="Weekly visits with forecast" />
      </CardContent>
    </Card>
  );
}

export function Recommendations({ hub }: { hub: Hub }) {
  const params = useHubParams(hub);
  const { data, loading, error } = useAnalyticsQuery('recommendations', params);
  const priorityLabel = (p: number) => (p === 1 ? 'Act now' : p === 2 ? 'Plan' : 'Prepare');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Recommended actions for {hub}
        </CardTitle>
        <CardDescription>
          Evidence is computed in SQL from the gold tables; each action sentence is written by an LLM with ai_query() and restricted to that evidence. AI-generated — check the evidence.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <LoadingRows n={5} />}
        {error && <Alert variant="destructive"><AlertDescription>Couldn’t load recommendations: {error}</AlertDescription></Alert>}
        {data && data.length === 0 && <NoData what="recommendations" />}
        {data && data.length > 0 && (
          <ol className="space-y-4">
            {data.map((r) => (
              <li key={r.evidence} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={r.priority === 1 ? 'destructive' : r.priority === 2 ? 'default' : 'secondary'}>{priorityLabel(Number(r.priority))}</Badge>
                  <span className="text-sm font-medium">{r.category}</span>
                </div>
                <p className="text-sm">{r.recommendation}</p>
                <p className="text-xs text-muted-foreground">Evidence: {r.evidence}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
