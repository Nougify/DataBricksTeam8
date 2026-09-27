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
  await expect(page.getByRole("status").filter({ hasText: "Live" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("v3 mock flow: preset → proposal from the Databricks feed → auto-pause", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Live" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Presets" }).click();
  await page.getByRole("menuitem", { name: /UBC exam weekend/ }).click();
  await expect(page.getByText("07:30").filter({ visible: true }).first()).toBeVisible();

  await page.getByRole("radio", { name: /^3600× speed/ }).click();
  await page.getByRole("button", { name: "Play" }).click();

  // The 09:00 event becomes actionable at 08:00 (60 min lead) and proposes route 49 at UBC.
  await expect(page.getByText(/New proposal: bus-0\d → extra 49 trip at UBC/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText("Simulation paused for review.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.getByText("08:00").filter({ visible: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("M2b: overview queue approve, origins list, timeline keyboard seek", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?t=${encodeURIComponent("2025-12-06T11:30:00-08:00")}`);
  await expect(page.getByRole("status").filter({ hasText: "Live" }).first()).toBeAttached();
  await page.getByRole("button", { name: "Jump", exact: true }).click();
  await expect(page.getByText("11:30").filter({ visible: true }).first()).toBeVisible();

  // Overview: the UBC proposal from the Databricks feed is waiting; approve it from the queue.
  const queue = page.getByRole("list", { name: "Proposals waiting for approval" });
  await expect(queue.getByText("UBC")).toBeVisible();
  await queue.getByRole("button", { name: /^Approve / }).first().click();
  // (The "Trip approved" toast can be crowded out by surge toasts from the jump; assert on the state instead.)
  await expect(page.getByRole("region", { name: "Active extra trips" }).getByText(/Approved|En route/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Approval queue" }).getByText("No proposals waiting")).toBeVisible();

  // Origins tab with the insight callout; hovering a row highlights it.
  await page.getByRole("button", { name: /^UBC/ }).first().click();
  await page.getByRole("tab", { name: "Origins" }).click();
  await expect(page.getByText(/of regional pings at UBC come from areas with no one-seat ride/)).toBeVisible();
  const surrey = page.getByRole("listitem", { name: /^Surrey:/ });
  await surrey.hover();
  await expect(surrey).toHaveClass(/bg-accent/);

  // Timeline: → then Enter seeks one day later at the same hour.
  const slider = page.getByRole("slider", { name: "Simulation date" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", /Sun Dec 7/);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Sun", { exact: true }).or(page.getByText(/Dec 7 2025/)).filter({ visible: true }).first()).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", "Sun Dec 7");
  expect(errors).toEqual([]);
});
