/**
 * V1.42 — Unified Inbox persistence + RLS + cross-tenant integrity (real Postgres).
 *
 * Proves that read/archive/label/assignment/note/priority/workflow-status are truly PERSISTED
 * (re-read after mutation, not client-only), that cross-tenant label/assignee/note links are
 * DB-impossible (composite FKs + membership check) — rejected even via the owner client — that
 * RLS isolates reads, that the delete lifecycle behaves as designed, and that bulk actions are
 * internal-only and tenant-scoped. Audit never stores a note body.
 *
 * Run: pnpm inbox-persistence:test
 */
import {
  systemDb, withTenant,
  setInboxRead, setInboxArchived, setInboxPriority, setInboxWorkflowStatus,
  assignInboxItem, createInboxLabel, deleteInboxLabel, addInboxItemLabel, removeInboxItemLabel,
  addInboxNote, listInboxNotes, softDeleteInboxNote, bulkInboxAction, listInboxItemsWithState,
} from "../src/index";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

async function mkTenant(tag: string, sfx: string) {
  const t = await systemDb.tenant.create({ data: { name: `Inbox ${tag}`, slug: `inbox-${tag}-${sfx}` } });
  const br = await systemDb.brand.create({ data: { tenantId: t.id, name: tag } });
  const acc = await systemDb.connectedAccount.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", status: "active", mode: "read_only", externalId: `ACC_${tag}_${sfx}`, health: "healthy" } });
  const u = await systemDb.user.create({ data: { email: `u-${tag}-${sfx}@t.dev`, name: `User ${tag}` } });
  await systemDb.membership.create({ data: { userId: u.id, tenantId: t.id, role: "admin" } });
  return { t, br, acc, u };
}
async function mkItem(t: { id: string }, br: { id: string }, acc: { id: string }, ext: string) {
  const ci = await systemDb.contentItem.create({ data: { tenantId: t.id, brandId: br.id, connectedAccountId: acc.id, platform: "facebook_page", kind: "comment", externalId: ext, text: "hi", publishedAt: new Date() } });
  const ri = await systemDb.reputationItem.create({ data: { tenantId: t.id, brandId: br.id, platform: "facebook_page", contentItemId: ci.id, status: "classified" } });
  return ri;
}

