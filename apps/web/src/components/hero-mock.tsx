import { Platform } from "@guardora/core";
import { BrandIcon } from "@/components/dashboard/platform-icon";

/**
 * Marketing hero product mock. PURELY illustrative UI — it shows a PROPOSED
 * action and a "Pending human approval" status. It never depicts an executed or
 * hidden action as reality (Guardora is approval-gated + read-only by default).
 */
export function HeroMock() {
  return (
    <div className="relative">
      {/* Glow behind the mock */}
      <div className="pointer-events-none absolute -inset-6 rounded-[32px] bg-[radial-gradient(60%_60%_at_60%_20%,rgba(25,195,154,0.22),transparent_70%)]" />

      {/* Floating post card (behind) */}
      <div className="absolute -top-6 -right-2 hidden w-56 rotate-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[0_24px_48px_rgba(0,0,0,0.45)] sm:block">
        <div className="flex items-center gap-2">
          <BrandIcon platform={Platform.InstagramBusiness} size={24} />
          <span className="text-xs text-[var(--color-muted)]">Instagram · Post</span>
        </div>
        <div className="mt-2 h-16 rounded-lg bg-gradient-to-br from-[var(--color-surface-2)] to-[var(--color-brand-soft)]" />
        <p className="mt-2 line-clamp-1 text-xs text-[var(--color-muted)]">
          New autumn collection is live ☕
        </p>
      </div>

      {/* Main card */}
      <div className="relative rounded-3xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-[0_30px_70px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted)]">
            Reputation Inbox
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-warn-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-warn)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warn)]" />
            Pending human approval
          </span>
        </div>

        {/* Harmful comment */}
        <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-muted)]">
              A
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">anon_user_88</p>
              <p className="text-[11px] text-[var(--color-muted)]">Facebook · 2m ago</p>
            </div>
            <span className="ml-auto"><BrandIcon platform={Platform.FacebookPage} size={24} /></span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--color-fg)]">
            &ldquo;This brand is a total scam, don&rsquo;t waste your money — worst
            service ever.&rdquo;
          </p>
        </div>

        {/* AI risk score */}
        <div className="mt-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-muted)]">AI risk score</span>
            <span className="text-xs font-semibold text-[var(--color-danger)]">High</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
            <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-[var(--color-warn)] to-[var(--color-danger)]" />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["Brand attack", "Scam", "Negative"].map((c) => (
              <span key={c} className="rounded-full bg-[var(--color-danger-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-danger)]">
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Proposed action */}
        <div className="mt-3">
          <p className="mb-2 text-xs text-[var(--color-muted)]">Proposed action · awaiting review</p>
          <div className="grid grid-cols-3 gap-2">
            <span className="rounded-lg border border-[var(--color-brand)] bg-[var(--color-brand-soft)] px-3 py-2 text-center text-sm font-medium text-[var(--color-brand)]">
              Hide
            </span>
            <span className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-center text-sm text-[var(--color-muted)]">
              Reply
            </span>
            <span className="rounded-lg border border-[var(--color-border-strong)] px-3 py-2 text-center text-sm text-[var(--color-muted)]">
              Escalate
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="flex-1 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-center text-xs text-[var(--color-muted)]">
              Reject
            </span>
            <span className="flex-1 rounded-lg bg-[var(--color-brand)] px-3 py-2 text-center text-xs font-semibold text-[var(--color-brand-fg)]">
              Approve &amp; execute
            </span>
          </div>
        </div>
      </div>

      {/* Platform badges */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {[
          Platform.FacebookPage,
          Platform.InstagramBusiness,
          Platform.YouTube,
          Platform.LinkedInCompany,
          Platform.TikTok,
          Platform.GoogleBusiness,
        ].map((p) => (
          <BrandIcon key={p} platform={p} size={28} label />
        ))}
      </div>
    </div>
  );
}
