/**
 * V1.60 — the STRICT structured-output contract for the OpenAI risk classifier. Two layers:
 *   1. OPENAI_RISK_JSON_SCHEMA — the JSON Schema sent to the Responses API (strict:true), so the model
 *      is constrained to emit exactly these keys with exactly these enum values.
 *   2. openAiRiskSchema (Zod) — a SECOND, local validation of whatever comes back. We never trust the
 *      model output: even with strict mode we re-validate enums + confidence range here, and any failure
 *      is a provider failure (→ rules fallback). No JSON.parse of free text without this schema.
 *
 * All enum values are compatible with the existing domain types (ControlCategory, risk levels,
 * RecommendedAction, sentiment). The output carries NO free-text field the model can fill — `reasonCodes`
 * is a controlled vocabulary — so nothing the model writes can smuggle instructions downstream.
 */
import { z } from "zod";
import { CONTROL_CATEGORIES } from "./control-center";

export const OPENAI_RISK_LEVELS = ["none", "low", "medium", "high", "critical"] as const;
export const OPENAI_SENTIMENTS = ["positive", "neutral", "negative"] as const;
export const OPENAI_RECOMMENDED_ACTIONS = ["escalate", "review", "monitor", "none"] as const;
/** Controlled reason-code vocabulary (NOT free text — the model cannot emit prose here). */
export const OPENAI_REASON_CODES = [
  "spam_promotion", "scam_or_fraud", "phishing_or_credential", "malicious_or_suspicious_link",
  "impersonation", "profanity", "hate_or_racism", "threat_or_violence", "sexual_content",
  "harassment", "customer_question", "normal_criticism", "positive_feedback", "off_topic",
  "ambiguous", "none",
] as const;

export type OpenAiReasonCode = (typeof OPENAI_REASON_CODES)[number];

/** The exact object the model must return. Mirrors the Zod schema below 1:1. */
export interface OpenAiRiskResult {
  category: string;                 // one of CONTROL_CATEGORIES
  riskLevel: (typeof OPENAI_RISK_LEVELS)[number];
  confidence: number;               // 0..1
  reasonCodes: OpenAiReasonCode[];
  recommendedAction: (typeof OPENAI_RECOMMENDED_ACTIONS)[number];
  language: string;                 // short ISO-ish code
  sentiment: (typeof OPENAI_SENTIMENTS)[number];
}

/** JSON Schema for the Responses API (strict: every key required, additionalProperties:false). */
export const OPENAI_RISK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["category", "riskLevel", "confidence", "reasonCodes", "recommendedAction", "language", "sentiment"],
  properties: {
    category: { type: "string", enum: [...CONTROL_CATEGORIES] },
    riskLevel: { type: "string", enum: [...OPENAI_RISK_LEVELS] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasonCodes: { type: "array", items: { type: "string", enum: [...OPENAI_REASON_CODES] } },
    recommendedAction: { type: "string", enum: [...OPENAI_RECOMMENDED_ACTIONS] },
    language: { type: "string", maxLength: 16 },
    sentiment: { type: "string", enum: [...OPENAI_SENTIMENTS] },
  },
} as const;

export const OPENAI_RISK_SCHEMA_NAME = "comment_risk_classification";

// --- Local Zod re-validation of the model output (never trust the model) ---------------------------
const RiskZ = z.object({
  category: z.enum(CONTROL_CATEGORIES as unknown as [string, ...string[]]),
  riskLevel: z.enum(OPENAI_RISK_LEVELS),
  confidence: z.number().finite().min(0).max(1),
  reasonCodes: z.array(z.enum(OPENAI_REASON_CODES)),
  recommendedAction: z.enum(OPENAI_RECOMMENDED_ACTIONS),
  language: z.string().min(1).max(16),
  sentiment: z.enum(OPENAI_SENTIMENTS),
}).strict();

export type ValidationOutcome =
  | { ok: true; value: OpenAiRiskResult }
  | { ok: false; error: string };

/**
 * Parse + STRICTLY validate a model response string with Zod. Returns a normalized error code on ANY
 * problem (parse error, missing/extra key, wrong type, unknown enum, out-of-range confidence). Never
 * throws. No JSON.parse of free text is ever consumed without passing this schema.
 */
export function parseAndValidateRisk(raw: string | null | undefined): ValidationOutcome {
  if (!raw || typeof raw !== "string") return { ok: false, error: "empty_output" };
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return { ok: false, error: "parse_error" }; }
  const parsed = RiskZ.safeParse(obj);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "root";
    return { ok: false, error: `schema_invalid:${path}` };
  }
  return { ok: true, value: parsed.data as OpenAiRiskResult };
}
