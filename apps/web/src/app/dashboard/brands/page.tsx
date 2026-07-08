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
import { getT } from "@/i18n/server";
import { tEnum } from "@/i18n/labels";
import { createBrand } from "./actions";

export const dynamic = "force-dynamic";
const nav = navItem("/dashboard/brands");

const STATUS_TONE: Record<string, string> = {
  active: "ok",
  paused: "warn",
  archived: "neutral",
};

export default async function BrandsPage() {
  const session = await requireSession();
  const hdrT = await getT();
  const manage = can(session.role, Permission.BrandManage);
  const toneOptions = Object.values(BrandTone).map((v) => ({ value: v, label: tEnum(hdrT, "tone", v) }));
  const statusOptions = Object.values(BrandStatus).map((v) => ({ value: v, label: tEnum(hdrT, "brandStatus", v) }));

  const brands = await prisma.brand.findMany({
    where: { tenantId: session.tenantId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { connectedAccounts: true, reputationItems: true } },
    },
  });

  return (
    <>
      <PageHeader title={hdrT.dashHeaders[nav.icon].title} description={hdrT.dashHeaders[nav.icon].desc} />

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
                      {tEnum(hdrT, "language", b.defaultLocale)} · {b.timezone} · {tEnum(hdrT, "tone", b.defaultTone)}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[b.status] ?? "neutral"}>
                    {tEnum(hdrT, "brandStatus", b.status)}
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
            <h3 className="mb-4 text-sm font-semibold">{hdrT.dash.newBrand}</h3>
            <form action={createBrand} className="space-y-3">
              <Field label={hdrT.dash.name}>
                <Input name="name" required placeholder="Acme Coffee" />
              </Field>
              <Field label={hdrT.dash.displayName}>
                <Input name="displayName" placeholder="Acme" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={hdrT.common.language}>
                  <Input name="defaultLocale" defaultValue="en" />
                </Field>
                <Field label={hdrT.dash.timezone}>
                  <Input name="timezone" defaultValue="UTC" />
                </Field>
              </div>
              <Field label={hdrT.dash.defaultTone}>
                <Select name="defaultTone" options={toneOptions} />
              </Field>
              <Field label={hdrT.dash.status}>
                <Select name="status" options={statusOptions} />
              </Field>
              <PrimaryButton type="submit" className="w-full">
                {hdrT.dash.createBrandBtn}
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
