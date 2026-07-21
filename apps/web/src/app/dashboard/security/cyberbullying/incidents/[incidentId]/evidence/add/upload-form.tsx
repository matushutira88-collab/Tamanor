"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  validateEvidenceFile, validateEvidenceBatch, EVIDENCE_ALLOWED_MIME, EVIDENCE_MAX_FILES,
  type EvidenceUploadErrorCode,
} from "@guardora/core/cyberbullying-evidence-upload";
import type { Locale } from "@/i18n/config";
import { CB_COPY } from "../../../../cb-i18n";

type FileError = { index: number; code: string };
const ACCEPT = EVIDENCE_ALLOWED_MIME.join(",");

export function EvidenceUploadForm({ locale, incidentId }: { locale: Locale; incidentId: string }) {
  const t = CB_COPY[locale].evUpload;
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [batchError, setBatchError] = useState<EvidenceUploadErrorCode | null>(null);
  const [fileErrors, setFileErrors] = useState<FileError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const errRef = useRef<HTMLDivElement>(null);

  const errMsg = (code: string) => (t.errors as Record<string, string>)[code] ?? t.errors.error;

  function addFiles(list: FileList | File[]) {
    setFormError(null); setFileErrors([]);
    const merged = [...files, ...Array.from(list)].slice(0, EVIDENCE_MAX_FILES);
    // Client-side (type/size/filename only — the server re-checks the bytes).
    const fErrs: FileError[] = [];
    merged.forEach((f, i) => {
      const code = validateEvidenceFile({ filename: f.name, declaredMime: f.type, size: f.size });
      if (code) fErrs.push({ index: i, code });
    });
    setBatchError(validateEvidenceBatch(merged.map((f) => ({ size: f.size }))));
    setFileErrors(fErrs);
    setFiles(merged);
  }

  function removeAt(i: number) {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    setFileErrors([]); setBatchError(validateEvidenceBatch(next.map((f) => ({ size: f.size }))));
    next.forEach((f, idx) => { const c = validateEvidenceFile({ filename: f.name, declaredMime: f.type, size: f.size }); if (c) setFileErrors((p) => [...p, { index: idx, code: c }]); });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || files.length === 0 || batchError || fileErrors.length) { if (fileErrors.length || batchError) errRef.current?.focus(); return; }
    setPending(true); setFormError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("file", f));
      const res = await fetch(`/api/dashboard/cyberbullying/incidents/${incidentId}/evidence`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ ok: false, error: "error" }));
      if (res.ok && data.ok) {
        setDone(true);
        setTimeout(() => successRef.current?.focus(), 0);
        router.refresh();
        return;
      }
      if (Array.isArray(data.fileErrors)) setFileErrors(data.fileErrors.map((x: FileError) => ({ index: x.index, code: x.code })));
      setFormError(errMsg(String(data.error ?? "error")));
      setTimeout(() => errRef.current?.focus(), 0);
    } catch {
      setFormError(t.errors.error);
      setTimeout(() => errRef.current?.focus(), 0);
    } finally {
      setPending(false);
    }
  }

  const detailHref = `/dashboard/security/cyberbullying/incidents/${incidentId}`;

  if (done) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-ok-soft)] text-[var(--color-ok)]" aria-hidden="true">✓</div>
        <h2 ref={successRef} tabIndex={-1} className="text-lg font-semibold text-[var(--color-fg)] focus:outline-none">{t.successTitle}</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{t.successBody}</p>
        <Link href={detailHref} className="mt-4 inline-block rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] hover:bg-[var(--color-brand-strong)]">{t.backToIncident}</Link>
      </div>
    );
  }

  const canSubmit = files.length > 0 && !batchError && fileErrors.length === 0 && !pending;

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-4">
      {/* Notices */}
      <div className="space-y-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
        <p>{t.contentNotice}</p>
        <p>{t.scanNotice}</p>
        <p>{t.allowed} {t.perFile} {t.maxFiles}</p>
      </div>

      {/* Error summary (focusable, announced) */}
      {(formError || batchError) ? (
        <div ref={errRef} tabIndex={-1} role="alert" className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)] focus:outline-none">
          {formError ?? errMsg(batchError!)}
        </div>
      ) : null}

      {/* Drop zone (enhancement) + labelled file input (always usable via keyboard). */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
        className="rounded-xl border-2 border-dashed border-[var(--color-border-strong)] p-6 text-center"
      >
        <p className="text-sm font-medium text-[var(--color-fg)]">{t.dropTitle}</p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">{t.dropHint}</p>
        <label htmlFor="evidence-files" className="mt-3 inline-block cursor-pointer rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]">
          {t.browse}
        </label>
        <input
          ref={inputRef} id="evidence-files" name="evidence-files" type="file" multiple accept={ACCEPT}
          className="sr-only"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      {/* Selected files */}
      <div>
        <h2 className="text-xs font-semibold text-[var(--color-fg)]">{t.selected}</h2>
        {files.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t.noFiles}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {files.map((f, i) => {
              const fe = fileErrors.find((x) => x.index === i);
              return (
                <li key={`${f.name}-${f.size}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm" aria-invalid={!!fe}>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-[var(--color-fg)]">{f.name}</span>
                    <span className="ml-2 text-xs text-[var(--color-muted)]">{Math.ceil(f.size / 1024)} KB</span>
                    {fe ? <span className="ml-2 text-xs text-[var(--color-danger)]">{errMsg(fe.code)}</span> : null}
                  </span>
                  <button type="button" onClick={() => removeAt(i)} className="rounded-md border border-[var(--color-border-strong)] px-2 py-1 text-xs font-semibold text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]">{t.remove}</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Live status for assistive tech */}
      <p aria-live="polite" className="sr-only">{pending ? t.submitting : ""}</p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
        <Link href={detailHref} className="text-sm font-semibold text-[var(--color-muted)] hover:text-[var(--color-fg)]">{t.cancel}</Link>
        <button type="submit" disabled={!canSubmit} aria-disabled={!canSubmit} className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-[var(--color-brand-fg)] transition hover:bg-[var(--color-brand-strong)] disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? t.submitting : t.submit}
        </button>
      </div>
    </form>
  );
}
