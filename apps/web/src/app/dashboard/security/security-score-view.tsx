import type { SecurityScoreResult, SecurityScoreDimensionResult, SecurityScoreFactor } from "@guardora/core";
import type { Locale } from "@/i18n/config";
import { Card, Badge, SectionHeader } from "@/components/dashboard/ui";
import { DIMENSION_LABELS, FACTOR_LABELS, ISSUE_TEXT, CHROME, type ScoreChrome } from "./score-i18n";

const LEVEL_TONE: Record<string, "ok" | "warn" | "danger"> = { strong: "ok", fair: "warn", weak: "danger" };
const LEVEL_COLOR: Record<string, string> = { strong: "var(--color-ok)", fair: "var(--color-warn)", weak: "var(--color-danger)" };

/** Deterministic 0–100 ring; renders a muted "insufficient" ring when score is null. */
function ScoreRing({ score, level }: { score: number | null; level: string | null }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * C;
  const color = level ? LEVEL_COLOR[level] : "var(--color-border-strong)";
  return (
    <div className="relative mx-auto shrink-0" style={{ width: 148, height: 148 }}>
      <svg viewBox="0 0 148 148" className="h-full w-full -rotate-90">
        <circle cx="74" cy="74" r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth="13" />
        {score !== null ? (
          <circle cx="74" cy="74" r={R} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${dash} ${C}`} />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="gu-display text-[40px] leading-none text-[var(--color-fg)]">{score === null ? "—" : score}</span>
      </div>
    </div>
  );
}

export function SecurityScoreView({ result, locale }: { result: SecurityScoreResult; locale: Locale }) {
  const t = CHROME[locale];
  const dimLabels = DIMENSION_LABELS[locale];
  const factorLabels = FACTOR_LABELS[locale];
  const issues = ISSUE_TEXT[locale];

  // Aggregate deductions (measured factors that lost points) across dimensions, worst first.
  const deductions = result.dimensions
    .flatMap((d) => d.factors.filter((f) => f.status === "measured" && f.issueCode != null && (f.score ?? 100) < 100).map((f) => ({ d, f })))
    .sort((a, b) => (a.f.score ?? 100) - (b.f.score ?? 100));

  return (
    <>
      {/* Headline score */}
      <Card>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <ScoreRing score={result.score} level={result.level} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{t.scoreTitle}</h2>
              {result.level ? <Badge tone={LEVEL_TONE[result.level]}>{t.level[result.level as "strong" | "fair" | "weak"]}</Badge> : <Badge tone="neutral">{t.insufficient}</Badge>}
            </div>
            {result.score === null ? (
              <p className="mt-1.5 text-sm text-[var(--color-muted)]">{t.insufficientHint}</p>
            ) : (
              <p className="mt-1.5 text-sm text-[var(--color-muted)]">{t.detectOnly}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="neutral">{t.coverage(result.coverage.dimensionsMeasured, result.coverage.dimensionsTotal)}</Badge>
              <Badge tone={result.coverage.confidence === "high" ? "ok" : result.coverage.confidence === "medium" ? "warn" : "neutral"}>{t.confidence[result.coverage.confidence]}</Badge>
              {result.weightsRenormalized ? <span className="text-[var(--color-muted)]">{t.renormalized}</span> : null}
            </div>
          </div>
        </div>
      </Card>

      {/* Dimension breakdown */}
      <div className="mt-8">
        <SectionHeader title={t.breakdownTitle} description={t.detectOnly} />
        <div className="grid gap-4">
          {result.dimensions.map((d) => (
            <DimensionCard key={d.key} d={d} locale={locale} dimLabels={dimLabels} factorLabels={factorLabels} issues={issues} chrome={t} />
          ))}
        </div>
      </div>

      {/* Reasons & recommendations */}
      <div className="mt-8">
        <SectionHeader title={t.recommendationsTitle} />
        {deductions.length === 0 ? (
          <Card><p className="text-sm text-[var(--color-muted)]">{t.noRecommendations}</p></Card>
        ) : (
          <div className="grid gap-3">
            {deductions.map(({ d, f }) => (
              <Card key={`${d.key}.${f.key}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {factorLabels[f.key] ?? f.key}
                    {f.severity === "critical" ? <Badge tone="danger">{t.critical}</Badge> : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--color-muted)]">{dimLabels[d.key]?.label}</span>
                    <Badge tone={(f.score ?? 100) >= 50 ? "warn" : "danger"}>{f.score}/100</Badge>
                  </div>
                </div>
                <p className="mt-1.5 text-sm text-[var(--color-fg)]"><span className="font-medium">{t.reasonLabel}:</span> {issues[f.issueCode as string]?.reason(f.evidence) ?? f.issueCode}</p>
                <p className="mt-1 text-sm text-[var(--color-muted)]"><span className="font-medium">{t.recommendationLabel}:</span> {issues[f.issueCode as string]?.recommendation(f.evidence) ?? ""}</p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function DimensionCard({
  d,
  dimLabels,
  factorLabels,
  issues,
  chrome,
}: {
  d: SecurityScoreDimensionResult;
  locale: Locale;
  dimLabels: Record<string, { label: string; description: string }>;
  factorLabels: Record<string, string>;
  issues: Record<string, { reason: (e: Record<string, number | string | boolean>) => string; recommendation: (e: Record<string, number | string | boolean>) => string }>;
  chrome: ScoreChrome;
}) {
  const label = dimLabels[d.key] ?? { label: d.key, description: "" };
  const scoreText = d.status === "insufficient_data" || d.score === null ? chrome.insufficientDim : `${d.score}`;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{label.label}</h3>
            <span className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">{d.weight}% {chrome.weightLabel}</span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{label.description}</p>
        </div>
        <div className="text-right">
          {d.score === null ? (
            <Badge tone="neutral">{chrome.insufficientDim}</Badge>
          ) : (
            <span className="gu-display text-[22px] leading-none" style={{ color: LEVEL_COLOR[d.level ?? "fair"] }}>{scoreText}<span className="text-xs text-[var(--color-muted)]"> /100</span></span>
          )}
        </div>
      </div>
      {/* Factors */}
      <ul className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
        {d.factors.map((f) => (
          <FactorRow key={f.key} f={f} factorLabels={factorLabels} issues={issues} chrome={chrome} />
        ))}
      </ul>
    </Card>
  );
}

function FactorRow({
  f,
  factorLabels,
  issues,
  chrome,
}: {
  f: SecurityScoreFactor;
  factorLabels: Record<string, string>;
  issues: Record<string, { reason: (e: Record<string, number | string | boolean>) => string; recommendation: (e: Record<string, number | string | boolean>) => string }>;
  chrome: ScoreChrome;
}) {
  const label = factorLabels[f.key] ?? f.key;
  const unavailable = f.status !== "measured";
  const value = unavailable ? (f.status === "unavailable" ? chrome.notAvailable : chrome.insufficientDim) : `${f.score}`;
  const dotColor = unavailable ? "var(--color-muted)" : (f.score ?? 100) >= 80 ? "var(--color-ok)" : (f.score ?? 100) >= 50 ? "var(--color-warn)" : "var(--color-danger)";
  const note = f.issueCode ? issues[f.issueCode]?.reason(f.evidence) : null;
  return (
    <li className="flex items-start justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-start gap-2">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} aria-hidden="true" />
        <span className="min-w-0">
          <span className={unavailable ? "text-[var(--color-muted)]" : "text-[var(--color-fg)]"}>{label}</span>
          {note ? <span className="block text-xs text-[var(--color-muted)]">{note}</span> : null}
        </span>
      </span>
      <span className="shrink-0 text-xs font-medium tabular-nums" style={{ color: dotColor }}>{unavailable ? value : `${value}/100`}</span>
    </li>
  );
}
