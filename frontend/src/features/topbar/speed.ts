// Speed labels and the tooltip that explains each speed (spec §6).

const HINTS: Readonly<Record<number, string>> = {
  1: "Real time",
  60: "1 sim-hour per real minute",
  300: "1 sim-hour every 12 s",
  900: "1 sim-hour every 4 s",
  3600: "1 sim-hour per real second",
};

const trim = (n: number) => String(Number(n.toFixed(1)));

/** What a speed means in wall time: 60 → "1 sim-hour per real minute". */
export function speedHint(speed: number): string {
  const known = HINTS[speed];
  if (known) return known;
  if (!(speed > 0)) return "Stopped";
  const realSecondsPerSimHour = 3600 / speed;
  if (realSecondsPerSimHour >= 60) return `1 sim-hour every ${trim(realSecondsPerSimHour / 60)} min`;
  return `1 sim-hour every ${trim(realSecondsPerSimHour)} s`;
}

/** 300 → "300×". */
export const speedLabel = (speed: number) => `${speed}×`;

/** The speed Reset demo returns to (spec §6). */
export const RESET_SPEED = 60;
