// Small colour maths for data-driven colours (GTFS route colours) and token values.
// WCAG 2 relative luminance and contrast ratio.

/** "#0060A9", "0060A9" or "#06a" → [r, g, b] (0–255), or null when it isn't a hex colour. */
export function parseHex(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** A GTFS colour as a CSS colour ("#0060A9"), or null when missing or malformed. */
export function normaliseHex(value: string | null | undefined): string | null {
  const rgb = parseHex(value);
  return rgb ? `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}` : null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1–21), or null if either can't be parsed. */
export function contrastRatio(a: string | null | undefined, b: string | null | undefined): number | null {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return null;
  const la = relativeLuminance(ra);
  const lb = relativeLuminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** True for a dark theme background (luminance below mid-grey). */
export function isDarkColor(value: string | null | undefined): boolean {
  const rgb = parseHex(value);
  return rgb ? relativeLuminance(rgb) < 0.18 : false;
}
