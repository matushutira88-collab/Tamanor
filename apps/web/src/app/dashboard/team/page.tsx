import { Role, Permission, can } from "@guardora/core";
import { PageHeader, Card, SectionHeader, Badge, Field, Input, Select, PrimaryButton } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { humanize, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/team");

const ROLE_TONE: Record<string, string> = {
  owner: "brand",
  admin: "brand",
  analyst: "ok",
  reviewer: "warn",
  viewer: "neutral",
};

const ROLE_DESC: Record<string, string> = {
  owner: "Full control incl. billing & members",
  admin: "Manage brands, connectors, rules, members",
  analyst: "Triage inbox, draft replies, manage rules",
  reviewer: "Review & approve proposals (scoped)",
  viewer: "Read-only across the workspace",
};

export default async function TeamPage() {
  const session = await requireSession();
  const manage = can(session.role, Permission.MemberManage);

  const memberships = await prisma.membership.findMany({
    where: { tenantId: session.tenantId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  const roleOptions = Object.values(Role).map((r) => ({ value: r, label: humanize(r) }));

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <SectionHeader title="Members" description={`${memberships.length} member(s) in this workspace`} />
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <div className="grid grid-cols-[1.6fr_1fr_0.9fr] gap-3 bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
              <span>Member</span>
              <span>Role</span>
              <span>Joined</span>
            </div>
            {memberships.map((m) => (
              <div key={m.id} className="grid grid-cols-[1.6fr_1fr_0.9fr] items-center gap-3 border-t border-[var(--color-border)] px-4 py-3 text-sm">
                <span className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-semibold text-white">
                    {(m.user.name ?? m.user.email).charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{m.user.name ?? m.user.email}</span>
                    <span className="block truncate text-xs text-[var(--color-muted)]">{m.user.email}</span>
                  </span>
                </span>
                <span><Badge tone={ROLE_TONE[m.role] ?? "neutral"}>{humanize(m.role)}</Badge></span>
                <span className="text-xs text-[var(--color-muted)]">{formatDate(m.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionHeader title="Invite a teammate" description="Send an invitation to join this workspace." />
            <form className="space-y-3">
              <Field label="Email">
                <Input type="email" placeholder="teammate@company.com" disabled={!manage} />
              </Field>
              <Field label="Role">
                <Select options={roleOptions} disabled={!manage} defaultValue={Role.Viewer} />
              </Field>
              <PrimaryButton type="button" disabled className="w-full">
                Send invite
              </PrimaryButton>
              <p className="text-xs text-[var(--color-muted)]">
                {manage ? "Invitations are coming soon." : `Your role (${session.role}) can't manage members.`}
              </p>
            </form>
          </Card>

          <Card>
            <SectionHeader title="Roles" />
            <ul className="space-y-2.5">
              {Object.values(Role).map((r) => (
                <li key={r} className="flex items-start gap-2.5 text-sm">
                  <Badge tone={ROLE_TONE[r] ?? "neutral"}>{humanize(r)}</Badge>
                  <span className="text-xs text-[var(--color-muted)]">{ROLE_DESC[r]}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
