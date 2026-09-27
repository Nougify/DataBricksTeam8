"use client";

// Basemap selection (spec §7.1, DECISIONS "Offline basemap", DESIGN §8.1).
//
//   1. Online: GET the CARTO GL style for the theme (Positron / Dark Matter) with a 3 s timeout. The fetched JSON
//      is handed to MapLibre as an object, so what we probed is exactly what renders (and isn't fetched twice).
//   2. Offline extract: if the probe fails, check /tiles/metro-vancouver.pmtiles (ranged GET, magic bytes). If it
//      is there, build a Protomaps style whose flavour comes from our map tokens, with local glyphs and sprites.
//   3. Plain: otherwise a single background layer in `map-land`. Every overlay still draws on top of it.
//
// The plain style is shown while a probe is running, so hubs and overlays paint immediately and nothing waits
// on the network. Results are cached for the session (per style URL), so a theme switch only probes a URL once.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { addProtocol, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers as protomapsLayers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import { ENV } from "@/config/env";
import type { MapTheme, MapThemeName } from "./theme";

export type BasemapKind = "online" | "pmtiles" | "plain";

export interface Basemap {
  kind: BasemapKind;
  style: StyleSpecification;
  /** True while this theme's online probe (or the extract check after it) is still running. */
  probing: boolean;
}

export const PROBE_TIMEOUT_MS = 3000;
export const PMTILES_PATH = "/tiles/metro-vancouver.pmtiles";
const PMTILES_MAGIC = "PMTiles";

export const onlineStyleUrl = (theme: MapThemeName) => (theme === "dark" ? ENV.basemapDarkUrl : ENV.basemapLightUrl);

// ---------- session cache (module level, outside React) ----------

interface ProbeSnapshot {
  /** Per style URL: undefined = probing, null = failed, object = the style JSON. */
  online: Readonly<Record<string, StyleSpecification | null>>;
  /** undefined = not checked yet (or checking). */
  pmtiles: boolean | undefined;
}

let snapshot: ProbeSnapshot = { online: {}, pmtiles: undefined };
const listeners = new Set<() => void>();
const startedOnline = new Set<string>();
let startedPmtiles = false;

function publish(next: ProbeSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;

function isStyleJson(v: unknown): v is StyleSpecification {
  if (!v || typeof v !== "object") return false;
  const s = v as { version?: unknown; layers?: unknown; sources?: unknown };
  return s.version === 8 && Array.isArray(s.layers) && !!s.sources && typeof s.sources === "object";
}

/** GET the style JSON; null on timeout, HTTP error, network error or a body that isn't a GL style. */
async function probeOnlineStyle(url: string): Promise<StyleSpecification | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: "omit" });
    if (!res.ok) return null;
    const json: unknown = await res.json(); // still under the same timeout
    return isStyleJson(json) ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** True when the bundled extract exists: a ranged GET whose first bytes are the PMTiles magic string. */
