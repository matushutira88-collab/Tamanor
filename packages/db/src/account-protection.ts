/**
 * V1.59 — per-account MONITORING + PROTECTION resolution and the "monitored account" limit unit.
 *
 * Product model: each Facebook Page and each Instagram Professional account is an INDEPENDENT monitored
 * account (FB + IG = TWO). Protection is resolved as tenant DEFAULTS unless an account OVERRIDES them.
 * Every read/write is tenant-scoped through withTenant (RLS), so a foreign tenant can neither see nor
 * change another tenant's account protection. No token/secret is ever read or logged here.
 */
import { EntitlementError, isWithinLimit } from "@guardora/core";
import type { TenantTx } from "./tenant-db";
import { withTenant } from "./repositories";
import { getTenantEntitlements } from "./billing-repo";
import { acquireTenantResourceLock } from "./resource-limits";

export type AutoHideMode = "recommend" | "manual_approval" | "automatic";
export type RiskThreshold = "medium" | "high" | "critical";

export interface EffectiveProtection {
  monitoringEnabled: boolean;
  autoHideEnabled: boolean;
  autoHideMode: AutoHideMode;
  autoHideRiskThreshold: RiskThreshold;
  autoHideCategories: string[];
  requireManualApproval: boolean;
  /** Where the effective config came from — an account override or the inherited tenant default. */
  source: "account_override" | "tenant_default";
}

interface AccountProtectionFields {
  monitoringEnabled: boolean;
  protectionOverridden: boolean;
  autoHideEnabled: boolean;
  autoHideMode: string;
  autoHideRiskThreshold: string;
  autoHideCategories: string[];
  requireManualApproval: boolean;
}
interface TenantDefaultFields {
  defaultAutoHideEnabled: boolean;
  defaultAutoHideMode: string;
  defaultAutoHideRiskThreshold: string;
  defaultAutoHideCategories: string[];
  defaultRequireManualApproval: boolean;
}

const asMode = (v: string): AutoHideMode => (v === "manual_approval" || v === "automatic" ? v : "recommend");
const asThreshold = (v: string): RiskThreshold => (v === "medium" || v === "critical" ? v : "high");

/** PURE resolution: account override wins; otherwise the tenant default. `monitoringEnabled` is always
 *  the account's own flag (it is not a tenant-default concept). */
export function resolveAccountProtection(account: AccountProtectionFields, defaults: TenantDefaultFields): EffectiveProtection {
  if (account.protectionOverridden) {
    return {
      monitoringEnabled: account.monitoringEnabled,
      autoHideEnabled: account.autoHideEnabled,
      autoHideMode: asMode(account.autoHideMode),
      autoHideRiskThreshold: asThreshold(account.autoHideRiskThreshold),
      autoHideCategories: account.autoHideCategories,
      requireManualApproval: account.requireManualApproval,
      source: "account_override",
    };
  }
  return {
    monitoringEnabled: account.monitoringEnabled,
    autoHideEnabled: defaults.defaultAutoHideEnabled,
    autoHideMode: asMode(defaults.defaultAutoHideMode),
    autoHideRiskThreshold: asThreshold(defaults.defaultAutoHideRiskThreshold),
    autoHideCategories: defaults.defaultAutoHideCategories,
    requireManualApproval: defaults.defaultRequireManualApproval,
    source: "tenant_default",
  };
}

const ACCOUNT_SELECT = {
  id: true, monitoringEnabled: true, protectionOverridden: true, autoHideEnabled: true, autoHideMode: true,
  autoHideRiskThreshold: true, autoHideCategories: true, requireManualApproval: true,
} as const;
const TENANT_SELECT = {
  defaultAutoHideEnabled: true, defaultAutoHideMode: true, defaultAutoHideRiskThreshold: true,
  defaultAutoHideCategories: true, defaultRequireManualApproval: true,
} as const;

/** Load an account's EFFECTIVE protection (tenant-scoped). Returns null if the account is not this tenant's. */
export async function getAccountProtection(tenantId: string, accountId: string): Promise<{ effective: EffectiveProtection; overridden: boolean } | null> {
  return withTenant(tenantId, async (tx) => {
    const account = await tx.connectedAccount.findFirst({ where: { id: accountId }, select: ACCOUNT_SELECT });
    if (!account) return null; // RLS + explicit scope: a foreign account is invisible
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: TENANT_SELECT });
    if (!tenant) return null;
    return { effective: resolveAccountProtection(account, tenant), overridden: account.protectionOverridden };
  });
}

export interface ProtectionPatch {
  autoHideEnabled?: boolean;
  autoHideMode?: AutoHideMode;
  autoHideRiskThreshold?: RiskThreshold;
  autoHideCategories?: string[];
  requireManualApproval?: boolean;
}

/** Override an account's protection (tenant-scoped). Marks it overridden + stamps protectionConfiguredAt.
 *  Returns the rows changed (0 = not this tenant's account → denied). */
