// Reads the design tokens (CSS custom properties from src/app/globals.css) as plain colour strings
// for libraries that can't use CSS variables: ECharts and MapLibre.
// In JSX, prefer Tailwind classes (bg-surge-high, text-need ...) over these values; see web/DESIGN.md.
//
// No "use client" here on purpose: TOKEN_NAMES and readTokens() are plain values that server code
// may import. useThemeTokens() is a hook, so call it from client components only.

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

export const TOKEN_NAMES = [
  "surge-low",
  "surge-medium",
  "surge-high",
  "need",
  "spare",
  "late-night",
  "actual",
  "forecast",
  "typical",
  "access-transfer",
  "access-oneseat",
  "trip-proposed",
  "trip-active",
  "trip-done",
  "trip-failed",
  "background",
  "foreground",
  "muted-foreground",
  "border",
  "card",
  "primary",
  "map-land",
  "map-water",
  "map-label",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

// Mirrors of the :root / .dark values in globals.css. Used during SSR, before the first client read,
// and whenever a variable can't be read. Keep in sync with globals.css.
const FALLBACK: Record<"light" | "dark", Record<TokenName, string>> = {
  light: {
    "surge-low": "#af820b",
    "surge-medium": "#a9650b",
    "surge-high": "#9d4203",
    need: "#930223",
    spare: "#2c9a88",
    "late-night": "#582684",
    actual: "#0b2b33",
    forecast: "#195fb3",
    typical: "#656e71",
    "access-transfer": "#7b0159",
    "access-oneseat": "#56717b",
    "trip-proposed": "#40258c",
    "trip-active": "#035e9d",
    "trip-done": "#60706f",
    "trip-failed": "#6c342e",
    background: "#ecf3f2",
    foreground: "#0b2b33",
    "muted-foreground": "#4f666d",
    border: "#cdd8d9",
    card: "#fafdfd",
    primary: "#0b2b33",
    "map-land": "#f3f7f6",
    "map-water": "#c9d8dc",
    "map-label": "#3f555c",
  },
  dark: {
    "surge-low": "#face5b",
    "surge-medium": "#f8a53d",
    "surge-high": "#f1803e",
    need: "#ea6067",
    spare: "#88edda",
    "late-night": "#cea9fb",
    actual: "#e6efef",
    forecast: "#659fe4",
    typical: "#838c8f",
    "access-transfer": "#ff8ebc",
    "access-oneseat": "#778f97",
    "trip-proposed": "#ab9ef2",
    "trip-active": "#3c8bd0",
    "trip-done": "#7c8e8c",
    "trip-failed": "#d49b92",
    background: "#0a171b",
    foreground: "#e6efef",
    "muted-foreground": "#8aa0a4",
    border: "#2d3b3f",
    card: "#122126",
    primary: "#e6efef",
    "map-land": "#0d1619",
    "map-water": "#1a2c33",
    "map-label": "#a9bcc0",
  },
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(/i;

let probe: CanvasRenderingContext2D | null | undefined;

// Resolves any CSS colour the browser understands (oklch(), color-mix(), named ...) to sRGB
// by painting one pixel, so ECharts and MapLibre always receive hex or rgba().
function paintToSrgb(value: string): string | null {
  if (probe === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probe = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return null;
  const sentinel = "#010203";
  probe.fillStyle = sentinel;
  probe.fillStyle = value; // an invalid colour leaves the sentinel in place
  if (probe.fillStyle === sentinel && value.toLowerCase() !== sentinel) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  if (a === 255) return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}

function normalise(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (HEX.test(value)) {
    const h = value.slice(1).toLowerCase();
    return h.length === 3 || h.length === 4 ? "#" + [...h].map((c) => c + c).join("") : "#" + h;
  }
  if (RGB.test(value)) return value;
  return paintToSrgb(value);
}

/** Current token values from the document root. Returns light fallbacks when there is no document (SSR). */
export function readTokens(): Record<TokenName, string> {
  if (typeof document === "undefined") return { ...FALLBACK.light };
  const root = document.documentElement;
  const fallback = FALLBACK[root.classList.contains("dark") ? "dark" : "light"];
  const style = getComputedStyle(root);
  const out = { ...fallback };
  for (const name of TOKEN_NAMES) {
    out[name] = normalise(style.getPropertyValue(`--${name}`)) ?? fallback[name];
  }
  return out;
}

function sameTokens(a: Record<TokenName, string>, b: Record<TokenName, string>): boolean {
  return TOKEN_NAMES.every((name) => a[name] === b[name]);
}

/**
 * Token values that follow the theme. Re-reads the computed CSS variables after next-themes'
 * resolvedTheme changes, deferred by two animation frames so the .dark class has been applied
 * (next-themes applies it in its own effect, which runs after this child's effect).
 * The first render returns the light fallbacks so server and client markup match; pass the
 * values to ECharts/MapLibre, and use Tailwind classes for anything rendered as JSX.
 */
export function useThemeTokens(): Record<TokenName, string> {
  const { resolvedTheme } = useTheme();
  const [tokens, setTokens] = useState<Record<TokenName, string>>(() => ({ ...FALLBACK.light }));

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const next = readTokens();
        setTokens((prev) => (sameTokens(prev, next) ? prev : next));
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return tokens;
}
