import { Role, Permission, can, ASSIGNABLE_ROLES } from "@guardora/core";
import { PageHeader, Card, SectionHeader, Badge, Field, Input, Select, PrimaryButton } from "@/components/dashboard/ui";
import { Notice } from "@/components/dashboard/notice";
import { requireSession } from "@/server/auth";
import { withTenant, getSeatSummary, listPendingInvites } from "@guardora/db";
import { navItem } from "@/lib/nav";
import { getLocale } from "@/i18n/locale-server";
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { formatDate } from "@/lib/format";
import { inviteMemberAction, revokeInviteAction, resendInviteAction, removeMemberAction, changeRoleAction } from "./actions";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/team");

const ROLE_TONE: Record<string, "brand" | "ok" | "warn" | "neutral"> = {
  owner: "brand", admin: "brand", analyst: "ok", reviewer: "warn", viewer: "neutral",
};

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  const hdrT = await getT();
  const locale = await getLocale();
  const sp = await searchParams;
  const manage = can(session.role, Permission.MemberManage);

  const [memberships, pendingInvites, seats] = await Promise.all([
    withTenant(session.tenantId, (db) => db.membership.findMany({
      where: { tenantId: session.tenantId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    })),
    listPendingInvites(session.tenantId),
    getSeatSummary(session.tenantId),
  ]);

  const inviteRoleOptions = ASSIGNABLE_ROLES.map((r) => ({ value: r, label: tEnum(hdrT, "role", r) }));
  const changeRoleOptions = Object.values(Role).map((r) => ({ value: r, label: tEnum(hdrT, "role", r) }));
  const ownerCount = memberships.filter((m) => m.role === "owner").length;
  const seatLabel = seats.maxSeats === null ? `${seats.usage} / ∞` : `${seats.usage} / ${seats.maxSeats}`;
  const atLimit = !seats.overLimit && seats.remaining !== null && seats.remaining <= 0;

  return (
    <>
      <PageHeader
        title={hdrT.dashHeaders[nav.icon].title}
        description={hdrT.dashHeaders[nav.icon].desc}
        action={<Badge tone={seats.overLimit ? "danger" : "neutral"}>{hdrT.dash.seatsUsed}: {seatLabel}</Badge>}
      />
      <Notice notice={sp.notice} kind={sp.kind} locale={locale} />

      {seats.overLimit ? (
        <p role="alert" className="mb-4 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]" data-testid="seats-over-limit">
          {hdrT.dash.seatsOverLimit}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card>
            <SectionHeader title={hdrT.dash.members} description={`${memberships.length} ${hdrT.dash.membersInWorkspace}`} />
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
              <div className="grid grid-cols-[1.6fr_1.1fr_0.9fr] gap-3 bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                <span>{hdrT.dash.member}</span><span>{hdrT.dash.role}</span><span></span>
              </div>
              {memberships.map((m) => {
                const isLastOwner = m.role === "owner" && ownerCount <= 1;
                const overLimit = seats.overLimitMemberIds.includes(m.id);
                return (
                  <div key={m.id} className="grid grid-cols-[1.6fr_1.1fr_0.9fr] items-center gap-3 border-t border-[var(--color-border)] px-4 py-3 text-sm">
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-semibold text-white">
                        {(m.user.name ?? m.user.email).charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{m.user.name ?? m.user.email}</span>
                        <span className="block truncate text-xs text-[var(--color-muted)]">{m.user.email}{overLimit ? " · ⚠︎" : ""}</span>
                      </span>
                    </span>
                    <span>
                      {manage && !isLastOwner ? (
                        <form action={changeRoleAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="membershipId" value={m.id} />
                          <select name="role" defaultValue={m.role} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs">
                            {changeRoleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">↳</button>
                        </form>
                      ) : (
                        <Badge tone={ROLE_TONE[m.role] ?? "neutral"}>{tEnum(hdrT, "role", m.role)}</Badge>
                      )}
                    </span>
                    <span className="text-right">
                      {manage && !isLastOwner ? (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-danger)] hover:border-[var(--color-danger)]">{hdrT.dash.remove}</button>
                        </form>
                      ) : <span className="text-xs text-[var(--color-muted)]">{formatDate(m.createdAt)}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <SectionHeader title={hdrT.dash.pendingInvites} />
            {pendingInvites.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">{hdrT.dash.noPendingInvites}</p>
            ) : (
              <div className="space-y-2" data-testid="pending-invites">
                {pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{inv.emailNormalized}</span>
                      <span className="block text-xs text-[var(--color-muted)]"><Badge tone={ROLE_TONE[inv.role] ?? "neutral"}>{tEnum(hdrT, "role", inv.role)}</Badge> · {hdrT.dash.inviteExpires} {formatDate(inv.expiresAt)}</span>
                    </span>
                    {manage ? (
                      <span className="flex items-center gap-1.5">
                        <form action={resendInviteAction}><input type="hidden" name="inviteId" value={inv.id} /><input type="hidden" name="email" value={inv.emailNormalized} /><button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:border-[var(--color-border-strong)]">{hdrT.dash.resend}</button></form>
                        <form action={revokeInviteAction}><input type="hidden" name="inviteId" value={inv.id} /><button type="submit" className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-danger)] hover:border-[var(--color-danger)]">{hdrT.dash.revoke}</button></form>
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHeader title={hdrT.dash.inviteTeammate} description={hdrT.dash.inviteDesc} />
            <form action={inviteMemberAction} className="space-y-3">
              <Field label={hdrT.dash.email}>
                <Input type="email" name="email" required placeholder={hdrT.dash.emailPlaceholder} disabled={!manage || seats.overLimit || atLimit} />
              </Field>
              <Field label={hdrT.dash.role}>
                <Select name="role" options={inviteRoleOptions} disabled={!manage || seats.overLimit || atLimit} defaultValue={Role.Viewer} />
              </Field>
              <PrimaryButton type="submit" disabled={!manage || seats.overLimit || atLimit} className="w-full">{hdrT.dash.sendInvite}</PrimaryButton>
              <p className="text-xs text-[var(--color-muted)]">
                {!manage ? hdrT.dash.cantManageMembers : seats.overLimit || atLimit ? hdrT.dash.seatLimitReached : hdrT.dash.inviteDesc}
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
