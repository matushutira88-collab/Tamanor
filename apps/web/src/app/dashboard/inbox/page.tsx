import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// V1.30B — the product-facing page for all captured comments is now
// /dashboard/comments. The old "Inbox" list redirects there (kept routable for
// backwards compatibility; the /dashboard/inbox/[id] detail route is unchanged).
export default function InboxPage() {
  redirect("/dashboard/comments");
}
