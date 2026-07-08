import Link from "next/link";
import { BrandStatus, BrandTone, Permission, can } from "@guardora/core";
import {
  PageHeader,
  Badge,
  Field,
  Input,
  Select,
  PrimaryButton,
} from "@/components/dashboard/ui";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { navItem } from "@/lib/nav";
import { humanize } from "@/lib/format";
import { createBrand } from "./actions";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/brands");

const STATUS_TONE: Record<string, string> = {
  active: "ok",
  paused: "warn",
  archived: "neutral",
};

const toneOptions = Object.values(BrandTone).map((v) => ({
  value: v,
  label: humanize(v),
}));
const statusOptions = Object.values(BrandStatus).map((v) => ({
  value: v,
  label: humanize(v),
}));

export default async function BrandsPage() {
  const session = await requireSession();
  const manage = can(session.role, Permission.BrandManage);

  const brands = await prisma.brand.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { connectedAccounts: true, reputationItems: true } },
    },
  });

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} />

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* List */}
        <div className="space-y-3">
          {brands.length === 0 ? (
            <div className="gu-card p-6 text-sm text-[var(--color-muted)]">
              No brands yet.{manage ? " Create your first brand →" : ""}
            </div>
          ) : (
            brands.map((b) => (
              <Link
                key={b.id}
                href={`/dashboard/brands/${b.id}`}
                className="gu-card block p-5 transition hover:border-[var(--color-brand)]"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{b.name}</h3>
                    <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {b.defaultLocale} · {b.timezone} · {humanize(b.defaultTone)}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>
                    {humanize(b.status)}
                  </Badge>
                </div>
                <div className="mt-3 flex gap-4 text-xs text-[var(--color-muted)]">
                  <span>{b._count.connectedAccounts} connected</span>
                  <span>{b._count.reputationItems} items</span>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Create */}
        {manage ? (
          <div className="gu-card h-fit p-5">
            <h3 className="mb-4 text-sm font-semibold">New brand</h3>
            <form action={createBrand} className="space-y-3">
              <Field label="Name">
                <Input name="name" required placeholder="Acme Coffee" />
              </Field>
              <Field label="Display name" hint="Optional public-facing name">
                <Input name="displayName" placeholder="Acme" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Language">
                  <Input name="defaultLocale" defaultValue="en" />
                </Field>
                <Field label="Timezone">
                  <Input name="timezone" defaultValue="UTC" />
                </Field>
              </div>
              <Field label="Default tone">
                <Select name="defaultTone" options={toneOptions} />
              </Field>
              <Field label="Status">
                <Select name="status" options={statusOptions} />
              </Field>
              <PrimaryButton type="submit" className="w-full">
                Create brand
              </PrimaryButton>
            </form>
          </div>
        ) : (
          <div className="gu-card h-fit p-5 text-xs text-[var(--color-muted)]">
            Your role ({session.role}) can view brands but not create them.
          </div>
        )}
      </div>
    </>
  );
}
