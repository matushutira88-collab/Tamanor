import { buildAtomFeed } from "@/lib/discoverability";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildAtomFeed(), {
    headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=86400" },
  });
}
