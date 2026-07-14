/**
 * V1.48P — Next.js instrumentation hook: runs ONCE at server startup (both node + edge runtimes).
 * Initializes the vendor-neutral observability sink so ops events are emitted as safe structured
 * stdout lines from the very first request. Fail-safe: never throws (startup must not break).
 */
export async function register(): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const { initOpsSink } = await import("@guardora/core");
      initOpsSink("web", process.env.NODE_ENV ?? "development");
    }
  } catch {
    /* observability init must never break startup */
  }
}
