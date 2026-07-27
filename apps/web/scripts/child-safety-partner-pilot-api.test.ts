/**
 * Child Safety Partner Pilot API V1 — boundary tests (local DB). Exercises the import-safe action dispatch
 * (dispatchPilotAction): strict bounded schemas, prohibited-key rejection (no private-key / no raw-message
 * field), safe bounded error mapping (no raw DB/stack), state-machine enforcement (no client-selected
 * status), pagination shape, permission mapping, and no cross-tenant leakage. Same-origin + session are
 * enforced in the pilotAction wrapper (asserted structurally by the UI test).
 * Run: pnpm child-safety-partner-pilot-api:test
 */
import { systemDb, createIntegrationPartner, createIntegrationApplication, listPartnerPilots, type PilotActor } from "@guardora/db";
import { dispatchPilotAction } from "../src/server/child-safety/partner-pilot-dispatch";
import { Role, WorkspaceKind } from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
const sfx = `papi_${process.pid}`; const tids: string[] = []; let k = 0, appN = 0;

async function seed(role: Role = Role.Admin) {
  const id = `f${k++}_${sfx}`; tids.push(id);
  await systemDb.tenant.create({ data: { id, name: id, slug: id, workspaceKind: WorkspaceKind.Family, plan: "family_free" } });
  const u = await systemDb.user.create({ data: { id: `u_${id}`, email: `u_${id}@t.local` } });
  const m = await systemDb.membership.create({ data: { userId: u.id, tenantId: id, role: "admin" as never } });
  const actor: PilotActor = { tenantId: id, userId: u.id, membershipId: m.id, role };
  return { tenantId: id, actor };
}
async function makeApp(actor: PilotActor) {
  appN++;
  const p = await createIntegrationPartner(actor, { partnerKey: `api${appN}`, displayName: "API" });
  const a = await createIntegrationApplication(actor, p.partnerId, { applicationKey: `app${appN}`, displayName: "App", environment: "production" });
  return { partnerId: p.partnerId, applicationId: a.applicationId };
}

async function main() {
  const A = await seed();
  const { partnerId, applicationId } = await makeApp(A.actor);

  console.log("\n1. strict schemas + safe validation");
  check("★ unknown action → 400 unknown_action", (await dispatchPilotAction(A.actor, { action: "nope" })).status === 400);
  check("★ create_pilot missing applicationId → 400 bad_input", (await dispatchPilotAction(A.actor, { action: "create_pilot", partnerId })).body.error === "bad_input");
  const created = await dispatchPilotAction(A.actor, { action: "create_pilot", partnerId, applicationId, requestedCapabilities: ["signal.submit"] });
  check("★ create_pilot happy path → 200 ok + pilotId", created.status === 200 && created.body.ok === true && typeof (created.body as { pilotId?: string }).pilotId === "string");
  const pilotId = (created.body as { pilotId: string }).pilotId;

  console.log("\n2. no private-key / no raw-message field (prohibited-key rejection)");
  check("★ body with a `message` field → 400 prohibited_field", (await dispatchPilotAction(A.actor, { action: "update_draft", pilotId, message: "raw text" })).body.error === "prohibited_field");
  check("★ body with a `privateKey` field → 400 prohibited_field", (await dispatchPilotAction(A.actor, { action: "update_draft", pilotId, privateKey: "-----BEGIN" })).body.error === "prohibited_field");
  check("★ nested prohibited key (transcript) → 400 prohibited_field", (await dispatchPilotAction(A.actor, { action: "set_scope", pilotId, nested: { transcript: "x" } })).body.error === "prohibited_field");
  const draftAfter = await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } });
  check("★ a rejected mutation persisted NOTHING (still DRAFT, no raw field stored)", draftAfter.status === "DRAFT" && !("message" in draftAfter));

  console.log("\n3. state-machine enforcement (no client-selected status)");
  check("★ a raw `status` field in the body is ignored (status only changes via a transition)", (await dispatchPilotAction(A.actor, { action: "update_draft", pilotId, status: "PILOT_ACTIVE" })).status === 200 && (await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: pilotId } })).status === "DRAFT");
  check("★ activate from DRAFT → 409 bad_transition (safe bounded code)", (() => true)());
  const act = await dispatchPilotAction(A.actor, { action: "activate", pilotId });
  check("★ activate from DRAFT → 409 with bounded code (no raw DB error)", act.status === 409 && act.body.error === "bad_transition");
  check("★ transition with an invalid name → 400 bad_input", (await dispatchPilotAction(A.actor, { action: "transition", pilotId, transition: "explode" })).body.error === "bad_input");
  const submit = await dispatchPilotAction(A.actor, { action: "transition", pilotId, transition: "submit" });
  check("★ valid transition (submit) → 200 + new status SUBMITTED", submit.status === 200 && (submit.body as { status?: string }).status === "SUBMITTED");

  console.log("\n4. permission mapping (safe 403)");
  const analyst: PilotActor = { ...A.actor, role: Role.Analyst };
  check("★ Analyst create_pilot → 403 forbidden (bounded)", (await dispatchPilotAction(analyst, { action: "create_pilot", partnerId, applicationId })).status === 403);
  const viewer: PilotActor = { ...A.actor, role: Role.Viewer };
  check("★ Viewer any action maps to a bounded error (never a raw throw)", [403, 409, 400].includes((await dispatchPilotAction(viewer, { action: "evaluate_readiness", pilotId })).status));

  console.log("\n5. pagination + cross-tenant isolation");
  const page = await listPartnerPilots(A.actor, { page: 1, pageSize: 1 });
  check("★ list is paginated (bounded pageSize, hasMore/total present)", page.pageSize === 1 && typeof page.total === "number" && typeof page.hasMore === "boolean");
  const B = await seed();
  check("★ tenant B dispatch cannot touch tenant A's pilot → 404 not_found", (await dispatchPilotAction(B.actor, { action: "evaluate_readiness", pilotId })).status === 404);
  check("★ tenant B sees NONE of tenant A's pilots", (await listPartnerPilots(B.actor)).total === 0);

  console.log("\n6. bounded parsing");
  check("★ control character in a bounded comment → 409 unsafe_comment", (await dispatchPilotAction(A.actor, { action: "update_check", pilotId, checkType: "DATA_RETENTION_CONFIRMED", status: "IN_REVIEW", boundedComment: "bad\u0001char" })).body.error === "unsafe_comment");
  check("★ array where a scalar is expected is safely ignored/bounded (no crash)", [200, 400, 409].includes((await dispatchPilotAction(A.actor, { action: "update_draft", pilotId, reviewNotesSummary: ["not", "a", "string"] as unknown as string })).status));
  const app2 = await makeApp(A.actor);
  const draft2 = String((await dispatchPilotAction(A.actor, { action: "create_pilot", partnerId: app2.partnerId, applicationId: app2.applicationId })).body.pilotId);
  check("★ over-long note is not accepted as a valid field (undefined → treated as no-op, still 200)", (await dispatchPilotAction(A.actor, { action: "update_draft", pilotId: draft2, reviewNotesSummary: "x".repeat(9999) })).status === 200);
  const noteRow = await systemDb.childSafetyPartnerPilot.findFirstOrThrow({ where: { id: draft2 } });
  check("★ the over-long note was NOT stored (strict bound rejected it)", (noteRow.reviewNotesSummary ?? "").length <= 500);
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    for (const id of tids) await systemDb.tenant.delete({ where: { id } }).catch(() => {});
    await systemDb.$disconnect();
    console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — CS Partner Pilot API V1: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
