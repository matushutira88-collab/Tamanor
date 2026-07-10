/**
 * V1.30C Public visibility clarity. A Facebook "hide" removes a comment from the
 * PUBLIC view, but the author and page admins may still see it — it is NOT deletion.
 * The product must say "Skryté pre verejnosť / Hidden from public / Öffentlich
 * verborgen" consistently and never imply removal for a hide. Wording/labels/tests only.
 *
 * Run via: pnpm public-visibility:test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { sentimentBucket } from "@guardora/ai";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(SCRIPT_DIR, "../../..", rel), "utf8");

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
const bucket = (cats: string[], sentiment = "neutral", riskLevel = "none") => sentimentBucket({ categories: cats, sentiment, riskLevel });
/** All values assigned to `key: "..."` anywhere in a dictionary source. */
const vals = (src: string, key: string) => [...src.matchAll(new RegExp(`\\b${key}: "([^"]*)"`, "g"))].map((m) => m[1]);

async function run() {
  const comments = readSrc("apps/web/src/app/dashboard/comments/page.tsx");
  const cc = readSrc("apps/web/src/app/dashboard/command-center/page.tsx");
  const rep = readSrc("apps/web/src/app/dashboard/reputation/page.tsx");
  const actor = readSrc("apps/web/src/app/dashboard/actor-risk/page.tsx");
  const control = readSrc("apps/web/src/app/dashboard/control-center/page.tsx");
  const aqDetail = readSrc("apps/web/src/app/dashboard/action-queue/[id]/page.tsx");
  const aqActions = readSrc("apps/web/src/app/dashboard/action-queue/[id]/actions.ts");
  const en = readSrc("apps/web/src/i18n/dictionaries/en.ts");
  const sk = readSrc("apps/web/src/i18n/dictionaries/sk.ts");
  const de = readSrc("apps/web/src/i18n/dictionaries/de.ts");

  // 1) Command Center hidden metric uses public-visibility wording.
  check("1) Command Center 'Hidden from public' metric", cc.includes("t.cc.hiddenToday") && vals(sk, "hiddenToday")[0] === "Skryté pre verejnosť dnes" && vals(en, "hiddenToday")[0] === "Hidden from public today");

  // 2) Command Center explains author/admin may still see.
  check("2) Command Center explains author/admin still see", cc.includes("t.common.hiddenFromPublicShort") && sk.includes("Autor a správcovia ho môžu stále vidieť"));

  // 3) Comments page status badge says "Skryté pre verejnosť".
  check("3) Comments hidden status = 'Skryté pre verejnosť'", comments.includes('r.statusKey as "st_captured"') && vals(sk, "st_hidden")[0] === "Skryté pre verejnosť" && vals(en, "st_hidden")[0] === "Hidden from public");

  // 4) Comments detail explains public cannot see but author/admin may.
  check("4) Comments detail explains public/author visibility", comments.includes("t.common.hiddenFromPublicHelp") && comments.includes("r.hiddenPublic ?") && sk.includes("Bežná verejnosť komentár nevidí") && sk.includes("Autor a správcovia ho môžu stále vidieť podľa pravidiel platformy"));

  // 5) Action Queue success says hidden from public + helper.
  check("5) Action Queue success = hidden from public", aqDetail.includes("t.common.hiddenFromPublicQueue") && aqDetail.includes("t.cc.autoHiddenPublic") && sk.includes("Komentár bol automaticky skrytý pre verejnosť") && sk.includes("Pre ostatných návštevníkov je skrytý"));

  // 6) Action Queue does NOT imply deletion/removal for a hide.
  const DELETE_WORDS = [/\bdeleted\b/i, /\bremoved\b/i, /\berased\b/i, /disappeared/i, /zmazan/i, /odstránen/i, /vymazan/i, /zmizol/i, /gelöscht/i, /entfernt/i, /verschwunden/i];
  const hideKeys = ["hiddenToday", "sumHiddenPublic", "autoHidden", "autoHiddenPublic", "autoHiddenBy", "liveDone", "hiddenPublicly", "evHidden", "evAutoHidden", "reason_hidden", "st_hidden", "st_alreadyHidden", "hiddenFromPublic", "hiddenFromPublicShort", "hiddenFromPublicHelp", "hiddenFromPublicQueue", "hiddenPublic"];
  const hideStrings = [en, sk, de].flatMap((d) => hideKeys.flatMap((k) => vals(d, k))).join("\n");
  check("6/16) no deletion/removal wording in hide-state copy", DELETE_WORDS.every((re) => !re.test(hideStrings)), DELETE_WORDS.find((re) => re.test(hideStrings))?.source ?? "");

  // 7) Reputation uses hidden-from-public wording.
  check("7) Reputation 'Hidden from public'", rep.includes("t.rep.hiddenPublic") && vals(sk, "hiddenPublic").includes("Skryté pre verejnosť") && vals(de, "hiddenPublic").includes("Öffentlich verborgen"));

  // 8) Actor Risk hidden reason uses hidden-from-public.
  check("8) Actor Risk hidden reason = hidden from public", vals(sk, "reason_hidden")[0] === "Komentáre skryté pre verejnosť" && vals(en, "reason_hidden")[0] === "Comments hidden from public");

  // 9) Timeline/important-events hide text uses hidden-from-public.
  check("9) Event hide text = hidden from public", vals(sk, "evHidden")[0].includes("skrytý pre verejnosť") && vals(sk, "evAutoHidden")[0].includes("skrytý pre verejnosť"));

  // 10) Control Center explains hide = public visibility, not deletion.
  check("10) Control Center: hide is not deletion", control.includes("t.common.hideNotDeletion") && sk.includes("Skrytie neznamená vymazanie") && en.includes("Hiding is not deletion"));

  // 11) Live-hide success note (server action) uses hidden-from-public, not deletion.
  check("11) success note = hidden from public", aqActions.includes("hidden from the public") && !/comment was (deleted|removed)/i.test(aqActions));

  // 12) Deleted/unavailable keeps its distinct wording.
  check("12) deleted → 'no longer exists / unavailable'", vals(sk, "st_deleted")[0] === "Komentár už neexistuje alebo nie je dostupný" && vals(en, "st_deleted")[0] === "Comment no longer exists or is unavailable");

  // 13) can_hide=false keeps its wording.
  check("13) can_hide=false → 'Facebook nedovolil skrytie'", vals(sk, "st_canHideFalse")[0] === "Facebook nedovolil skrytie");

  // 14) dry_run never counts as live hidden.
  check("14) dry_run not live-hidden", !comments.includes('"dry_run"') && comments.includes('HIDE_REASONS = ["live_hide_executed", "already_hidden"]') && !actor.includes('"dry_run"'));

  // 15) Hidden derives ONLY from execution state truth (never from sentiment/criticism).
  check("15) hidden only from state truth", comments.includes("execState") && comments.includes('st === "hidden"') && !/hiddenPublic = .*bucket/.test(comments) && bucket(["normal_criticism"], "negative", "critical") !== "risky");

  // 17) Default UI exposes no provider codes / raw ids.
  for (const [name, src] of [["comments", comments], ["command-center", cc], ["reputation", rep]] as const) {
    check(`17) ${name}: no provider codes / raw ids rendered`, !src.includes("providerResponseCode") && !src.includes("providerErrorCode") && !/>\{[^{}]*externalCommentId[^{}]*\}</.test(src) && !src.includes("policyId"));
  }

  // 18) i18n SK/EN/DE canonical keys present in all three.
  check("18) i18n canonical keys present (SK/EN/DE)",
    vals(en, "hiddenFromPublic")[0] === "Hidden from public" && vals(sk, "hiddenFromPublic")[0] === "Skryté pre verejnosť" && vals(de, "hiddenFromPublic")[0] === "Öffentlich verborgen"
    && [en, sk, de].every((d) => vals(d, "hiddenFromPublicHelp").length > 0 && vals(d, "hiddenFromPublicQueue").length > 0 && vals(d, "hideNotDeletion").length > 0));

  // 19) State truth unchanged: criticism never risky; harmful is; self-service copy intact.
  check("19) state truth + self-service intact", bucket(["normal_criticism"], "negative", "critical") !== "risky" && bucket(["scam"]) === "risky" && sk.includes("Normálna kritika nie je automaticky skrývaná") && sk.includes("Vy určujete pravidlá"));

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Public visibility clarity`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
