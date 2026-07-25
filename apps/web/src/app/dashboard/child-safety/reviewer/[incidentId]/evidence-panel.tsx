"use client";

import { useActionState, useEffect, useState } from "react";
import type { ReviewerCopy } from "../reviewer-i18n";
import { integrityTone, formatBytes, fmtDateTime, shortId } from "../reviewer-view";
import { ChildSafetyEvidenceType } from "@guardora/core";
import { uploadEvidenceAction, verifyEvidenceAction, sealEvidenceAction, type EvidenceActionState } from "./evidence-actions";

export interface EvidenceItem {
  id: string; evidenceType: string; sourceType: string; label: string | null; externalUrl: string | null;
  mimeType: string | null; sizeBytes: number | null; contentHash: string; integrityStatus: string;
  chainPosition: number; uploaderUserId: string | null; sealed: boolean; capturedAt: string;
  previewable: boolean; downloadable: boolean;
}
interface CustodyEvent { id: string; eventType: string; actorUserId: string | null; reason: string | null; createdAt: string }
const INITIAL: EvidenceActionState = { ok: true };

const badge = (tone: string) => `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current/15 bg-[var(--color-${tone}-soft)] text-[var(--color-${tone})]`;
const btn = "rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-medium text-[var(--color-fg)] hover:border-[var(--color-border-strong)] disabled:opacity-50";

/**
 * Incident Evidence — the reviewer's evidence tab. Upload (file/screenshot/url/manual), filter + search
 * (client-side over the loaded chain), preview + download (authorized API routes), verify integrity + seal
 * (server actions), and an expandable chain-of-custody per item. There is NO edit and NO delete affordance.
 */
