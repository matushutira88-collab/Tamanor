import { buildTopics } from "@/lib/discoverability";

export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(buildTopics(), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=86400" },
  });
}
