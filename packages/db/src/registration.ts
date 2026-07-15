import { randomBytes } from "node:crypto";
import { Prisma, Role, BrandTone, BrandStatus } from "@prisma/client";
import { DEFAULT_AUTO_PROTECT_POLICIES } from "@guardora/ai";
import { systemDb } from "./index";

/**
 * V1.50A/B — self-service account provisioning (server-side, system-scoped).
 *
 * A new account — whether from email/password registration OR a first Google/Facebook
 * sign-in — gets the SAME atomic workspace graph: User, Tenant (14-day Free Trial +
 * pending onboarding state), OWNER Membership, a default Brand, and default Auto-Protect
 * policies, all inside ONE transaction. A partial account is never left behind.
 *
 * Identity is single: multiple login providers (password, Google, Facebook) resolve to
 * ONE user (see {@link resolveOAuthLogin}). Duplicate accounts are prevented by DB unique
 * constraints (users.email, oauth_accounts.provider+providerAccountId), not read-checks.
 */

export const FREE_TRIAL_DAYS = 14;
export const FREE_TRIAL_PLAN = "free_trial";

/** Login providers for USER authentication. NOT the Meta Page/Business connector. */
export type OAuthProvider = "google" | "facebook";

/** Thrown when the email is already registered (email/password path). */
export class EmailAlreadyRegisteredError extends Error {
  constructor() { super("email_already_registered"); this.name = "EmailAlreadyRegisteredError"; }
}
/** Thrown when an OAuth provider returns no usable (verified) email — we cannot create/link an identity. */
export class OAuthEmailRequiredError extends Error {
  constructor() { super("oauth_email_required"); this.name = "OAuthEmailRequiredError"; }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function slugifyBase(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

function shortSuffix(): string {
  return randomBytes(4).toString("base64url").replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase() || "w";
}

function isUniqueViolation(e: unknown, target: string): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === "P2002" &&
    JSON.stringify(e.meta?.target ?? "").includes(target)
  );
}

type ProvisionInput = {
  email: string;
  passwordHash: string | null;
  name?: string | null;
  locale: string;
  country?: string | null;
  workspaceName: string;
  brandName: string;
  /** V1.50C — set for OAuth provider-verified emails (start verified); null for email/password. */
  emailVerifiedAt?: Date | null;
  /** When set, link this external identity to the new user in the same transaction. */
  oauth?: { provider: OAuthProvider; providerAccountId: string } | null;
};

/**
 * Atomically create User + Tenant(trial, pending onboarding) + OWNER Membership + default
 * Brand + Auto-Protect policies (+ optional OAuth link). Retries only on the rare slug
 * collision; an email collision is surfaced as {@link EmailAlreadyRegisteredError}.
 */
