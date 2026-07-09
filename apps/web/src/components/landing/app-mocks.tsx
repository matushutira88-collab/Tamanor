import { Platform } from "@guardora/core";
import { BrandIcon } from "@/components/dashboard/platform-icon";
import type { Dictionary } from "@/i18n";

/**
 * Marketing product mocks — PURELY ILLUSTRATIVE UI built in code (no
 * screenshots, no raster assets). Every mock reflects Guardora's real safety
 * posture:
 *
 *  - read-only by default; moderation actions are never shown as executed,
 *  - sensitive actions are shown as PROPOSALS awaiting human approval,
 *  - execution is shown as gated off at the connector runtime,
 *  - all sample content is demo data and labelled as such by the caller.
 *
 * Copy lives in the i18n dictionaries (`dict.productMocks`); only structural
 * data — platform identity, risk severity, chart series — stays in code.
 */

type Level = "high" | "medium" | "low";

/* ---------------------------------------------------------------- primitives */

function Frame({
  title,
  status,
  tone,
  children,
}: {
  title: string;
  status: string;
  tone: "brand" | "warn" | "ok";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand)]",
    warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
    ok: "bg-[var(--color-ok-soft)] text-[var(--color-ok)]",
  };
  return (
    <div className="relative h-full rounded-3xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted)]">
          {title}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {status}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

const LEVEL_CLASS: Record<Level, string> = {
  high: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  medium: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
  low: "bg-[var(--color-ok-soft)] text-[var(--color-ok)]",
};

function RiskPill({ level, label }: { level: Level; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${LEVEL_CLASS[level]}`}
    >
      {label}
    </span>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3.5 text-center text-[11px] text-[var(--color-muted)]">{children}</p>
  );
}

/* ------------------------------------------------------------ 1. Inbox mock */

/** Structural pairing for the inbox rows — copy comes from the dictionary. */
const INBOX_SHAPE: { platform: string; level: Level }[] = [
  { platform: Platform.FacebookPage, level: "high" },
  { platform: Platform.InstagramBusiness, level: "high" },
  { platform: Platform.GoogleBusiness, level: "medium" },
  { platform: Platform.YouTube, level: "low" },
];

export function InboxMock({ dict }: { dict: Dictionary }) {
  const t = dict.productMocks.inbox;
  return (
    <Frame title={t.title} status={t.status} tone="ok">
      <div className="space-y-2">
        {INBOX_SHAPE.map((shape, i) => {
          const item = t.items[i];
          if (!item) return null;
          return (
            <div
              key={item.author}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3.5"
            >
              <div className="flex items-center gap-2.5">
                <BrandIcon platform={shape.platform} size={22} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{item.author}</p>
                  <p className="text-[10.5px] text-[var(--color-muted)]">{item.meta}</p>
                </div>
                <RiskPill level={shape.level} label={dict.enums.risk[shape.level]} />
              </div>
              <p className="mt-2 line-clamp-1 text-[12.5px] text-[var(--color-muted)]">
                {item.text}
              </p>
            </div>
          );
        })}
      </div>
      <Caption>{t.caption}</Caption>
    </Frame>
  );
}

/* ------------------------------------------------- 2. AI risk assessment mock */

export function RiskDetailMock({ dict }: { dict: Dictionary }) {
  const t = dict.productMocks.risk;
  const rows: { label: string; value: string; tone?: string }[] = [
    { label: t.rowRiskLevel, value: dict.enums.risk.high, tone: "text-[var(--color-danger)]" },
    { label: t.rowSentiment, value: dict.enums.sentiment.negative, tone: "text-[var(--color-warn)]" },
    { label: t.rowPriority, value: t.priorityValue },
    { label: t.rowLanguage, value: t.languageValue },
  ];
  return (
    <Frame title={t.title} status={t.status} tone="brand">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--color-muted)]">{t.confidenceLabel}</span>
          <span className="text-xs font-semibold text-[var(--color-danger)]">82%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
          <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-[var(--color-warn)] to-[var(--color-danger)]" />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {t.tags.map((c) => (
            <span
              key={c}
              className="rounded-full bg-[var(--color-danger-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-danger)]"
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      <dl className="mt-3 divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-4">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between py-2.5">
            <dt className="text-[12px] text-[var(--color-muted)]">{r.label}</dt>
            <dd className={`text-[12px] font-semibold ${r.tone ?? "text-[var(--color-fg)]"}`}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      <Caption>{t.caption}</Caption>
    </Frame>
  );
}

/* --------------------------------------------- 3. Human approval workflow mock */

export function ApprovalMock({ dict }: { dict: Dictionary }) {
  const t = dict.productMocks.approval;
  const states: ("done" | "active" | "gated")[] = ["done", "active", "gated"];
  return (
    <Frame title={t.title} status={t.status} tone="warn">
      <div className="space-y-2.5">
        {t.steps.map((label, i) => {
          const state = states[i] ?? "gated";
          const ring =
            state === "done"
              ? "border-[var(--color-ok)] text-[var(--color-ok)]"
              : state === "active"
                ? "border-[var(--color-brand)] text-[var(--color-brand)]"
                : "border-[var(--color-border-strong)] text-[var(--color-muted)]";
          return (
            <div
              key={label}
              className="flex items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3.5 py-3"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${ring}`}
              >
                {state === "done" ? "✓" : state === "gated" ? "🔒" : i + 1}
              </span>
              <span className="flex-1 text-[12.5px] font-medium">{label}</span>
              {state === "gated" ? (
                <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  {t.disabled}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          {t.auditTitle}
        </p>
        <ul className="mt-2 space-y-1.5 text-[11.5px] text-[var(--color-muted)]">
          {t.audit.map((line, i) => (
            <li
              key={line}
              className={`flex justify-between gap-3 ${i === t.audit.length - 1 ? "text-[var(--color-fg)]" : ""}`}
            >
              <span>{line}</span>
              <span className="shrink-0 tabular-nums">09:41</span>
            </li>
          ))}
        </ul>
      </div>

      <Caption>{t.caption}</Caption>
    </Frame>
  );
}

/* --------------------------------------------------------- 4. Trends mock */

const SENTIMENT = [22, 26, 24, 31, 29, 38, 34, 44, 41, 52, 49, 58];
const RISK_SERIES = [14, 12, 17, 13, 19, 15, 22, 18, 15, 12, 10, 9];

function toPath(series: number[], w: number, h: number, max: number) {
  const step = w / (series.length - 1);
  return series
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
}

export function TrendsMock({ dict }: { dict: Dictionary }) {
  const t = dict.productMocks.trends;
  const W = 260;
  const H = 90;
  const MAX = 64;
  const sentimentPath = toPath(SENTIMENT, W, H, MAX);
  const riskPath = toPath(RISK_SERIES, W, H, MAX);

  const stats = [
    { k: t.statTopics, v: "18" },
    { k: t.statChannels, v: "6" },
    { k: t.statFlagged, v: "9" },
  ];

  return (
    <Frame title={t.title} status={t.status} tone="brand">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[90px] w-full"
          role="img"
          aria-label={`${t.legendSentiment} · ${t.legendRisk}`}
        >
          <defs>
            <linearGradient id="gu-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${sentimentPath} L${W},${H} L0,${H} Z`} fill="url(#gu-area)" />
          <path d={sentimentPath} fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinecap="round" />
          <path
            d={riskPath}
            fill="none"
            stroke="var(--color-danger)"
            strokeWidth="1.6"
            strokeDasharray="4 3"
            strokeLinecap="round"
            opacity="0.85"
          />
        </svg>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11px] text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[var(--color-brand)]" />
            {t.legendSentiment}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[var(--color-danger)]" />
            {t.legendRisk}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div
            key={s.k}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-soft)] px-3 py-2.5 text-center"
          >
            <p className="gu-display text-lg leading-none text-[var(--color-fg)]">{s.v}</p>
            <p className="mt-1 text-[10.5px] text-[var(--color-muted)]">{s.k}</p>
          </div>
        ))}
      </div>

      <Caption>{t.caption}</Caption>
    </Frame>
  );
}
