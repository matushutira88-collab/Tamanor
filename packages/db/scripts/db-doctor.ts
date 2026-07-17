/**
 * DB doctor — one command that tells you exactly which credential/step is wrong,
 * instead of guessing from a raw Prisma auth error.
 *
 * Run: pnpm db:doctor
 *
 * It probes the OWNER connection (DATABASE_URL) and the APP connection
 * (APP_DATABASE_URL → tamanor_app), classifies each failure (auth vs network),
 * and — if the owner connects — reports whether the RLS migration is applied and
 * whether the tamanor_app role exists, then prints the exact next command.
 */
import { PrismaClient } from "@prisma/client";

async function probe(label: string, url: string | undefined): Promise<string | null> {
  if (!url) {
    console.log(`- ${label}: <not set>`);
    return null;
  }
  const c = new PrismaClient({ datasourceUrl: url });
  try {
    const r = await c.$queryRawUnsafe<Array<{ u: string }>>(`SELECT current_user AS u`);
    console.log(`✓ ${label}: connected as "${r[0]?.u}"`);
    return r[0]?.u ?? null;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const auth = /Authentication failed|P1000|not valid|password/i.test(m);
    const reach = /P1001|ENOTFOUND|EAI_AGAIN|timed out|ECONNREFUSED|reach/i.test(m);
    const tenant = /no tenant identifier|external_id|sni_hostname/i.test(m);
    const why = tenant
      ? "POOLER ROUTING — username missing the .<project-ref> suffix"
      : auth
        ? "AUTH FAILED — wrong password for this role"
        : reach
          ? "UNREACHABLE — host/network/SSL"
          : m.split("\n")[0];
    console.log(`✗ ${label}: ${why}`);
    return null;
  } finally {
    await c.$disconnect();
  }
}

async function main() {
  console.log("Tamanor DB doctor\n");
  const owner = await probe("owner (DATABASE_URL / postgres)", process.env.DATABASE_URL);
  const app = await probe("app   (APP_DATABASE_URL / tamanor_app)", process.env.APP_DATABASE_URL);
  console.log("");

  if (!owner) {
    console.log("→ The owner connection failed. DATABASE_URL's password must be your Supabase");
    console.log("  project Database password (Dashboard → Project → Settings → Database →");
    console.log("  'Database password'; use 'Reset database password' if you don't know it).");
    console.log("  Put it in DATABASE_URL, keep the user as postgres.<project-ref>, then re-run.");
    process.exit(1);
  }

  const c = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const role = await c.$queryRawUnsafe<Array<{ x: number }>>(`SELECT 1 AS x FROM pg_roles WHERE rolname = 'tamanor_app'`);
    const forced = await c.$queryRawUnsafe<Array<{ f: boolean }>>(`SELECT relforcerowsecurity AS f FROM pg_class WHERE relname = 'content_items'`);
    const roleExists = role.length > 0;
    const rlsOn = forced[0]?.f === true;
    console.log(`tamanor_app role exists:      ${roleExists}`);
    console.log(`FORCE RLS on content_items:   ${rlsOn}`);
    console.log("");
    if (!rlsOn || !roleExists) {
      console.log("→ Migrations not fully applied. Run:  pnpm db:migrate:deploy");
    } else if (!app) {
      console.log("→ Role exists but app login failed. Run:  pnpm db:set-app-password");
    } else {
      console.log("→ Everything checks out. Run:  pnpm rls-isolation:test");
    }
  } finally {
    await c.$disconnect();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
