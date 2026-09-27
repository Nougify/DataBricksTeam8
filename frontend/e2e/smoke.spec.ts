import { expect, test } from "@playwright/test";
import { APP } from "../src/config/app";

test("operational console boots", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle(APP.name);
  await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Events" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Proposals" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Trips" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Fleet" })).toBeVisible();
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: /timeline/i })).toHaveCount(0);
  expect(errors).toEqual([]);
});
