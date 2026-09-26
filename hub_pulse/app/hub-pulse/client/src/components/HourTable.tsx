import {
  Badge,
  Button,
  ScrollArea,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@databricks/appkit-ui/react';
import { Lock, Minus, Plus } from 'lucide-react';
import { CROWDED_LOAD_PCT, type HourResult, type HourStatus } from '../lib/planner';
import { hourLabel, pct } from '../lib/format';

interface HourMeta {
  timePeriod: string;
  peakLoad: number;
  crowdedLine: string;
}

interface HourTableProps {
  rows: HourResult[];
  meta: HourMeta[];
  onAdjust: (hourIndex: number, step: number) => void;
}

const statusVariant = (s: HourStatus) =>
  s === 'Underserved' || s === 'No service' ? 'destructive' : s === 'Overserved' ? 'outline' : 'secondary';

const gapText = (g: number | null) => (g === null ? '—' : `${g.toFixed(2)}×`);
const loadText = (l: number | null) => (l === null ? '—' : Number.isFinite(l) ? `${Math.round(l)}%` : 'no bus');

export function HourTable({ rows, meta, onAdjust }: HourTableProps) {
  return (
    <TooltipProvider>
      <ScrollArea className="h-[440px] rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead>Hour</TableHead>
              <TableHead className="text-right">Visits</TableHead>
              <TableHead className="text-center">Departures</TableHead>
              <TableHead className="text-right">Demand ÷ service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Busiest line load</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const m = meta[i];
              const delta = r.scenarioDepartures - r.baseDepartures;
              return (
                <TableRow key={r.hour}>
                  <TableCell className="font-mono text-xs">{hourLabel(r.hour)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(r.demandShare, 1)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Remove a departure at ${hourLabel(r.hour)}`}
                        disabled={r.scenarioDepartures === 0} onClick={() => onAdjust(i, -1)}>
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="w-16 text-center tabular-nums text-sm">
                        {r.scenarioDepartures}
                        {delta !== 0 && (
                          <span className={delta > 0 ? 'text-success text-xs ml-1' : 'text-destructive text-xs ml-1'}>
                            ({delta > 0 ? '+' : ''}{delta})
                          </span>
                        )}
                      </span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Add a departure at ${hourLabel(r.hour)}`}
                        onClick={() => onAdjust(i, 1)}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {delta !== 0 ? (
                      <span>
                        <span className="text-muted-foreground">{gapText(r.baseGap)}</span> → {gapText(r.scenarioGap)}
                      </span>
                    ) : (
                      gapText(r.baseGap)
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(r.scenarioStatus)}>{r.scenarioStatus}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {m && r.baseLoad !== null ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1">
                            {r.minDepartures >= r.baseDepartures && <Lock className="h-3 w-3 text-warning" aria-label="At capacity-safe floor" />}
                            <span className={r.baseLoad > CROWDED_LOAD_PCT ? 'text-warning font-medium' : ''}>{loadText(r.baseLoad)}</span>
                            {delta !== 0 && (
                              <>
                                <span className="text-muted-foreground">→</span>
                                <span className={r.scenarioLoad !== null && r.scenarioLoad > CROWDED_LOAD_PCT ? 'text-destructive font-medium' : 'text-success'}>
                                  {loadText(r.scenarioLoad)}
                                </span>
                              </>
                            )}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          {m.crowdedLine} runs at {Math.round(m.peakLoad)}% of capacity at its busiest point in the {m.timePeriod} period (TSPR 2025, fall).
                          {' '}Capacity-safe floor: {r.minDepartures} departures.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </TooltipProvider>
  );
}
