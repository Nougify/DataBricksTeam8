"use client";

import { useEffect, useRef } from "react";
import { useSim } from "@/lib/live/store";

/** Focus in a text field, or an open dialog, popover, menu or listbox, owns the Esc key. */
function escapeBelongsElsewhere(e: KeyboardEvent): boolean {
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return true;
  if (target?.closest("[role='dialog'], [role='alertdialog']")) return true;
  return (
    document.querySelector(
      "[role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='menu'][data-state='open'], [role='listbox'][data-state='open']",
    ) !== null
  );
}

/**
 * Global Esc (spec §7.3): exits Preview if one is running, otherwise clears the selected hub, otherwise
 * runs `onNothingToClear` (the tablet drawer closes). Handled keys are marked defaultPrevented so other
 * listeners can tell. The shell owns this; features shouldn't add their own global Esc handlers.
 */
export function useEscapeToClear(onNothingToClear?: () => void): void {
  const fallback = useRef(onNothingToClear);
  useEffect(() => {
    fallback.current = onNothingToClear;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      if (escapeBelongsElsewhere(e)) return;
      const s = useSim.getState();
      if (s.previewTripId) s.exitPreview();
      else if (s.selectedHubId) s.selectHub(null);
      else if (fallback.current) fallback.current();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
