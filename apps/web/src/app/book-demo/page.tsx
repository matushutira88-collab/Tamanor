import { redirect } from "next/navigation";

/**
 * V1.50A — Tamanor is now self-service (Start free → /register). The former
 * "Request beta access" demo form is retired; this legacy path permanently
 * redirects to the sales contact form so any old inbound link still lands somewhere
 * useful. The shared lead-capture action (./actions) is still used by /contact.
 */
export default function BookDemoRedirect(): never {
  redirect("/contact");
}