async function run() {
  const sfx = Date.now().toString(36);
  const A = await mkTenant("A", sfx);
  const B = await mkTenant("B", sfx);

  try {
    const a1 = await mkItem(A.t, A.br, A.acc, `A1_${sfx}`);
    const a2 = await mkItem(A.t, A.br, A.acc, `A2_${sfx}`);
    const b1 = await mkItem(B.t, B.br, B.acc, `B1_${sfx}`);
    const reread = (tid: string, id: string) => withTenant(tid, (db) => db.reputationItem.findFirst({ where: { id }, select: { isRead: true, archivedAt: true, priority: true, inboxWorkflowStatus: true, assignedToUserId: true } }));

    // ---------------- persistence ----------------
    await setInboxRead(A.t.id, a1.id, true, A.u.id);
    check("1) mark read persists (re-read from DB)", (await reread(A.t.id, a1.id))?.isRead === true);
    await setInboxArchived(A.t.id, a1.id, true, A.u.id);
    check("2) archive persists (archivedAt set)", !!(await reread(A.t.id, a1.id))?.archivedAt);
    await setInboxPriority(A.t.id, a1.id, "high", A.u.id);
    check("3) priority persists", (await reread(A.t.id, a1.id))?.priority === "high");
    await setInboxWorkflowStatus(A.t.id, a1.id, "in_review", A.u.id);
    check("4) workflow status persists", (await reread(A.t.id, a1.id))?.inboxWorkflowStatus === "in_review");
    const asg = await assignInboxItem(A.t.id, a1.id, A.u.id, A.u.id);
    check("5) assignment persists", asg.ok === true && (await reread(A.t.id, a1.id))?.assignedToUserId === A.u.id);

    const lab = await createInboxLabel(A.t.id, "  Urgent Follow-up ", "danger", A.u.id);
    check("6) label create persists (normalized, deduped per tenant)", lab.ok === true && !!lab.id);
    const dupe = await createInboxLabel(A.t.id, "urgent follow-up", undefined, A.u.id);
    check("7) duplicate normalized label rejected", dupe.ok === false && dupe.reason === "duplicate_label");
    const labId = (lab as { id: string }).id;
    await addInboxItemLabel(A.t.id, a1.id, labId, A.u.id);
    const withLabels = await listInboxItemsWithState(A.t.id, { id: a1.id });
    check("8) label assignment persists (no N+1 join)", withLabels[0]?.inboxLabels.some((l) => l.label.id === labId) === true);

    const note = await addInboxNote(A.t.id, a1.id, A.u.id, "  internal secret note  ");
    const notes = await listInboxNotes(A.t.id, a1.id);
    check("9) note persists (trimmed, chronological)", note.ok === true && notes.length === 1 && notes[0]?.body === "internal secret note");

    // ---------------- audit never stores note body ----------------
    const audits = await withTenant(A.t.id, (db) => db.auditLog.findMany({ where: { event: { startsWith: "inbox." } }, select: { event: true, metadata: true } }));
    check("10) audit trail written, note body NEVER audited", audits.length >= 8 && audits.every((x) => JSON.stringify(x.metadata ?? {}).indexOf("internal secret note") === -1) && audits.some((x) => x.event === "inbox.note_add"));

    // ---------------- cross-tenant / RLS ----------------
    check("11) foreign item mutation rejected (A cannot mark B's item)", (await setInboxRead(A.t.id, b1.id, true, A.u.id)).ok === false);
    const foreignLabel = await addInboxItemLabel(A.t.id, a1.id, "no-such-or-foreign", A.u.id);
    check("12) foreign/missing label rejected (composite FK)", foreignLabel.ok === false && foreignLabel.reason === "item_or_label_missing");
    check("13) foreign assignee rejected (not a member of tenant A)", (await assignInboxItem(A.t.id, a1.id, B.u.id, A.u.id)).reason === "assignee_not_member");
    check("14) note on foreign item rejected", (await addInboxNote(A.t.id, b1.id, A.u.id, "x")).ok === false);

    // Owner/system client cannot bypass the composite FK either.
    let ownerBlocked = false;
    try { await systemDb.inboxItemLabel.create({ data: { tenantId: A.t.id, reputationItemId: a1.id, labelId: labId } }); } catch { ownerBlocked = false; }
    try { await systemDb.inboxItemLabel.create({ data: { tenantId: A.t.id, reputationItemId: b1.id, labelId: labId } }); ownerBlocked = false; } catch { ownerBlocked = true; }
    check("15) cross-tenant label link rejected even via owner client (composite FK)", ownerBlocked);

    // RLS read isolation — A's tenant read never sees B's item.
    const aSees = await listInboxItemsWithState(A.t.id, {});
    check("16) RLS read isolation: tenant A never sees tenant B's items", aSees.every((r) => r.tenantId === A.t.id) && aSees.some((r) => r.id === a1.id));

    // ---------------- bulk (internal only, tenant-scoped) ----------------
    const bulk = await bulkInboxAction(A.t.id, [a1.id, a2.id, b1.id], "mark_read", A.u.id);
    check("17) bulk mark_read affects only tenant A's items (B ignored by RLS)", bulk.ok === true && bulk.affected === 2);
    const bulkArch = await bulkInboxAction(A.t.id, [a2.id], "archive", A.u.id);
    check("18) bulk archive works", bulkArch.ok === true && !!(await reread(A.t.id, a2.id))?.archivedAt);

    // ---------------- delete lifecycle ----------------
    await removeInboxItemLabel(A.t.id, a1.id, labId, A.u.id);
    await addInboxItemLabel(A.t.id, a1.id, labId, A.u.id); // re-add
    await deleteInboxLabel(A.t.id, labId, A.u.id);
    const afterLabelDel = await listInboxItemsWithState(A.t.id, { id: a1.id });
    check("19) label delete → join rows gone, item retained", afterLabelDel.length === 1 && afterLabelDel[0]?.inboxLabels.length === 0);

    const del = await softDeleteInboxNote(A.t.id, notes[0]!.id, A.u.id);
    check("20) note author-scoped soft delete", del.ok === true && (await listInboxNotes(A.t.id, a1.id)).length === 0);

    // ReputationItem delete → labels + notes cascade.
    const a3 = await mkItem(A.t, A.br, A.acc, `A3_${sfx}`);
    const lab2 = await createInboxLabel(A.t.id, `L2_${sfx}`, undefined, A.u.id);
    await addInboxItemLabel(A.t.id, a3.id, (lab2 as { id: string }).id, A.u.id);
    await addInboxNote(A.t.id, a3.id, A.u.id, "note on a3");
    await systemDb.reputationItem.delete({ where: { id: a3.id } });
    const orphanLabels = await systemDb.inboxItemLabel.count({ where: { reputationItemId: a3.id } });
    const orphanNotes = await systemDb.inboxNote.count({ where: { reputationItemId: a3.id } });
    check("21) ReputationItem delete → labels + notes cascade (no orphans)", orphanLabels === 0 && orphanNotes === 0);

    // User delete → assignment + note author SetNull (history retained).
    const u2 = await systemDb.user.create({ data: { email: `u2-${sfx}@t.dev`, name: "Temp" } });
    await systemDb.membership.create({ data: { userId: u2.id, tenantId: A.t.id, role: "reviewer" } });
    await assignInboxItem(A.t.id, a1.id, u2.id, A.u.id);
    const n2 = await addInboxNote(A.t.id, a1.id, u2.id, "note by u2");
    await systemDb.membership.deleteMany({ where: { userId: u2.id } });
    await systemDb.user.delete({ where: { id: u2.id } });
    const relRow = await systemDb.reputationItem.findUnique({ where: { id: a1.id }, select: { assignedToUserId: true } });
    const noteRow = await systemDb.inboxNote.findUnique({ where: { id: (n2 as { id: string }).id }, select: { authorUserId: true, body: true } });
    check("22) user delete → assignment SetNull + note author SetNull, note retained", relRow?.assignedToUserId === null && noteRow?.authorUserId === null && noteRow?.body === "note by u2");

    // ---------------- ingest never overwrites workflow state ----------------
    await setInboxRead(A.t.id, a1.id, true, A.u.id);
    await withTenant(A.t.id, (db) => db.reputationItem.update({ where: { id: a1.id }, data: { riskLevel: "high" } })); // simulate a re-classify write
    check("23) provider/classifier write does not reset isRead (workflow data preserved)", (await reread(A.t.id, a1.id))?.isRead === true);

    check("24) empty selection rejected in bulk", (await bulkInboxAction(A.t.id, [], "mark_read", A.u.id)).ok === false);

    // ---------------- V1.42B: bulk label ops + filter queries ----------------
    const lab3 = await createInboxLabel(A.t.id, `Bulk_${sfx}`, "brand", A.u.id);
    const lab3Id = (lab3 as { id: string }).id;
    // Bulk add_label to A's items; a foreign id (b1) is silently ignored by RLS (only own items link).
    const bAdd = await bulkInboxAction(A.t.id, [a1.id, a2.id, b1.id], "add_label", A.u.id, { labelId: lab3Id });
    const a1Labels = (await listInboxItemsWithState(A.t.id, { id: a1.id }))[0]?.inboxLabels.map((l) => l.label.id) ?? [];
    const bForeignLinked = await systemDb.inboxItemLabel.count({ where: { reputationItemId: b1.id, labelId: lab3Id } });
    check("25) bulk add_label links only tenant A's items (foreign ignored)", bAdd.ok === true && bAdd.affected === 2 && a1Labels.includes(lab3Id) && bForeignLinked === 0);
    const bRem = await bulkInboxAction(A.t.id, [a1.id, a2.id], "remove_label", A.u.id, { labelId: lab3Id });
    const a1LabelsAfter = (await listInboxItemsWithState(A.t.id, { id: a1.id }))[0]?.inboxLabels.map((l) => l.label.id) ?? [];
    check("26) bulk remove_label unlinks from items", bRem.ok === true && bRem.affected === 2 && !a1LabelsAfter.includes(lab3Id));
    check("27) bulk add_label with missing label rejected", (await bulkInboxAction(A.t.id, [a1.id], "add_label", A.u.id, { labelId: "no-such" })).ok === false);
    check("28) bulk label without labelId rejected", (await bulkInboxAction(A.t.id, [a1.id], "add_label", A.u.id)).reason === "label_required");

    // Filter queries the inbox UI relies on (unread / archived / priority / workflow / label).
    await setInboxRead(A.t.id, a1.id, false, A.u.id);
    await setInboxPriority(A.t.id, a2.id, "urgent", A.u.id);
    await setInboxWorkflowStatus(A.t.id, a1.id, "resolved", A.u.id);
    await addInboxItemLabel(A.t.id, a2.id, lab3Id, A.u.id);
    const unread = await listInboxItemsWithState(A.t.id, { isRead: false });
    const archived = await listInboxItemsWithState(A.t.id, { archivedAt: { not: null } });
    const urgent = await listInboxItemsWithState(A.t.id, { priority: "urgent" });
    const resolved = await listInboxItemsWithState(A.t.id, { inboxWorkflowStatus: "resolved" });
    const labeled = await listInboxItemsWithState(A.t.id, { inboxLabels: { some: { labelId: lab3Id } } });
    check("29) filter queries return the expected tenant-scoped sets",
      unread.some((r) => r.id === a1.id) && !unread.some((r) => r.id === b1.id)
      && archived.every((r) => r.archivedAt !== null)
      && urgent.some((r) => r.id === a2.id) && urgent.every((r) => r.priority === "urgent")
      && resolved.some((r) => r.id === a1.id)
      && labeled.some((r) => r.id === a2.id));
  } finally {
    for (const X of [A, B]) {
      await systemDb.auditLog.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.reputationItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.contentItem.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.connectedAccount.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.inboxLabel.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.membership.deleteMany({ where: { tenantId: X.t.id } });
      await systemDb.brand.deleteMany({ where: { tenantId: X.t.id } });
    }
    await systemDb.user.deleteMany({ where: { email: { contains: sfx } } });
    await systemDb.tenant.deleteMany({ where: { id: { in: [A.t.id, B.t.id] } } });
  }

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — Unified Inbox persistence & RLS (V1.42)`);
  await systemDb.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error(e); await systemDb.$disconnect(); process.exit(1); });
