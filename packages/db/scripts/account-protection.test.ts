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
  enableAccountMonitoringWithinLimit, clampAutoHideMinConfidence, canAccountUseAutomatic,
  reconcileMonitoredAccountsToPlan,
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
  const A = await mkTenant("a"); const B = await mkTenant("b"); const C = await mkTenant("c");

  try {
    // -------------------------------------------------------------------------
    console.log("Resolution — tenant default vs account override");
    const fb = await mkAcc(A, "fb", "facebook_page");
    // Pure resolution: not overridden ⇒ tenant default.
    const eff0 = resolveAccountProtection(
      { monitoringEnabled: true, protectionOverridden: false, autoHideEnabled: false, autoHideMode: "recommend", autoHideRiskThreshold: "high", autoHideMinConfidence: 0.8, autoHideCategories: [], requireManualApproval: false },
      { defaultAutoHideEnabled: true, defaultAutoHideMode: "automatic", defaultAutoHideRiskThreshold: "medium", defaultAutoHideCategories: ["spam"], defaultRequireManualApproval: true },
    );
    check("not overridden → inherits tenant default", eff0.source === "tenant_default" && eff0.autoHideEnabled === true && eff0.autoHideMode === "automatic");
    const eff1 = resolveAccountProtection(
      { monitoringEnabled: true, protectionOverridden: true, autoHideEnabled: false, autoHideMode: "recommend", autoHideRiskThreshold: "critical", autoHideMinConfidence: 0.8, autoHideCategories: ["fraud"], requireManualApproval: false },
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
    console.log("V1.60 (2c) — protection mode + min-confidence + account-kind gating");
    check("clampAutoHideMinConfidence floors sub-0.8 at 0.8", clampAutoHideMinConfidence(0.5) === 0.8 && clampAutoHideMinConfidence(0.2) === 0.8);
    check("clampAutoHideMinConfidence keeps valid + caps at 1 + NaN→floor", clampAutoHideMinConfidence(0.9) === 0.9 && clampAutoHideMinConfidence(1.5) === 1 && clampAutoHideMinConfidence(Number.NaN) === 0.8);
    check("canAccountUseAutomatic: mock / placeholder / read-only-without-perm → false",
      canAccountUseAutomatic({ status: "mock_connected", mode: "read_only", grantedPermissions: ["pages_manage_engagement"] }) === false
      && canAccountUseAutomatic({ status: "active", mode: "placeholder", grantedPermissions: [] }) === false
      && canAccountUseAutomatic({ status: "active", mode: "read_only", grantedPermissions: [] }) === false);
    check("canAccountUseAutomatic: real actionable (oauth_ready / read-only+perm) → true",
      canAccountUseAutomatic({ status: "active", mode: "oauth_ready", grantedPermissions: ["pages_manage_engagement"] }) === true
      && canAccountUseAutomatic({ status: "active", mode: "read_only", grantedPermissions: ["pages_manage_engagement"] }) === true);

    // Existing account (no override) → the SAFE default: SUGGEST_ONLY (recommend) + server-floor confidence.
    const eff0mc = resolveAccountProtection(
      { monitoringEnabled: true, protectionOverridden: false, autoHideEnabled: false, autoHideMode: "recommend", autoHideRiskThreshold: "high", autoHideMinConfidence: 0.8, autoHideCategories: [], requireManualApproval: false },
      { defaultAutoHideEnabled: false, defaultAutoHideMode: "recommend", defaultAutoHideRiskThreshold: "high", defaultAutoHideCategories: [], defaultRequireManualApproval: false },
    );
    check("default (no override) → SUGGEST_ONLY + min-confidence 0.8", eff0mc.autoHideMode === "recommend" && eff0mc.autoHideMinConfidence === 0.8);

    // Save AUTOMATIC + a sub-floor confidence → mode persists, confidence clamped up to the floor.
    const fb2 = await mkAcc(A, "fb2", "facebook_page", undefined, true);
    await updateAccountProtection(A.t.id, fb2.id, { autoHideMode: "automatic", autoHideEnabled: true, autoHideMinConfidence: 0.5 });
    const gfb2 = await getAccountProtection(A.t.id, fb2.id);
    check("AUTOMATIC persists + sub-0.8 confidence clamped to 0.8 (client can't weaken the gate)",
      gfb2?.effective.autoHideMode === "automatic" && gfb2?.effective.autoHideEnabled === true && gfb2?.effective.autoHideMinConfidence === 0.8);
    await updateAccountProtection(A.t.id, fb2.id, { autoHideMinConfidence: 0.93 });
    check("a valid (≥0.8) confidence is stored as-is", (await getAccountProtection(A.t.id, fb2.id))?.effective.autoHideMinConfidence === 0.93);

    // Saving one account must not change another account in the same tenant.
    const fb3 = await mkAcc(A, "fb3", "facebook_page", undefined, true);
    const before3 = await getAccountProtection(A.t.id, fb3.id);
    await updateAccountProtection(A.t.id, fb2.id, { autoHideMode: "manual_approval" });
    const after3 = await getAccountProtection(A.t.id, fb3.id);
    check("saving one account leaves another account in the same tenant unchanged",
      after3?.overridden === false && after3?.effective.autoHideMode === before3?.effective.autoHideMode);

    // -------------------------------------------------------------------------
    console.log("V1.60 (3) — downgrade reconciliation (deterministic: keep the oldest)");
    // New tenant defaults to free_trial (schema default fix; not the phantom "free").
    const fresh = await systemDb.tenant.create({ data: { name: "Fresh", slug: `fresh-${sfx}` } });
    check("new tenant defaults to free_trial", fresh.plan === "free_trial");
    await systemDb.tenant.delete({ where: { id: fresh.id } });

    await systemDb.tenant.update({ where: { id: C.t.id }, data: { plan: "growth" } }); // limit 3
    const t0 = new Date("2026-01-01T00:00:00Z");
    const cAccs: { id: string }[] = [];
    for (let i = 0; i < 3; i++) {
      cAccs.push(await systemDb.connectedAccount.create({ data: {
        tenantId: C.t.id, brandId: C.b.id, platform: "facebook_page" as never, status: "active", mode: "read_only",
        externalId: `RC_${i}_${sfx}`, pageId: `RC_${i}_${sfx}`, monitoringEnabled: true, health: "healthy",
        createdAt: new Date(t0.getTime() + i * 60_000), protectionOverridden: true, autoHideEnabled: true, autoHideMode: "automatic",
      } }));
    }
    const cMon = () => withTenant(C.t.id, (tx) => countMonitoredAccounts(tx, C.t.id));
    const r0 = await reconcileMonitoredAccountsToPlan(C.t.id);
    check("growth (limit 3) with 3 monitored → no change", r0.disabledCount === 0 && (await cMon()) === 3);

    await systemDb.tenant.update({ where: { id: C.t.id }, data: { plan: "starter" } }); // limit 1
    const r1 = await reconcileMonitoredAccountsToPlan(C.t.id);
    check("downgrade 3 → 1 keeps exactly ONE monitored", r1.disabledCount === 2 && (await cMon()) === 1);
    const keptId = (await systemDb.connectedAccount.findMany({ where: { tenantId: C.t.id, monitoringEnabled: true }, select: { id: true } }));
    check("the KEPT account is the OLDEST (deterministic createdAt, id tiebreak)", keptId.length === 1 && keptId[0]!.id === cAccs[0]!.id);

    const r2 = await reconcileMonitoredAccountsToPlan(C.t.id);
    check("repeat reconciliation is a no-op (idempotent / late-webhook safe)", r2.disabledCount === 0 && (await cMon()) === 1);

    const allC = await systemDb.connectedAccount.findMany({ where: { tenantId: C.t.id }, select: { status: true, monitoringEnabled: true, autoHideMode: true } });
    check("no account disconnected or deleted (all 3 present + active)", allC.length === 3 && allC.every((a) => a.status === "active"));
    check("protection settings preserved on the disabled accounts", allC.filter((a) => !a.monitoringEnabled).every((a) => a.autoHideMode === "automatic"));

    // Unknown plan → fail-closed (MINIMAL limit 0) → all monitoring reconciled off.
    await systemDb.tenant.update({ where: { id: C.t.id }, data: { plan: "free" } });
    await reconcileMonitoredAccountsToPlan(C.t.id);
    check("unknown plan (fail-closed limit 0) → all monitoring disabled", (await cMon()) === 0);
    check("even at limit 0 nothing is disconnected/deleted", (await systemDb.connectedAccount.count({ where: { tenantId: C.t.id, status: "active" } })) === 3);

    // -------------------------------------------------------------------------
    console.log("Cross-tenant denial (RLS)");
    check("tenant B cannot read tenant A's account protection", (await getAccountProtection(B.t.id, fb.id)) === null);
    check("tenant B cannot update tenant A's account protection", (await updateAccountProtection(B.t.id, fb.id, { autoHideEnabled: true })) === 0);
    check("tenant B cannot toggle tenant A's monitoring", (await setAccountMonitoring(B.t.id, fb.id, false)) === 0);
  } finally {
    for (const X of [A, B, C]) {
      await systemDb.auditLog.deleteMany({ where: { tenantId: X.t.id } });
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
