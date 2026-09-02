import "server-only";
import { createUserSession, readUserSession, revokeUserSession } from "@guardora/db";
import { metrics, emitOpsEvent, classifyWorkspaceRouting } from "@guardora/core";
import { summarizeUserAgent } from "@/server/auth-security";
import { sendSecurityEmail } from "@/server/security-email";
import { authenticateCredentials } from "./login-core";
import { realCredentialDeps } from "./login-deps";
import type { MobileAuthDeps, MobileWorkspace } from "./mobile-auth";

/**
 * M2 — the ONE wiring of {@link MobileAuthDeps} to the real session store, the
 * shared credential core and the notification transport.
 *
 * Every primitive here is the SAME one the web cookie path uses:
 * `createUserSession` / `readUserSession` / `revokeUserSession` from @guardora/db,
 * and `authenticateCredentials` + `realCredentialDeps` from the shared login core.
 * There is no mobile-specific session table, token format, or trust shortcut.
 */
export function realMobileAuthDeps(): MobileAuthDeps {
  return {
    authenticateCredentials,
    credentialDeps: realCredentialDeps(),

    createUserSession: async (input) => {
      const created = await createUserSession(input);
      return { token: created.token, session: created.session };
    },
    readUserSession,
    revokeUserSession,

    // Fail-closed: an unknown/corrupt workspace kind is never treated as Business.
    classifyWorkspace: (kind): MobileWorkspace => classifyWorkspaceRouting(kind),
    summarizeUserAgent,

    // Same best-effort "new sign-in" email as the web login path. The mobile route
    // has no request locale negotiation yet, so it uses the default locale; the
    // message never contains a token.
    notifyNewLogin: async (email, device) => {
      await sendSecurityEmail(email, "en", "new_login", {
        when: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
        device: device ?? undefined,
      });
    },

    metrics,
    emitOpsEvent,
  };
}
