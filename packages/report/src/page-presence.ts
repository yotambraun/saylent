// The battlefield headline. Over the pages we could
// VERIFY (brand_present !== null), how many does the top rival sit on vs the
// brand. This is PAGE presence, not answer share-of-voice — deliberately no
// import of sov.ts. Counts, never percentages; the sentence names honest
// denominators and must carry the phrase "pages behind these answers". Pure:
// no React/Supabase/Next.

/** Minimal cited-page shape — a structural subset of the dossier's CorpusRow. */
export interface PagePresencePage {
  /** true = brand verified present, false = verified absent, null = unverifiable */
  brand_present: boolean | null;
  competitors_present: string[];
}

export interface PagePresence {
  sentence: string;
  rivalName: string;
  rivalPages: number;
  brandPages: number;
  verifiedPages: number;
  totalPages: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function pagePresence(
  pages: PagePresencePage[],
  brand: string,
  aliases: string[] = [],
): PagePresence | null {
  const verified = pages.filter((p) => p.brand_present !== null);
  const V = verified.length;
  if (V === 0) return null;

  const self = new Set([brand, ...aliases].map(norm));
  const B = verified.filter((p) => p.brand_present === true).length;

  const counts = new Map<string, { name: string; count: number }>();
  for (const p of verified) {
    const seen = new Set<string>();
    for (const c of p.competitors_present) {
      const key = norm(c);
      if (!key || self.has(key) || seen.has(key)) continue;
      seen.add(key);
      const e = counts.get(key) ?? { name: c.trim(), count: 0 };
      e.count += 1;
      counts.set(key, e);
    }
  }

  const top = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0];
  if (!top) return null;

  return {
    sentence: `${top.name} is on ${top.count} of the ${V} pages behind these answers we could verify; you're on ${B}.`,
    rivalName: top.name,
    rivalPages: top.count,
    brandPages: B,
    verifiedPages: V,
    totalPages: pages.length,
  };
}
