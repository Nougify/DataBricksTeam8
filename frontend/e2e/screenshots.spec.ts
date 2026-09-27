import { expect, test, type Page } from "@playwright/test";

// Screenshots for the design critique (spec §14.1): 1440, 1024 and 390 px in light and dark.
// Output: screenshots/<SHOT_TAG>/<width>-<theme>-<state>.png (gitignored).
//
// States (milestone 2b): the network overview, UBC Now and UBC Origins at a fixed sim time mid-surge, plus the
// timeline sheet on phone. Each state jumps through the shared-link banner (`?t=`), which works at every width.
// SHOT_TIME overrides the sim time; SHOT_QUERY adds params (e.g. "layers=origins,routes").
const TAG = process.env.SHOT_TAG ?? "latest";
const AT = process.env.SHOT_TIME ?? "2025-12-06T11:30:00-08:00"; // UBC exam Saturday; peak 1.99× at 13:00
const EXTRA = process.env.SHOT_QUERY ? `&${process.env.SHOT_QUERY}` : "";
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

async function openAt(page: Page, query: string) {
  await page.goto(`/?t=${encodeURIComponent(AT)}${query}${EXTRA}`);
  await expect(page.getByRole("status").filter({ hasText: "Live" }).first()).toBeAttached();
  await page.getByRole("button", { name: "Jump", exact: true }).click();
  await expect(page.getByRole("button", { name: "Jump", exact: true })).toHaveCount(0);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(2500); // map tiles, camera fit and charts settle
}

for (const theme of ["light", "dark"] as const) {
  for (const vp of WIDTHS) {
    test(`${vp.width}px ${theme}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize(vp);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      // Phone: a viewport shot, plus a full-page one of the scrolled panel. (Full-page capture resizes the viewport,
      // so the 45vh map is caught mid-resize and looks blank in the "-full" files; the viewport shot shows it.)
      const shot = async (state: string, full = vp.width < 768) => {
        await page.screenshot({ path: `screenshots/${TAG}/${vp.width}-${theme}-${state}.png` });
        if (full) await page.screenshot({ path: `screenshots/${TAG}/${vp.width}-${theme}-${state}-full.png`, fullPage: true });
      };

      await openAt(page, "");
      // Tablet: the drawer starts closed with no hub selected.
      if (vp.width >= 768 && vp.width < 1280) await page.getByRole("button", { name: "Open panel" }).click();
      await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible();
      await shot("overview");

      await openAt(page, "&hub=ubc");
      await expect(page.getByRole("heading", { name: /UBC forecast to reach|No surge forecast for UBC/ })).toBeVisible();
      await shot("now");
      if (vp.width >= 768) {
        await page.getByRole("img", { name: /UBC forecast to reach|No surge forecast for UBC/ }).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await shot("now-chart");
      }

      await openAt(page, "&hub=ubc&tab=origins");
      await expect(page.getByText(/of regional pings at UBC come from areas with no one-seat ride/)).toBeVisible();
      await shot("origins");

      if (vp.width < 768) {
        await page.getByRole("button", { name: "Timeline" }).click();
        await page.waitForTimeout(500);
        await shot("timeline", false);
      }
      expect(errors).toEqual([]);
    });
  }
}