export async function updateAccountProtection(tenantId: string, accountId: string, patch: ProtectionPatch): Promise<number> {
  const data: Record<string, unknown> = { protectionOverridden: true, protectionConfiguredAt: new Date() };
  if (patch.autoHideEnabled !== undefined) data.autoHideEnabled = patch.autoHideEnabled;
  if (patch.autoHideMode !== undefined) data.autoHideMode = asMode(patch.autoHideMode);
  if (patch.autoHideRiskThreshold !== undefined) data.autoHideRiskThreshold = asThreshold(patch.autoHideRiskThreshold);
  if (patch.autoHideCategories !== undefined) data.autoHideCategories = patch.autoHideCategories;
  if (patch.requireManualApproval !== undefined) data.requireManualApproval = patch.requireManualApproval;
  return withTenant(tenantId, async (tx) => (await tx.connectedAccount.updateMany({ where: { id: accountId }, data })).count);
}

/** Revert an account to the tenant default protection (drops its override). */
export async function resetAccountProtectionToDefault(tenantId: string, accountId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => (await tx.connectedAccount.updateMany({ where: { id: accountId }, data: { protectionOverridden: false } })).count);
}

/** Toggle whether Guardora monitors an account (tenant-scoped). Enabling is limit-checked separately. */
export async function setAccountMonitoring(tenantId: string, accountId: string, enabled: boolean): Promise<number> {
  return withTenant(tenantId, async (tx) => (await tx.connectedAccount.updateMany({ where: { id: accountId }, data: { monitoringEnabled: enabled } })).count);
}

export async function getTenantProtectionDefaults(tenantId: string): Promise<TenantDefaultFields | null> {
  return withTenant(tenantId, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: TENANT_SELECT }));
}

export interface DefaultsPatch {
  defaultAutoHideEnabled?: boolean;
  defaultAutoHideMode?: AutoHideMode;
  defaultAutoHideRiskThreshold?: RiskThreshold;
  defaultAutoHideCategories?: string[];
  defaultRequireManualApproval?: boolean;
}
export async function updateTenantProtectionDefaults(tenantId: string, patch: DefaultsPatch): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.defaultAutoHideEnabled !== undefined) data.defaultAutoHideEnabled = patch.defaultAutoHideEnabled;
  if (patch.defaultAutoHideMode !== undefined) data.defaultAutoHideMode = asMode(patch.defaultAutoHideMode);
  if (patch.defaultAutoHideRiskThreshold !== undefined) data.defaultAutoHideRiskThreshold = asThreshold(patch.defaultAutoHideRiskThreshold);
  if (patch.defaultAutoHideCategories !== undefined) data.defaultAutoHideCategories = patch.defaultAutoHideCategories;
  if (patch.defaultRequireManualApproval !== undefined) data.defaultRequireManualApproval = patch.defaultRequireManualApproval;
  if (Object.keys(data).length === 0) return;
  await withTenant(tenantId, (tx) => tx.tenant.update({ where: { id: tenantId }, data }));
}

// ---------------------------------------------------------------------------------------------------
// Monitored-account LIMIT. Product unit = each monitoring-enabled, non-disconnected account (FB + IG
// counted SEPARATELY — unlike the legacy "connection bundle" count). Enforced atomically.
// ---------------------------------------------------------------------------------------------------

/** Count monitored accounts (each Facebook Page + each Instagram = one). */
export async function countMonitoredAccounts(tx: TenantTx, tenantId: string): Promise<number> {
  return tx.connectedAccount.count({ where: { tenantId, monitoringEnabled: true, status: { not: "disconnected" } } });
}

export interface MonitoredLimitPreview {
  used: number;
  limit: number;      // -1 = unlimited
  remaining: number;  // Infinity-safe: large when unlimited
  wouldExceed: boolean;
}

/** Preview the monitored-account limit for the connect UI ("Po pripojení využijete X z Y"). `adding` is how
 *  many monitored accounts the user is about to enable in this action. */
export async function previewMonitoredAccountLimit(tenantId: string, adding = 1): Promise<MonitoredLimitPreview> {
  const ent = await getTenantEntitlements(tenantId);
  const limit = ent.maxConnectedAccounts ?? -1; // null ⇒ unlimited
  const used = await withTenant(tenantId, (tx) => countMonitoredAccounts(tx, tenantId));
  const remaining = limit < 0 ? Number.MAX_SAFE_INTEGER : Math.max(0, limit - used);
  return { used, limit, remaining, wouldExceed: limit >= 0 && used + adding > limit };
}

/**
 * Atomically enable monitoring on an account only if it stays within the plan's monitored-account limit.
 * Advisory-locked per (tenant, monitored_accounts) so two parallel enables can never exceed the limit.
 * Throws EntitlementError("account_limit_reached") when it would exceed. A no-op (already monitored) is safe.
 */
export async function enableAccountMonitoringWithinLimit(tenantId: string, accountId: string): Promise<void> {
  const ent = await getTenantEntitlements(tenantId);
  const max = ent.maxConnectedAccounts;
  await withTenant(tenantId, async (tx) => {
    await acquireTenantResourceLock(tx, tenantId, "connections");
    const acc = await tx.connectedAccount.findFirst({ where: { id: accountId }, select: { monitoringEnabled: true } });
    if (!acc) throw new EntitlementError("account_limit_reached"); // not this tenant's account → denied (generic)
    if (acc.monitoringEnabled) return; // already counted; idempotent
    const current = await countMonitoredAccounts(tx, tenantId);
    if (!isWithinLimit(current, max)) throw new EntitlementError("account_limit_reached");
    await tx.connectedAccount.updateMany({ where: { id: accountId }, data: { monitoringEnabled: true } });
  });
}
