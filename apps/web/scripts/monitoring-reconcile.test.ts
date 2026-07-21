/**
 * V1.68 (Release A / A2) — PURE tests for the retroactive keep-oldest monitoring reconciliation
 * (selectMonitoringToDisable, no DB). Proves: within-cap → no-op; downgrade over the account cap
 * disables the NEWEST beyond it (oldest kept); the brand cap disables accounts of the newest brands;
 * both caps compose; unlimited (null) never disables; deterministic tiebreak by id.
 * Run: pnpm monitoring-reconcile:test
 */
import { selectMonitoringToDisable, type MonitoredAccountRef, type BrandRef } from "@guardora/core";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};
const sorted = (a: string[]) => [...a].sort();

const t = (n: number) => new Date(2026, 0, 1 + n); // ascending createdAt by index
const acc = (id: string, brandId: string | null, age: number): MonitoredAccountRef => ({ id, brandId, createdAt: t(age) });
const brand = (id: string, age: number): BrandRef => ({ id, createdAt: t(age) });

function run() {
  // ---- within cap → no-op --------------------------------------------------------------------------
  check("within account cap → nothing disabled",
    selectMonitoringToDisable([acc("a1", "b1", 0), acc("a2", "b1", 1)], [brand("b1", 0)], { maxBrands: 1, maxConnectedAccounts: 4 }).length === 0);

  // ---- downgrade over the ACCOUNT cap → keep oldest, disable newest --------------------------------
  const sixInOneBrand = [acc("a1", "b1", 0), acc("a2", "b1", 1), acc("a3", "b1", 2), acc("a4", "b1", 3), acc("a5", "b1", 4), acc("a6", "b1", 5)];
  const disabled = selectMonitoringToDisable(sixInOneBrand, [brand("b1", 0)], { maxBrands: 1, maxConnectedAccounts: 4 });
  check("downgrade 6→cap 4: disables exactly the 2 NEWEST (a5,a6), keeps the 4 oldest",
    JSON.stringify(sorted(disabled)) === JSON.stringify(["a5", "a6"]), sorted(disabled).join(","));

  // ---- BRAND cap → accounts of the newest brands are disabled --------------------------------------
  const brands3 = [brand("b1", 0), brand("b2", 1), brand("b3", 2)];
  const acctsAcross = [acc("a1", "b1", 0), acc("a2", "b2", 1), acc("a3", "b3", 2)];
  const brandCapped = selectMonitoringToDisable(acctsAcross, brands3, { maxBrands: 1, maxConnectedAccounts: 40 });
  check("downgrade to 1 brand: disables accounts of the 2 newest brands (a2,a3), keeps oldest brand's (a1)",
    JSON.stringify(sorted(brandCapped)) === JSON.stringify(["a2", "a3"]), sorted(brandCapped).join(","));

  // ---- both caps compose ---------------------------------------------------------------------------
  // 3 brands, brand cap 1 keeps b1's accounts; b1 has 3 accounts, account cap 2 keeps the 2 oldest.
  const combo = [acc("a1", "b1", 0), acc("a2", "b1", 1), acc("a3", "b1", 2), acc("a4", "b2", 3), acc("a5", "b3", 4)];
  const comboDisabled = selectMonitoringToDisable(combo, brands3, { maxBrands: 1, maxConnectedAccounts: 2 });
  check("compose brand+account cap: disables a3 (over account cap in b1) + a4,a5 (over brand cap)",
    JSON.stringify(sorted(comboDisabled)) === JSON.stringify(["a3", "a4", "a5"]), sorted(comboDisabled).join(","));

  // ---- unlimited (enterprise) → never disables -----------------------------------------------------
  check("unlimited plan (null caps) → nothing disabled",
    selectMonitoringToDisable(sixInOneBrand, [brand("b1", 0)], { maxBrands: null, maxConnectedAccounts: null }).length === 0);

  // ---- restricted-style cap 0 → disable all --------------------------------------------------------
  check("cap 0 (both) → disable everything",
    selectMonitoringToDisable(sixInOneBrand, [brand("b1", 0)], { maxBrands: 0, maxConnectedAccounts: 0 }).length === 6);

  // ---- deterministic tiebreak on equal createdAt (id asc) ------------------------------------------
  const sameAge = [acc("z", "b1", 0), acc("a", "b1", 0), acc("m", "b1", 0)];
  const tie = selectMonitoringToDisable(sameAge, [brand("b1", 0)], { maxBrands: 1, maxConnectedAccounts: 2 });
  check("equal createdAt → id asc tiebreak keeps a,m; disables z (newest by id)",
    JSON.stringify(tie) === JSON.stringify(["z"]), tie.join(","));

  // ---- reconnect-after-downgrade invariant: an old reconnected account is KEPT, a newer one dropped --
  // a1 (oldest, e.g. reconnected) stays; the newest beyond cap is disabled → count never exceeds cap.
  const afterReconnect = selectMonitoringToDisable(
    [acc("reconnected-old", "b1", 0), acc("a2", "b1", 1), acc("a3", "b1", 2)], [brand("b1", 0)], { maxBrands: 1, maxConnectedAccounts: 2 });
  check("reconnect keep-oldest: the oldest reconnected account is kept, newest (a3) disabled → within cap",
    JSON.stringify(afterReconnect) === JSON.stringify(["a3"]), afterReconnect.join(","));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — monitoring keep-oldest reconciliation (V1.68 A2): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
