/**
 * Branded ID types. These are compile-time-only helpers so a BrandId can never
 * be silently passed where a TenantId is expected.
 *
 * Note: `Branded` (the helper) is intentionally distinct from `Brand`
 * (the tenant's brand domain entity in ./brand).
 */
export type Branded<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Branded<string, "TenantId">;
export type UserId = Branded<string, "UserId">;
export type BrandId = Branded<string, "BrandId">;
export type ConnectorAccountId = Branded<string, "ConnectorAccountId">;
export type ContentItemId = Branded<string, "ContentItemId">;
export type ReputationItemId = Branded<string, "ReputationItemId">;
export type ModerationDecisionId = Branded<string, "ModerationDecisionId">;
export type BrandRuleId = Branded<string, "BrandRuleId">;

/** ISO-8601 timestamp string. */
export type IsoTimestamp = Branded<string, "IsoTimestamp">;

export const asId = <T extends string>(value: string): T => value as T;
