// Shareable UI state in the query string (spec §11.5): hub, tab, basis, h (horizon) and layers, synced
// both ways with the store through history.replaceState, so there is no router navigation. An optional
// `t` (sim time) never seeks by itself; it lands in `pendingLinkTime` for a "Jump there?" banner.
import { useEffect } from "react";
import type { OriginsBasis } from "@/lib/api/schemas";
import { toVancouverIso } from "@/lib/time";
import {
  DEFAULT_HORIZON,
  DEFAULT_LAYERS,
  HUB_TABS,
  LAYER_KEYS,
  useSim,
  type HubTab,
  type LayerKey,
  type LiveState,
} from "@/lib/live/store";

const P = { hub: "hub", tab: "tab", basis: "basis", horizon: "h", layers: "layers", time: "t" } as const;

export interface UrlUiState {
  hub: string | null;
  tab: HubTab | null;
  basis: OriginsBasis | null;
  horizon: number | null;
  /** null when absent (use defaults); [] when present but empty (every layer off). */
  layers: LayerKey[] | null;
  /** Normalised Vancouver ISO time, or null. */
  time: string | null;
}

const isHubTab = (v: string): v is HubTab => (HUB_TABS as readonly string[]).includes(v);
const isLayer = (v: string): v is LayerKey => (LAYER_KEYS as readonly string[]).includes(v);

export function parseUrlState(search: string): UrlUiState {
  const q = new URLSearchParams(search);

  const hub = q.get(P.hub);
  const tab = q.get(P.tab);
  const basis = q.get(P.basis);
  const h = Number(q.get(P.horizon));
  const layers = q.get(P.layers);
  // A literal "+" in an offset arrives as a space after form decoding.
  const t = q.get(P.time)?.replace(/ /g, "+");
  const tMs = t ? Date.parse(t) : Number.NaN;

  return {
    hub: hub && /^[a-z0-9-]+$/.test(hub) ? hub : null,
    tab: tab && isHubTab(tab) ? tab : null,
    basis: basis === "actual" || basis === "typical" ? basis : null,
    horizon: Number.isInteger(h) && h > 0 && h <= 48 ? h : null,
    layers: layers === null ? null : layers.split(",").filter(isLayer),
    time: Number.isFinite(tMs) ? toVancouverIso(tMs) : null,
  };
}

type UrlSource = Pick<LiveState, "selectedHubId" | "tab" | "originsBasis" | "horizon" | "layers" | "pendingLinkTime">;

const sameLayers = (a: readonly LayerKey[], b: readonly LayerKey[]) =>
  a.length === b.length && a.every((l) => b.includes(l));

/** Rewrites our params in `search` from the store, leaving unrelated params (e.g. dev flags) alone. Defaults are omitted. */
export function serializeUrlState(search: string, s: UrlSource): string {
  const q = new URLSearchParams(search);
  const put = (key: string, value: string | null) => (value === null ? q.delete(key) : q.set(key, value));

  put(P.hub, s.selectedHubId);
  put(P.tab, s.tab !== "events" ? s.tab : null);
  put(P.basis, s.originsBasis !== "actual" ? s.originsBasis : null);
  put(P.horizon, s.horizon !== DEFAULT_HORIZON ? String(s.horizon) : null);
  put(P.layers, sameLayers(s.layers, DEFAULT_LAYERS) ? null : LAYER_KEYS.filter((l) => s.layers.includes(l)).join(","));
  // `t` is only ever cleared here (after the banner is answered); it is never written from the live clock.
  if (s.pendingLinkTime === null) q.delete(P.time);

  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

function applyToStore(url: UrlUiState) {
  const s = useSim.getState();
  s.selectHub(url.hub, url.tab ?? "events");
  s.setOriginsBasis(url.basis ?? "actual");
  s.setHorizon(url.horizon ?? DEFAULT_HORIZON);
  if (!sameLayers(url.layers ?? DEFAULT_LAYERS, s.layers)) s.setLayers(url.layers ?? DEFAULT_LAYERS);
  s.setPendingLinkTime(url.time);
}

function writeUrl() {
  const { pathname, search, hash } = window.location;
  const next = serializeUrlState(search, useSim.getState());
  if (next !== search) window.history.replaceState(null, "", `${pathname}${next}${hash}`);
}

// Only one mounted caller syncs, so an extra call elsewhere can't double-write.
let owner: symbol | null = null;

/** Keeps the URL and the store in sync. Call once near the root; effects only, so it's inert during SSR. */
export function useUrlStateSync(): void {
  useEffect(() => {
    if (owner) return;
    const me = Symbol("url-sync");
    owner = me;

    applyToStore(parseUrlState(window.location.search));
    writeUrl();

    const unsubscribe = useSim.subscribe((s, prev) => {
      if (
        s.selectedHubId !== prev.selectedHubId ||
        s.tab !== prev.tab ||
        s.originsBasis !== prev.originsBasis ||
        s.horizon !== prev.horizon ||
        s.layers !== prev.layers ||
        s.pendingLinkTime !== prev.pendingLinkTime
      ) {
        writeUrl();
      }
    });
    const onPopState = () => applyToStore(parseUrlState(window.location.search));
    window.addEventListener("popstate", onPopState);

    return () => {
      unsubscribe();
      window.removeEventListener("popstate", onPopState);
      if (owner === me) owner = null;
    };
  }, []);
}
