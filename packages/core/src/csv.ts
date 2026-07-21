/**
 * V1.69 (Release B / B3) — safe CSV serialization (pure). RFC-4180 quoting PLUS a formula-injection
 * guard: a field beginning with = + - @ (or a control char) is neutralized with a leading apostrophe so
 * a spreadsheet never executes exported user content as a formula. Used by the tenant-scoped export route.
 */

/** Escape one field: neutralize formula triggers, then RFC-4180 quote if needed. */
export function csvEscapeField(value: unknown): string {
  let s = value == null ? "" : typeof value === "string" ? value : String(value);
  // Formula-injection guard (Excel/Sheets): a leading =,+,-,@ or tab/CR would be evaluated.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  // RFC-4180: wrap in quotes and double any internal quote when the field has , " CR or LF.
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Build a CSV document (CRLF line endings) from a header row and data rows. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const out = [headers.map(csvEscapeField).join(",")];
  for (const row of rows) out.push(row.map(csvEscapeField).join(","));
  return out.join("\r\n") + "\r\n";
}
