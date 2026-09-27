"use client";

import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMeta, usePause, useResume, useSetSpeed } from "@/lib/api/hooks";
import { SPEEDS, type Speed } from "@/lib/api/schemas";
import { useSim } from "@/lib/live/store";
import { cn } from "@/lib/utils";
import { toastFailure } from "./actions";
import { speedHint, speedLabel } from "./speed";

/** Play / Pause (spec §6): toggles the server clock; disabled while the request is in flight. */
export function PlayPauseButton({ className }: { className?: string }) {
  const status = useSim((s) => s.clock?.status ?? null);
  const pause = usePause();
  const resume = useResume();
  const running = status === "RUNNING";
  const busy = pause.isPending || resume.isPending;

  const toggle = () => {
    if (running) pause.mutate(undefined, { onError: (e) => toastFailure("pause the simulation", e) });
    else resume.mutate(undefined, { onError: (e) => toastFailure("play the simulation", e) });
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          className={cn("size-11 md:size-9", className)}
          aria-label={running ? "Pause" : "Play"}
          disabled={status === null || busy}
          onClick={toggle}
        >
          {running ? <Pause className="size-4.5" fill="currentColor" /> : <Play className="size-4.5" fill="currentColor" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{running ? "Pause the simulation" : "Play the simulation"}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Speed as a segmented control built from /meta.supported_speeds, each option explained in a tooltip.
 * `size="lg"` fills its container with 44 px targets (phone menu).
 */
export function SpeedControl({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  const meta = useMeta();
  const clockSpeed = useSim((s) => s.clock?.speed ?? null);
  const setSpeed = useSetSpeed();

  if (!meta.data) {
    // Pending: a static placeholder of the same size. Error: nothing here; the settings banner explains.
    return meta.isPending ? <Skeleton className={cn(size === "lg" ? "h-11 w-full" : "h-8 w-56", className)} /> : null;
  }

  const shown = setSpeed.isPending ? setSpeed.variables : clockSpeed;
  const onChange = (value: string) => {
    const speed = Number(value) as Speed;
    if (!value || !(SPEEDS as readonly number[]).includes(speed) || speed === clockSpeed) return;
    setSpeed.mutate(speed, { onError: (e) => toastFailure("change the speed", e) });
  };

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      value={shown != null ? String(shown) : ""}
      onValueChange={onChange}
      disabled={clockSpeed === null || setSpeed.isPending}
      aria-label="Simulation speed"
      className={cn(size === "lg" && "w-full", className)}
    >
      {meta.data.supported_speeds.map((speed) => (
        <Tooltip key={speed}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={String(speed)}
              aria-label={`${speedLabel(speed)} speed: ${speedHint(speed)}`}
              className={cn(
                "px-2.5 font-medium aria-checked:bg-primary aria-checked:text-primary-foreground hover:aria-checked:bg-primary/90",
                size === "lg" ? "h-11 flex-1" : "h-8",
              )}
            >
              {speedLabel(speed)}
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{speedHint(speed)}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
