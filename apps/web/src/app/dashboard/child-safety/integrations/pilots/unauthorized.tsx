import Link from "next/link";
import { EmptyState } from "@/components/dashboard/ui";
import type { PilotCopy } from "./pilot-i18n";
export function Unauthorized({ t }: { t: PilotCopy }) {
  return (
    <div className="space-y-4">
      <EmptyState title={t.unauthorized.title} body={t.unauthorized.body} />
      <div className="text-center"><Link href="/dashboard/child-safety/integrations" className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline">{t.unauthorized.cta}</Link></div>
    </div>
  );
}
