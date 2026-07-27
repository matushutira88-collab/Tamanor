/**
 * LOCAL TEST ONLY — generate an ephemeral Ed25519 key pair for sandbox/testing. The private key is returned
 * to the caller in-memory and is NEVER persisted to disk, the database, or the repository. Do not use this
 * to provision a real partner key: in a real integration the partner generates and holds its own private key.
 */
import { generateKeyPairSync } from "node:crypto";

export interface TestKeyPair {
  privateKeyPem: string;
  publicKeyBase64Spki: string; // what a partner would register with Tamanor
}
export function generateEphemeralPartnerKeyPair(): TestKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyBase64Spki: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64"),
  };
}
