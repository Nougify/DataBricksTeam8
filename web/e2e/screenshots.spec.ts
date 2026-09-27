import { test } from "@playwright/test";

// Screenshots for the design critique (spec §14.1): 1440, 1024 and 390 px in light and dark.
// Output: screenshots/<SHOT_TAG>/<width>-<theme>[-<state>].png (gitignored).
const TAG = process.env.SHOT_TAG ?? "latest";
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
// Optional extra states, e.g. SHOT_QUERY="hub=ubc&tab=now" to capture a hub view.
const QUERY = process.env.SHOT_QUERY ?? "";
const STATE = process.env.SHOT_STATE ?? "";

for (const theme of ["light", "dark"] as const) {
  for (const vp of WIDTHS) {
    test(`${vp.width}px ${theme}${STATE ? ` ${STATE}` : ""}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(`/${QUERY ? `?${QUERY}` : ""}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(2500); // map tiles and charts settle
      await page.screenshot({
        path: `screenshots/${TAG}/${vp.width}-${theme}${STATE ? `-${STATE}` : ""}.png`,
        fullPage: vp.width < 768,
      });
    });
  }
}
