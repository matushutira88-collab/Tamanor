/**
 * V1.59 — per-account protection resolution + monitored-account limit against a REAL Postgres.
 * Proves: tenant-default → account-override resolution, monitoring toggle, FB Page + IG counted as TWO
 * monitored accounts, ATOMIC limit under parallel enables, and cross-tenant denial (RLS). Run via
 * pnpm account-protection:test.
 */
import {
  systemDb, withTenant,
  resolveAccountProtection, getAccountProtection, updateAccountProtection, resetAccountProtectionToDefault,
  setAccountMonitoring, updateTenantProtectionDefaults, countMonitoredAccounts, previewMonitoredAccountLimit,
  enableAccountMonitoringWithinLimit,
} from "@guardora/db";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function run() {
  const sfx = Date.now().toString(36);
  const mkTenant = async (tag: string) => {
    const t = await systemDb.tenant.create({ data: { name: `Ap${tag}`, slug: `ap-${tag}-${sfx}` } });
    const b = await systemDb.brand.create({ data: { tenantId: t.id, name: `ApB${tag}` } });
    return { t, b };
  };
  const mkAcc = (T: { t: { id: string }; b: { id: string } }, tag: string, platform: string, parentId?: string, monitoring = true) =>
    systemDb.connectedAccount.create({ data: {
      tenantId: T.t.id, brandId: T.b.id, platform: platform as never, status: "active", mode: "read_only",
      externalId: `AP_${tag}_${sfx}`, pageId: platform === "facebook_page" ? `AP_${tag}_${sfx}` : null,
      parentAccountId: parentId ?? null, monitoringEnabled: monitoring, health: "healthy",
    } });
  const A = await mkTenant("a"); const B = await mkTenant("b");

  try {
    // -------------------------------------------------------------------------
    console.log("Resolution — tenant default vs account override");
    const fb = await mkAcc(A, "fb", "facebook_page");
    // Pure resolution: not overridden ⇒ tenant default.
    const eff0 = resolveAccountProtection(
      { monitoringEnabled: true, protectionOverridden: false, autoHideEnabled: false, autoHideMode: "recommend", autoHideRiskThreshold: "high", autoHideCategories: [], requireManualApproval: false },
      { defaultAutoHideEnabled: true, defaultAutoHideMode: "automatic", defaultAutoHideRiskThreshold: "medium", defaultAutoHideCategories: ["spam"], defaultRequireManualApproval: true },
    );
    check("not overridden → inherits tenant default", eff0.source === "tenant_default" && eff0.autoHideEnabled === true && eff0.autoHideMode === "automatic");
    const eff1 = resolveAccountProtection(
      { monitoringEnabled: true, protectionOverridden: true, autoHideEnabled: false, autoHideMode: "recommend", autoHideRiskThreshold: "critical", autoHideCategories: ["fraud"], requireManualApproval: false },
      { defaultAutoHideEnabled: true, defaultAutoHideMode: "automatic", defaultAutoHideRiskThreshold: "medium", defaultAutoHideCategories: ["spam"], defaultRequireManualApproval: true },
    );
    check("overridden → account fields win", eff1.source === "account_override" && eff1.autoHideEnabled === false && eff1.autoHideRiskThreshold === "critical");

    // DB round-trip: tenant default flows through getAccountProtection until an override is set.
    await updateTenantProtectionDefaults(A.t.id, { defaultAutoHideEnabled: true, defaultAutoHideMode: "automatic", defaultAutoHideCategories: ["spam"] });
    const g1 = await getAccountProtection(A.t.id, fb.id);
    check("getAccountProtection inherits tenant default", g1?.effective.source === "tenant_default" && g1?.effective.autoHideEnabled === true);
    await updateAccountProtection(A.t.id, fb.id, { autoHideEnabled: false, autoHideMode: "manual_approval" });
    const g2 = await getAccountProtection(A.t.id, fb.id);
    check("after override → account config wins + stamped", g2?.effective.source === "account_override" && g2?.effective.autoHideEnabled === false && g2?.overridden === true);
    await resetAccountProtectionToDefault(A.t.id, fb.id);
    check("reset → inherits again", (await getAccountProtection(A.t.id, fb.id))?.effective.source === "tenant_default");

    // -------------------------------------------------------------------------
    console.log("FB Page + Instagram = TWO monitored accounts");
    const ig = await mkAcc(A, "ig", "instagram_business", fb.id); // linked to the FB page, but a SEPARATE account
    const monitored = await withTenant(A.t.id, (tx) => countMonitoredAccounts(tx, A.t.id));
    check("FB + linked IG count as TWO monitored accounts", monitored === 2);
    // Disabling monitoring frees a slot.
    await setAccountMonitoring(A.t.id, ig.id, false);
    check("disabling monitoring drops the count", (await withTenant(A.t.id, (tx) => countMonitoredAccounts(tx, A.t.id))) === 1);
    await setAccountMonitoring(A.t.id, ig.id, true);

    // -------------------------------------------------------------------------
    console.log("Atomic monitored-account limit");
    const preview = await previewMonitoredAccountLimit(A.t.id, 1);
    check("preview reports used + limit", preview.used >= 2 && (preview.limit === -1 || preview.limit >= 0));
    if (preview.limit >= 0) {
      // Turn everything off, then race to enable more than the limit allows.
      await systemDb.connectedAccount.updateMany({ where: { tenantId: A.t.id }, data: { monitoringEnabled: false } });
      const limit = preview.limit;
      const extra = await Promise.all(Array.from({ length: limit + 2 }, (_, i) => mkAcc(A, `x${i}`, "facebook_page", undefined, false)));
      const results = await Promise.allSettled(extra.map((a) => enableAccountMonitoringWithinLimit(A.t.id, a.id)));
      const enabled = await withTenant(A.t.id, (tx) => countMonitoredAccounts(tx, A.t.id));
      const rejected = results.filter((r) => r.status === "rejected").length;
      check("parallel enable never exceeds the plan limit (atomic)", enabled === limit && rejected >= 2, `enabled=${enabled} limit=${limit} rejected=${rejected}`);
    } else {
      check("unlimited plan → atomic-limit race N/A (skipped)", true);
    }

    // -------------------------------------------------------------------------
    console.log("Cross-tenant denial (RLS)");
    check("tenant B cannot read tenant A's account protection", (await getAccountProtection(B.t.id, fb.id)) === null);
    check("tenant B cannot update tenant A's account protection", (await updateAccountProtection(B.t.id, fb.id, { autoHideEnabled: true })) === 0);
    check("tenant B cannot toggle tenant A's monitoring", (await setAccountMonitoring(B.t.id, fb.id, false)) === 0);
  } finally {
    for (const X of [A, B]) {
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.brand.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.tenant.deleteMany({ where: { id: X.t.id } });
    }
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — account protection + monitored-account limit (V1.59)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