async function provisionAccount(input: ProvisionInput): Promise<{ userId: string; tenantId: string; trialEndsAt: Date }> {
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const slugBase = slugifyBase(input.workspaceName);

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${slugBase}-${shortSuffix()}`;
    try {
      return await systemDb.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: input.email, passwordHash: input.passwordHash, name: input.name ?? null, locale: input.locale, emailVerifiedAt: input.emailVerifiedAt ?? null },
          select: { id: true },
        });
        const tenant = await tx.tenant.create({
          data: {
            name: input.workspaceName || "Workspace",
            slug,
            plan: FREE_TRIAL_PLAN,
            trialStartsAt: now,
            trialEndsAt,
            country: input.country ?? null,
            onboardingCompletedAt: null,
          },
          select: { id: true },
        });
        await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: Role.owner } });
        const brand = await tx.brand.create({
          data: {
            tenantId: tenant.id,
            name: input.brandName,
            defaultLocale: input.locale,
            timezone: "Europe/Bratislava",
            defaultTone: BrandTone.professional,
            status: BrandStatus.active,
          },
          select: { id: true },
        });
        await tx.brandAutoProtectPolicy.createMany({
          data: DEFAULT_AUTO_PROTECT_POLICIES.map((p) => ({
            tenantId: tenant.id, brandId: brand.id, category: p.category, mode: p.mode, minConfidence: 0.7, isActive: true,
          })),
        });
        if (input.oauth) {
          await tx.oAuthAccount.create({ data: { userId: user.id, provider: input.oauth.provider, providerAccountId: input.oauth.providerAccountId } });
        }
        return { userId: user.id, tenantId: tenant.id, trialEndsAt };
      });
    } catch (e) {
      if (isUniqueViolation(e, "email")) throw new EmailAlreadyRegisteredError();
      if (isUniqueViolation(e, "slug")) continue;
      throw e;
    }
  }
  throw new Error("provisionAccount: could not allocate a unique workspace slug");
}

// ---- Email/password registration -------------------------------------------

export type RegisterInput = {
  email: string;
  /** Already-hashed Argon2id PHC string — this module NEVER sees plaintext. */
  passwordHash: string;
  workspaceName: string;
  company?: string | null;
  country?: string | null;
  locale?: string;
};
export type RegisterResult = { userId: string; tenantId: string; trialEndsAt: Date };

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const workspaceName = input.workspaceName.trim() || "Workspace";
  const brandName = (input.company ?? "").trim() || workspaceName || "My Brand";
  return provisionAccount({
    email,
    passwordHash: input.passwordHash,
    locale: input.locale ?? "en",
    country: (input.country ?? "").trim() || null,
    workspaceName,
    brandName,
  });
}

export async function findUserForLogin(email: string): Promise<{ id: string; passwordHash: string | null } | null> {
  return systemDb.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, passwordHash: true },
  });
}

// ---- OAuth (Google / Facebook) sign-in / linking ---------------------------

export type OAuthLoginInput = {
  provider: OAuthProvider;
  /** Provider's stable subject id (Google `sub`, Facebook user id). */
  providerAccountId: string;
  /** Email from the provider (may be absent for Facebook if not granted). */
  email?: string | null;
  /** Whether the provider asserts the email is verified. Auto-linking REQUIRES this. */
  emailVerified: boolean;
  name?: string | null;
  locale?: string;
};
export type OAuthLoginResult = { userId: string; tenantId: string | null; isNew: boolean };

function deriveWorkspaceName(name: string | null | undefined, email: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed) return trimmed.slice(0, 60);
  const local = email.split("@")[0] ?? "workspace";
  return local.slice(0, 60);
}

/**
 * Resolve a Google/Facebook sign-in to a SINGLE Tamanor identity:
 *   1. Known external identity  → that user (login).
 *   2. Verified email matches an existing user → LINK the provider to that user (no dup).
 *   3. Otherwise → create a new user + workspace + link, atomically (register via OAuth).
 *
 * Auto-linking by email requires a provider-verified email; if the provider gives no
 * usable verified email we cannot safely create/link an identity and throw
 * {@link OAuthEmailRequiredError}. Races are guarded by DB unique constraints.
 */
export async function resolveOAuthLogin(input: OAuthLoginInput): Promise<OAuthLoginResult> {
  const provider = input.provider;
  const providerAccountId = input.providerAccountId;

  // 1) Existing external identity.
  const existing = await systemDb.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    select: { userId: true },
  });
  if (existing) return { userId: existing.userId, tenantId: null, isNew: false };

  // A provider-verified email is required to create OR link an identity safely.
  const email = input.email ? normalizeEmail(input.email) : null;
  if (!email || !input.emailVerified) throw new OAuthEmailRequiredError();

  // 2) Link to an existing user with the same verified email.
  const byEmail = await systemDb.user.findUnique({ where: { email }, select: { id: true, emailVerifiedAt: true } });
  if (byEmail) {
    await systemDb.$transaction(async (tx) => {
      try {
        await tx.oAuthAccount.create({ data: { userId: byEmail.id, provider, providerAccountId } });
      } catch (e) {
        // Concurrent link of the same identity → treat as linked (idempotent).
        if (!isUniqueViolation(e, "provider") && !isUniqueViolation(e, "userId")) throw e;
      }
      // V1.50C — the provider proved ownership of this exact email. If the existing account was
      // NOT yet verified, mark it verified AND invalidate any pre-registration password + sessions
      // (anti account-pre-hijacking: an attacker who set a password on an unverified email must not
      // retain access once the real owner arrives via a provider-verified login). Already-verified
      // accounts keep their password untouched.
      if (byEmail.emailVerifiedAt === null) {
        const now = new Date();
        await tx.user.update({ where: { id: byEmail.id }, data: { emailVerifiedAt: now, passwordHash: null, passwordChangedAt: now } });
        await tx.userSession.updateMany({ where: { userId: byEmail.id, revokedAt: null }, data: { revokedAt: now } });
      }
    });
    return { userId: byEmail.id, tenantId: null, isNew: false };
  }

  // 3) Brand-new identity → new user + workspace + link. Provider-verified → starts verified.
  const workspaceName = deriveWorkspaceName(input.name, email);
  try {
    const res = await provisionAccount({
      email,
      passwordHash: null,
      name: input.name ?? null,
      locale: input.locale ?? "en",
      country: null,
      workspaceName,
      brandName: workspaceName || "My Brand",
      emailVerifiedAt: new Date(),
      oauth: { provider, providerAccountId },
    });
    return { userId: res.userId, tenantId: res.tenantId, isNew: true };
  } catch (e) {
    // A user with this email was created concurrently — fall back to linking.
    if (e instanceof EmailAlreadyRegisteredError) {
      const raced = await systemDb.user.findUnique({ where: { email }, select: { id: true } });
      if (raced) {
        await systemDb.oAuthAccount
          .create({ data: { userId: raced.id, provider, providerAccountId } })
          .catch((err) => { if (!isUniqueViolation(err, "provider") && !isUniqueViolation(err, "userId")) throw err; });
        return { userId: raced.id, tenantId: null, isNew: false };
      }
    }
    throw e;
  }
}

/** Mark a workspace's onboarding as finished (idempotent) so it is not shown again. */
export async function markOnboardingComplete(tenantId: string): Promise<void> {
  await systemDb.tenant.updateMany({
    where: { id: tenantId, onboardingCompletedAt: null },
    data: { onboardingCompletedAt: new Date() },
  });
}
