import { buildSitemapXml } from "@/lib/discoverability";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildSitemapXml(), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=86400" },
  });
}
