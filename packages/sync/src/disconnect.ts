/**
 * V1.37.4 / V1.45B — safe connector disconnect lifecycle. read + resolve local token
 * cluster → best-effort provider revoke (HTTP, OUTSIDE any DB tx) → ATOMIC tenant-scoped
 * removal of the WHOLE local token-sharing cluster.
 *
 * A Facebook Page and its linked Instagram Business account SHARE the same Page token
 * (the IG row stores a copy, joined by `parentAccountId`). Clearing only one row would
 * leave the sibling holding a live copy of the same authorization — so disconnecting
 * EITHER member disconnects the whole local cluster. The cluster is derived ONLY from
 * trusted account relationships (`parentAccountId` + platform), NEVER by comparing token
 * values. Local tokens are ALWAYS removed, even if the provider revoke fails/unsupported —
 * a failed/unsupported revoke never blocks local removal and never produces a fake
 * "revoked". Reconnect requires a fresh OAuth flow (the stored token is gone). Any
 * in-flight sync lease is invalidated so a stale sync completion writes zero rows.
 * Tokens are never logged or returned.
 */
import { withTenantDb, decryptToken, type TenantTx } from "@guardora/db";
import { revokeProviderCredentials, type RevokeResult, type RevokeTransport } from "./provider-revoke";

export type DisconnectStatus = "disconnected_local" | "revoked_provider" | "revoke_failed" | "revoke_unsupported";

const META_PLATFORMS = new Set(["facebook_page", "instagram_business"]);

/**
 * A member of a local token-sharing cluster. The ENCRYPTED credential envelopes are carried
 * ONLY as an optimistic-concurrency witness for the final clear (a reconnect writes fresh
 * random-IV ciphertext, so a CAS on these values never clobbers a reconnected lifecycle).
 * They are the values already stored in the DB — never decrypted, logged, returned, or used
 * to *discover* the cluster (which is resolved purely from relationships).
 */
interface ClusterRow {
  id: string;
  platform: string;
  longLivedToken: string | null;
  accessToken: string | null;
}

export interface DisconnectResult {
  account: { id: string; brandId: string; platform: string } | null;
  /** Normalized revoke outcome (for audit + truthful UI copy). */
  revoke: RevokeResult;
  status: DisconnectStatus;
  /** V1.45B — the complete local token-sharing cluster that was invalidated. No tokens. */
  cluster: { accountIds: string[]; count: number; platforms: string[] };
  /** V1.45B — local credentials were removed for every cluster row (always true on success). */
  localCredentialsRemoved: boolean;
  /** V1.45B — truthful provider-side revocation classification (alias of `revoke`). */
  providerRevocation: RevokeResult;
  /**
   * V1.45B — true when the provider authorization may still be valid at Meta and the user
   * should remove Tamanor manually (Meta exposes no per-Page/IG token revoke). Never true
   * when a genuine provider revocation actually succeeded.
   */
  manualCleanupRecommended: boolean;
  /** V1.45B — the resulting local status for every cluster row. */
  resultingStatus: "disconnected";
}

/** Empty cluster shape for the not-found path. */
const NO_CLUSTER = { accountIds: [] as string[], count: 0, platforms: [] as string[] };

/**
 * Resolve the LOCAL token-sharing cluster for a requested account using ONLY trusted
 * relationships (never token comparison). All reads run on the supplied tenant-scoped
 * `db`, so a foreign-tenant parent/child is never reachable (RLS). Bounded and idempotent:
 *
 *  - Facebook Page  → the Page + every Instagram Business child (`parentAccountId` → Page).
 *  - Instagram      → resolve up to the parent Page, then the WHOLE cluster (Page + all its
 *                     IG children). A missing/broken parent link stays BOUNDED to the
 *                     requested IG row (no cross-account expansion).
 *  - Non-Meta       → the requested row only.
 */
