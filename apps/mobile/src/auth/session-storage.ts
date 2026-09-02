/**
 * Secure session-token storage — the app's binding to the native secure store.
 *
 * The token is the bearer credential for the whole account, so it lives ONLY in
 * platform-backed secure storage: the iOS Keychain and the Android Keystore
 * (AES-encrypted SharedPreferences), both via `expo-secure-store`.
 *
 * It is deliberately NOT in: AsyncStorage, React state persistence, the file
 * system, SQLite, logs, crash/error reports, analytics, Expo public config, or a
 * URL/deep link. Nothing here logs the value; it is returned only to its caller.
 *
 * The exported surface is exactly three operations — read, write, delete. Anything
 * richer would invite copies of the token to accumulate. The policy itself lives in
 * `./session-storage-core` so it stays testable off-device.
 */

import * as SecureStore from "expo-secure-store";

import { createSessionStorage } from "./session-storage-core";

export { TOKEN_KEY, createSessionStorage } from "./session-storage-core";
export type { SecureStoreLike, SessionStorage } from "./session-storage-core";

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps the token out of iCloud Keychain backups
 * and out of a restore onto a different device: a stolen backup cannot resurrect a
 * live session, and the value is unreadable while the device is locked.
 */
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const storage = createSessionStorage(SecureStore, OPTIONS);

export const readToken = storage.readToken;
export const writeToken = storage.writeToken;
export const deleteToken = storage.deleteToken;
