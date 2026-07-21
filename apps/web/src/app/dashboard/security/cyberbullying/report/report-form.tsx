"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
// Import from the crypto-free subpath (NOT the barrel) to keep node:crypto out of the client bundle.
import { validateManualReportInput, MANUAL_REPORT_LIMITS, IncidentReportSource, type ManualReportField, type ManualReportErrorCode } from "@guardora/core/cyberbullying-incident";
import type { Locale } from "@/i18n/config";
import { CB_COPY } from "../cb-i18n";
import { SubmitButton } from "@/components/dashboard/submit-button";
import { submitManualCyberbullyingReportAction, type ReportFormState } from "./actions";

type Subject = { id: string; label: string; subjectType: string };

/** Which wizard step a field lives on — used to jump to the first server error. */
const FIELD_STEP: Partial<Record<ManualReportField, number>> = {
  protectedSubjectId: 0,
  category: 1, summary: 1, allegedActorLabel: 1, allegedActorExternalReference: 1,
};

const INPUT = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-fg)] focus:border-[var(--color-brand)] focus:outline-none aria-[invalid=true]:border-[var(--color-danger)]";
const BTN = "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-[var(--color-fg)] transition hover:bg-[var(--color-surface-2)]";

export function ManualReportForm({ locale, subjects, categories }: { locale: Locale; subjects: Subject[]; categories: string[] }) {
  const t = CB_COPY[locale].report;
  const [state, formAction] = useActionState<ReportFormState, FormData>(submitManualCyberbullyingReportAction, {});
  const [step, setStep] = useState(0);
  const [idempotencyKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `k${Date.now()}${Math.round(performance.now())}`));
  const [v, setV] = useState({ protectedSubjectId: "", category: "", summary: "", allegedActorLabel: "", allegedActorExternalReference: "" });
  const [clientErrors, setClientErrors] = useState<Partial<Record<ManualReportField, ManualReportErrorCode>>>({});

  const headingRef = useRef<HTMLHeadingElement>(null);
  const errRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const errors = { ...clientErrors, ...(state.fieldErrors ?? {}) };
  const errMsg = (f: ManualReportField) => (errors[f] ? t.errors[errors[f] as keyof typeof t.errors] : null);

  // On a server-returned field error, jump to the step holding the first error.
  useEffect(() => {
    if (!state.fieldErrors) return;
    const first = (Object.keys(state.fieldErrors) as ManualReportField[])[0];
    if (first && FIELD_STEP[first] !== undefined) setStep(FIELD_STEP[first]!);
  }, [state.fieldErrors]);

  // Focus the step heading on navigation; focus the error summary when errors appear.
  useEffect(() => { headingRef.current?.focus(); }, [step]);
  useEffect(() => { if (state.fieldErrors || state.formError) errRef.current?.focus(); }, [state.fieldErrors, state.formError]);

  const full = () => ({ ...v, reportSource: IncidentReportSource.ManualReport, idempotencyKey });
  function validateStep(s: number): boolean {
    const res = validateManualReportInput(full());
    const stepErrs: Partial<Record<ManualReportField, ManualReportErrorCode>> = {};
    (Object.keys(res.errors) as ManualReportField[]).forEach((f) => { if (FIELD_STEP[f] === s) stepErrs[f] = res.errors[f]; });
    setClientErrors(stepErrs);
    return Object.keys(stepErrs).length === 0;
  }
  const next = () => { if (validateStep(step)) { setClientErrors({}); setStep((s) => Math.min(2, s + 1)); } };
  const back = () => { setClientErrors({}); setStep((s) => Math.max(0, s - 1)); };

  const steps = [t.steps.subject, t.steps.details, t.steps.review];
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const label = (f: ManualReportField, text: string, hint?: string) => (
    <label htmlFor={`${uid}-${f}`} className="block text-xs font-semibold text-[var(--color-fg)]">
      {text}{hint ? <span className="ml-1 font-normal text-[var(--color-muted)]">({hint})</span> : null}
    </label>
  );
  const fieldError = (f: ManualReportField) => errMsg(f) ? <p id={`${uid}-${f}-err`} className="mt-1 text-xs text-[var(--color-danger)]">{errMsg(f)}</p> : null;
  const aria = (f: ManualReportField) => ({ "aria-invalid": !!errors[f], "aria-describedby": errMsg(f) ? `${uid}-${f}-err` : undefined, id: `${uid}-${f}` });

  return (
    <form action={formAction} className="space-y-6">
      {/* Hidden system fields — server re-validates & forces these; not user-editable. */}
      <input type="hidden" name="reportSource" value={IncidentReportSource.ManualReport} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {/* Step indicator */}
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="progress">
        {steps.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className={`rounded-full px-3 py-1 font-medium ${i === step ? "bg-[var(--color-brand)] text-[var(--color-brand-fg)]" : i < step ? "bg-[var(--color-ok-soft)] text-[var(--color-ok)]" : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"}`}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg)] focus:outline-none">{steps[step]}</h2>

      {/* Error summary / form-level error (focusable, announced). */}
      {(Object.keys(errors).length > 0 || state.formError) ? (
        <div ref={errRef} tabIndex={-1} role="alert" className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)] focus:outline-none">
          {state.formError ? t.errors[state.formError] : t.errors.invalid}
        </div>
      ) : null}

      {/* STEP 0 — protected subject */}
      <div hidden={step !== 0} className="space-y-2">
        <p className="text-sm text-[var(--color-muted)]">{t.subjectStep.helper}</p>
        {label("protectedSubjectId", t.subjectStep.label)}
        <select name="protectedSubjectId" value={v.protectedSubjectId} onChange={set("protectedSubjectId")} className={INPUT} {...aria("protectedSubjectId")}>
          <option value="">{t.subjectStep.choose}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.label} · {CB_COPY[locale].report.subjectStep.type}: {s.subjectType}</option>
          ))}
        </select>
        {fieldError("protectedSubjectId")}
      </div>

      {/* STEP 1 — incident details */}
      <div hidden={step !== 1} className="space-y-4">
        <div>
          {label("reportSource", t.fields.reportSource)}
          {/* Manual flow: source is fixed to manual report (server-enforced). */}
          <input disabled value={CB_COPY[locale].reportSource[IncidentReportSource.ManualReport]} className={`${INPUT} opacity-70`} aria-readonly="true" />
        </div>
        <div>
          {label("category", t.fields.category)}
          <select name="category" value={v.category} onChange={set("category")} className={INPUT} {...aria("category")}>
            <option value="">{t.fields.category}…</option>
            {categories.map((c) => (
              <option key={c} value={c}>{t.category[c as keyof typeof t.category] ?? c}</option>
            ))}
          </select>
          {fieldError("category")}
        </div>
        <div>
          {label("summary", t.fields.summary)}
          <p className="mb-1 text-xs text-[var(--color-muted)]">{t.fields.summaryHelper}</p>
          <textarea name="summary" rows={5} maxLength={MANUAL_REPORT_LIMITS.summaryMax} value={v.summary} onChange={set("summary")} className={INPUT} {...aria("summary")} />
          {fieldError("summary")}
        </div>
        <div>
          {label("allegedActorLabel", t.fields.actorLabel, t.fields.optional)}
          <p className="mb-1 text-xs text-[var(--color-muted)]">{t.fields.actorLabelHelper}</p>
          <input name="allegedActorLabel" maxLength={MANUAL_REPORT_LIMITS.actorLabelMax} value={v.allegedActorLabel} onChange={set("allegedActorLabel")} className={INPUT} {...aria("allegedActorLabel")} />
          {fieldError("allegedActorLabel")}
        </div>
        <div>
          {label("allegedActorExternalReference", t.fields.actorRef, t.fields.optional)}
          <p className="mb-1 text-xs text-[var(--color-muted)]">{t.fields.actorRefHelper}</p>
          <input name="allegedActorExternalReference" maxLength={MANUAL_REPORT_LIMITS.actorRefMax} value={v.allegedActorExternalReference} onChange={set("allegedActorExternalReference")} className={INPUT} {...aria("allegedActorExternalReference")} />
          {fieldError("allegedActorExternalReference")}
        </div>
      </div>

      {/* STEP 2 — review & submit */}
      <div hidden={step !== 2} className="space-y-3">
        <div className="rounded-lg border border-[var(--color-warn,var(--color-border-strong))] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)]">
          <p>{t.reviewStep.notConfirmed}</p>
          <p className="mt-1 text-xs text-[var(--color-muted)]">{t.reviewStep.humanReview} {t.reviewStep.allegedNeutral}</p>
        </div>
        <dl className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] px-3">
          {[
            [t.subjectStep.label, subjects.find((s) => s.id === v.protectedSubjectId)?.label ?? "—"],
            [t.fields.reportSource, CB_COPY[locale].reportSource[IncidentReportSource.ManualReport]],
            [t.fields.category, v.category ? (t.category[v.category as keyof typeof t.category] ?? v.category) : "—"],
            [t.fields.summary, v.summary || "—"],
            [t.fields.actorLabel, v.allegedActorLabel || "—"],
          ].map(([k, val]) => (
            <div key={k} className="flex justify-between gap-4 py-2 text-sm">
              <dt className="text-[var(--color-muted)]">{k}</dt>
              <dd className="max-w-[60%] whitespace-pre-wrap text-right text-[var(--color-fg)]">{val}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
        <Link href="/dashboard/security/cyberbullying/incidents" className="text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-fg)]">{t.buttons.cancel}</Link>
        <div className="flex gap-2">
          {step > 0 ? <button type="button" onClick={back} className={BTN}>{t.buttons.back}</button> : null}
          {step < 2 ? <button type="button" onClick={next} className={`${BTN} border-[var(--color-brand)] text-[var(--color-brand)]`}>{t.buttons.next}</button>
            : <SubmitButton pendingLabel={t.buttons.submitting}>{t.buttons.submit}</SubmitButton>}
        </div>
      </div>
    </form>
  );
}
