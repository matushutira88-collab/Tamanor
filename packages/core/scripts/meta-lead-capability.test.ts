/**
 * Meta Lead Ads truthful capability evaluator — pure unit tests. Proves the fixed precedence of preconditions and
 * that `available` is returned ONLY when every precondition holds (never claims available/active otherwise).
 */
import { evaluateMetaLeadCapability, isMetaLeadCapabilityAvailable, type MetaLeadCapabilitySignals } from "../src/business-contacts";

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = "") => { console.log(`${c ? "  ✓" : "  ✗"} ${l}${c ? "" : `  — ${d}`}`); c ? pass++ : fail++; };

const ALL_TRUE: MetaLeadCapabilitySignals = {
  metaConfigured: true, entitled: true, hasLinkedActiveAccount: true, connectionActive: true,
  credentialDecryptable: true, leadsPermissionGranted: true, providerApproved: true,
};

check("all preconditions → available", evaluateMetaLeadCapability(ALL_TRUE) === "available");
check("available helper true only for available", isMetaLeadCapabilityAvailable("available") && !isMetaLeadCapabilityAvailable("permission_missing"));
check("no config → config_missing (highest precedence)", evaluateMetaLeadCapability({ ...ALL_TRUE, metaConfigured: false }) === "config_missing");
check("config but not entitled → entitlement_locked", evaluateMetaLeadCapability({ ...ALL_TRUE, entitled: false }) === "entitlement_locked");
check("entitled but no linked account → no_linked_account", evaluateMetaLeadCapability({ ...ALL_TRUE, hasLinkedActiveAccount: false }) === "no_linked_account");
check("linked but connection inactive → connection_inactive", evaluateMetaLeadCapability({ ...ALL_TRUE, connectionActive: false }) === "connection_inactive");
check("connection active but credential not decryptable → credential_unavailable", evaluateMetaLeadCapability({ ...ALL_TRUE, credentialDecryptable: false }) === "credential_unavailable");
check("credential ok but permission missing → permission_missing", evaluateMetaLeadCapability({ ...ALL_TRUE, leadsPermissionGranted: false }) === "permission_missing");
check("permission granted but not approved → awaiting_provider_approval", evaluateMetaLeadCapability({ ...ALL_TRUE, providerApproved: false }) === "awaiting_provider_approval");
// precedence: an EARLIER failing precondition wins over a later one.
check("precedence: config missing wins over approval missing", evaluateMetaLeadCapability({ ...ALL_TRUE, metaConfigured: false, providerApproved: false }) === "config_missing");
check("precedence: credential failure hides permission/approval gaps", evaluateMetaLeadCapability({ ...ALL_TRUE, credentialDecryptable: false, leadsPermissionGranted: false, providerApproved: false }) === "credential_unavailable");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — meta lead capability evaluator: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
