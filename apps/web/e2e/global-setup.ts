import { request } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * V1.39C — stable authenticated fixture. Waits for the production build to be ready, then
 * bootstraps ONE real session via the fail-closed `/api/e2e/login` seam and saves it as a
 * storageState the authenticated projects reuse. No credentials or raw tokens are written
 * to the repo (state.json is gitignored).
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
}
