"use server";

import { redirect } from "next/navigation";
import { startSession, endSession } from "./session";

/**
 * V1.37.1 — development sign-in. Fail-closed: this seam is UNAVAILABLE in
 * production. It no longer writes a raw userId; it issues a real, secure,
 * DB-backed session via {@link startSession} (the same path a future real auth
 * provider would use after verifying credentials / an OAuth callback).
 */
const devLoginEnabled = () => process.env.NODE_ENV !== "production";

export async function signInAs(userId: string): Promise<void> {
  if (!devLoginEnabled()) throw new Error("Development sign-in is disabled in production.");
  await startSession(userId); // verifies the user + a valid tenant membership, sets the opaque cookie
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  await endSession(); // server-side revoke + cookie clear
  redirect("/login");
}
