"use client";

// Top-bar actions that combine several mutations or touch the UI selection. The API hooks don't toast,
// so failures are reported here in one consistent form: "Couldn't <action>." plus the server's message.
import { useState } from "react";
import { toast } from "sonner";
import { useMeta, usePause, useSeek, useSetSpeed } from "@/lib/api/hooks";
import type { Preset } from "@/lib/api/schemas";
import { fmtDate, fmtTime } from "@/lib/format";
import { useSim, type HubTab } from "@/lib/live/store";
import { ENV } from "@/config/env";
import { RESET_SPEED, speedLabel } from "./speed";

/** "Couldn't pause the simulation." with the error message as the description. */
export function toastFailure(action: string, err: unknown): void {
  const description = err instanceof Error && err.message ? err.message : undefined;
  toast.error(`Couldn't ${action}.`, { description });
}

export interface JumpOptions {
  /** Select this hub after the seek (null shows the network overview). Leave out to keep the selection. */
  hubId?: string | null;
  /** Tab to open when a hub is selected. Default "events". */
  tab?: HubTab;
  /** Names the target in an error toast ("jump to UBC exam weekend"). */
  label?: string;
}

/** Seeks the sim clock, then optionally selects a hub. Used by presets, the date picker and the link banner. */
export function useJumpTo() {
  const seek = useSeek();
  const jump = (time: string, opts: JumpOptions = {}, onDone?: () => void) => {
    seek.mutate(time, {
      onSuccess: () => {
        if ("hubId" in opts) {
          const hubId = opts.hubId ?? null;
          useSim.getState().selectHub(hubId, hubId ? (opts.tab ?? "events") : undefined);
        }
        onDone?.();
      },
      onError: (err) => toastFailure(`jump to ${opts.label ?? `${fmtDate(time)} ${fmtTime(time)}`}`, err),
    });
  };
  return { jump, isPending: seek.isPending };
}

/** Choosing a preset seeks to its time and selects its hub on Events, or shows the overview. */
export function usePresetJump() {
  const { jump, isPending } = useJumpTo();
  const jumpToPreset = (preset: Preset) =>
    jump(preset.time, { hubId: preset.hub_id, tab: "events", label: preset.label });
  return { jumpToPreset, isPending };
}

/**
 * Reset demo (spec §6): pause, seek to `/meta.default_start_time`, set speed 60, clear the selection and
 * close any preview. Pausing first means the clock can't drift past the start time while the seek runs.
 */
export function useResetDemo() {
  const meta = useMeta();
  const hasClock = useSim((s) => s.clock !== null);
  const pause = usePause();
  const seek = useSeek();
  const setSpeed = useSetSpeed();
  const [pending, setPending] = useState(false);
  const target = meta.data?.default_start_time ?? null;

  const reset = async () => {
    if (!target || pending) return;
    setPending(true);
    try {
      let clock = useSim.getState().clock;
      if (clock?.status === "RUNNING") clock = await pause.mutateAsync();
      clock = await seek.mutateAsync(target);
      if (clock.status === "RUNNING") clock = await pause.mutateAsync();
      if (clock.speed !== RESET_SPEED) await setSpeed.mutateAsync(RESET_SPEED);
      const s = useSim.getState();
      s.exitPreview();
      s.selectHub(null);
      toast("Demo reset", {
        description: `Paused at ${fmtDate(target)} ${fmtTime(target)}, speed ${speedLabel(RESET_SPEED)}.`,
      });
    } catch (err) {
      toastFailure("reset the demo", err);
    } finally {
      setPending(false);
    }
  };

  return { reset: () => void reset(), pending, disabled: !target || !hasClock || pending };
}

/** Dev only, mock mode only: closes the fake WebSocket so reconnect handling can be exercised (spec §12.3). */
export const canDropConnection = ENV.isDev && ENV.useMocks;

export function dropConnection(): void {
  void import("@/mocks/browser").then((m) => m.dropMockConnections());
}
