import {
  Badge,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from '@databricks/appkit-ui/react';
import { TrainFront } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AboutPage } from './pages/AboutPage';
import { AskGeniePage } from './pages/AskGeniePage';
import { PlannerPage } from './pages/PlannerPage';
import { DAY_TYPES, HUBS, SOURCES, type DayType, type Hub } from './lib/format';

function useWhoAmI() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/whoami')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { email?: string | null } | null) => setEmail(j?.email ?? null))
      .catch(() => setEmail(null));
  }, []);
  return email;
}

export default function App() {
  const [hub, setHub] = useState<Hub>('UBC');
  const [dayType, setDayType] = useState<DayType>('MF');
  const [tab, setTab] = useState('planner');
  const email = useWhoAmI();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-3">
            <TrainFront className="h-7 w-7 text-primary" aria-hidden />
            <div>
              <h1 className="text-xl font-semibold leading-tight">Hub Pulse</h1>
              <p className="text-xs text-muted-foreground">Is Vancouver’s transit schedule in step with its busiest hubs?</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline">{email ?? 'Databricks App'}</Badge>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
        <div className="flex flex-wrap items-end gap-4">
          <TabsList>
            <TabsTrigger value="planner">Service planner</TabsTrigger>
            <TabsTrigger value="genie">Ask Genie</TabsTrigger>
            <TabsTrigger value="about">Method & data</TabsTrigger>
          </TabsList>
          {tab === 'planner' && (
            <div className="flex flex-wrap items-end gap-4 ml-auto">
              <div className="space-y-1">
                <Label htmlFor="hub-select" className="text-xs text-muted-foreground">Hub</Label>
                <Select value={hub} onValueChange={(v) => setHub(v as Hub)}>
                  <SelectTrigger id="hub-select" className="w-[220px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {HUBS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Day type</Label>
                <ToggleGroup type="single" value={dayType} onValueChange={(v: string) => { if (v) setDayType(v as DayType); }} aria-label="Day type">
                  {DAY_TYPES.map((d) => <ToggleGroupItem key={d.value} value={d.value} className="px-3">{d.label}</ToggleGroupItem>)}
                </ToggleGroup>
              </div>
            </div>
          )}
        </div>

        <TabsContent value="planner"><PlannerPage key={`${hub}|${dayType}`} hub={hub} dayType={dayType} /></TabsContent>
        <TabsContent value="genie"><AskGeniePage userEmail={email} /></TabsContent>
        <TabsContent value="about"><AboutPage /></TabsContent>

        <footer className="text-xs text-muted-foreground border-t pt-4">{SOURCES}</footer>
      </Tabs>
    </div>
  );
}
