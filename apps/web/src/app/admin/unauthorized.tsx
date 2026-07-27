import Link from "next/link";
import { EmptyState } from "@/components/dashboard/ui";
import type { AdminCopy } from "./admin-i18n";
export function Unauthorized({ t }: { t: AdminCopy }) {
  return (
    <div className="mx-auto max-w-lg space-y-4 py-16" role="alert">
      <EmptyState title={t.unauthorized.title} body={t.unauthorized.body} />
      <div className="text-center"><Link href="/dashboard" className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline">{t.unauthorized.cta}</Link></div>
    </div>
  );
}
