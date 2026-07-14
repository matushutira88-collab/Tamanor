import { test, expect } from "@playwright/test";

/**
 * V1.45C2 — focused Account (global identity) Danger Zone browser proofs (production build).
 *
 * NON-DESTRUCTIVE: it never SUBMITS the deletion — that would erase the shared E2E fixture identity and
 * break every other authenticated spec. It proves the SAFETY GATING, the self-service visibility (NOT
 * tenant-role gated), and the sole-owner blocker rendering. The atomic server-side erasure is proven
 * separately by the user-deletion integration suite against real Postgres.
 */

// Least-privileged VIEWER (owns no tenant → no blockers → the confirm form is shown).
test.describe("Account Danger Zone — Viewer (self-service, not role-gated)", () => {
  test.use({ storageState: "e2e/.auth/state.viewer.json" });
  test("a non-owner sees a truthful account Danger Zone with an email+ack gate", async ({ page }) => {
    await page.goto("/dashboard/settings");
    const zone = page.getByTestId("account-danger-zone");
    await expect(zone).toBeVisible();
    // Truthful copy: memberships/sessions removed; history anonymized; workspace deletion separate.
    await expect(zone).toContainText(/permanently delete your personal account/i);
    await expect(zone).toContainText(/anonymized/i);
    await expect(zone).toContainText(/separate action/i);

    // No blockers for a viewer → the confirm form is present.
    await expect(page.getByTestId("account-sole-owner-blockers")).toHaveCount(0);
    const button = page.getByTestId("account-delete-btn");
    const input = page.getByTestId("account-confirm-input");
    const ack = page.getByTestId("account-ack");
    await expect(button).toBeDisabled();

    const email = (await page.getByTestId("account-email").textContent())?.trim() ?? "";
    expect(email).toContain("@");

    await input.fill("wrong@example.test");
    await ack.check();
    await expect(button).toBeDisabled();

    await input.fill(email);
    await expect(button).toBeEnabled();

    await ack.uncheck();
    await expect(button).toBeDisabled();
    // Deliberately NOT submitted.
  });
});

// Owner is the SOLE owner of the fixture workspace → blockers shown, no confirm form.
test.describe("Account Danger Zone — sole Owner is blocked", () => {
  test("a sole owner sees the blocker list and no confirm form; workspace Danger Zone still present", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByTestId("account-danger-zone")).toBeVisible();
    // Sole-owner blocker list shown (their OWN workspace — safe to show them), form suppressed.
    await expect(page.getByTestId("account-sole-owner-blockers")).toBeVisible();
    await expect(page.getByTestId("account-confirm-input")).toHaveCount(0);
    // The separate workspace (tenant) Danger Zone remains unaffected for the owner.
    await expect(page.getByTestId("danger-zone")).toBeVisible();
  });
});
