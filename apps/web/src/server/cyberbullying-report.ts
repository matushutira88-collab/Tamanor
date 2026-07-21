import "server-only";
import { listReportableSubjects, assertReportableSubject, canReportManualIncident, type ReportableSubject } from "@guardora/db";
import { IncidentReportSource, CYBERBULLYING_CATEGORIES } from "@guardora/core";

/**
 * C6 — server-side READ MODEL for the manual cyberbullying report form. Every
 * value the form offers is produced here: the ALLOWED protected subjects
 * (tenant-scoped, permission-checked, active-only, server-filtered — the client
 * never receives a subject it may not report for), and the closed sets of report
 * sources / categories. Raw enum values are returned; the UI localizes them. No
 * raw Prisma object crosses to the client.
 */

export type ReportActor = { tenantId: string; userId: string; role: string };

/** Whether this role may open a manual report at all (drives CTA + route gating). */
export function canReportCyberbullying(role: string): boolean {
  return canReportManualIncident(role);
}

export interface ManualReportFormOptions {
  subjects: { id: string; label: string; subjectType: string }[];
  reportSources: string[];
  categories: string[];
}

/** Options for the form. Fail-closed: throws if the actor lacks report permission. */
export async function getManualReportFormOptions(actor: ReportActor): Promise<ManualReportFormOptions> {
  const subjects = await listReportableSubjects(actor);
  return {
    subjects: subjects.map((s: ReportableSubject) => ({ id: s.id, label: s.displayLabel, subjectType: s.subjectType })),
    // Manual flow: the only valid source is `manual_report` (fail-closed elsewhere).
    reportSources: [IncidentReportSource.ManualReport],
    categories: [...CYBERBULLYING_CATEGORIES],
  };
}

export { assertReportableSubject };
