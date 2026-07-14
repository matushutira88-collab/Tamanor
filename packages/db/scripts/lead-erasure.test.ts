/**
 * V1.45C3 — GLOBAL LEAD ERASURE (real Postgres).
 *
 * E) authorization (leads:erase is Platform-Admin-only; staff + ordinary users denied);
 * F) erasure (exact id / exact normalized email; no domain/fuzzy over-delete; converge; stale-update
 *    cannot restore; new lead not retroactively removed; receipt count);
 * G) privacy (receipt has no email/name/company/message/notes).
 *
 * Run: pnpm lead-erasure:test
 */
import {
  systemDb, createLead, eraseLeads, platformUpdateLead, getLeadErasureReceipt,
  setPlatformRoleByEmail, isPlatformForbidden,
} from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return pred(e); }
}
const leadExists = (id: string) => systemDb.lead.count({ where: { id } }).then((c) => c === 1);

async function run() {
  const sfx = Date.now().toString(36);
  const mkLead = (tag: string, email: string) => createLead({ name: `Name ${tag}`, email, company: `Co ${tag}`, message: `msg ${tag}`, source: "book_demo", consent: true } as never);

  // ==================== E) AUTHORIZATION ====================
  const ordinary = await systemDb.user.create({ data: { email: `ord-${sfx}@example.test` } });
  const staff = await systemDb.user.create({ data: { email: `staff-${sfx}@example.test` } });
  const admin = await systemDb.user.create({ data: { email: `admin-${sfx}@example.test` } });
  await setPlatformRoleByEmail(staff.email, "staff");
  await setPlatformRoleByEmail(admin.email, "admin");

  const victim = await mkLead("E", `victim-${sfx}@example.test`);
  check("E2) ordinary user cannot erase (platform_forbidden)",
    await throws(() => eraseLeads(ordinary.id, { mode: "lead_id", leadId: victim.id }), isPlatformForbidden));
  check("E4) platform STAFF cannot erase (leads:erase is admin-only; staff keeps read/write)",
    await throws(() => eraseLeads(staff.id, { mode: "lead_id", leadId: victim.id }), isPlatformForbidden));
  check("E/denied-untouched) the lead still exists after denied attempts", await leadExists(victim.id));
  const r5 = await eraseLeads(admin.id, { mode: "lead_id", leadId: victim.id });
  check("E5) platform ADMIN allowed — the lead is gone", r5.matchedCount === 1 && !(await leadExists(victim.id)));

  // ==================== F) ERASURE ====================
  // F1 exact id removes the whole row (all PII/content gone).
  const f1 = await mkLead("F1", `f1-${sfx}@example.test`);
  await eraseLeads(admin.id, { mode: "lead_id", leadId: f1.id });
  check("F1) erase by exact id removes the whole Lead row", !(await leadExists(f1.id)));

  // F2 exact normalized email removes ALL exact matches (case-insensitive); F3/F4 no over-delete.
  const sharedEmail = `Shared.${sfx}@Example.test`;
  const dupA = await mkLead("dupA", sharedEmail);
  const dupB = await mkLead("dupB", sharedEmail.toLowerCase()); // same normalized email, different case
  const otherDomain = await mkLead("dom", `shared.${sfx}@other.test`); // different domain — must survive
  const prefix = await mkLead("pre", `xshared.${sfx}@example.test`);    // prefix — must survive
  const rEmail = await eraseLeads(admin.id, { mode: "normalized_email", email: `  SHARED.${sfx}@EXAMPLE.TEST  ` });
  check("F2) erase by normalized email removes ALL exact (case-insensitive) matches", rEmail.matchedCount === 2 && !(await leadExists(dupA.id)) && !(await leadExists(dupB.id)));
  check("F3/F4) NO domain/prefix/fuzzy over-delete (other-domain + prefix leads survive)", (await leadExists(otherDomain.id)) && (await leadExists(prefix.id)));

  // F5 repeat converges (0 match, truthful).
  const rRepeat = await eraseLeads(admin.id, { mode: "normalized_email", email: sharedEmail });
  check("F5) a repeat erase matches zero rows (truthful, not a fabricated prior success)", rRepeat.matchedCount === 0);

  // F6 concurrent erase-by-id and erase-by-email for the same lead converge (one deletes, one 0).
  const conc = await mkLead("conc", `conc-${sfx}@example.test`);
  const [c1, c2] = await Promise.allSettled([
    eraseLeads(admin.id, { mode: "lead_id", leadId: conc.id }),
    eraseLeads(admin.id, { mode: "normalized_email", email: `conc-${sfx}@example.test` }),
  ]);
  const total = [c1, c2].filter((r) => r.status === "fulfilled").reduce((s, r) => s + (r as PromiseFulfilledResult<{ matchedCount: number }>).value.matchedCount, 0);
  check("F6) concurrent id + email erase of one lead converges (deleted once, total match = 1)", total === 1 && !(await leadExists(conc.id)));

  // F7/F8 stale status/note update after erasure cannot restore PII.
  const stale = await mkLead("stale", `stale-${sfx}@example.test`);
  await eraseLeads(admin.id, { mode: "lead_id", leadId: stale.id });
  const upd = await platformUpdateLead(staff.id, stale.id, { status: "contacted" as never });
  check("F7/F8) a stale status/note update on an erased lead affects 0 rows and cannot restore it",
    (upd as { count: number }).count === 0 && !(await leadExists(stale.id)));

  // F9 a NEW lead created after the operation is not retroactively removed.
  const afterEmail = `after-${sfx}@example.test`;
  const before = await mkLead("before", afterEmail);
  await eraseLeads(admin.id, { mode: "normalized_email", email: afterEmail });
  check("F9-pre) the pre-existing lead was erased", !(await leadExists(before.id)));
  const after = await mkLead("after", afterEmail); // brand new submission, same email, AFTER the op
  check("F9) a new submission after the erasure is a genuinely new record (not retroactively removed)", await leadExists(after.id));

  // F10 receipt count + F11/G privacy.
  const receipt = await getLeadErasureReceipt(rEmail.operationId);
  check("F10) receipt records the correct matched count + mode", receipt?.matchedCount === 2 && receipt?.mode === "normalized_email");
  const blob = JSON.stringify(receipt);
  const leaks = [sharedEmail, sharedEmail.toLowerCase(), "Name dupA", "Co dupA", "msg dupA", sfx + "@example"].filter((s) => blob.includes(s));
  check("F11/G) receipt contains NO email/name/company/message/notes (opaque ids + counts + mode only)", leaks.length === 0, `leaked: ${leaks.join(",")}`);
  check("G2) receipt actor id is opaque and there is no email hash field",
    receipt?.requestedByUserId === admin.id && !blob.toLowerCase().includes("hash") && !blob.includes("@"));

  console.log(`\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
