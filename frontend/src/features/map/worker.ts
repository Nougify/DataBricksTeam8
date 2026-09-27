"use client";

// MapLibre v6 starts its web worker from `./maplibre-gl-worker.mjs` next to its own module, and that worker
// imports `./maplibre-gl-shared.mjs`. Under Turbopack neither sits next to the bundled chunk, so the default
// worker 404s ("Worker failed to load") and no tiles or GeoJSON render.
//
// Fix without copying files into public/: reference both files as assets (Turbopack emits them under
// /_next/static/media with hashed names), fetch the worker source, point its one relative import at the emitted
// shared file, and give MapLibre a same-origin blob URL for a module worker. Everything is served by our own
// origin (works with the offline basemap) and always matches the installed maplibre-gl version.
import { setWorkerUrl } from "maplibre-gl";

const WORKER_ASSET = new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url);
const SHARED_ASSET = new URL("../../../node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", import.meta.url);
const SHARED_IMPORT = /(["'])\.\/maplibre-gl-shared\.mjs\1/g;

let ready: Promise<boolean> | null = null;
let settled = false;
const listeners = new Set<() => void>();

async function prepare(): Promise<boolean> {
  try {
    const res = await fetch(WORKER_ASSET.href);
    if (!res.ok) throw new Error(`worker asset HTTP ${res.status}`);
    const shared = new URL(SHARED_ASSET.href, window.location.href).href;
    const source = (await res.text()).replace(SHARED_IMPORT, JSON.stringify(shared));
    setWorkerUrl(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    return true;
  } catch (err) {
    // MapLibre falls back to its default URL; the map will report its own error.
    console.error("Couldn't prepare the MapLibre worker", err);
    return false;
  } finally {
    settled = true;
    for (const l of listeners) l();
  }
}

/** Starts (once per page) preparing the worker URL. Must finish before the first map is constructed. */
export function prepareMapWorker(): Promise<boolean> {
  ready ??= prepare();
  return ready;
}

export function subscribeMapWorker(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True once the worker URL is set (or preparing it has failed and MapLibre is left to its default). */
export const isMapWorkerSettled = () => settled;
