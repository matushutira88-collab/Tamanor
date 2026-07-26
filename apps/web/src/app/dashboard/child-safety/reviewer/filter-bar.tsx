"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { ReviewerCopy } from "./reviewer-i18n";
import { INCIDENT_SORTS, SEVERITY_OPTIONS, URGENCY_OPTIONS } from "./reviewer-view";
import { ChildSafetyIncidentStatus } from "@guardora/core/child-safety-orchestration";

/**
 * Reviewer Console — the incident-list filter/sort/search bar. A CLIENT control that only rewrites the
 * URL search params (source of truth); the server component re-renders the table from those params. This
 * keeps loading/empty/error states server-driven and the table itself a pure server render.
 */
const STATUS_VALUES = Object.values(ChildSafetyIncidentStatus) as string[];

export function FilterBar({ t, sp }: { t: ReviewerCopy; sp: Record<string, string | undefined> }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = useSearchParams();

  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(current?.toString() ?? "");
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page"); // any filter change resets pagination
    router.push(`${pathname}?${next.toString()}`);
  }, [current, pathname, router]);

  const onSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = new FormData(e.currentTarget).get("search");
    setParam("search", typeof v === "string" ? v.trim() : "");
  };

  const sel = "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-fg)]";
  return (
    <div className="flex flex-wrap items-end gap-2">
      <form onSubmit={onSearch} className="flex items-end gap-2" role="search">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
          {t.list.search}
          <input name="search" defaultValue={sp.search ?? ""} placeholder={t.list.searchPlaceholder} className={`${sel} w-56`} aria-label={t.list.search} />
        </label>
        <button type="submit" className="rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-sm font-medium">{t.list.search}</button>
      </form>

      <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.sort.label}
        <select className={sel} value={sp.sort ?? "newest"} onChange={(e) => setParam("sort", e.target.value)} aria-label={t.sort.label}>
          {INCIDENT_SORTS.map((s) => <option key={s.value} value={s.value}>{t.sort[s.value === "highest_severity" ? "severity" : s.value === "highest_urgency" ? "urgency" : s.value === "oldest" ? "oldest" : "newest"]}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.filter.status}
        <select className={sel} value={sp.status ?? ""} onChange={(e) => setParam("status", e.target.value)} aria-label={t.filter.status}>
          <option value="">{t.filter.all}</option>
          {STATUS_VALUES.map((s) => <option key={s} value={s}>{t.statusLabel[s] ?? s}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.filter.severity}
        <select className={sel} value={sp.severity ?? ""} onChange={(e) => setParam("severity", e.target.value)} aria-label={t.filter.severity}>
          <option value="">{t.filter.any}</option>
          {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{t.severityLabel[s] ?? s}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.filter.urgency}
        <select className={sel} value={sp.urgency ?? ""} onChange={(e) => setParam("urgency", e.target.value)} aria-label={t.filter.urgency}>
          <option value="">{t.filter.any}</option>
          {URGENCY_OPTIONS.map((u) => <option key={u} value={u}>{t.urgencyLabel[u] ?? u}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.filter.escalation}
        <select className={sel} value={sp.escalationState ?? ""} onChange={(e) => setParam("escalationState", e.target.value)} aria-label={t.filter.escalation}>
          <option value="">{t.filter.any}</option>
          <option value="escalated">{t.filter.escalated}</option>
          <option value="none">{t.filter.notEscalated}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{t.filter.profile}
        <input defaultValue={sp.profileId ?? ""} onBlur={(e) => setParam("profileId", e.target.value.trim())} placeholder={t.filter.profile} className={`${sel} w-40`} aria-label={t.filter.profile} />
      </label>

      {Object.keys(sp).some((k) => sp[k]) ? (
        <button type="button" onClick={() => router.push(pathname)} className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]">{t.list.clear}</button>
      ) : null}
    </div>
  );
}
