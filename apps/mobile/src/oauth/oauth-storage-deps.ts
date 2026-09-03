/**
 * The real keychain wiring for the pending-flow marker.
 *
 * Kept separate from `oauth-storage.ts` so the contract stays testable off-device:
 * that module imports types only, and this one is the single place that touches
 * `expo-secure-store`.
 */

import * as SecureStore from "expo-secure-store";

import { createPendingFlowStorage } from "./oauth-storage";

/**
 * The same keychain accessibility class as the session token: not backed up to
 * iCloud, not restorable onto another device, unreadable while locked.
 */
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const store = {
  getItemAsync: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
  setItemAsync: (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS),
  deleteItemAsync: (key: string) => SecureStore.deleteItemAsync(key, OPTIONS),
};

export const pendingFlowStorage = createPendingFlowStorage(store);
