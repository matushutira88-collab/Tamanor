"use client";

import { useId, useRef, useState } from "react";
import { passwordScoreClient, strengthLabel, generatePasswordClient } from "@/lib/password-ux";

/**
 * V1.58.9 — accessible password input: show/hide toggle (keyboard-accessible, aria, no focus loss, never
 * mutates the value), an advisory strength meter, and an optional cryptographic generator + copy button.
 * The input is UNCONTROLLED (autofill + password managers work); we only mirror the value for the meter.
 */
export interface PasswordFieldProps {
  name: string;
  label: string;
  autoComplete: "new-password" | "current-password";
  required?: boolean;
  minLength?: number;
  showStrength?: boolean;
  withGenerator?: boolean;
  /** Localized labels (defaults are English). */
  labels?: { show: string; hide: string; generate: string; copy: string; copied: string; strength: Record<string, string> };
}

const DEFAULT_LABELS = {
  show: "Show password", hide: "Hide password", generate: "Generate strong password", copy: "Copy", copied: "Copied",
  strength: { weak: "Weak", fair: "Fair", strong: "Strong", very_strong: "Very strong" } as Record<string, string>,
};

const field = "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 pr-11 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-brand)]";

export function PasswordField(props: PasswordFieldProps) {
  const L = { ...DEFAULT_LABELS, ...props.labels };
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);

  const score = passwordScoreClient(value);
  const label = strengthLabel(score);
  const barColor = ["#ef4444", "#f59e0b", "#eab308", "#22c55e", "#16a34a"][score];

  const generate = () => {
    const pw = generatePasswordClient(24);
    if (ref.current) {
      ref.current.value = pw;
      setValue(pw);
      setVisible(true); // reveal the generated password so the user can save it
    }
  };
  const copy = async () => {
    const v = ref.current?.value ?? "";
    if (!v) return;
    try { await navigator.clipboard.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="block text-sm font-medium">{props.label}</label>
        {props.withGenerator ? (
          <button type="button" onClick={generate} className="text-xs font-medium text-[var(--color-brand)] hover:underline">{L.generate}</button>
        ) : null}
      </div>
      <div className="relative mt-1">
        <input
          ref={ref}
          id={id}
          name={props.name}
          type={visible ? "text" : "password"}
          required={props.required}
          minLength={props.minLength}
          autoComplete={props.autoComplete}
          onChange={(e) => setValue(e.target.value)}
          className={field}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? L.hide : L.show}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          {visible ? "🙈" : "👁"}
        </button>
      </div>

      {props.withGenerator ? (
        <div className="mt-1 flex items-center gap-3">
          <button type="button" onClick={copy} className="text-xs text-[var(--color-brand)] hover:underline">{copied ? L.copied : L.copy}</button>
          <span className="text-[11px] text-[var(--color-muted)]">Save it in your password manager — it won’t be shown again after registration.</span>
        </div>
      ) : null}

      {props.showStrength && value ? (
        <div className="mt-2" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded bg-[var(--color-surface-2)]">
            <div className="h-full transition-all" style={{ width: `${((score + 1) / 5) * 100}%`, background: barColor }} />
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted)]">{L.strength[label]}</p>
        </div>
      ) : null}
    </div>
  );
}
