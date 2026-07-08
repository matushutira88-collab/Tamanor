import type { ReactNode } from "react";
import Link from "next/link";

/* ----------------------------------------------------------------------------
   Layout
---------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[var(--color-brand)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`gu-card p-6 ${className}`}>{children}</div>;
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Empty state
---------------------------------------------------------------------------- */

export function EmptyState({
  title,
  body,
  hint,
  icon,
  action,
}: {
  title: string;
  body: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="gu-card flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]">
        {icon ?? <IconSparkle />}
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-[var(--color-muted)]">{body}</p>
      {hint ? (
        <p className="mt-2 text-xs text-[var(--color-muted)]">{hint}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Stat card
---------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: ReactNode;
  tone?: "neutral" | "brand" | "ok" | "warn" | "danger";
}) {
  const iconTone: Record<string, string> = {
    neutral: "bg-[var(--color-neutral-soft)] text-[var(--color-muted)]",
    brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
    ok: "bg-[var(--color-ok-soft)] text-[var(--color-ok)]",
    warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
    danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  };
  return (
    <div className="gu-card p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-pop">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
          {label}
        </p>
        {icon ? (
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${iconTone[tone]}`}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-[32px] font-bold leading-none tracking-tight text-[var(--color-fg)]">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-xs text-[var(--color-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Badge (soft tint)
---------------------------------------------------------------------------- */

const TONE: Record<string, string> = {
  neutral: "bg-[var(--color-neutral-soft)] text-[var(--color-muted)]",
  brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
  ok: "bg-[var(--color-ok-soft)] text-[var(--color-ok)]",
  warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof TONE | string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current/15 ${
        TONE[tone] ?? TONE.neutral
      }`}
    >
      {children}
    </span>
  );
}

/** Small status dot + label, for inline connection/health status. */
export function StatusDot({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONE | string;
  children: ReactNode;
}) {
  const dot: Record<string, string> = {
    neutral: "bg-[var(--color-muted)]",
    brand: "bg-[var(--color-brand)]",
    ok: "bg-[var(--color-ok)]",
    warn: "bg-[var(--color-warn)]",
    danger: "bg-[var(--color-danger)]",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
      <span className={`h-1.5 w-1.5 rounded-full ${dot[tone] ?? dot.neutral}`} />
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------------------
   Tabs (link-based, server-friendly)
---------------------------------------------------------------------------- */

export function Tabs({
  tabs,
  active,
}: {
  tabs: { key: string; label: string; href: string; count?: number }[];
  active: string;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1 border-b border-[var(--color-border)]">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm transition ${
              on
                ? "border-[var(--color-brand)] font-semibold text-[var(--color-fg)]"
                : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            {t.label}
            {typeof t.count === "number" ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                  on
                    ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
                    : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                }`}
              >
                {t.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   Form controls
---------------------------------------------------------------------------- */

const inputClass =
  "w-full rounded-lg border border-[var(--color-border-strong)] bg-white px-3 py-2 text-sm text-[var(--color-fg)] outline-none transition focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand-soft)]";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--color-fg)]">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-[var(--color-muted)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea {...props} className={`${inputClass} ${props.className ?? ""}`} />
  );
}

export function Select({
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[];
}) {
  return (
    <select {...props} className={`${inputClass} ${props.className ?? ""}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ----------------------------------------------------------------------------
   Buttons
---------------------------------------------------------------------------- */

export function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] shadow-sm transition hover:bg-[var(--color-brand-strong)] disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}

export function SecondaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}

/* ----------------------------------------------------------------------------
   Inline icons (stroke, 18px). Kept tiny + dependency-free.
---------------------------------------------------------------------------- */

function IconSparkle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