async function resolveTokenCluster(
  db: TenantTx,
  acct: { id: string; platform: string; parentAccountId: string | null; longLivedToken: string | null; accessToken: string | null },
): Promise<ClusterRow[]> {
  const self: ClusterRow = { id: acct.id, platform: acct.platform, longLivedToken: acct.longLivedToken, accessToken: acct.accessToken };
  // Non-Meta providers do not share Page tokens across rows → the row itself only.
  if (!META_PLATFORMS.has(acct.platform)) return [self];

  // Find the anchoring Facebook Page account id for this cluster.
  let pageAccountId: string | null = null;
  if (acct.platform === "facebook_page") {
    pageAccountId = acct.id;
  } else if (acct.parentAccountId) {
    const parent = await db.connectedAccount.findFirst({
      where: { id: acct.parentAccountId, platform: "facebook_page" as never },
      select: { id: true },
    });
    pageAccountId = parent?.id ?? null;
  }

  // Broken/missing parent link → safe bounded behavior: the requested IG row only.
  if (!pageAccountId) return [self];

  // The full cluster: the Page + every IG child that references it (same tenant via RLS).
  const sel = { id: true, platform: true, longLivedToken: true, accessToken: true } as const;
  const [page, igChildren] = await Promise.all([
    db.connectedAccount.findFirst({ where: { id: pageAccountId }, select: sel }),
    db.connectedAccount.findMany({
      where: { parentAccountId: pageAccountId, platform: "instagram_business" as never },
      select: sel,
    }),
  ]);

  const rows: ClusterRow[] = [];
  if (page) rows.push({ id: page.id, platform: page.platform as string, longLivedToken: page.longLivedToken, accessToken: page.accessToken });
  for (const c of igChildren) rows.push({ id: c.id, platform: c.platform as string, longLivedToken: c.longLivedToken, accessToken: c.accessToken });
  // Always include the requested row (defensive — e.g. an orphaned child of a since-removed page).
  if (!rows.some((r) => r.id === acct.id)) rows.push(self);

  // De-duplicate by id (idempotent, order-stable).
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/**
 * Disconnect a connected account and its complete local token-sharing cluster.
 * Tenant-scoped (RLS). A foreign/absent id returns `account: null` (not_found — never
 * enumerated). Idempotent: re-disconnecting an already-disconnected cluster is a no-op
 * transition that still reports the truthful classification.
 */
export async function disconnectAccount(
  tenantId: string,
  accountId: string,
  opts?: {
    transport?: RevokeTransport;
    /** Test-only seam: fires AFTER cluster resolve + provider revoke, BEFORE the local clear.
     * Used to deterministically inject a reconnect/sync between the two phases. Never carries data. */
    hooks?: { beforeLocalClear?: () => void | Promise<void> };
  },
): Promise<DisconnectResult> {
  // Phase 1 — tenant read (short tx). Load the requested account + resolve its cluster.
  // Only fields needed for revoke + identity; token fields are decrypted locally only.
  const resolved = await withTenantDb(tenantId, async (db) => {
    const acct = await db.connectedAccount.findFirst({
      where: { id: accountId },
      select: { id: true, brandId: true, platform: true, externalId: true, pageId: true, parentAccountId: true, accessToken: true, longLivedToken: true },
    });
    if (!acct) return null;
    const cluster = await resolveTokenCluster(db, acct);
    return { acct, cluster };
  });
  if (!resolved) {
    return {
      account: null, revoke: "already_invalid", status: "disconnected_local",
      cluster: NO_CLUSTER, localCredentialsRemoved: false, providerRevocation: "already_invalid",
      manualCleanupRecommended: false, resultingStatus: "disconnected",
    };
  }
  const { acct, cluster } = resolved;
  const clusterIds = cluster.map((c) => c.id);

  // Decrypt ONLY here, only to revoke; never logged, never returned. A malformed/invalid
  // ciphertext must NOT reach the provider — treat as no usable token (revoke reports
  // already_invalid) while local cluster removal still proceeds. The whole cluster shares
  // one Page token, so a single revoke attempt covers it.
  let token: string | null = null;
  try {
    token = decryptToken(acct.longLivedToken ?? acct.accessToken) ?? null;
  } catch {
    token = null;
  }

  // Phase 2 — provider HTTP (NO open DB transaction). Best-effort. Meta per-account
  // revocation is unsupported (Meta exposes no single-Page/IG token revoke endpoint) → the
  // adapter returns `unsupported`; we NEVER fabricate a `revoked` result.
  const revoke = await revokeProviderCredentials(
    { platform: acct.platform, accessToken: token, externalAccountId: acct.pageId ?? acct.externalId },
    { transport: opts?.transport },
  );

  // Test-only seam — lets a test commit a reconnect (or a benign sync write) between the
  // resolve/revoke and the local clear, to deterministically prove the CAS below.
  if (opts?.hooks?.beforeLocalClear) await opts.hooks.beforeLocalClear();

  const clearData = {
    accessToken: null,
    longLivedToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    status: "disconnected" as never,
    connectionStatus: "disconnected",
    // Clear any stale health so the row can never read "disconnected" + "healthy".
    health: "unknown" as never,
    tokenHealth: revoke === "revoked" ? "revoked" : "invalid",
    requiresReconnectReason: "disconnected",
    lastError: null,
    lastErrorAt: null,
  };

  // Phase 3 — tenant write (short tx). Remove local credentials for every cluster row.
  // Two invariants enforced here:
  //  (1) LEASE-FIRST lock order (delete leases before clearing accounts) matches the sync
  //      terminal write's order (lock lease → write account), so a concurrent sync can never
  //      DEADLOCK with this clear.
  //  (2) Per-row COMPARE-AND-SWAP on the exact stored credential resolved in Phase 1. A
  //      reconnect writes a NEW random-IV ciphertext, so a reconnected row matches zero rows
  //      and is NEVER clobbered (stale-disconnect-after-reconnect is impossible). A read-only
  //      sync never writes token fields, so it never blocks a legitimate disconnect.
  let requestedRemoved = false;
  await withTenantDb(tenantId, async (db) => {
    // (1) Invalidate leases first — a stale in-flight sync (which locks its lease FOR UPDATE
    // then writes) sees the lease gone and updates zero rows.
    await db.syncLease.deleteMany({ where: { connectedAccountId: { in: clusterIds } } });
    // (2) CAS-guarded clear, one row at a time (clusters are tiny: a Page + its IG children).
    for (const c of cluster) {
      await db.connectedAccount.updateMany({
        where: { id: c.id, longLivedToken: c.longLivedToken, accessToken: c.accessToken },
        data: clearData,
      });
    }
    // Truthful outcome for the REQUESTED account by its FINAL state (not by which call cleared
    // it): a concurrent/idempotent peer disconnect may have removed it first (CAS then matches
    // zero rows here), yet the account is genuinely credential-free — that is still "removed".
    // A reconnect that won the race leaves a fresh non-null credential → correctly reported false.
    const finalReq = await db.connectedAccount.findFirst({
      where: { id: acct.id },
      select: { longLivedToken: true, accessToken: true, refreshToken: true, status: true },
    });
    requestedRemoved = !!finalReq
      && finalReq.longLivedToken === null && finalReq.accessToken === null && finalReq.refreshToken === null
      && (finalReq.status as unknown as string) === "disconnected";
  });

  const status: DisconnectStatus =
    revoke === "revoked" ? "revoked_provider"
      : revoke === "failed" ? "revoke_failed"
        : revoke === "unsupported" ? "revoke_unsupported"
          : "disconnected_local";

  // Recommend manual provider cleanup whenever we removed a Meta authorization LOCALLY
  // without a genuine provider-side revocation (the token may remain valid until expiry).
  const isMeta = META_PLATFORMS.has(acct.platform);
  const manualCleanupRecommended = isMeta && revoke !== "revoked";

  return {
    account: { id: acct.id, brandId: acct.brandId, platform: acct.platform },
    revoke,
    status,
    cluster: { accountIds: clusterIds, count: clusterIds.length, platforms: [...new Set(cluster.map((c) => c.platform))] },
    // Truthful: whether the REQUESTED account is now credential-free + disconnected. False only
    // when a reconnect replaced the credential first — the newer lifecycle is preserved, not clobbered.
    localCredentialsRemoved: requestedRemoved,
    providerRevocation: revoke,
    manualCleanupRecommended,
    resultingStatus: "disconnected",
  };
}
