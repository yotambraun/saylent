// share_of_voice display helpers — jsonb does NOT preserve object key order
// (found live on a real run), so count order is re-derived here.
// Used by the dossier verdict strip ("Top rival"), the lede, and the "Who gets mentioned most" bars.

export function sovEntries(
  shareOfVoice: Record<string, number> | null | undefined,
): [string, number][] {
  return Object.entries(shareOfVoice ?? {}).sort(
    ([an, ac], [bn, bc]) => bc - ac || an.localeCompare(bn),
  );
}

/** The top rival, plus everyone tied with it.
 *
 *  Ties used to be broken ALPHABETICALLY and silently: with Beacon Uptime 9 and
 *  Upcheck 9 the headline said "Beacon Uptime is named most, 9 times" while the
 *  rival section two screens down ranked Upcheck first (it appears in more of
 *  the answers that skip you). Same report, two answers to "who is winning".
 *
 *  So a tie is now (a) visible — `tiedWith` is non-empty and the copy says
 *  "named most, 9 times each" — and (b) broken on the SAME ordering the rival
 *  section uses: `preferredOrder` is the rivalGaps ranking (appearances in the
 *  answers that skip you), with alphabetical as the last resort. */
export interface TopRivalPick {
  name: string;
  count: number;
  /** other rivals on the same count (empty when the lead is outright) */
  tiedWith: string[];
}

export function topRivalPick(
  entries: [string, number][],
  brandName: string,
  preferredOrder: string[] = [],
): TopRivalPick | null {
  const brand = brandName.trim().toLowerCase();
  const rivals = entries.filter(([name]) => name.trim().toLowerCase() !== brand);
  if (rivals.length === 0) return null;
  const max = rivals[0][1];
  const tied = rivals.filter(([, c]) => c === max).map(([name]) => name);
  const rank = (name: string) => {
    const i = preferredOrder.findIndex((p) => p.trim().toLowerCase() === name.trim().toLowerCase());
    return i === -1 ? preferredOrder.length : i;
  };
  const ordered = [...tied].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const name = ordered[0];
  return { name, count: max, tiedWith: ordered.slice(1) };
}

/** The tie sentence, or the plain one. "Upcheck and Beacon Uptime are named
 *  most, 9 times each" / "Upcheck is named most, 9 times". */
export function topRivalSentence(pick: TopRivalPick): string {
  const times = `${pick.count} time${pick.count === 1 ? "" : "s"}`;
  if (pick.tiedWith.length === 0) return `${pick.name} is named most, ${times}`;
  const names = [pick.name, ...pick.tiedWith];
  const list =
    names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} are named most, ${times} each`;
}

/** Back-compat entry point (the plain `[name, count]` the views already read).
 *  Same tie-breaking as `topRivalPick`, so every surface picks one name. */
export function topRival(
  entries: [string, number][],
  brandName: string,
  preferredOrder: string[] = [],
): [string, number] | undefined {
  const pick = topRivalPick(entries, brandName, preferredOrder);
  return pick ? [pick.name, pick.count] : undefined;
}
