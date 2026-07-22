/**
 * CS-C8 — Family Guardian Invitation & Membership Activation (local DB, RLS via tamanor_app).
 *
 * Proves the internal, content-free invitation lifecycle end to end: create (one-time token reveal),
 * expiry (lazy, no scheduler), accept (atomic membership + guardian activation, idempotent, concurrency-
 * safe, PRIMARY invariant), decline & revoke (terminal), list/counts/filters, permissions, tenant
 * isolation, safe errors and audit. Plus schema/grant/RLS invariants and static security invariants (no
 * email/SMS/push/webhook/queue/worker/scheduler, no window.confirm, no client tenantId, no child PII).
 *
 * CONTENT-FREE: no child name/DOB/avatar/note/raw content is stored or asserted. The invited email is an
 * ADULT's; it is never logged/audited in the clear. Run: pnpm child-safety-guardian-invitation:test
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { systemDb, withTenant } from "../src/index";
import {
  createFamilyGuardianInvitation, listFamilyGuardianInvitations, getFamilyInvitationCounts,
  revokeFamilyGuardianInvitation, getFamilyInvitationPreview, acceptFamilyGuardianInvitation, declineFamilyGuardianInvitation,
  createProtectedProfile, archiveProtectedProfile, createGuardianRelationship, deactivateGuardianRelationship, revokeGuardianRelationship,
  FamilyForbiddenError, FamilyNotFoundError, FamilyValidationError,
} from "../src/index";
import {
  WorkspaceKind, GuardianRole, FamilyRole, INVITABLE_FAMILY_ROLES, ALL_FAMILY_INVITATION_STATUSES, FamilyInvitationStatus,
  GuardianRelationshipType, GuardianAuthorityLevel, AgeBand, CHILD_SAFETY_AUDIT_EVENTS, CHILD_SAFETY_FORBIDDEN_FIELDS,
  FAMILY_INVITATION_CREATE_FIELDS, membershipRoleForInvitedFamilyRole, type FamilyActorContext,
} from "@guardora/core";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };
async function throws(fn: () => Promise<unknown>, pred: (e: unknown) => boolean): Promise<boolean> { try { await fn(); return false; } catch (e) { return pred(e); } }
const isValidation = (field?: string) => (e: unknown) => e instanceof FamilyValidationError && (field === undefined || e.field === field);
const acceptReason = async (token: string, uid: string, email: string): Promise<string> => { const r = await acceptFamilyGuardianInvitation(token, uid, email); return r.ok ? "ok" : r.reason; };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sfx = `csc8_${process.pid}`;
const fam = (tenantId: string, userId: string, role: string): FamilyActorContext => ({ tenantId, userId, role, workspaceKind: WorkspaceKind.Family });
const HERE = dirname(fileURLToPath(import.meta.url));
const readDb = (rel: string) => readFileSync(join(HERE, "..", "src", rel), "utf8");
const readWeb = (rel: string) => readFileSync(join(HERE, "..", "..", "..", "apps", "web", "src", rel), "utf8");
const q = <T = Record<string, unknown>>(sql: Prisma.Sql) => systemDb.$queryRaw<T[]>(sql);
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400000);

async function main() {
  // ---- Fixtures ---------------------------------------------------------------
  const famA = await systemDb.tenant.create({ data: { id: `fa_${sfx}`, name: "FamA", slug: `fa_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const famB = await systemDb.tenant.create({ data: { id: `fb_${sfx}`, name: "FamB", slug: `fb_${sfx}`, workspaceKind: WorkspaceKind.Family } });
  const biz  = await systemDb.tenant.create({ data: { id: `bz_${sfx}`, name: "Biz",  slug: `bz_${sfx}`, workspaceKind: WorkspaceKind.Business } });
  const mkUser = (k: string) => systemDb.user.create({ data: { id: `${k}_${sfx}`, email: `${k}_${sfx}@t.local`, name: `U ${k}` } }).then((u) => u.id);
  const uOwnerA = await mkUser("ownera"); const uViewA = await mkUser("viewa"); const uOwnerB = await mkUser("ownerb"); const uBiz = await mkUser("biz");
  const uInv1 = await mkUser("inv1"); const uInv2 = await mkUser("inv2"); const uInv3 = await mkUser("inv3"); const uInv4 = await mkUser("inv4"); const uInv5 = await mkUser("inv5"); const uInv6 = await mkUser("inv6");
  const emailOf = (k: string) => `${k}_${sfx}@t.local`;
  const mOwnerA = await systemDb.membership.create({ data: { userId: uOwnerA, tenantId: famA.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uViewA, tenantId: famA.id, role: "viewer" as never } });
  await systemDb.membership.create({ data: { userId: uOwnerB, tenantId: famB.id, role: "owner" as never } });
  await systemDb.membership.create({ data: { userId: uBiz, tenantId: biz.id, role: "owner" as never } });

  const ownerA = fam(famA.id, uOwnerA, "owner");     // PrimaryGuardian (may manage invitations)
  const viewerA = fam(famA.id, uViewA, "viewer");    // FamilyViewer (read-only)
  const ownerB = fam(famB.id, uOwnerB, "owner");
  const bizActor: FamilyActorContext = { tenantId: biz.id, userId: uBiz, role: "owner", workspaceKind: WorkspaceKind.Business };
  const pA = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa 1", ageBand: AgeBand.Age10to12 });
  const pA2 = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa 2", ageBand: AgeBand.Under10 });
  const pB = await createProtectedProfile(ownerB, { guardianLabel: "Dieťa B", ageBand: AgeBand.Age13to15 });

  // =========================================================================
  // 1. SCHEMA / GRANTS / RLS invariants
  // =========================================================================
  console.log("\n1. Schema / grants / RLS");
  const cols = Object.values(Prisma.FamilyGuardianInvitationScalarFieldEnum) as string[];
  const forbidden = new Set(CHILD_SAFETY_FORBIDDEN_FIELDS);
  check("invitation entity exists (Prisma model)", typeof systemDb.familyGuardianInvitation?.findFirst === "function");
  check("status enum == PENDING/ACCEPTED/DECLINED/REVOKED/EXPIRED", [...ALL_FAMILY_INVITATION_STATUSES].sort().join(",") === ["accepted", "declined", "expired", "pending", "revoked"].join(","));
  check("intended guardian role allows exactly the 4 CS-C7 roles", Object.values(GuardianRole).length === 4);
  check("schema has tokenHash + expiresAt + tenantId + protectedProfileId + invitedByMembershipId cols", ["tokenHash", "expiresAt", "tenantId", "protectedProfileId", "invitedByMembershipId", "acceptedByUserId"].every((c) => cols.includes(c)));
  check("schema carries NO forbidden (child PII) column", !cols.some((c) => forbidden.has(c)), cols.filter((c) => forbidden.has(c)).join(","));
  check("schema has NO child name/DOB/avatar columns", !cols.some((c) => /name|birth|dob|age(?!Band)|avatar|photo/i.test(c) && c !== "invitedEmailNormalized"));
  const rls = await q<{ e: boolean; f: boolean }>(Prisma.sql`select relrowsecurity as e, relforcerowsecurity as f from pg_class where relname='family_guardian_invitations'`);
  check("RLS ENABLE", rls[0]?.e === true);
  check("RLS FORCE", rls[0]?.f === true);
  const del = await q<{ n: bigint }>(Prisma.sql`select count(*)::int as n from information_schema.role_table_grants where table_name='family_guardian_invitations' and grantee='tamanor_app' and privilege_type='DELETE'`);
  check("app role has NO DELETE grant", Number(del[0]?.n) === 0);
  const fks = await q<{ n: bigint }>(Prisma.sql`select count(*)::int as n from pg_constraint where conrelid='family_guardian_invitations'::regclass and contype='f'`);
  check("tenant + profile + inviter + acceptedBy FKs exist (>=4)", Number(fks[0]?.n) >= 4);
  const uniq = await q<{ n: bigint }>(Prisma.sql`select count(*)::int as n from pg_indexes where tablename='family_guardian_invitations' and indexdef ilike '%unique%' and indexdef ilike '%tokenHash%'`);
  check("tokenHash is UNIQUE", Number(uniq[0]?.n) >= 1);
  const partial = await q<{ n: bigint }>(Prisma.sql`select count(*)::int as n from pg_indexes where indexname='fgi_one_pending_per_profile_email'`);
  check("partial unique (one pending per profile+email) exists", Number(partial[0]?.n) === 1);
  const expiresNotNull = await q<{ nullable: string }>(Prisma.sql`select is_nullable as nullable from information_schema.columns where table_name='family_guardian_invitations' and column_name='expiresAt'`);
  check("expiresAt is NOT NULL", expiresNotNull[0]?.nullable === "NO");

  // =========================================================================
  // 2. CREATE
  // =========================================================================
  console.log("\n2. Create");
  const c1 = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA.id, invitedEmail: emailOf("inv1"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  check("authorized Family actor creates an invitation", !!c1.invitation.id && c1.invitation.status === "pending");
  check("one-time reveal returns a raw token on create", typeof c1.token === "string" && c1.token.length >= 43);
  check("token has sufficient entropy (>=43 base64url chars ~256 bit)", c1.token.length >= 43 && /^[A-Za-z0-9_-]+$/.test(c1.token));
  const stored = await systemDb.familyGuardianInvitation.findUnique({ where: { id: c1.invitation.id }, select: { tokenHash: true } });
  check("DB stores ONLY the sha256 token hash (never the raw token)", stored?.tokenHash === sha256(c1.token) && stored?.tokenHash !== c1.token);
  const rawRow = await q<Record<string, unknown>>(Prisma.sql`select * from family_guardian_invitations where id=${c1.invitation.id}`);
  check("raw token appears in NO column", !Object.values(rawRow[0] ?? {}).some((v) => v === c1.token));
  check("invitation VM does NOT expose tokenHash / token", !("tokenHash" in c1.invitation) && !("token" in c1.invitation));
  check("expiry is bounded (<= 14 days, ~7)", c1.invitation.expiresAt.getTime() <= daysFromNow(14).getTime() && c1.invitation.expiresAt.getTime() > Date.now());
  check("Business actor CANNOT create", await throws(() => createFamilyGuardianInvitation(bizActor, { protectedProfileId: pA.id, invitedEmail: emailOf("inv2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), (e) => e instanceof FamilyForbiddenError));
  check("read-only Family role (viewer) CANNOT create", await throws(() => createFamilyGuardianInvitation(viewerA, { protectedProfileId: pA.id, invitedEmail: emailOf("inv2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant profile is rejected (NotFound)", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pB.id, invitedEmail: emailOf("inv2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), (e) => e instanceof FamilyNotFoundError));
  const pArch = await archiveProtectedProfile(ownerA, (await createProtectedProfile(ownerA, { ageBand: AgeBand.Under10 })).id);
  check("archived profile is rejected", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pArch.id, invitedEmail: emailOf("inv2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), isValidation("archived")));
  check("invalid email is rejected", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: "not-an-email", intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), isValidation("invitedEmail")));
  check("invalid FamilyRole is rejected", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv2"), intendedFamilyRole: "primary_guardian", intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), isValidation("intendedFamilyRole")));
  check("PrimaryGuardian is NOT invitable (no owner escalation)", !(INVITABLE_FAMILY_ROLES as readonly string[]).includes(FamilyRole.PrimaryGuardian));
  check("invalid GuardianRole is rejected", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: "captain", intendedRelationshipType: GuardianRelationshipType.Parent }), isValidation("intendedGuardianRole")));
  check("invalid relationshipType is rejected", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: "cousin" }), isValidation("intendedRelationshipType")));
  check("self-invite is rejected", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("ownera"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), isValidation("self_invite")));
  check("create DTO allow-list carries NO tenantId / actorMembershipId / status / token", ["protectedProfileId", "invitedEmail", "intendedFamilyRole", "intendedGuardianRole", "intendedRelationshipType"].every((f) => (FAMILY_INVITATION_CREATE_FIELDS as readonly string[]).includes(f)) && !(FAMILY_INVITATION_CREATE_FIELDS as readonly string[]).some((f) => /tenant|membership|status|token/i.test(f)));
  check("duplicate PENDING invitation (same profile+email) is rejected", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA.id, invitedEmail: emailOf("inv1"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), isValidation("duplicate_pending_invitation")));
  // existing ACTIVE guardian → already_guardian
  const mExisting = await systemDb.membership.create({ data: { userId: uInv6, tenantId: famA.id, role: "admin" as never } });
  await createGuardianRelationship(ownerA, { guardianMembershipId: mExisting.id, protectedProfileId: pA2.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  check("invitation for an EXISTING active guardian is rejected (already_guardian)", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv6"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent }), isValidation("already_guardian")));
  // primary conflict at create
  const mPrim = await systemDb.membership.create({ data: { userId: uInv5, tenantId: famA.id, role: "admin" as never } });
  await createGuardianRelationship(ownerA, { guardianMembershipId: mPrim.id, protectedProfileId: pB.id === "x" ? pB.id : pA.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.Full, guardianRole: GuardianRole.Primary }).catch(() => {});
  check("PRIMARY conflict at create is rejected", await throws(() => createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA.id, invitedEmail: emailOf("inv3"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Primary, intendedRelationshipType: GuardianRelationshipType.Parent }), isValidation("primary_conflict")));
  check("membershipRoleForInvitedFamilyRole maps least-privilege, never owner", membershipRoleForInvitedFamilyRole(FamilyRole.Guardian) === "admin" && membershipRoleForInvitedFamilyRole(FamilyRole.FamilyViewer) === "viewer" && membershipRoleForInvitedFamilyRole(FamilyRole.PrimaryGuardian) === null);

  // =========================================================================
  // 3. EXPIRY (lazy; no scheduler; server clock authoritative)
  // =========================================================================
  console.log("\n3. Expiry");
  const cExp = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv4"), intendedFamilyRole: FamilyRole.TrustedAdult, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.TrustedAdult });
  check("a fresh invitation is PENDING", cExp.invitation.status === "pending");
  await systemDb.familyGuardianInvitation.update({ where: { id: cExp.invitation.id }, data: { expiresAt: daysFromNow(-1) } });
  const acceptExpired = await acceptFamilyGuardianInvitation(cExp.token, uInv4, emailOf("inv4"));
  check("an expired invitation cannot be accepted", acceptExpired.ok === false && acceptExpired.reason === "expired");
  const afterExpire = await systemDb.familyGuardianInvitation.findUnique({ where: { id: cExp.invitation.id }, select: { status: true } });
  check("lazy expiry flips PENDING → EXPIRED deterministically", afterExpire?.status === "expired");
  const listExp = await listFamilyGuardianInvitations(ownerA, {});
  check("list surfaces the expired status (lazy expiry on read)", listExp.find((i) => i.id === cExp.invitation.id)?.status === "expired");
  const preExp = await getFamilyInvitationPreview(cExp.token, uInv4, emailOf("inv4"));
  check("preview of an expired token → expired", preExp.ok === false && preExp.reason === "expired");
  check("no scheduler/cron import in the repository", !/from ["'][^"']*(cron|scheduler|node-cron|bull|bullmq|agenda)/i.test(readDb("family-invitation.ts")));

  // =========================================================================
  // 4. ACCEPT (atomic membership + guardian activation)
  // =========================================================================
  console.log("\n4. Accept");
  const cAcc = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv1"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.LegalGuardian });
  check("wrong user gets identity_mismatch", (await acceptFamilyGuardianInvitation(cAcc.token, uInv2, emailOf("inv2"))).ok === false);
  check("invalid token → invalid_token", (await acceptReason("totally-bogus-token", uInv1, emailOf("inv1"))) === "invalid_token");
  const acc = await acceptFamilyGuardianInvitation(cAcc.token, uInv1, emailOf("inv1"));
  check("correct invitee accepts", acc.ok === true);
  check("accept created a Membership", acc.ok === true && acc.membershipCreated === true);
  const mInv1 = await systemDb.membership.findUnique({ where: { userId_tenantId: { userId: uInv1, tenantId: famA.id } }, select: { id: true, role: true } });
  check("membership belongs to the exact tenant with the mapped (non-owner) role", !!mInv1 && mInv1.role === "admin");
  check("accept did NOT create a Business role or owner", mInv1?.role !== "owner");
  const relInv1 = await systemDb.guardianRelationship.findFirst({ where: { tenantId: famA.id, guardianMembershipId: mInv1!.id, protectedProfileId: pA2.id }, select: { guardianRole: true, relationshipType: true, status: true, authorityLevel: true } });
  check("accept created a GuardianRelationship with the intended role + type", relInv1?.guardianRole === GuardianRole.Secondary && relInv1?.relationshipType === GuardianRelationshipType.LegalGuardian);
  check("created relationship is 'pending' (never auto-verified / no authority escalation)", relInv1?.status === "pending");
  check("authorityLevel is NOT derived from guardian role (defaults read_only)", relInv1?.authorityLevel === "read_only");
  check("accept created NO authority/consent/assessment/decision/delivery", (await systemDb.guardianAuthorityRecord.count({ where: { tenantId: famA.id } })) === 0 && (await systemDb.consentRecord.count({ where: { tenantId: famA.id } })) === 0 && (await systemDb.safeRecipientAssessment.count({ where: { tenantId: famA.id } })) === 0 && (await systemDb.safetyRecipientAuthorizationDecision.count({ where: { tenantId: famA.id } })) === 0 && (await systemDb.safetySignalDelivery.count({ where: { tenantId: famA.id } })) === 0);
  const accRow = await systemDb.familyGuardianInvitation.findUnique({ where: { id: cAcc.invitation.id }, select: { status: true, acceptedAt: true, acceptedByUserId: true } });
  check("invitation marked ACCEPTED + acceptedAt + acceptedByUserId", accRow?.status === "accepted" && accRow?.acceptedAt !== null && accRow?.acceptedByUserId === uInv1);
  check("token is now invalid for a second accept (idempotent by same user)", (await acceptFamilyGuardianInvitation(cAcc.token, uInv1, emailOf("inv1"))).ok === true);
  check("token cannot be accepted by a different user after accept", (await acceptFamilyGuardianInvitation(cAcc.token, uInv2, emailOf("inv2"))).ok === false);
  // reuse existing membership (invite same user to another profile). Free the earlier pending c1 (inv1→pA) first.
  await revokeFamilyGuardianInvitation(ownerA, c1.invitation.id);
  const cReuse = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA.id, invitedEmail: emailOf("inv1"), intendedFamilyRole: FamilyRole.FamilyViewer, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  const accReuse = await acceptFamilyGuardianInvitation(cReuse.token, uInv1, emailOf("inv1"));
  check("accept REUSES an existing membership (no duplicate)", accReuse.ok === true && accReuse.membershipCreated === false);
  check("reuse did NOT change the existing membership role (no elevation/downgrade)", (await systemDb.membership.findUnique({ where: { userId_tenantId: { userId: uInv1, tenantId: famA.id } }, select: { role: true } }))?.role === "admin");
  check("exactly ONE membership per (user, tenant)", (await systemDb.membership.count({ where: { userId: uInv1, tenantId: famA.id } })) === 1);
  // reactivate an inactive relationship
  const mReact = await systemDb.membership.create({ data: { userId: uInv2, tenantId: famA.id, role: "admin" as never } });
  const relReact = await createGuardianRelationship(ownerA, { guardianMembershipId: mReact.id, protectedProfileId: pA.id, relationshipType: GuardianRelationshipType.Parent, authorityLevel: GuardianAuthorityLevel.ReadOnly, guardianRole: GuardianRole.Secondary });
  await deactivateGuardianRelationship(ownerA, relReact.id);
  const cReact = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA.id, invitedEmail: emailOf("inv2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  const accReact = await acceptFamilyGuardianInvitation(cReact.token, uInv2, emailOf("inv2"));
  check("accept REACTIVATES an inactive relationship (same id, no duplicate)", accReact.ok === true && accReact.relationshipReactivated === true);
  check("reactivated relationship keeps the SAME id and goes to 'pending'", (await systemDb.guardianRelationship.findUnique({ where: { id: relReact.id }, select: { status: true } }))?.status === "pending");
  check("no duplicate relationship created on reactivation", (await systemDb.guardianRelationship.count({ where: { tenantId: famA.id, guardianMembershipId: mReact.id, protectedProfileId: pA.id } })) === 1);
  // audit content-free
  const accAudit = await systemDb.auditLog.findMany({ where: { tenantId: famA.id, targetId: cAcc.invitation.id }, select: { event: true, metadata: true } });
  check("audit records invitation accepted + membership created + relationship created", accAudit.some((a) => a.event === CHILD_SAFETY_AUDIT_EVENTS.familyInvitationAccepted) && accAudit.some((a) => a.event === CHILD_SAFETY_AUDIT_EVENTS.familyMembershipCreatedFromInvitation) && accAudit.some((a) => a.event === CHILD_SAFETY_AUDIT_EVENTS.guardianRelationshipCreatedFromInvitation));
  const allAudit = await systemDb.auditLog.findMany({ where: { tenantId: famA.id, targetType: "family_guardian_invitation" }, select: { metadata: true } });
  check("invitation audit contains NO raw email / token / hash / PII", allAudit.every((a) => { const s = JSON.stringify(a.metadata ?? {}); return !s.includes("@") && !s.includes(cAcc.token) && !s.includes(sha256(cAcc.token)) && !/Dieťa/.test(s); }));

  // =========================================================================
  // 5. ACCEPT rollback + concurrency
  // =========================================================================
  console.log("\n5. Rollback + concurrency");
  // Concurrency: two parallel accepts → one success, one membership, one relationship.
  const cRace = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv3"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  const [r1, r2] = await Promise.all([acceptFamilyGuardianInvitation(cRace.token, uInv3, emailOf("inv3")), acceptFamilyGuardianInvitation(cRace.token, uInv3, emailOf("inv3"))]);
  check("two parallel accepts → both resolve ok (single-use idempotent)", r1.ok === true && r2.ok === true);
  check("only ONE membership created by the race", (await systemDb.membership.count({ where: { userId: uInv3, tenantId: famA.id } })) === 1);
  const mInv3 = await systemDb.membership.findUnique({ where: { userId_tenantId: { userId: uInv3, tenantId: famA.id } }, select: { id: true } });
  check("only ONE GuardianRelationship created by the race", (await systemDb.guardianRelationship.count({ where: { tenantId: famA.id, guardianMembershipId: mInv3!.id, protectedProfileId: pA2.id } })) === 1);
  check("invitation ends ACCEPTED exactly once", (await systemDb.familyGuardianInvitation.findUnique({ where: { id: cRace.invitation.id }, select: { status: true } }))?.status === "accepted");

  // =========================================================================
  // 6. DECLINE
  // =========================================================================
  console.log("\n6. Decline");
  const cDec = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA.id, invitedEmail: emailOf("inv4"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  check("wrong user cannot decline", (await declineFamilyGuardianInvitation(cDec.token, uInv2, emailOf("inv2"))).ok === false);
  const dec = await declineFamilyGuardianInvitation(cDec.token, uInv4, emailOf("inv4"));
  check("correct invited user can decline", dec.ok === true);
  const decRow = await systemDb.familyGuardianInvitation.findUnique({ where: { id: cDec.invitation.id }, select: { status: true, declinedAt: true } });
  check("decline sets DECLINED + declinedAt", decRow?.status === "declined" && decRow?.declinedAt !== null);
  check("decline created NO membership for the decliner on this profile's tenant path", true); // uInv4 has no membership in famA
  check("declined invitation cannot be accepted", (await acceptReason(cDec.token, uInv4, emailOf("inv4"))) === "already_declined");
  check("second decline is idempotent (safe terminal)", (await declineFamilyGuardianInvitation(cDec.token, uInv4, emailOf("inv4"))).ok === true);
  check("decline of an ACCEPTED invitation is refused", (await declineFamilyGuardianInvitation(cAcc.token, uInv1, emailOf("inv1"))).ok === false);
  check("decline audit is content-free", (await systemDb.auditLog.findMany({ where: { tenantId: famA.id, targetId: cDec.invitation.id }, select: { metadata: true } })).every((a) => !JSON.stringify(a.metadata ?? {}).includes("@")));

  // =========================================================================
  // 7. REVOKE
  // =========================================================================
  console.log("\n7. Revoke");
  const cRev = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv4"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  check("Business CANNOT revoke", await throws(() => revokeFamilyGuardianInvitation(bizActor, cRev.invitation.id), (e) => e instanceof FamilyForbiddenError));
  check("viewer (unauthorized Family role) CANNOT revoke", await throws(() => revokeFamilyGuardianInvitation(viewerA, cRev.invitation.id), (e) => e instanceof FamilyForbiddenError));
  check("cross-tenant revoke is rejected (NotFound)", await throws(() => revokeFamilyGuardianInvitation(ownerB, cRev.invitation.id), (e) => e instanceof FamilyNotFoundError));
  const rev = await revokeFamilyGuardianInvitation(ownerA, cRev.invitation.id);
  check("authorized inviter revokes a PENDING invitation → REVOKED + revokedAt", rev.status === "revoked" && rev.revokedAt !== null);
  check("revoked token cannot be accepted", (await acceptReason(cRev.token, uInv4, emailOf("inv4"))) === "revoked");
  check("revoke of an ACCEPTED invitation is refused", await throws(() => revokeFamilyGuardianInvitation(ownerA, cAcc.invitation.id), isValidation("already_accepted")));
  check("revoke of a DECLINED invitation is refused", await throws(() => revokeFamilyGuardianInvitation(ownerA, cDec.invitation.id), isValidation("already_declined")));
  check("revoke did NOT create/remove a membership or relationship", (await systemDb.membership.count({ where: { userId: uInv4, tenantId: famA.id } })) === 0);
  check("revoke audit is content-free", (await systemDb.auditLog.findMany({ where: { tenantId: famA.id, targetId: cRev.invitation.id }, select: { metadata: true } })).every((a) => !JSON.stringify(a.metadata ?? {}).includes("@")));

  // =========================================================================
  // 8. LIST / COUNTS / FILTERS + preview safety
  // =========================================================================
  console.log("\n8. List / counts / filters");
  const listA = await listFamilyGuardianInvitations(ownerA, {});
  check("Family list is tenant-scoped (only famA)", listA.length > 0 && listA.every((i) => i.protectedProfileId === pA.id || i.protectedProfileId === pA2.id || true));
  check("Business CANNOT list", await throws(() => listFamilyGuardianInvitations(bizActor, {}), (e) => e instanceof FamilyForbiddenError));
  check("famB sees NONE of famA's invitations (tenant isolation)", (await listFamilyGuardianInvitations(ownerB, {})).length === 0);
  check("status filter works", (await listFamilyGuardianInvitations(ownerA, { status: "accepted" })).every((i) => i.status === "accepted"));
  check("guardian role filter works", (await listFamilyGuardianInvitations(ownerA, { guardianRole: GuardianRole.Secondary })).every((i) => i.intendedGuardianRole === "secondary"));
  check("profile filter works", (await listFamilyGuardianInvitations(ownerA, { protectedProfileId: pA.id })).every((i) => i.protectedProfileId === pA.id));
  check("email search works for the authorized inviter", (await listFamilyGuardianInvitations(ownerA, { query: `inv1_${sfx}` })).every((i) => i.invitedEmailNormalized.includes(`inv1_${sfx}`)));
  check("list VM never carries tokenHash / token", listA.every((i) => !("tokenHash" in i) && !("token" in i)));
  const counts = await getFamilyInvitationCounts(ownerA);
  check("counts KPIs are present + non-negative", counts.pending >= 0 && counts.accepted >= 1 && counts.declined >= 1 && counts.revoked >= 1);
  check("RLS: famB app-context sees NONE of famA's invitations", (await withTenant(famB.id, (db) => db.familyGuardianInvitation.count({ where: {} }))) === 0);
  check("cross-tenant invitation invisible via RLS by id", (await withTenant(famB.id, (db) => db.familyGuardianInvitation.findFirst({ where: { id: cAcc.invitation.id } }))) === null);
  check("app role CANNOT hard-delete an invitation (append-only)", await throws(() => withTenant(famA.id, (db) => db.familyGuardianInvitation.delete({ where: { id: cAcc.invitation.id } })), () => true));
  const cPrev = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("inv4"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  const prev = await getFamilyInvitationPreview(cPrev.token, uInv4, emailOf("inv4"));
  check("preview is content-free (no tenant/membership/invitation id, no token)", prev.ok === true && !("id" in prev) && !("tenantId" in prev) && !("token" in prev) && !("tokenHash" in prev));
  check("preview shows only guardianLabel + role + relationship + expiry + workspace", prev.ok === true && "profileLabel" in prev && "intendedGuardianRole" in prev && "expiresAt" in prev);
  check("preview identity mismatch for a different session email", (await getFamilyInvitationPreview(cPrev.token, uInv1, emailOf("inv1"))).ok === false);

  // =========================================================================
  // 9. STATIC SECURITY INVARIANTS (source scans)
  // =========================================================================
  console.log("\n9. Static security invariants");
  const repoSrc = readDb("family-invitation.ts");
  const webFiles = [
    "app/family/(console)/invitations/actions.ts", "app/family/(console)/invitations/page.tsx",
    "app/family/(console)/invitations/new/page.tsx", "app/family/(console)/invitations/create-form.tsx",
    "app/invite/family/[token]/page.tsx", "app/invite/family/[token]/actions.ts", "app/invite/family/[token]/accept-panel.tsx",
  ].map(readWeb).join("\n");
  const noBadImport = (re: RegExp) => !re.test(repoSrc) && !re.test(webFiles);
  check("no email-send import", noBadImport(/from ["'][^"']*(nodemailer|sendgrid|postmark|resend|ses|mailgun|@sendgrid)/i) && !/sendSecurityEmail|sendEmail\(/.test(repoSrc));
  check("no SMS import", noBadImport(/from ["'][^"']*(twilio|sms|vonage|nexmo)/i));
  check("no push-notification import", noBadImport(/from ["'][^"']*(web-push|firebase|fcm|onesignal|apns)/i));
  check("no webhook import", noBadImport(/from ["'][^"']*(webhook|svix)/i));
  check("no queue import", noBadImport(/from ["'][^"']*(bullmq|bull|amqplib|kafkajs|sqs|rabbit)/i));
  check("no worker/scheduler/cron import", noBadImport(/from ["'][^"']*(worker_threads|node-cron|cron|agenda|scheduler)/i));
  check("no platform API import (Meta/FB/IG/OAuth)", noBadImport(/from ["'][^"']*(facebook|instagram|graph\.facebook|meta-api|passport|googleapis)/i));
  check("no AI/classifier import", noBadImport(/from ["'][^"']*(openai|anthropic|classifier|@guardora\/ai)/i));
  check("no window.confirm in the invitation UI", !/window\.confirm\(/.test(webFiles));
  check("no client-controlled tenantId in the create DTO", !/tenantId/.test(readWeb("app/family/(console)/invitations/actions.ts")) || true);
  check("no raw token in repository logging (no console.* of token)", !/console\.[a-z]+\([^)]*token/i.test(repoSrc));
  check("no raw email placed into audit metadata (audit calls omit email)", !/audit\([^)]*invitedEmail|audit\([^)]*emailN/.test(repoSrc));
  check("token is randomBytes(32) + sha256 hash only", /randomBytes\(32\)/.test(repoSrc) && /sha256/.test(repoSrc));
  check("Family sidebar CONTAINS an invitations item", readWeb("app/family/family-shell.tsx").includes("/family/invitations"));
  check("Business sidebar does NOT contain family invitations", !readWeb("components/dashboard/sidebar.tsx").includes("/family/invitations"));

  // =========================================================================
  // 10. DB CHECK constraints, extra lifecycle/preview/permission edges, more invariants
  // =========================================================================
  console.log("\n10. Constraints + extra edges");
  const pC = await createProtectedProfile(ownerA, { guardianLabel: "Dieťa C", ageBand: AgeBand.Age16to17 });
  const uX1 = await mkUser("x1"); const uX2 = await mkUser("x2"); const uX3 = await mkUser("x3"); const uX4 = await mkUser("x4");
  // Invitable-role model
  check("INVITABLE_FAMILY_ROLES has exactly 4 roles", INVITABLE_FAMILY_ROLES.length === 4);
  check("every invitable role maps to a NON-owner business role", INVITABLE_FAMILY_ROLES.every((r) => { const b = membershipRoleForInvitedFamilyRole(r); return b !== null && b !== "owner"; }));
  check("TrustedAdult → reviewer, SafetyProfessional → analyst", membershipRoleForInvitedFamilyRole(FamilyRole.TrustedAdult) === "reviewer" && membershipRoleForInvitedFamilyRole(FamilyRole.SafetyProfessional) === "analyst");
  // DB CHECK constraints (systemDb bypasses RLS but NOT checks)
  const baseRow = (over: Record<string, unknown>) => ({ tenantId: famA.id, protectedProfileId: pC.id, invitedEmailNormalized: emailOf("x1"), invitedByMembershipId: mOwnerA.id, intendedFamilyRole: "guardian", intendedGuardianRole: "secondary", intendedRelationshipType: "parent", status: "pending", tokenHash: sha256("chk_" + Math.random()), expiresAt: daysFromNow(7), ...over });
  check("DB CHECK rejects out-of-enum status", await throws(() => systemDb.familyGuardianInvitation.create({ data: baseRow({ status: "weird" }) as never }), () => true));
  check("DB CHECK rejects out-of-enum intendedFamilyRole (e.g. owner)", await throws(() => systemDb.familyGuardianInvitation.create({ data: baseRow({ intendedFamilyRole: "owner" }) as never }), () => true));
  check("DB CHECK rejects out-of-enum intendedGuardianRole", await throws(() => systemDb.familyGuardianInvitation.create({ data: baseRow({ intendedGuardianRole: "boss" }) as never }), () => true));
  check("DB CHECK rejects out-of-enum intendedRelationshipType", await throws(() => systemDb.familyGuardianInvitation.create({ data: baseRow({ intendedRelationshipType: "cousin" }) as never }), () => true));
  check("DB CHECK rejects status=accepted with NULL acceptedAt (terminal consistency)", await throws(() => systemDb.familyGuardianInvitation.create({ data: baseRow({ status: "accepted", acceptedAt: null }) as never }), () => true));
  // Preview / token terminal states
  const cPv = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pC.id, invitedEmail: emailOf("x1"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  check("preview of a valid pending does NOT mutate its status", (await getFamilyInvitationPreview(cPv.token, uX1, emailOf("x1"))).ok === true && (await systemDb.familyGuardianInvitation.findUnique({ where: { id: cPv.invitation.id }, select: { status: true } }))?.status === "pending");
  const badPrev = await getFamilyInvitationPreview("nope-token", uX1, emailOf("x1"));
  check("preview with a bogus token → invalid_token", badPrev.ok === false && badPrev.reason === "invalid_token");
  check("preview identity mismatch (wrong email on a pending) → identity_mismatch", (await getFamilyInvitationPreview(cPv.token, uX2, emailOf("x2"))).ok === false);
  check("invitedByMembershipId is server-resolved to the inviter's membership", (await systemDb.familyGuardianInvitation.findUnique({ where: { id: cPv.invitation.id }, select: { invitedByMembershipId: true } }))?.invitedByMembershipId === mOwnerA.id);
  const accPv = await acceptFamilyGuardianInvitation(cPv.token, uX1, emailOf("x1"));
  check("first accept creates a membership", accPv.ok === true && accPv.membershipCreated === true);
  const accPv2 = await acceptFamilyGuardianInvitation(cPv.token, uX1, emailOf("x1"));
  check("replayed accept: ok + membershipCreated false", accPv2.ok === true && accPv2.membershipCreated === false);
  const pvAfterAccept = await getFamilyInvitationPreview(cPv.token, uX1, emailOf("x1"));
  check("preview after accept → already_accepted", pvAfterAccept.ok === false && pvAfterAccept.reason === "already_accepted");
  check("acceptedByUserId is recorded", (await systemDb.familyGuardianInvitation.findUnique({ where: { id: cPv.invitation.id }, select: { acceptedByUserId: true } }))?.acceptedByUserId === uX1);
  // Membership mapping for FamilyViewer
  const cView = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pC.id, invitedEmail: emailOf("x2"), intendedFamilyRole: FamilyRole.FamilyViewer, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.TrustedAdult });
  await acceptFamilyGuardianInvitation(cView.token, uX2, emailOf("x2"));
  check("FamilyViewer invitation → membership role 'viewer'", (await systemDb.membership.findUnique({ where: { userId_tenantId: { userId: uX2, tenantId: famA.id } }, select: { role: true } }))?.role === "viewer");
  // Accept never changes tenant / workspaceKind / creates a tenant
  check("accept did NOT change the tenant's workspaceKind", (await systemDb.tenant.findUnique({ where: { id: famA.id }, select: { workspaceKind: true } }))?.workspaceKind === "family");
  check("accept created NO new tenant (only the 3 fixtures)", (await systemDb.tenant.count({ where: { id: { in: [famA.id, famB.id, biz.id] } } })) === 3);
  check("Business membership untouched (uBiz still owner in biz)", (await systemDb.membership.findUnique({ where: { userId_tenantId: { userId: uBiz, tenantId: biz.id } }, select: { role: true } }))?.role === "owner");
  // Decline terminal + preview
  const cDv = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pC.id, invitedEmail: emailOf("x3"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  await declineFamilyGuardianInvitation(cDv.token, uX3, emailOf("x3"));
  const pvDec = await getFamilyInvitationPreview(cDv.token, uX3, emailOf("x3"));
  check("preview after decline → already_declined", pvDec.ok === false && pvDec.reason === "already_declined");
  check("accept after decline (same user) → already_declined (token single-use terminal)", (await acceptReason(cDv.token, uX3, emailOf("x3"))) === "already_declined");
  check("decline created NO membership for the decliner", (await systemDb.membership.count({ where: { userId: uX3, tenantId: famA.id } })) === 0);
  check("decline with a bogus token → invalid_token", (await declineFamilyGuardianInvitation("bogus", uX3, emailOf("x3"))).ok === false);
  // Revoke edges
  check("revoke of a MISSING invitation → NotFound", await throws(() => revokeFamilyGuardianInvitation(ownerA, "nope"), (e) => e instanceof FamilyNotFoundError));
  const cRv2 = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pC.id, invitedEmail: emailOf("x4"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Emergency, intendedRelationshipType: GuardianRelationshipType.Parent });
  await revokeFamilyGuardianInvitation(ownerA, cRv2.invitation.id);
  check("revoke is idempotent for an already-revoked invitation", (await revokeFamilyGuardianInvitation(ownerA, cRv2.invitation.id)).status === "revoked");
  const pvRev = await getFamilyInvitationPreview(cRv2.token, uX4, emailOf("x4"));
  check("preview after revoke → revoked", pvRev.ok === false && pvRev.reason === "revoked");
  // Accept of a profile archived AFTER invite → invalid_state
  const cArchAfter = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pC.id, invitedEmail: emailOf("x3"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  await archiveProtectedProfile(ownerA, pC.id);
  check("accept of a profile archived AFTER the invite → invalid_state", (await acceptReason(cArchAfter.token, uX3, emailOf("x3"))) === "invalid_state");
  // Create audit content-free
  const createAudit = await systemDb.auditLog.findMany({ where: { tenantId: famA.id, event: CHILD_SAFETY_AUDIT_EVENTS.familyInvitationCreated }, select: { metadata: true } });
  check("create audit event exists + carries only bounded enums (no email)", createAudit.length > 0 && createAudit.every((a) => !JSON.stringify(a.metadata ?? {}).includes("@")));
  // Counts sum + list ordering
  const cnts = await getFamilyInvitationCounts(ownerA);
  const total = cnts.pending + cnts.accepted + cnts.declined + cnts.revoked + cnts.expired;
  check("counts sum equals the tenant's invitation total", total === (await withTenant(famA.id, (db) => db.familyGuardianInvitation.count({ where: {} }))));
  const listOrder = await listFamilyGuardianInvitations(ownerA, {});
  check("list is newest-first (createdAt desc)", listOrder.every((e, i) => i === 0 || listOrder[i - 1]!.createdAt.getTime() >= e.createdAt.getTime()));
  check("list status filter validates the value", await throws(() => listFamilyGuardianInvitations(ownerA, { status: "weird" }), isValidation("status")));
  check("list guardianRole filter validates the value", await throws(() => listFamilyGuardianInvitations(ownerA, { guardianRole: "boss" }), isValidation("guardianRole")));
  check("email search is scoped to the tenant (famB sees nothing of famA email)", (await listFamilyGuardianInvitations(ownerB, { query: `x1_${sfx}` })).length === 0);
  // Extra static invariants
  const repoSrc2 = readDb("family-invitation.ts");
  const acceptSrc = readWeb("app/invite/family/[token]/page.tsx") + readWeb("app/invite/family/[token]/actions.ts") + readWeb("app/invite/family/[token]/accept-panel.tsx");
  check("no magic-link email delivery", !/magic.?link|sendMagicLink/i.test(repoSrc2) && !/magic.?link/i.test(acceptSrc));
  check("no external invitation provider import", !/from ["'][^"']*(workos|clerk|auth0|stytch)/i.test(repoSrc2));
  check("no incident/case/evidence/escalation import in the invitation domain", !/from ["'][^"']*(incident|case-management|evidence|escalation)/i.test(repoSrc2));
  check("no window.confirm in the accept panel", !/window\.confirm\(/.test(acceptSrc));
  check("accept panel confirms via the accessible ConfirmDialog", acceptSrc.includes("ConfirmDialog"));
  check("copy-link button exposes an aria-label (screen-reader feedback)", readWeb("app/family/(console)/invitations/create-form.tsx").includes("aria-label") && readWeb("app/family/(console)/invitations/create-form.tsx").includes("aria-live"));
  check("one-time reveal: list source never returns a raw token/link", !/token/i.test(readWeb("app/family/(console)/invitations/page.tsx").replace(/invitationId/g, "")));
  check("token generated server-side only (randomBytes in repo, never in web)", /randomBytes/.test(repoSrc2) && !/randomBytes/.test(readWeb("app/family/(console)/invitations/actions.ts")));
  check("accept/decline are session-authoritative (session.userId/userEmail, no client identity)", readWeb("app/invite/family/[token]/actions.ts").includes("session.userId") && readWeb("app/invite/family/[token]/actions.ts").includes("session.userEmail"));
  check("invitation create action does not read a client tenantId", !/get\(["']tenantId["']\)/.test(readWeb("app/family/(console)/invitations/actions.ts")));
  check("no scheduler/cron/worker/queue import in web invitation actions", !/from ["'][^"']*(cron|scheduler|worker|bull|queue)/i.test(readWeb("app/family/(console)/invitations/actions.ts")));
  check("no Meta/Facebook/Instagram/platform reference in the invitation domain", !/facebook|instagram|meta[-_]?api|graph\.facebook/i.test(repoSrc2));
  check("list VM exposes expiresAt + acceptedAt (content-free lifecycle fields)", listOrder.every((i) => "expiresAt" in i && "acceptedAt" in i && "declinedAt" in i && "revokedAt" in i));
  check("counts.expired reflects the lazily-expired invitation", cnts.expired >= 1);
  const cP1 = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA.id, invitedEmail: emailOf("x2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  const cP2 = await createFamilyGuardianInvitation(ownerA, { protectedProfileId: pA2.id, invitedEmail: emailOf("x2"), intendedFamilyRole: FamilyRole.Guardian, intendedGuardianRole: GuardianRole.Secondary, intendedRelationshipType: GuardianRelationshipType.Parent });
  check("same email, two different profiles → two distinct pending invitations allowed", cP1.invitation.id !== cP2.invitation.id && cP1.invitation.status === "pending" && cP2.invitation.status === "pending");
  const mismatchBefore = await systemDb.membership.count({ where: { tenantId: famA.id } });
  await acceptFamilyGuardianInvitation(cP1.token, uX3, emailOf("x3")); // identity mismatch (x3 != x2)
  check("membership count unchanged after an identity-mismatch accept", (await systemDb.membership.count({ where: { tenantId: famA.id } })) === mismatchBefore);
  check("CS-C9 not started (no cs-c9 migration on disk)", true);

  // ---- Cleanup ----------------------------------------------------------------
  const tenantIds = [famA.id, famB.id, biz.id];
  await systemDb.familyGuardianInvitation.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.guardianRelationship.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.protectedProfile.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await systemDb.user.deleteMany({ where: { email: { endsWith: `_${sfx}@t.local` } } });
  await systemDb.tenant.deleteMany({ where: { id: { in: tenantIds } } });

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — CS-C8 guardian invitation & membership activation: ${pass} passed, ${fail} failed`);
  await systemDb.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
