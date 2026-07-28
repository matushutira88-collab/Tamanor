/**
 * FAMILY NOTIFICATION CENTER V1 — shared constants + types. Kept OUT of the "use server" actions file (which may
 * export only async functions) and imported by the route, the client center, and the actions.
 */
import type { FamilyNotificationCardVM } from "../../family-notification-view";

/** Bounded page size for the center list (hard-capped well under 50; the service clamps too). */
export const FAMILY_NOTIFICATIONS_PAGE_SIZE = 20;

export type CenterActionState = { status: "idle" | "read" | "readall" | "dismissed" | "error" };

export interface FamilyNotificationPage { items: FamilyNotificationCardVM[]; nextCursor: string | null }
