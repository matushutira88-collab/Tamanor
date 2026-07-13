/**
 * V1.38.2 — renders one or more JSON-LD blocks. Content comes from the truthful
 * generators in `@/lib/jsonld`. Uses a script tag with application/ld+json.
 */
export function JsonLd({ data }: { data: unknown | unknown[] }) {
  const blocks = Array.isArray(data) ? data : [data];
  return (
    <>
      {blocks.map((b, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(b) }}
        />
      ))}
    </>
  );
}
