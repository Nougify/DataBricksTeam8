"use client";

// Camera fitting (spec §7.2). Callers describe *what* should be in view as a list of coordinates plus a key;
// useMapFit decides when to move the camera and how much of the map is actually visible (padding for the
// side panel or drawer covering the right edge, and for the map's own controls).
//
//   network            → METRO_BOUNDS (the three hubs and the eastern origins)
//   hub selected       → the hub (+ its origins with share ≥ 2% from milestone 2; see camera.tsx)
//   preview (M3)       → the trip's deadhead and service paths and both routes
import { useEffect, useRef, useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { PaddingOptions } from "maplibre-gl";
import { useSim } from "@/lib/live/store";
import { boundsOf, type Bounds, type LngLatTuple } from "./geo";

/** Metro Vancouver: the hubs plus the eastern origins out to Langley and Maple Ridge (spec §7.2). */
export const METRO_BOUNDS: Bounds = [
  [-123.3, 49.08],
  [-122.55, 49.36],
];

/** Panning limit: a generous box around the region, so the map can't be lost off-screen. */
export const MAX_BOUNDS: [number, number, number, number] = [-124.6, 48.55, -121.4, 49.95];

/** DESIGN §6: the desktop side panel and the tablet drawer. */
export const PANEL_WIDTH = 420;
export const DRAWER_WIDTH = 380;

const FIT_DURATION_MS = 600; // DESIGN §10
const DEFAULT_MAX_ZOOM = 14;

export interface FitTarget {
  /**
   * Identity of the view ("network", "hub:ubc", "hub:ubc:origins", "preview:trip-1"). The camera moves only
   * when the key changes, so data refreshes with the same key never fight a user who has panned away.
   * Put data readiness in the key when late data should widen the view (e.g. origins arriving after the hub).
   */
  key: string;
  points: readonly LngLatTuple[];
  /** Keep at least this many metres around the centre, so a single hub doesn't zoom to street level. */
  minRadiusM?: number;
  maxZoom?: number;
}

export const NETWORK_FIT: FitTarget = { key: "network", points: METRO_BOUNDS };

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Padding for fitBounds: clear of the layer control (top-left), the key and attribution (bottom), and of
 * whatever covers the right edge. Scaled down if the map is too small to honour it.
 */
export function fitPadding(container: HTMLElement | null, occludedRight: number): PaddingOptions {
  const w = container?.clientWidth ?? 0;
  const h = container?.clientHeight ?? 0;
  const edge = w > 0 && w < 640 ? 24 : 48;
  const top = Math.max(edge, 56);
  const right = edge + occludedRight;
  if (w <= 0 || h <= 0) return { top, right, bottom: edge, left: edge };
  const room = 0.8; // keep at least 20% of each dimension for the content itself
  const sx = Math.min(1, (w * room) / (edge + right));
  const sy = Math.min(1, (h * room) / (top + edge));
  return { top: top * sy, right: right * sx, bottom: edge * sy, left: edge * sx };
}

/**
 * Pixels of the map hidden under the side panel (desktop) or drawer (tablet, open while a hub is selected).
 * Inferred from layout: only when the map reaches the right edge of the viewport is anything on top of it.
 * The shell can pass an exact value instead (ConsoleMap's `insetRight` prop).
 */
export function useRightOcclusion(container: HTMLElement | null, override?: number): number {
  const hubSelected = useSim((s) => s.selectedHubId !== null);
  const [layout, setLayout] = useState({ viewport: 0, reachesRight: false });

  useEffect(() => {
    if (!container) return;
    const measure = () => {
      const viewport = document.documentElement.clientWidth;
      const reachesRight = container.getBoundingClientRect().right >= viewport - 2;
      setLayout((prev) => (prev.viewport === viewport && prev.reachesRight === reachesRight ? prev : { viewport, reachesRight }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [container]);

  if (override !== undefined) return override;
  if (!layout.reachesRight) return 0;
  if (layout.viewport >= 1280) return PANEL_WIDTH;
  if (layout.viewport >= 768 && hubSelected) return DRAWER_WIDTH;
  return 0;
}

/**
 * Moves the camera to `target` whenever its key changes (600 ms, or instantly on first run and under
 * prefers-reduced-motion). Until the user pans or zooms, the same target is re-fitted when the map resizes
 * or the right-hand occlusion changes, so layout changes keep the subject in view. Must render inside <Map>.
 */
export function useMapFit(target: FitTarget | null, container: HTMLElement | null, occludedRight: number): void {
  const { current: mapRef } = useMap();
  const lastKey = useRef<string | null>(null);
  const lastOccluded = useRef(occludedRight);
  const userMoved = useRef(false);
  const latest = useRef({ target, container, occludedRight });

  useEffect(() => {
    latest.current = { target, container, occludedRight };
  });

  // Fit on a new key; re-fit an untouched view when the panel/drawer changes what's visible.
  useEffect(() => {
    if (!mapRef || !target) return;
    const keyChanged = lastKey.current !== target.key;
    const occlusionChanged = lastOccluded.current !== occludedRight;
    if (!keyChanged && !(occlusionChanged && !userMoved.current)) return;
    const first = lastKey.current === null;
    lastKey.current = target.key;
    lastOccluded.current = occludedRight;
    const bounds = boundsOf(target.points, target.minRadiusM);
    if (!bounds) return;
    userMoved.current = false;
    mapRef.fitBounds(bounds, {
      padding: fitPadding(container, occludedRight),
      maxZoom: target.maxZoom ?? DEFAULT_MAX_ZOOM,
      duration: first || prefersReducedMotion() ? 0 : FIT_DURATION_MS,
    });
  }, [mapRef, target, container, occludedRight]);

  // Track user camera moves (events with an originalEvent), and keep an untouched view fitted on resize.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const onMoveStart = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) userMoved.current = true;
    };
    const onResize = () => {
      const { target: t, container: c, occludedRight: o } = latest.current;
      if (userMoved.current || !t) return;
      const bounds = boundsOf(t.points, t.minRadiusM);
      if (bounds) map.fitBounds(bounds, { padding: fitPadding(c, o), maxZoom: t.maxZoom ?? DEFAULT_MAX_ZOOM, duration: 0 });
    };
    map.on("movestart", onMoveStart);
    map.on("resize", onResize);
    return () => {
      map.off("movestart", onMoveStart);
      map.off("resize", onResize);
    };
  }, [mapRef]);
}
