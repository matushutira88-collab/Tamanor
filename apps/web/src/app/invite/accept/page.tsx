import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInvite, systemDb } from "@guardora/db";
import { requireSession } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * V1.71 (Release B / B4) — accept a team invite. The recipient must be signed in (requireSession sends
 * them to login/register first); the token is verified server-side against its hash, status, expiry and
 * the invited email (which must match the signed-in user's email). Accept is transactional, single-use
 * and idempotent. No user existence is enumerated — a bad/expired token yields a generic message.
 */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const sp = await searchParams;
  const token = String(sp.token ?? "");
  if (!token) redirect("/dashboard");

  const user = await systemDb.user.findUnique({ where: { id: session.userId }, select: { email: true } });
  const res = await acceptInvite(token, session.userId, user?.email ?? "");
  if (res.ok) redirect("/dashboard?joined=1");

  const message = res.reason === "wrong_email"
    ? "This invitation was sent to a different email address. Sign in with that email to accept it."
    : res.reason === "expired"
      ? "This invitation has expired. Ask an admin to send a new one."
      : res.reason === "revoked"
        ? "This invitation was revoked."
        : "This invitation link is not valid.";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-semibold">Invitation</h1>
      <p className="text-sm text-[var(--color-muted)]">{message}</p>
      <Link href="/dashboard" className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm hover:border-[var(--color-border-strong)]">Go to dashboard</Link>
    </main>
  );
}
