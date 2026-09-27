import { expect, test } from "@playwright/test";
import { APP } from "../src/config/app";

test("console boots in mock mode", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle(APP.name);
  // The top bar renders "Mock data" twice and shows one by width (status line below 1280 px, bar above).
  await expect(page.getByText("Mock data").filter({ visible: true }).first()).toBeVisible();
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  expect(errors).toEqual([]);
});
