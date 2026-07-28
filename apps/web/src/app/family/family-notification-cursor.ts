/**
 * FAMILY NOTIFICATION CENTER V1 — opaque keyset cursor. Encodes the last row's (createdAt, id) as one base64url
 * token; strict decode fails SAFELY to null (an invalid/forged cursor simply starts from the first page — never
 * a crash, never a leak). No tenant/user/source id is encoded — only the recipient's OWN last (createdAt, id),
 * which the service re-scopes to the authenticated recipient + tenant anyway.
 */
const B64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const UNB64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/; // cuid-shaped; never a URL/path/content

export function encodeFamilyNotificationCursor(createdAt: Date, id: string): string {
  return B64(`${createdAt.getTime()}.${id}`);
}

/** Decode → { before, beforeId } or null on ANY malformation (bad base64 / shape / non-numeric ts / bad id). */
export function decodeFamilyNotificationCursor(cursor: string | undefined | null): { before: Date; beforeId: string } | null {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 128) return null;
  let raw: string;
  try { raw = UNB64(cursor); } catch { return null; }
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const tsStr = raw.slice(0, dot), id = raw.slice(dot + 1);
  if (!/^\d{1,15}$/.test(tsStr) || !ID_RE.test(id)) return null;
  const ms = Number(tsStr);
  if (!Number.isSafeInteger(ms) || ms <= 0) return null;
  return { before: new Date(ms), beforeId: id };
}

/** Normalize the `view` query param to the two allowed values (anything else → "all"). */
export function normalizeFamilyNotificationView(view: string | undefined | null): "all" | "unread" {
  return view === "unread" ? "unread" : "all";
}
