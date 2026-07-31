import { request, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * V1.39C / V1.42B — stable authenticated fixtures. Waits for the production build to be ready,
 * then bootstraps real sessions via the fail-closed `/api/e2e/login` seam: an owner storageState
 * (state.json, reused by every authenticated project) and a least-privileged viewer storageState
 * (state.viewer.json, used to prove viewers cannot mutate). No credentials or raw tokens are
 * written to the repo (the .auth dir is gitignored).
 *
 * V1.74 (hardening) — the auth bootstrap is a prerequisite ONLY for projects that reuse an authenticated
 * `storageState`. A PUBLIC-only run (e.g. `--project=public-auto-download`) needs no session, so the bootstrap
 * (which requires a seeded fixture tenant/membership in the local DB) is SKIPPED for such runs. This lets the
 * public gates — including the auto-download regression — run deterministically without an authed DB fixture,
 * and never weakens an authenticated project (those still bootstrap). The decision is the pure, unit-tested
 * `runNeedsAuthBootstrap` (see e2e-global-setup-selection.test.ts).
 */
const PORT = Number(process.env.E2E_PORT ?? 3220);
const baseURL = `http://localhost:${PORT}`;

/** Parse selected project names from a Playwright argv (`--project=x` and `--project x` forms). */
export function parseSelectedProjects(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--project=")) out.push(a.slice("--project=".length));
    else if (a === "--project" && i + 1 < argv.length) out.push(argv[++i]!);
  }
  return out;
}

/**
 * True when the run requires the authenticated bootstrap: at least one SELECTED project reuses a
 * `storageState`. With no explicit selection (full run), all projects are considered.
 */
export function runNeedsAuthBootstrap(
  projects: readonly { name: string; use?: { storageState?: unknown } }[],
  selectedNames: readonly string[],
): boolean {
  const chosen = selectedNames.length === 0 ? projects : projects.filter((p) => selectedNames.includes(p.name));
  return chosen.some((p) => !!p.use?.storageState);
}

export default async function globalSetup(config: FullConfig) {
  mkdirSync("e2e/.auth", { recursive: true });

  const selected = parseSelectedProjects(process.argv);
  const needsAuth = runNeedsAuthBootstrap(
    config.projects.map((p) => ({ name: p.name, use: p.use as { storageState?: unknown } })),
    selected,
  );

  const ctx = await request.newContext({ baseURL });
  // Wait for readiness (the app is a production build; no on-demand compilation).
  let up = false;
  for (let i = 0; i < 60; i++) {
    try {
      const h = await ctx.get("/api/health");
      if (h.ok()) { up = true; break; }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) { await ctx.dispose(); throw new Error("web server did not become ready for E2E"); }

  if (!needsAuth) {
    // Public-only run — no authenticated storageState is used by any selected project; skip the DB-backed
    // auth bootstrap so public gates run without a seeded fixture tenant.
    // eslint-disable-next-line no-console
    console.log(`[global-setup] public-only run (${selected.join(", ") || "all"}) — skipping auth bootstrap`);
    await ctx.dispose();
    return;
  }

  const res = await ctx.post("/api/e2e/login");
  if (!res.ok()) throw new Error(`e2e auth bootstrap failed: HTTP ${res.status()}`);
  await ctx.storageState({ path: "e2e/.auth/state.json" });
  await ctx.dispose();

  // Viewer session (separate cookie jar) for the "viewer cannot mutate" proof.
  const vctx = await request.newContext({ baseURL });
  const vres = await vctx.post("/api/e2e/login?role=viewer");
  if (!vres.ok()) throw new Error(`e2e viewer bootstrap failed: HTTP ${vres.status()}`);
  await vctx.storageState({ path: "e2e/.auth/state.viewer.json" });
  await vctx.dispose();
}
