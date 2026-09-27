"use client";

// Scenario controls: presets, the date + hour picker, the read-only auto-pause indicator and Reset demo (spec §6).
// v3 has no settings endpoint, so auto-pause is shown, not set (DECISIONS.md "Contract (zod)").
// On desktop they sit in the top bar; on tablet and phone the overflow menus reuse the same pieces.
import { useId, useState } from "react";
import { CalendarDays, ChevronDown, PauseCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRESETS, type Preset } from "@/config/scenario";
import type { Clock } from "@/lib/api/schemas";
import { fmtDate, hourLabel } from "@/lib/format";
import { clockLocal } from "@/lib/live/clock";
import { useSim } from "@/lib/live/store";
import { toVancouverIso, vancouverParts, vancouverToMs } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useJumpTo, usePresetJump, useResetDemo } from "./actions";

// ---------- presets ----------

/** Whether a preset's time is inside the clock's bounds (a backend may serve a narrower window than the feed). */
function usePresetInRange(): (preset: Preset) => boolean {
  const min = useSim((s) => (s.clock ? Date.parse(s.clock.min_time) : null));
  const max = useSim((s) => (s.clock ? Date.parse(s.clock.max_time) : null));
  return (preset) => {
    const t = Date.parse(preset.time);
    return min === null || max === null || (t >= min && t <= max);
  };
}

/**
 * Menu rows for the presets: label, then the description on a second, muted line. A preset outside the clock's
 * bounds is disabled and says so, rather than failing on selection.
 */
export function PresetItems({ onSelect }: { onSelect: (preset: Preset) => void }) {
  const inRange = usePresetInRange();
  return PRESETS.map((preset) => {
    const ok = inRange(preset);
    return (
      <DropdownMenuItem
        key={preset.id}
        disabled={!ok}
        onSelect={() => onSelect(preset)}
        className="flex-col items-start gap-0.5 px-2 py-1.5"
      >
        <span className="font-semibold">{preset.label}</span>
        <span className="text-xs text-muted-foreground">
          {ok ? preset.description : "Outside the simulation's time range on this backend."}
        </span>
      </DropdownMenuItem>
    );
  });
}

export function PresetsMenu({ fullWidth = false, className }: { fullWidth?: boolean; className?: string }) {
  const hasClock = useSim((s) => s.clock !== null);
  const { jumpToPreset, isPending } = usePresetJump();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size={fullWidth ? "lg" : "sm"}
          disabled={!hasClock || isPending}
          className={cn(fullWidth && "h-11 w-full justify-between", className)}
        >
          {isPending ? "Jumping…" : "Presets"}
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)] rounded-xl p-1.5 shadow-float">
        <PresetItems onSelect={jumpToPreset} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------- date + hour ----------

const pad2 = (n: number) => String(n).padStart(2, "0");
/** A Vancouver calendar date as a Date for the calendar grid (local midnight; only its y/m/d are used). */
const toCalendarDate = (localDate: string) => {
  const [y, m, d] = localDate.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fromCalendarDate = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Calendar limited to the clock's min_time..max_time (as Vancouver dates), an hour select (0–23), and Go,
 * which seeks to that Vancouver wall time. Starts at the current sim date and hour.
 */
export function DateHourForm({ clock, onDone }: { clock: Clock; onDone?: () => void }) {
  const hourId = useId();
  const [date, setDate] = useState(() => clockLocal(clock).local_date);
  const [hour, setHour] = useState(() => clockLocal(clock).hour);
  const { jump, isPending } = useJumpTo();

  const minMs = Date.parse(clock.min_time);
  const maxMs = Date.parse(clock.max_time);
  const minDate = vancouverParts(minMs).local_date;
  const maxDate = vancouverParts(maxMs).local_date;
  const targetMs = vancouverToMs(date, hour);
  const inRange = targetMs >= minMs && targetMs <= maxMs;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inRange || isPending) return;
    jump(toVancouverIso(targetMs), {}, onDone);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Calendar
        mode="single"
        selected={toCalendarDate(date)}
        onSelect={(d) => d && setDate(fromCalendarDate(d))}
        defaultMonth={toCalendarDate(date)}
        startMonth={toCalendarDate(minDate)}
        endMonth={toCalendarDate(maxDate)}
        disabled={[{ before: toCalendarDate(minDate) }, { after: toCalendarDate(maxDate) }]}
        today={toCalendarDate(clockLocal(clock).local_date)}
        className="p-0"
      />
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={hourId}>Hour</Label>
          <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
            <SelectTrigger id={hourId} className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-64">
              {HOURS.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {hourLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={!inRange || isPending} className="ml-auto min-w-16">
          {isPending ? "Going…" : "Go"}
        </Button>
      </div>
      <p className="max-w-64 text-xs text-muted-foreground">
        {inRange
          ? "Vancouver time. Proposals and extra trips reset to that moment."
          : `Pick a time between ${fmtDate(minMs)} and ${fmtDate(maxMs)}.`}
      </p>
    </form>
  );
}

/** The date + hour picker as a popover (desktop bar and phone menu). */
export function DatePicker({ fullWidth = false, className }: { fullWidth?: boolean; className?: string }) {
  const clock = useSim((s) => s.clock);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={fullWidth ? "lg" : "sm"}
          disabled={!clock}
          className={cn(fullWidth && "h-11 w-full justify-between", className)}
        >
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays aria-hidden />
            Go to date
          </span>
          <ChevronDown aria-hidden className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto rounded-xl p-3 shadow-float">
        {clock && <DateHourForm clock={clock} onDone={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

/** The same form in a dialog, opened from the tablet overflow menu. */
export function DatePickerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const clock = useSim((s) => s.clock);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-auto sm:max-w-fit">
        <DialogHeader>
          <DialogTitle className="text-lg">Go to a date and hour</DialogTitle>
          <DialogDescription>The clock jumps there and keeps playing or stays paused.</DialogDescription>
        </DialogHeader>
        {clock ? (
          <DateHourForm clock={clock} onDone={() => onOpenChange(false)} />
        ) : (
          <p className="text-sm text-muted-foreground">The simulation clock hasn&rsquo;t loaded yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- auto-pause ----------

/** The backend's auto-pause setting (`Clock.auto_pause_on_proposal`), or null when the backend doesn't send it. */
export function useAutoPause(): boolean | null {
  return useSim((s) => s.clock?.auto_pause_on_proposal ?? null);
}

export const AUTO_PAUSE_TOOLTIP = "Set on the backend (AUTO_PAUSE_ON_PROPOSAL). It can't be changed from the console.";

export function autoPauseText(on: boolean): string {
  return on ? "Pauses when a bus is proposed" : "Doesn't pause on proposals";
}

/** Read-only indicator; hidden when the backend doesn't report the setting. */
export function AutoPauseIndicator({ className }: { className?: string }) {
  const on = useAutoPause();
  if (on === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground", className)}
        >
          <PauseCircle aria-hidden className="size-4" />
          {autoPauseText(on)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{AUTO_PAUSE_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

// ---------- reset ----------

export function ResetDemoButton({ fullWidth = false, className }: { fullWidth?: boolean; className?: string }) {
  const { reset, pending, disabled } = useResetDemo();
  return (
    <Button
      variant={fullWidth ? "outline" : "ghost"}
      size={fullWidth ? "lg" : "sm"}
      onClick={reset}
      disabled={disabled}
      className={cn(fullWidth && "h-11 w-full", className)}
    >
      <RotateCcw aria-hidden />
      {pending ? "Resetting…" : "Reset demo"}
    </Button>
  );
}
