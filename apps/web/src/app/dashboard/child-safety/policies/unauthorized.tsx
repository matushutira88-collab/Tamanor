import Link from "next/link";
import { EmptyState } from "@/components/dashboard/ui";
import type { PolicyCopy } from "./policy-i18n";

/** Fail-closed 403 view for the policy console (rendered when the role lacks policy_view). */
export function Unauthorized({ t }: { t: PolicyCopy }) {
  return (
    <div className="space-y-4">
      <EmptyState title={t.unauthorized.title} body={t.unauthorized.body} />
      <div className="text-center">
        <Link href="/dashboard/child-safety/reviewer" className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline">{t.unauthorized.cta}</Link>
      </div>
    </div>
  );
}
