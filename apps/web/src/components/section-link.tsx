"use client";
/**
 * V1.53B — robust public-header section link. The header section items point at homepage sections
 * (e.g. `/#features`). A plain `<Link href="/#features">` DOES navigate, but the scroll-to-section
 * after a CROSS-ROUTE navigation is timing-dependent (if the homepage hasn't rendered the target yet
 * when Next tries to scroll, the user can land at the top and perceive the link as "dead"). This
 * component makes it deterministic:
 *
 *   - already on the (localized) homepage → smooth-scroll to the section + update the hash;
 *   - on any other page → `router.push` to the homepage, then poll until the section exists and scroll.
 *
 * It renders a real `<a href>` so SEO, no-JS, and modifier/middle-click (open in new tab) all keep
 * working — only a plain left-click is intercepted. Standard Next.js navigation; no window.location,
 * no full-page reload.
 */
import { useRouter, usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";

export function SectionLink({
  home,
  section,
  className,
  children,
}: {
  /** Localized homepage path: "/", "/sk", or "/de". */
  home: string;
  /** Target section id on the homepage (without the leading #). */
  section: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const href = `${home}#${section}`;
  const homePath = home === "" ? "/" : home;

  function scrollToSection(behavior: ScrollBehavior) {
    document.getElementById(section)?.scrollIntoView({ behavior, block: "start" });
  }

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle modifier / non-primary clicks natively (new tab, etc.).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const current = pathname || "/";
    if (current === homePath) {
      window.history.pushState(null, "", href);
      scrollToSection("smooth");
      return;
    }
    // Cross-route: navigate to the homepage, then reliably scroll once the section is in the DOM.
    router.push(href);
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      const el = document.getElementById(section);
      if (el) {
        el.scrollIntoView({ behavior: "auto", block: "start" });
        window.clearInterval(timer);
      } else if (tries > 60) {
        window.clearInterval(timer); // ~3s ceiling — never poll forever
      }
    }, 50);
  }

  return (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
