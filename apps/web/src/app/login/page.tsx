import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { prisma } from "@/server/db";
import { getSession } from "@/server/auth";
import { signInAs } from "@/server/session-actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");

  // Dev/mock: list existing users to sign in as. Real auth replaces this.
  const users = await prisma.user.findMany({
    include: { memberships: { include: { tenant: true } } },
    orderBy: { createdAt: "asc" },
  });

  return (
    <main className="gu-grid flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="gu-card p-6">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Development sign-in. Choose a workspace user to continue.
          </p>

          <div className="mt-5 space-y-2">
            {users.length === 0 ? (
              <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-muted)]">
                No users yet. Run <code>pnpm db:seed</code> to create the dev
                workspace.
              </p>
            ) : (
              users.map((u) => {
                const m = u.memberships[0];
                return (
                  <form key={u.id} action={signInAs.bind(null, u.id)}>
                    <button
                      type="submit"
                      className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-left transition hover:border-[var(--color-brand)]"
                    >
                      <span>
                        <span className="block text-sm font-medium">
                          {u.name ?? u.email}
                        </span>
                        <span className="block text-xs text-[var(--color-muted)]">
                          {u.email}
                          {m ? ` · ${m.tenant.name} · ${m.role}` : ""}
                        </span>
                      </span>
                      <span className="text-[var(--color-brand)]">→</span>
                    </button>
                  </form>
                );
              })
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
          Mock authentication for local development. No real credentials, no
          third-party sign-in.
        </p>
      </div>
    </main>
  );
}
