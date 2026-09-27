"use client";

// The theme the map draws in. The basemap style and every overlay paint read from this one object, so the
// style URL and the paint colours always switch together (no frame mixes light tiles with dark overlays).
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { readTokens, TOKEN_NAMES, type TokenName } from "@/lib/theme/tokens";

export type MapThemeName = "light" | "dark";
export type MapTokens = Record<TokenName, string>;

export interface MapTheme {
  name: MapThemeName;
  /** Resolved token colours (hex / rgba) for MapLibre paint properties. */
  tokens: MapTokens;
}

const sameTokens = (a: MapTokens, b: MapTokens) => TOKEN_NAMES.every((n) => a[n] === b[n]);

/**
 * Null until next-themes has resolved the theme on the client (spec §7.7: render the map only then, so the
 * wrong style never flashes). The token values are read once the `.dark` class on <html> matches the
 * resolved theme; next-themes applies that class in its own effect, after this one.
 */
export function useMapTheme(): MapTheme | null {
  const { resolvedTheme } = useTheme();
  const [theme, setTheme] = useState<MapTheme | null>(null);

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    const name: MapThemeName = resolvedTheme;
    let frame = 0;
    let tries = 0;
    const settle = () => {
      const applied = document.documentElement.classList.contains("dark") === (name === "dark");
      // A few frames at most; after that, trust whatever the CSS says.
      if (!applied && tries++ < 10) {
        frame = requestAnimationFrame(settle);
        return;
      }
      const tokens = readTokens();
      setTheme((prev) => (prev && prev.name === name && sameTokens(prev.tokens, tokens) ? prev : { name, tokens }));
    };
    frame = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(frame);
  }, [resolvedTheme]);

  return theme;
}
