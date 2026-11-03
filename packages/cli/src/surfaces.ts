// Answer surfaces on the CLI: which sources a run can actually ask with the
// keys on this machine, where surface answers are fetched from, and the lines
// the preflight and the finish summary print. Shared by `saylent audit`, the
// MCP audit tool and `saylent verify`, so the three never disagree.
//
// Surfaces are opt-in (`--surfaces`, or a surface id in `--engines` / config
// `engines`) and read through the operator's own SerpApi key. An explicitly
// requested surface with no key is refused by name rather than silently
// dropped: the operator asked for it and would otherwise pay for a run that
// quietly left it out.
import type { Engine, SurfaceId } from "@saylent/engine";
import type { SaylentConfig } from "@saylent/engine/config";
import type { SourceIntelligence } from "@saylent/engine/sources";
import {
  DOMAIN_TYPE_LABEL,
} from "@saylent/engine/sources";
import {
  SERP_PROVIDERS,
  SURFACES,
  type SerpProviderId,
  type SurfaceLocale,
  engineLabel,
  isSurfaceId,
  normalizeSurfaceLocale,
} from "@saylent/engine/surfaces";
import { SERP_REQUEST_CENTS } from "@saylent/engine/rates";
import { PROVIDERS, PROVIDER_TO_ENGINE, type KeyMap } from "./keys";
import { glyph } from "./glyphs";

/** true when this machine has the key that asks `engine`. */
export function hasKeyFor(engine: Engine, keys: KeyMap): boolean {
  if (isSurfaceId(engine)) return Boolean(keys.serpapi);
  const provider = PROVIDERS.find((p) => PROVIDER_TO_ENGINE[p.id] === engine);
  return provider ? Boolean(keys[provider.id]) : false;
}

export interface EnginePlan {
  /** what was asked for: the engine list (default: the four model engines)
   *  plus any --surfaces, canonical order, deduped */
  requested: Engine[];
  /** the requested sources this machine has a key for */
  available: Engine[];
  /** requested surfaces with no SerpApi key (refused unless dry-run) */
  surfacesWithoutKey: SurfaceId[];
}

const ORDER: Engine[] = ["chatgpt", "claude", "gemini", "perplexity", "google_ai_overview", "google_ai_mode", "copilot"];

export function planEngines(
  engines: readonly Engine[] | undefined,
  addSurfaces: readonly SurfaceId[] | undefined,
  keys: KeyMap,
): EnginePlan {
  const base: Engine[] = engines?.length ? [...engines] : PROVIDERS.map((p) => PROVIDER_TO_ENGINE[p.id]);
  const all = new Set<Engine>([...base, ...(addSurfaces ?? [])]);
  const requested = ORDER.filter((e) => all.has(e));
  const available = requested.filter((e) => hasKeyFor(e, keys));
  const surfacesWithoutKey = requested.filter((e): e is SurfaceId => isSurfaceId(e) && !keys.serpapi);
  return { requested, available, surfacesWithoutKey };
}

/** The refusal for a surface asked for without a key. */
export function missingSurfaceKeyMessage(surfaces: readonly SurfaceId[]): string {
  const names = surfaces.map((s) => SURFACES[s].label).join(", ");
  return (
    `${names} ${surfaces.length === 1 ? "needs" : "need"} a SerpApi key (${SERP_PROVIDERS.serpapi.envVar}). ` +
    "Set one with `saylent keys set serpapi` (free plan: 250 searches a month), or drop the surface from the run."
  );
}

/** Where surface answers are fetched from. THE PRECEDENCE, in one place:
 *    country  = --country > saylent.config surfaces.country > the --questions
 *               file's locale.country > provider default
 *    language = saylent.config surfaces.language > --locale > the --questions
 *               file's locale.language > provider default
 *    location = --location > saylent.config surfaces.location
 *  Throws the sentence to print on a bad value. */
export function resolveSurfaceLocale(input: {
  country?: string | null;
  location?: string | null;
  locale?: string | null;
  config?: SaylentConfig["surfaces"] | null;
  /** questions.json `locale` (saylent questions import) */
  questions?: { language?: string; country?: string } | null;
}): SurfaceLocale {
  const r = normalizeSurfaceLocale({
    country: input.country ?? input.config?.country ?? input.questions?.country,
    language: input.config?.language ?? input.locale ?? input.questions?.language ?? undefined,
    location: input.location ?? input.config?.location,
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** "gl=us · hl=en · Austin, Texas" / "provider default location" */
export function formatSurfaceLocale(l: SurfaceLocale | null | undefined): string {
  const parts = [
    l?.country ? `country ${l.country}` : null,
    l?.language ? `language ${l.language}` : null,
    l?.location ? l.location : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(` ${glyph("sep")} `) : "provider default location";
}

/** The preflight's Surfaces line, or null when the run asks no surface. */
export function surfacesLine(
  engines: readonly Engine[],
  locale: SurfaceLocale | null | undefined,
  provider: SerpProviderId = "serpapi",
): string | null {
  const surfaces = engines.filter(isSurfaceId);
  if (surfaces.length === 0) return null;
  const meta = SERP_PROVIDERS[provider];
  const cents = SERP_REQUEST_CENTS[provider];
  const noLocale = surfaces.filter((s) => !SURFACES[s].capabilities.locale.country).map((s) => SURFACES[s].label);
  return (
    `${surfaces.map(engineLabel).join(", ")} via ${meta.label} ${glyph("sep")} ${formatSurfaceLocale(locale)}` +
    ` ${glyph("sep")} priced at ${cents}c/search (${meta.label} Starter plan rate)` +
    (noLocale.length ? ` ${glyph("sep")} ${noLocale.join(", ")} takes no locale` : "")
  );
}

/** The finish summary's two source lines (counts only), or [] when nothing
 *  was cited. */
export function sourcesSummaryLines(intel: SourceIntelligence | null | undefined): string[] {
  if (!intel || intel.totals.citations === 0) return [];
  const top = intel.domains[0];
  const lines = [
    `  Sources   ${intel.totals.citations} citations ${glyph("sep")} ${intel.totals.domains} domains` +
      (top ? ` ${glyph("sep")} most cited: ${top.host} (${top.citations}, ${DOMAIN_TYPE_LABEL[top.type].toLowerCase()})` : ""),
  ];
  const opp = intel.opportunities[0];
  lines.push(
    opp
      ? `  Off-site  ${intel.opportunities.length} opportunit${intel.opportunities.length === 1 ? "y" : "ies"} ${glyph("sep")} first: ${opp.host}, in ${opp.evidence} answer${opp.evidence === 1 ? "" : "s"} that name a rival and not you`
      : `  Off-site  none: no cited off-site domain backs a rival without you`,
  );
  return lines;
}
