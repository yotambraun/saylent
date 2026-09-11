// Presentation-layer de-templating of the fix plan. The
// engine emits one `source-{host}` pitch fix per opportunity page (src/engine/
// fixes.ts); a dossier that lists six near-identical "Pitch www.X — the engines
// cite it and you're not on it" rows reads templated. This groups every
// same-shape source pitch into one cluster and leaves each other fix (unique
// fix_key) untouched. Pure: no React/Supabase/Next — the view wraps it in a
// useMemo and passes its DB FixRow[] straight through (T carries the full row).

/** Minimal fix shape this reads — a structural subset of the dossier's FixRow
 *  (DB snake_case), so views pass their rows and get them back in `fixes`. */
export interface FixLike {
  fix_key: string;
  title: string;
  weight: number;
}

export interface FixGroup<T extends FixLike = FixLike> {
  kind: "single" | "cluster";
  /** the discriminator: "source" for `source-{host}` pitches, else the fix_key.
   *  pickTopMoves keeps at most one group per shape. */
  shape: string;
  /** cluster headline, or the lone fix's own title for a singleton */
  title: string;
  /** max child weight — the position the group holds in the weight order */
  groupWeight: number;
  /** children in weight order (a singleton holds exactly one) */
  fixes: T[];
  /** target hosts parsed from `source-{host}` keys; [] for non-source groups */
  hosts: string[];
}

// The source pitch verb → page-type plural, read from the title prefix that
// src/engine/fixes.ts::sourceTitle() encodes 1:1 (the page_type is not on the
// Fix shape). "Pitch" (docs/news/other) is deliberately absent — its true type
// is unknown from the title, so it counts toward the "sources" fallback.
const PLURAL_BY_PREFIX: { prefix: string; plural: string }[] = [
  { prefix: "Get added to ", plural: "listicles" },
  { prefix: "Get into ", plural: "comparisons" },
  { prefix: "Get mentioned in ", plural: "videos" },
  { prefix: "Claim your ", plural: "review-platform listings" },
  { prefix: "Reply in ", plural: "forum threads" },
  { prefix: "Update ", plural: "wiki pages" },
];

const SOURCE_PREFIX = "source-";
const isSource = (f: FixLike) => f.fix_key.startsWith(SOURCE_PREFIX);
const shapeOf = (f: FixLike) => (isSource(f) ? "source" : f.fix_key);
const hostOf = (f: FixLike) => (isSource(f) ? f.fix_key.slice(SOURCE_PREFIX.length) : "");
const pluralOf = (title: string): string | null =>
  PLURAL_BY_PREFIX.find((p) => title.startsWith(p.prefix))?.plural ?? null;

function dedupe(hosts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hosts) {
    if (h && !seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

/** Cluster headline: the dominant page-type plural when one type has a strict
 *  plurality over both the runner-up type and the unknown-type pile; otherwise
 *  the honest, mixed-safe "sources". */
function clusterTitle(children: FixLike[]): string {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const f of children) {
    const p = pluralOf(f.title);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    else unknown += 1;
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  const plural = top && top[1] > runnerUp && top[1] > unknown ? top[0] : "sources";
  return `Get onto the ${children.length} ${plural} the engines trust: a drafted pitch for each`;
}

export function groupFixes<T extends FixLike>(fixes: T[]): FixGroup<T>[] {
  const buckets = new Map<string, { fix: T; idx: number }[]>();
  fixes.forEach((fix, idx) => {
    const shape = shapeOf(fix);
    const b = buckets.get(shape);
    if (b) b.push({ fix, idx });
    else buckets.set(shape, [{ fix, idx }]);
  });

  const built: { group: FixGroup<T>; firstIdx: number }[] = [];
  for (const [shape, items] of buckets) {
    const ordered = [...items].sort((a, b) => b.fix.weight - a.fix.weight || a.idx - b.idx);
    const children = ordered.map((x) => x.fix);
    if (shape === "source" && children.length >= 2) {
      built.push({
        group: {
          kind: "cluster",
          shape,
          title: clusterTitle(children),
          groupWeight: children[0].weight,
          fixes: children,
          hosts: dedupe(children.map(hostOf)),
        },
        firstIdx: Math.min(...items.map((x) => x.idx)),
      });
    } else {
      for (const { fix, idx } of ordered) {
        built.push({
          group: {
            kind: "single",
            shape,
            title: fix.title,
            groupWeight: fix.weight,
            fixes: [fix],
            hosts: dedupe([hostOf(fix)]),
          },
          firstIdx: idx,
        });
      }
    }
  }

  return built
    .sort((a, b) => b.group.groupWeight - a.group.groupWeight || a.firstIdx - b.firstIdx)
    .map((x) => x.group);
}

/** The top `n` moves by weight, at most one per shape — clusters already fold
 *  same-shape pitches together, and this additionally stops two different-host
 *  source groups (a listicle cluster + a leftover pitch) both taking a slot. */
export function pickTopMoves<T extends FixLike>(groups: FixGroup<T>[], n = 3): FixGroup<T>[] {
  const seen = new Set<string>();
  const out: FixGroup<T>[] = [];
  for (const g of [...groups].sort((a, b) => b.groupWeight - a.groupWeight)) {
    if (seen.has(g.shape)) continue;
    seen.add(g.shape);
    out.push(g);
    if (out.length >= n) break;
  }
  return out;
}
