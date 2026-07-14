import { test, expect } from "@playwright/test";

/**
 * V1.45C1 — focused Danger Zone browser proofs (production build, real DB-backed sessions).
 *
 * NON-DESTRUCTIVE BY DESIGN: it never SUBMITS the deletion — doing so would delete the shared E2E
 * fixture workspace and break every other authenticated spec. It proves the SAFETY GATING and the
 * Owner-only visibility, which is what the UI layer is responsible for (server authorization is
 * proven separately by the tenant-deletion integration suite against real Postgres).
 */

// Owner project inherits the default owner storageState (state.json) from playwright.config.
test.describe("Danger Zone — Owner", () => {
  test("Owner sees a truthful Danger Zone with a name+ack confirmation gate", async ({ page }) => {
    await page.goto("/dashboard/settings");
    const zone = page.getByTestId("danger-zone");
    await expect(zone).toBeVisible();

    // Truthful copy: it must state the local credentials are removed AND that provider auth may persist.
    await expect(zone).toContainText(/permanently delete/i);
    await expect(zone).toContainText(/remote token revocation|remain valid at the provider/i);
    await expect(zone).toContainText(/backups may retain/i);

    const button = page.getByTestId("danger-delete-btn");
    const input = page.getByTestId("danger-confirm-input");
    const ack = page.getByTestId("danger-ack");

    // Initially disabled — no name, no acknowledgement.
    await expect(button).toBeDisabled();

    const workspaceName = (await page.getByTestId("danger-workspace-name").textContent())?.trim() ?? "";
    expect(workspaceName.length).toBeGreaterThan(0);

    // Wrong name + ack → still disabled.
    await input.fill("definitely-not-the-name");
    await ack.check();
    await expect(button).toBeDisabled();

    // Correct name + ack → enabled (we deliberately DO NOT click it).
    await input.fill(workspaceName);
    await expect(button).toBeEnabled();

    // Unchecking the acknowledgement re-disables it.
    await ack.uncheck();
    await expect(button).toBeDisabled();
  });
});

// Viewer session (least-privileged) — the Danger Zone must NOT be rendered at all.
test.describe("Danger Zone — Viewer", () => {
  test.use({ storageState: "e2e/.auth/state.viewer.json" });
  test("a non-owner never sees the Danger Zone", async ({ page }) => {
    await page.goto("/dashboard/settings");
    // The settings page itself renders (viewer can view settings)…
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // …but the Owner-only Danger Zone is absent.
    await expect(page.getByTestId("danger-zone")).toHaveCount(0);
  });
});
