/**
 * V1.38.3 — IndexNow submitter. DRY-RUN by default: it prints the payload it WOULD
 * send and exits without any network call. Pass `--submit` to actually POST (requires
 * INDEXNOW_KEY). It submits ONLY canonical public URLs, never logs the key, retries
 * with backoff on 429/5xx, and NEVER reports success on an HTTP error.
 *
 *   Dry run:  pnpm indexnow:submit
 *   Submit:   INDEXNOW_KEY=... pnpm indexnow:submit --submit
 *   Specific: pnpm indexnow:submit --submit -- https://tamanor.com/compare  (changed/removed URLs)
 */
import { buildIndexNowPayload, indexNowUrls, INDEXNOW_ENDPOINT } from "../src/lib/indexnow";

const argv = process.argv.slice(2);
const doSubmit = argv.includes("--submit");
const explicit = argv.filter((a) => a.startsWith("https://"));
const urls = explicit.length ? explicit : indexNowUrls();

function maskKey(key: string): string {
  if (!key) return "MISSING";
  return `configured (len=${key.length}, fp=${key.slice(0, 2)}…)`;
}

async function postWithRetry(body: string, attempts = 4): Promise<{ ok: boolean; status: number }> {
  let delay = 500;
  for (let i = 1; i <= attempts; i++) {
    let status = 0;
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body,
      });
      status = res.status;
      // 200/202 = accepted. 4xx (except 429) is terminal — do not retry, do not fake success.
      if (status === 200 || status === 202) return { ok: true, status };
      if (status !== 429 && status < 500) return { ok: false, status };
    } catch {
      status = 0; // network error — retry
    }
    if (i < attempts) {
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    } else {
      return { ok: false, status };
    }
  }
  return { ok: false, status: 0 };
}

async function main() {
  const key = (process.env.INDEXNOW_KEY ?? "").trim();
  const payload = buildIndexNowPayload(key || "DRYRUN_NO_KEY", urls);
  console.log("IndexNow submission");
  console.log(`  endpoint:    ${INDEXNOW_ENDPOINT}`);
  console.log(`  host:        ${payload.host}`);
  console.log(`  keyLocation: ${payload.keyLocation}`);
  console.log(`  key:         ${maskKey(key)}`);
  console.log(`  urls:        ${payload.urlList.length}`);
  console.log(payload.urlList.map((u) => `    - ${u}`).join("\n"));

  if (!doSubmit) {
    console.log("\nDRY RUN — nothing submitted. Re-run with --submit (and INDEXNOW_KEY set) to send.");
    process.exit(0);
  }
  if (!key) {
    console.error("\nERROR: --submit requires INDEXNOW_KEY. Nothing submitted.");
    process.exit(1);
  }
  const body = JSON.stringify(buildIndexNowPayload(key, urls));
  const { ok, status } = await postWithRetry(body);
  if (ok) {
    console.log(`\nSubmitted ${urls.length} URLs. IndexNow accepted (HTTP ${status}).`);
    process.exit(0);
  }
  console.error(`\nIndexNow submission FAILED (HTTP ${status || "network error"}). No success is claimed.`);
  process.exit(1);
}

main();