export function EvidencePanel({ incidentId, items, canManage, t }: { incidentId: string; items: EvidenceItem[]; canManage: boolean; t: ReviewerCopy }) {
  const e = t.evidence;
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [search, setSearch] = useState("");
  const [uploadType, setUploadType] = useState<string>(ChildSafetyEvidenceType.UploadedFile);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [custody, setCustody] = useState<Record<string, CustodyEvent[]>>({});

  const [upState, upload, upPending] = useActionState(uploadEvidenceAction, INITIAL);
  const [, verify] = useActionState(verifyEvidenceAction, INITIAL);
  const [, seal] = useActionState(sealEvidenceAction, INITIAL);

  const shown = items.filter((it) =>
    (!typeFilter || it.evidenceType === typeFilter) &&
    (!sourceFilter || it.sourceType === sourceFilter) &&
    (!search || it.id === search.trim() || (it.label ?? "").toLowerCase().includes(search.trim().toLowerCase())));

  async function toggleCustody(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!custody[id]) {
      const r = await fetch(`/api/v1/child-safety/reviewer/evidence/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (r?.ok) setCustody((c) => ({ ...c, [id]: r.custody }));
    }
  }

  const sel = "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm text-[var(--color-fg)]";
  const upErr = upState.ok ? null : upState.error;

  return (
    <div className="space-y-4">
      {/* Upload (manager only) */}
      {canManage ? (
        <form action={upload} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <input type="hidden" name="incidentId" value={incidentId} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{e.type}
              <select name="type" value={uploadType} onChange={(ev) => setUploadType(ev.target.value)} className={sel} aria-label={e.type}>
                <option value={ChildSafetyEvidenceType.UploadedFile}>{e.typeLabel.uploaded_file}</option>
                <option value={ChildSafetyEvidenceType.Screenshot}>{e.typeLabel.screenshot}</option>
                <option value={ChildSafetyEvidenceType.ExternalUrl}>{e.typeLabel.external_url}</option>
                <option value={ChildSafetyEvidenceType.Manual}>{e.typeLabel.manual}</option>
              </select>
            </label>
            {uploadType === ChildSafetyEvidenceType.UploadedFile || uploadType === ChildSafetyEvidenceType.Screenshot ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{e.file}<input type="file" name="file" required className="text-sm" aria-label={e.file} /></label>
            ) : uploadType === ChildSafetyEvidenceType.ExternalUrl ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{e.url}<input name="url" type="url" required placeholder={e.urlPlaceholder} className={`${sel} w-64`} aria-label={e.url} /></label>
            ) : (
              <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{e.text}<input name="bodyText" required placeholder={e.textPlaceholder} className={`${sel} w-64`} aria-label={e.text} /></label>
            )}
            <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{e.label}<input name="label" placeholder={e.labelPlaceholder} className={`${sel} w-48`} aria-label={e.label} /></label>
            <button type="submit" disabled={upPending} className="rounded-lg bg-[var(--color-brand)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{upPending ? e.working : e.addBtn}</button>
            <a href={`/api/v1/child-safety/reviewer/incidents/${incidentId}/evidence/export`} className="ml-auto rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-sm font-medium">{e.export}</a>
          </div>
          {upErr ? <div role="alert" className="mt-2 rounded-lg border border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{t.errors[upErr] ?? t.errors.retry_later}</div> : null}
        </form>
      ) : <div className="text-xs text-[var(--color-muted)]">{e.readOnly}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{e.filterType}
          <select value={typeFilter} onChange={(ev) => setTypeFilter(ev.target.value)} className={sel} aria-label={e.filterType}>
            <option value="">{e.all}</option>
            {Object.entries(e.typeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{e.filterSource}
          <select value={sourceFilter} onChange={(ev) => setSourceFilter(ev.target.value)} className={sel} aria-label={e.filterSource}>
            <option value="">{e.all}</option>
            {Object.entries(e.sourceLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">{e.search}
          <input value={search} onChange={(ev) => setSearch(ev.target.value)} placeholder={e.searchPlaceholder} className={`${sel} w-52`} aria-label={e.search} />
        </label>
      </div>

      {/* List */}
      {shown.length === 0 ? <p className="text-sm text-[var(--color-muted)]">{e.empty}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                <th className="px-2 py-2">{e.chain}</th><th className="px-2 py-2">{e.type}</th><th className="px-2 py-2">{e.label}</th>
                <th className="px-2 py-2">{e.integrity}</th><th className="px-2 py-2">{e.size}</th><th className="px-2 py-2">{e.capturedAt}</th><th className="px-2 py-2 text-right">·</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((it) => (
                <>
                  <tr key={it.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-2 py-2 tabular-nums">{it.chainPosition}</td>
                    <td className="px-2 py-2">{e.typeLabel[it.evidenceType] ?? it.evidenceType}</td>
                    <td className="px-2 py-2">{it.label ?? <span className="font-mono text-xs text-[var(--color-muted)]">{shortId(it.id)}</span>} {it.sealed ? <span className={badge("neutral")}>{e.sealedBadge}</span> : null}</td>
                    <td className="px-2 py-2"><span className={badge(integrityTone(it.integrityStatus))}>{e.integrityLabel[it.integrityStatus] ?? it.integrityStatus}</span></td>
                    <td className="px-2 py-2 text-xs text-[var(--color-muted)]">{formatBytes(it.sizeBytes)}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-xs text-[var(--color-muted)]">{fmtDateTime(it.capturedAt)}</td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <a href={`/api/v1/child-safety/reviewer/evidence/${it.id}/preview`} target="_blank" rel="noopener noreferrer" className={btn}>{e.preview}</a>
                        {it.downloadable ? <a href={`/api/v1/child-safety/reviewer/evidence/${it.id}/download`} className={btn}>{e.download}</a> : null}
                        {canManage ? (
                          <>
                            <form action={verify}><input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="evidenceId" value={it.id} /><button type="submit" className={btn}>{e.verify}</button></form>
                            {!it.sealed ? <form action={seal}><input type="hidden" name="incidentId" value={incidentId} /><input type="hidden" name="evidenceId" value={it.id} /><button type="submit" className={btn}>{e.seal}</button></form> : null}
                          </>
                        ) : null}
                        <button type="button" onClick={() => toggleCustody(it.id)} className={btn} aria-expanded={expanded === it.id}>{e.custodyChain}</button>
                      </div>
                    </td>
                  </tr>
                  {expanded === it.id ? (
                    <tr key={`${it.id}-c`}><td colSpan={7} className="bg-[var(--color-neutral-soft)] px-4 py-2">
                      {custody[it.id] ? (custody[it.id]!.length === 0 ? <p className="text-xs text-[var(--color-muted)]">{e.noCustody}</p> : (
                        <ol className="space-y-1 text-xs">
                          {custody[it.id]!.map((c) => <li key={c.id} className="flex items-center gap-2"><span className="font-semibold">{e.custodyLabel[c.eventType] ?? c.eventType}</span><span className="text-[var(--color-muted)]">{fmtDateTime(c.createdAt)}</span>{c.actorUserId ? <span className="font-mono text-[var(--color-muted)]">{shortId(c.actorUserId)}</span> : null}</li>)}
                        </ol>
                      )) : <p className="text-xs text-[var(--color-muted)]">…</p>}
                    </td></tr>
                  ) : null}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