async function probePmtiles(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(PMTILES_PATH, {
      headers: { Range: `bytes=0-${PMTILES_MAGIC.length - 1}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok || !res.body) return false;
    // Read only the first chunk, in case the server ignores Range and starts sending the whole file.
    const reader = res.body.getReader();
    const { value } = await reader.read();
    void reader.cancel().catch(() => undefined);
    if (!value || value.length < PMTILES_MAGIC.length) return false;
    return new TextDecoder().decode(value.subarray(0, PMTILES_MAGIC.length)) === PMTILES_MAGIC;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let pmtilesProtocolRegistered = false;

/**
 * Registers the pmtiles:// protocol with MapLibre once per page. Module-level flag, so React StrictMode's double
 * mount (or any number of map mounts) can't register it twice. Called before a PMTiles style is ever published.
 */
export function ensurePmtilesProtocol(): void {
  if (pmtilesProtocolRegistered) return;
  pmtilesProtocolRegistered = true;
  addProtocol("pmtiles", new Protocol().tile);
}

function startPmtilesCheck() {
  if (startedPmtiles) return;
  startedPmtiles = true;
  void probePmtiles().then((ok) => {
    if (ok) ensurePmtilesProtocol();
    publish({ ...snapshot, pmtiles: ok });
  });
}

/** Starts (once per session) the probe chain for a style URL. Safe to call on every render or effect run. */
export function startBasemapProbe(url: string): void {
  if (startedOnline.has(url)) return;
  startedOnline.add(url);
  void probeOnlineStyle(url).then((style) => {
    publish({ ...snapshot, online: { ...snapshot.online, [url]: style } });
    if (!style) startPmtilesCheck();
  });
}

// ---------- style builders (memoised per theme + colours, so mapStyle keeps its identity) ----------

const styleCache = new Map<string, StyleSpecification>();

function cached(key: string, build: () => StyleSpecification): StyleSpecification {
  let style = styleCache.get(key);
  if (!style) {
    style = build();
    styleCache.set(key, style);
  }
  return style;
}

/** No tiles at all: a single background in `map-land`. Overlays and HTML hub labels still render. */
export function plainStyle(theme: MapTheme): StyleSpecification {
  const land = theme.tokens["map-land"];
  return cached(`plain:${theme.name}:${land}`, () => ({
    version: 8,
    name: `plain-${theme.name}`,
    sources: {},
    layers: [{ id: "basemap-land", type: "background", paint: { "background-color": land } }],
  }));
}

/** Protomaps flavour from our tokens (DESIGN §8.1): land and background = map-land, water = map-water, labels = map-label. */
function tokenFlavor(theme: MapTheme): Flavor {
  const land = theme.tokens["map-land"];
  const water = theme.tokens["map-water"];
  const label = theme.tokens["map-label"];
  return {
    ...namedFlavor(theme.name),
    background: land,
    earth: land,
    water,
    ocean_label: label,
    roads_label_minor: label,
    roads_label_minor_halo: land,
    roads_label_major: label,
    roads_label_major_halo: land,
    subplace_label: label,
    subplace_label_halo: land,
    city_label: label,
    city_label_halo: land,
    state_label: label,
    state_label_halo: land,
    country_label: label,
    address_label: label,
    address_label_halo: land,
  };
}

/**
 * The offline extract, rendered with Protomaps layers. Everything is local (see README for how to generate the
 * extract, glyphs and sprites). URLs are absolute because MapLibre resolves some of them inside its worker; the
 * source is the same file as `pmtiles:///tiles/metro-vancouver.pmtiles`.
 */
export function pmtilesStyle(theme: MapTheme): StyleSpecification {
  const t = theme.tokens;
  return cached(`pmtiles:${theme.name}:${t["map-land"]}:${t["map-water"]}:${t["map-label"]}`, () => {
    const origin = window.location.origin;
    return {
      version: 8,
      name: `protomaps-${theme.name}`,
      glyphs: `${origin}/glyphs/{fontstack}/{range}.pbf`,
      sprite: `${origin}/sprites/v4/${theme.name}`,
      sources: {
        protomaps: {
          type: "vector",
          url: `pmtiles://${origin}${PMTILES_PATH}`,
          attribution: "© Protomaps © OpenStreetMap contributors",
        },
      },
      layers: protomapsLayers("protomaps", tokenFlavor(theme), { lang: "en" }),
    };
  });
}

// ---------- hook ----------

/**
 * The basemap for the resolved theme, or null before the theme is known. Starts the probe on first use.
 * `kind` drives the attribution text and the small "offline" note.
 */
export function useBasemap(theme: MapTheme | null): Basemap | null {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const url = theme ? onlineStyleUrl(theme.name) : null;

  useEffect(() => {
    if (url) startBasemapProbe(url);
  }, [url]);

  return useMemo<Basemap | null>(() => {
    if (!theme || !url) return null;
    const online = snap.online[url];
    if (online) return { kind: "online", style: online, probing: false };
    if (online === undefined || snap.pmtiles === undefined) {
      return { kind: "plain", style: plainStyle(theme), probing: true };
    }
    // The protocol is registered before `pmtiles: true` is published (startPmtilesCheck).
    if (snap.pmtiles) return { kind: "pmtiles", style: pmtilesStyle(theme), probing: false };
    return { kind: "plain", style: plainStyle(theme), probing: false };
  }, [theme, url, snap]);
}
