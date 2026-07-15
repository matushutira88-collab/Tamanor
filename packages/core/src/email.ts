/**
 * V1.50C — production email delivery abstraction. Configuration is read from the
 * environment ONLY; API keys are never hardcoded and never logged, and no message body
 * (which contains the one-time verification/reset URL + token) is ever logged. Transports:
 *
 *   - "resend"  → real delivery via the Resend REST API (fetch; no SDK dependency).
 *   - "console" → development transport that logs ONLY non-secret metadata (subject +
 *                 redacted recipient) — never a usable token or URL.
 *   - a null transport that FAILS TRUTHFULLY when delivery is not configured.
 *
 * Tests inject a deterministic in-memory transport ({@link MemoryEmailTransport}).
 */

export type EmailMessage = { to: string; subject: string; html: string; text: string };
export type EmailSendResult = { ok: boolean; reason?: "delivery_failed" | "not_configured" };

export interface EmailTransport {
  readonly name: string;
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

export type EmailConfig = { provider: string; from: string; replyTo?: string; apiKey?: string };

/** Redact an address to its domain for safe logging (never log the local-part). */
function redactRecipient(to: string): string {
  const at = to.lastIndexOf("@");
  return at > 0 ? `***@${to.slice(at + 1)}` : "***";
}

/** Read email config from env. Returns null when EMAIL_FROM / provider are unset. */
export function resolveEmailConfig(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const from = env.EMAIL_FROM?.trim();
  if (!from) return null;
  return {
    provider: (env.EMAIL_PROVIDER?.trim() || "console").toLowerCase(),
    from,
    replyTo: env.EMAIL_REPLY_TO?.trim() || undefined,
    apiKey: env.RESEND_API_KEY?.trim() || undefined,
  };
}

/** Real Resend delivery. Never logs the API key or the message body. */
class ResendTransport implements EmailTransport {
  readonly name = "resend";
  constructor(private cfg: EmailConfig) {}
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    if (!this.cfg.apiKey) return { ok: false, reason: "not_configured" };
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.cfg.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: this.cfg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(this.cfg.replyTo ? { reply_to: this.cfg.replyTo } : {}),
        }),
      });
      return resp.ok ? { ok: true } : { ok: false, reason: "delivery_failed" };
    } catch {
      return { ok: false, reason: "delivery_failed" };
    }
  }
}

/** Development transport: logs non-secret metadata only. NEVER prints a usable token/URL. */
class ConsoleTransport implements EmailTransport {
  readonly name = "console";
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    // eslint-disable-next-line no-console
    console.log(`[email:console] "${msg.subject}" → ${redactRecipient(msg.to)} (body suppressed)`);
    return { ok: true };
  }
}

/** No transport configured → fails truthfully (callers surface an honest error). */
class NullEmailTransport implements EmailTransport {
  readonly name = "null";
  async send(): Promise<EmailSendResult> {
    return { ok: false, reason: "not_configured" };
  }
}

/** Deterministic in-memory transport for tests: captures sent messages, no network. */
export class MemoryEmailTransport implements EmailTransport {
  readonly name = "memory";
  readonly sent: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(msg);
    return { ok: true };
  }
  last(): EmailMessage | undefined {
    return this.sent[this.sent.length - 1];
  }
}

export function createEmailTransport(cfg: EmailConfig | null): EmailTransport {
  if (!cfg) return new NullEmailTransport();
  // V1.51 — preview kill-switch: a Vercel PREVIEW deployment must never send REAL transactional
  // email (a throwaway preview mailing real users). Downgrade a `resend` transport to the metadata-
  // only console transport when VERCEL_ENV=preview. Production / self-hosted are unaffected (unset).
  if (cfg.provider === "resend" && (process.env.VERCEL_ENV ?? "").trim().toLowerCase() === "preview") {
    return new ConsoleTransport();
  }
  if (cfg.provider === "resend") return new ResendTransport(cfg);
  if (cfg.provider === "console") return new ConsoleTransport();
  return new NullEmailTransport();
}

// ---- injectable module singleton -------------------------------------------

let override: EmailTransport | null = null;
let cached: EmailTransport | null = null;

/** Inject a transport (tests). Pass null to reset to env-resolved default. */
export function setEmailTransport(t: EmailTransport | null): void {
  override = t;
  cached = null;
}

/** The active transport: an injected one (tests), else resolved once from env. */
export function getEmailTransport(): EmailTransport {
  if (override) return override;
  if (!cached) cached = createEmailTransport(resolveEmailConfig());
  return cached;
}
