import { request } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * V1.39C / V1.42B — stable authenticated fixtures. Waits for the production build to be ready,
 * then bootstraps real sessions via the fail-closed `/api/e2e/login` seam: an owner storageState
 * (state.json, reused by every authenticated project) and a least-privileged viewer storageState
 * (state.viewer.json, used to prove viewers cannot mutate). No credentials or raw tokens are
 * written to the repo (the .auth dir is gitignored).
 */
const PORT = Number(process.env.E2E_PORT ?? 3220);
const baseURL = `http://localhost:${PORT}`;

export default async function globalSetup() {
  mkdirSync("e2e/.auth", { recursive: true });
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
  if (!up) throw new Error("web server did not become ready for E2E");

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
