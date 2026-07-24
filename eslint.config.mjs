// V1.48P — flat ESLint config (ESLint 10). Replaces the deprecated `next lint` interactive workflow
// with a real, non-interactive CLI gate: `pnpm lint` → `eslint .`. Scoped to catch genuine correctness
// bugs on a large existing codebase WITHOUT reformatting it (stylistic/opinionated TS rules are off so
// the gate passes on current code and stays meaningful for real defects).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-e2e/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.d.ts",
      "**/prisma/migrations/**",
      "**/generated/**",
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  js.configs.recommended,
  // TypeScript parsing (non type-checked — fast, no tsconfig project graph needed for the gate).
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly", console: "readonly", Buffer: "readonly", fetch: "readonly",
        URL: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        crypto: "readonly", structuredClone: "readonly", globalThis: "readonly",
        Response: "readonly", Request: "readonly", Headers: "readonly", NodeJS: "readonly", React: "readonly",
      },
    },
    rules: {
      // Real-bug rules (kept as errors):
      "no-debugger": "error",
      "no-cond-assign": ["error", "except-parens"],
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      // New ESLint 10 opinionated rules OFF (they flag intentional init-then-reassign-in-closure and
      // throw-without-cause patterns already present; not real bugs, and fixing them = churn).
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      // Style/opinion rules turned OFF so the gate passes on existing code (no mass reformatting):
      "no-empty": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-regex-spaces": "off",
      "no-unused-expressions": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  // Next.js plugin registration — GLOBAL (no rules). Two reasons it must be unscoped:
  //  1. It makes the `@next/next/*` rules DEFINED everywhere (so in-file directives like
  //     `eslint-disable @next/next/no-img-element` resolve instead of erroring "rule not found").
  //  2. `next build`'s own lint detects the plugin by resolving the config for the CONFIG-FILE path
  //     itself (eslint.config.mjs / package.json), not a source file — so a block scoped to
  //     `apps/web/**` is invisible to that check and yields "plugin was not detected". A global
  //     plugin registration is seen by that detection. It carries NO rules, so non-Next workspace
  //     packages are completely unaffected.
  { plugins: { "@next/next": nextPlugin } },
  // Next.js RULES — scoped to the Next app only (apps/web). Spread ONLY `.rules` from the legacy
  // `configs.recommended`/`core-web-vitals` (their string-array `plugins` field is rejected by flat
  // config; the plugin is already registered globally above).
  {
    files: ["apps/web/**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // App Router only — there is no `pages/` directory, so this Pages-Router rule cannot resolve
      // internal routes and emits a spurious "Pages directory cannot be found" diagnostic. Off by
      // necessity, not to weaken the gate (App-Router link correctness is not this rule's concern).
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  // Test/script files: relax further (they intentionally use loose patterns).
  {
    files: ["**/scripts/**", "**/*.test.ts", "**/*.test.tsx", "**/e2e/**"],
    rules: { "no-console": "off", "no-constant-binary-expression": "off" },
  },
);
