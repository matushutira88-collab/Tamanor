/**
 * V1.51 — preview/production environment separation (defense-in-depth kill-switch).
 * Pure unit test (no DB). Run via: pnpm env-separation:test
 */
import { deploymentEnv, isPreviewDeployment } from "@guardora/config";
import { createEmailTransport } from "@guardora/core";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  if (!cond) failures++;
}

// deploymentEnv — Vercel-authoritative, NODE_ENV fallback off-Vercel.
check("VERCEL_ENV=production → production", deploymentEnv({ VERCEL_ENV: "production" } as never) === "production");
check("VERCEL_ENV=preview → preview", deploymentEnv({ VERCEL_ENV: "preview" } as never) === "preview");
check("VERCEL_ENV=development → development", deploymentEnv({ VERCEL_ENV: "development" } as never) === "development");
check("no VERCEL_ENV + NODE_ENV=production → production (self-host)", deploymentEnv({ NODE_ENV: "production" } as never) === "production");
check("no VERCEL_ENV + NODE_ENV=test → development", deploymentEnv({ NODE_ENV: "test" } as never) === "development");
check("garbage VERCEL_ENV falls back to NODE_ENV", deploymentEnv({ VERCEL_ENV: "weird", NODE_ENV: "production" } as never) === "production");

// isPreviewDeployment — TRUE only for an explicit Vercel preview.
check("isPreviewDeployment: preview → true", isPreviewDeployment({ VERCEL_ENV: "preview" } as never) === true);
check("isPreviewDeployment: production → false (unaffected)", isPreviewDeployment({ VERCEL_ENV: "production" } as never) === false);
check("isPreviewDeployment: unset → false (self-host unaffected)", isPreviewDeployment({ NODE_ENV: "production" } as never) === false);

// Email kill-switch: the production Google transport downgrades to console ONLY under a preview.
const googleCfg = { provider: "google", from: "no-reply@tamanor.com", google: { clientId: "id", clientSecret: "sec", refreshToken: "rt" } };
const prev = process.env.VERCEL_ENV;
try {
  process.env.VERCEL_ENV = "preview";
  const t1 = createEmailTransport({ ...googleCfg });
  check("preview: google transport downgraded to console (no real send)", t1.name === "console", t1.name);

  process.env.VERCEL_ENV = "production";
  const t2 = createEmailTransport({ ...googleCfg });
  check("production: google transport used (real send)", t2.name === "google", t2.name);

  delete process.env.VERCEL_ENV;
  const t3 = createEmailTransport({ ...googleCfg });
  check("self-host (unset): google transport used (unaffected)", t3.name === "google", t3.name);
} finally {
  if (prev === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = prev;
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — preview/production environment separation (V1.51)`);
if (failures > 0) process.exit(1);
