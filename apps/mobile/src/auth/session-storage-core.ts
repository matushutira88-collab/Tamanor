/**
 * The storage POLICY, independent of the native module.
 *
 * Split from `session-storage.ts` so the behaviour that actually matters — what a
 * read/write/delete does, and what each failure means — can be exercised against a
 * fake store without a device or the Expo runtime. `session-storage.ts` binds this
 * to the real `expo-secure-store`.
 */

/** The single namespaced key the session token is stored under. */
export const TOKEN_KEY = "tamanor.session.token";

/** The minimal slice of `expo-secure-store` this policy uses. */
export interface SecureStoreLike {
  getItemAsync: (key: string, options?: object) => Promise<string | null>;
  setItemAsync: (key: string, value: string, options?: object) => Promise<void>;
  deleteItemAsync: (key: string, options?: object) => Promise<void>;
}

export interface SessionStorage {
  readToken: () => Promise<string | null>;
  writeToken: (token: string) => Promise<boolean>;
  deleteToken: () => Promise<void>;
}

/**
 * Build the storage API over a secure-store implementation.
 *
 * Every operation is fail-safe rather than throwing, because each failure has
 * exactly one correct interpretation:
 *   - an unreadable token means "not signed in" (fail closed),
 *   - an unwritable token must NOT be reported as a successful sign-in,
 *   - a failed delete must still leave the caller able to sign out.
 *
 * Nothing here logs the token.
 */
export function createSessionStorage(store: SecureStoreLike, options?: object): SessionStorage {
  return {
    async readToken() {
      try {
        const value = await store.getItemAsync(TOKEN_KEY, options);
        return value && value.length > 0 ? value : null;
      } catch {
        return null;
      }
    },

    async writeToken(token: string) {
      // An empty string is never a credential; refuse rather than persist it.
      if (!token) return false;
      try {
        await store.setItemAsync(TOKEN_KEY, token, options);
        return true;
      } catch {
        return false;
      }
    },

    async deleteToken() {
      try {
        await store.deleteItemAsync(TOKEN_KEY, options);
      } catch {
        /* already gone, or the store is unavailable — either way nothing is kept */
      }
    },
  };
}
