import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@databricks/appkit-ui/react';

const STEPS: [string, string][] = [
  ['Demand', 'Average device visits per hour at each hub, by TransLink day type (weekday / Saturday / Sunday-holiday), from 21.5M hackathon pings (Nov 2025 – Aug 2026).'],
  ['Supply', "Every scheduled trip in TransLink's GTFS feed that calls within 800 m of UBC (the whole UBC Exchange) or 300 m of Waterfront and Park Royal, resolved on representative fall 2026 dates."],
  ['Gap index', "An hour's share of daily visits ÷ its share of daily departures. It is scale-free, so synthetic volumes are never compared with real counts. Above 1.5 = underserved; below 0.67 = over-served."],
  ['Mismatch score', 'Half the sum of |visit share − departure share| over 24 hours: the share of departures that would need to move for service to mirror demand.'],
  ['Crowding', "Each hub's bus lines joined to TransLink's 2025 Transit Service Performance Review (overcrowding, peak load factor, bunching). The planner never removes a bus from an hour where the busiest line is ≥85% full."],
  ['Access', 'An origin has a one-seat ride if a line serving the hub also stops within 1 km (bus) or 2 km (SkyTrain, SeaBus or West Coast Express station) of its centroid.'],
  ['Validation', "Waterfront's weekday ping profile tracks TransLink's real 2025 SkyTrain boardings + alightings at Waterfront with r = 0.92. That is also how the source timestamps were confirmed to be local time despite their Z suffix."],
  ['Forecast & AI', 'ai_forecast() projects weekly visits to Oct 2026; ai_query() writes each recommendation from SQL-computed evidence only.'],
];

export function AboutPage() {
  return (
    <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>How Hub Pulse works</CardTitle>
          <CardDescription>Everything runs on Databricks: Unity Catalog Delta tables, a serverless SQL warehouse, AI functions, Genie and this App.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4">
            {STEPS.map(([k, v]) => (
              <div key={k} className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-1">
                <dt className="font-medium">{k}</dt>
                <dd className="text-sm text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Data sources</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p><span className="text-foreground font-medium">Hackathon data</span> — synthetic visit pings with origin and dwell time at UBC, Waterfront Station and Park Royal Mall.</p>
            <p><span className="text-foreground font-medium">TransLink GTFS</span> — static schedule feed, fall 2026 (gtfs-static.translink.ca).</p>
            <p><span className="text-foreground font-medium">TransLink TSPR 2025</span> — open route, SkyTrain and SeaBus performance data (translink.ca → Managing the Transit Network).</p>
            <p><span className="text-foreground font-medium">Tables</span> — <code>rgersxdatabricks_hackathon.hub_pulse</code></p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Limitations</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2 text-muted-foreground">
            <p>Pings count people at a hub, not boardings, so demand is compared with service as shares.</p>
            <p>Origin centroids are approximate; “one-seat ride” is a proximity test, not a trip planner.</p>
            <p>Ten months of history cannot capture full annual seasonality (e.g. September term start).</p>
            <p>Planner data queries run as the app’s service principal; Genie questions run as you.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
