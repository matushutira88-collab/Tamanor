/**
 * FAMILY NOTIFICATION CENTER V1 — SK/EN/DE localization parity. Proves every catalogue type has a non-empty
 * title+body in all three locales, the center/severity/bell strings are present and localized (no raw enum
 * fallback), and titles are content-free (never a name/age/email placeholder). Run: pnpm family-notifications-i18n:test
 */
import { FAMILY_NOTIF_DICT, familyNotifTypeCoverage } from "../src/app/family/family-notifications-i18n";
import { FAMILY_NOTIFICATION_TYPES, FAMILY_NOTIFICATION_CATALOGUE } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const LOCALES = ["en", "sk", "de"] as const;

function main() {
  console.log("\n1. every type localized in every locale (no missing, no raw-enum fallback)");
  const cov = familyNotifTypeCoverage();
  check("★ no missing type title/body in any locale", cov.every((c) => c.missing.length === 0), JSON.stringify(cov.filter((c) => c.missing.length)));
  for (const loc of LOCALES) {
    const d = FAMILY_NOTIF_DICT[loc];
    check(`★ [${loc}] all 13 type titles+bodies non-empty and NOT the raw enum name`, FAMILY_NOTIFICATION_TYPES.every((t) => { const e = d.types[t]; return !!e && e.title.trim().length > 2 && e.body.trim().length > 2 && e.title !== t && e.body !== t; }));
  }

  console.log("\n2. center + severity + bell strings present in every locale");
  for (const loc of LOCALES) {
    const d = FAMILY_NOTIF_DICT[loc];
    check(`★ [${loc}] center strings (title/desc/tabs/actions/empty/unavailable/loading/error/feedback)`, [d.center.title, d.center.description, d.center.tabAll, d.center.tabUnread, d.center.markRead, d.center.markAllRead, d.center.dismiss, d.center.empty, d.center.emptyUnread, d.center.unavailable, d.center.loading, d.center.error, d.center.markedRead, d.center.markedAllRead, d.center.dismissed].every((s) => typeof s === "string" && s.trim().length > 0));
    check(`★ [${loc}] severity labels (info/attention/urgent) present`, !!d.severity.info && !!d.severity.attention && !!d.severity.urgent);
    check(`★ [${loc}] bell aria labels (count / none / open) present + count interpolates`, d.bell.label("3").includes("3") && d.bell.none.trim().length > 0 && d.bell.open.trim().length > 0);
  }

  console.log("\n3. parity: identical key structure across locales");
  const shape = (loc: typeof LOCALES[number]) => [
    ...Object.keys(FAMILY_NOTIF_DICT[loc].center).sort(),
    ...Object.keys(FAMILY_NOTIF_DICT[loc].severity).sort(),
    ...Object.keys(FAMILY_NOTIF_DICT[loc].types).sort(),
  ].join("|");
  check("★ EN/SK/DE have the identical set of keys", shape("en") === shape("sk") && shape("sk") === shape("de"));

  console.log("\n4. safe copy — titles carry no entity detail");
  for (const loc of LOCALES) {
    const d = FAMILY_NOTIF_DICT[loc];
    check(`★ [${loc}] no title/body contains an id/email/placeholder token`, FAMILY_NOTIFICATION_TYPES.every((t) => { const e = d.types[t]; return !/@|\{|\}|\bid\b|_id|cuid|prof_|dlv_|sig_/i.test(`${e.title} ${e.body}`); }));
  }
  check("★ catalogue titleKey/messageKey are stable and namespaced", FAMILY_NOTIFICATION_TYPES.every((t) => FAMILY_NOTIFICATION_CATALOGUE[t].titleKey.startsWith(`family_notif.${t}.`)));
}

main();
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — Family notifications i18n parity: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
