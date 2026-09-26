import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import { ArrowRight } from 'lucide-react';

interface KpiProps {
  title: string;
  description: string;
  base: number;
  scenario: number;
  format: (v: number) => string;
  /** Which direction is an improvement for this metric. */
  better: 'lower' | 'higher' | 'neutral';
  changed: boolean;
}

export function Kpi({ title, description, base, scenario, format, better, changed }: KpiProps) {
  const diff = scenario - base;
  const improved = better === 'lower' ? diff < 0 : better === 'higher' ? diff > 0 : false;
  const worsened = better === 'lower' ? diff > 0 : better === 'higher' ? diff < 0 : false;
  const tone = improved ? 'text-success' : worsened ? 'text-destructive' : 'text-foreground';

  return (
    <Card className="gap-2">
      <CardHeader className="pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="flex items-baseline gap-2">
          <span className={changed ? 'text-xl text-muted-foreground line-through decoration-1' : 'text-3xl font-semibold'}>
            {format(base)}
          </span>
          {changed && (
            <>
              <ArrowRight className="h-4 w-4 text-muted-foreground self-center" aria-hidden />
              <span className={`text-3xl font-semibold ${tone}`}>{format(scenario)}</span>
            </>
          )}
        </div>
        <CardDescription className="text-xs">{changed ? `Current → your scenario. ${description}` : description}</CardDescription>
      </CardContent>
    </Card>
  );
}
