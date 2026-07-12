import { Role, Permission, can } from "@guardora/core";
import { PageHeader, Card, SectionHeader, Badge, Field, Input, Select, PrimaryButton } from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { withTenant } from "@guardora/db";
import { navItem } from "@/lib/nav";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/team");

const ROLE_TONE: Record<string, string> = {
  owner: "brand",
  admin: "brand",
  analyst: "ok",
  reviewer: "warn",
  viewer: "neutral",
};

export default async function TeamPage() {
  const session = await requireSession();
  const hdrT = await getT();
  const manage = can(session.role, Permission.MemberManage);

  const memberships = await withTenant(session.tenantId, (db) => db.membership.findMany({
    where: { tenantId: session.tenantId },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  }));

  const roleOptions = Object.values(Role).map((r) => ({ value: r, label: tEnum(hdrT, "role", r) }));

  return (
    <>
      <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={hdrT.dashHeaders[nav.icon].desc} />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <SectionHeader title={hdrT.dash.members} description={`${memberships.length} ${hdrT.dash.membersInWorkspace}`} />
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <div className="grid grid-cols-[1.6fr_1fr_0.9fr] gap-3 bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
              <span>{hdrT.dash.member}</span>
              <span>{hdrT.dash.role}</span>
              <span>{hdrT.dash.joined}</span>
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
                <span><Badge tone={ROLE_TONE[m.role] ?? "neutral"}>{tEnum(hdrT, "role", m.role)}</Badge></span>
                <span className="text-xs text-[var(--color-muted)]">{formatDate(m.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionHeader title={hdrT.dash.inviteTeammate} description={hdrT.dash.inviteDesc} />
            <form className="space-y-3">
              <Field label={hdrT.dash.email}>
                <Input type="email" placeholder={hdrT.dash.emailPlaceholder} disabled={!manage} />
              </Field>
              <Field label={hdrT.dash.role}>
                <Select options={roleOptions} disabled={!manage} defaultValue={Role.Viewer} />
              </Field>
              <PrimaryButton type="button" disabled className="w-full">
                {hdrT.dash.sendInvite}
              </PrimaryButton>
              <p className="text-xs text-[var(--color-muted)]">
                {manage ? hdrT.dash.invitationsComingSoon : hdrT.dash.cantManageMembers}
              </p>
            </form>
          </Card>

          <Card>
            <SectionHeader title={hdrT.dash.roles} />
            <ul className="space-y-2.5">
              {Object.values(Role).map((r) => (
                <li key={r} className="flex items-start gap-2.5 text-sm">
                  <Badge tone={ROLE_TONE[r] ?? "neutral"}>{tEnum(hdrT, "role", r)}</Badge>
                  <span className="text-xs text-[var(--color-muted)]">{tEnum(hdrT, "roleDesc", r)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
