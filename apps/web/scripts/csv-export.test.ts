/**
 * V1.69 (Release B / B3) — PURE tests for safe CSV serialization (no DB). Proves RFC-4180 quoting and,
 * critically, the formula-injection guard so exported user content can never execute in a spreadsheet.
 * Run: pnpm csv-export:test
 */
import { csvEscapeField, toCsv } from "@guardora/core";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${cond ? "" : `  — ${detail}`}`);
  cond ? pass++ : fail++;
};

function run() {
  check("plain value unchanged", csvEscapeField("hello") === "hello");
  check("null/undefined → empty", csvEscapeField(null) === "" && csvEscapeField(undefined) === "");
  check("comma → quoted", csvEscapeField("a,b") === '"a,b"');
  check("quote → doubled + wrapped", csvEscapeField('he said "hi"') === '"he said ""hi"""');
  check("newline → quoted", csvEscapeField("line1\nline2") === '"line1\nline2"');
  // Formula-injection guard
  check("=SUM neutralized with leading apostrophe", csvEscapeField("=SUM(A1:A2)") === "'=SUM(A1:A2)");
  check("+, -, @ leaders neutralized", csvEscapeField("+1") === "'+1" && csvEscapeField("-1") === "'-1" && csvEscapeField("@x") === "'@x");
  check("formula that also needs quoting: guard THEN quote", csvEscapeField("=1,2") === '"\'=1,2"');
  check("normal negative number in a non-leading position is fine", csvEscapeField("a-1") === "a-1");

  const doc = toCsv(["id", "text"], [["1", "ok"], ["2", "=cmd"], ["3", "a,b"]]);
  check("toCsv: header + rows, CRLF", doc === 'id,text\r\n1,ok\r\n2,\'=cmd\r\n3,"a,b"\r\n', JSON.stringify(doc));
  check("toCsv: never emits a raw leading = in any cell", !/(^|\r\n|,)=/.test(doc));

  console.log(`\n${fail === 0 ? "PASS" : `FAIL (${fail})`} — safe CSV (V1.69 B3): ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run();
