"use server";
// /app/onboarding — brand creation (user's own RLS insert) and
// the domain reachability preflight (warn, never block).
import { track } from "@/lib/analytics";
import { assertNotDemo } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";
import { normalizeSelection } from "@saylent/engine/engines";
import { blockedDomainReason } from "@/lib/blocked-domains";
import { brandLimit } from "@/lib/limits";
import { RATE_LIMITS, checkRateLimit } from "@/lib/rate-limit";
import { validateBrandFields } from "@saylent/report/validation";
import { parseIcp } from "@/app/app/settings/brands/brand-context";
import { PLACEHOLDER_CATEGORY, PLACEHOLDER_ICP } from "@/lib/placeholder-guard";
import { parseSiteRoot } from "@saylent/engine/crawl";
import { safeFetch } from "@saylent/engine/util";

export async function preflightDomain(domain: string): Promise<{ reachable: boolean }> {
  // Hosted read-only demo: a preflight is an outbound fetch this deployment pays
  // for and is attributed to, on a host a visitor chose. The demo makes no
  // network requests on a visitor's behalf.
  if (assertNotDemo()) return { reachable: false };

  // Exported server action = public endpoint: require auth (like createBrand) and
  // reject private/internal hosts (SSRF) before issuing the outbound fetch.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { reachable: false };

  // ...and cap it. Auth alone made this a free port/host scanner and a
  // traffic amplifier: one signed-up account could drive unlimited outbound
  // requests from our IP at our cost, one host per call. Durable per-user
  // window (fails open on a limiter blip, like every other caller).
  if (!(await checkRateLimit(RATE_LIMITS.preflight, user.id))) {
    return { reachable: false };
  }

  // SUBPATH HOSTING: preflight the SITE root the audit
  // will actually crawl — the host root for a bare domain (unchanged), the path
  // root for `example.com/docs`. parseSiteRoot is the engine's own normalizer.
  const { base } = parseSiteRoot(domain);
  // safeFetch is the hardened path: it DNS-resolves and blocks private/reserved
  // addresses post-resolution, re-checks + re-resolves every redirect hop
  // (redirect:manual), and caps the body — closing the SSRF/rebind gap the old raw
  // fetch(redirect:"follow") + host-only check left open. status 0 = guard/network fail.
  const res = await safeFetch(base, { timeoutMs: 5000 });
  return { reachable: res.status > 0 && res.status < 500 };
}

export async function createBrand(input: {
  name: string;
  domain: string;
  competitorsCsv?: string;
  category?: string;
  /** Who buys you. REQUIRED alongside category: with either one blank the
   *  question templates fall back to "product" / "teams evaluating options" and
   *  the whole audit asks questions no buyer types. */
  icp?: string;
  /** The required "I'm authorized
   *  to run this audit for this brand" attestation. Must be true — the consent
   *  shield for republishing rival claims. */
  authorized?: boolean;
  /** the answer-engine
   *  selection. Ignored (→ all four) for non-pro; validated server-side regardless
   *  of the client. Omit / all four / empty → stored as null (the default). */
  engines?: string[];
}): Promise<{ ok: true; brandId: string } | { ok: false; error: string }> {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return demo;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in first." };

  // consent gate: no attestation, no brand. Honest, non-legalese message.
  if (input.authorized !== true) {
    return {
      ok: false,
      error: "Please confirm you're authorized to run this audit for this brand.",
    };
  }

  // zod bounds: these fields flow into LLM prompts +
  // storage, so cap length/shape before anything touches them.
  const valid = validateBrandFields(input);
  if (!valid.ok) return { ok: false, error: valid.error };
  const { name, domain, category, competitors } = valid.value;

  // Category + who-buys-you are REQUIRED. They are the two
  // template slots with a stand-in fallback, and a brand created without them
  // gets 23 questions asking about "product" for "teams evaluating options".
  // The form asks for both; this is the server half, and createRun refuses the
  // run as well (placeholder-guard.ts).
  if (!category || category.toLowerCase() === PLACEHOLDER_CATEGORY) {
    return {
      ok: false,
      error:
        "Tell us your category — it is what every question asks about. For example “uptime monitoring” or “payroll software for restaurants”.",
    };
  }
  const icpParsed = parseIcp(input.icp ?? "");
  if (!icpParsed.ok) return { ok: false, error: icpParsed.error };
  const icp = icpParsed.value;
  if (!icp || icp.toLowerCase() === PLACEHOLDER_ICP) {
    return {
      ok: false,
      error:
        "Tell us who buys from you — the questions are asked on their behalf. For example “SRE teams at high-traffic SaaS” or “independent restaurant owners”.",
    };
  }

  // TRUST-SAFETY: refuse domains we've been asked to stop auditing (read via the
  // service role — blocked_domains is service-role-only). Same gate lives in
  // createRun for the re-audit path.
  const blocked = await blockedDomainReason(domain);
  if (blocked) return { ok: false, error: blocked };

  const { data: existing } = await supabase
    .from("brands")
    .select("id")
    .eq("domain", domain)
    .maybeSingle();
  if (existing) return { ok: true, brandId: existing.id };

  // Brand-count cap (config-driven, one number for everyone — BRAND_LIMIT).
  // Editing/re-auditing the existing brand stays open — we only block a NEW one.
  const cap = brandLimit();
  const { count: owned } = await supabase
    .from("brands")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((owned ?? 0) >= cap) {
    return {
      ok: false,
      error: `This deployment allows ${cap} brand${cap === 1 ? "" : "s"} per account. Edit or remove one in settings, or ask your operator to raise the brand limit.`,
    };
  }

  // Answer-engine narrowing (default: all four).
  const engineSel = normalizeSelection(input.engines);
  if (!engineSel.ok) return { ok: false, error: engineSel.error };

  const { data, error } = await supabase
    .from("brands")
    .insert({
      user_id: user.id,
      name,
      domain,
      competitors,
      category,
      icp,
      // The buyer is now always the owner's own words, so it wins VERBATIM in
      // the audit (inngest/functions.ts keepIcp) instead of being re-derived
      // from the crawl.
      context_source: "user",
      engines: engineSel.store,
      // consent attestation, recorded with who attested (their email). brands is
      // user-writable (0025), so this is the owner's own RLS insert.
      authorized_at: new Date().toISOString(),
      authorized_by: user.email ?? user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the brand." };
  // brand_created — a NEW brand was inserted (the early "existing brand"
  // return above is a no-op, not a creation). Fire-and-forget: track() never throws.
  await track("brand_created", { userId: user.id, props: { brand_id: data.id } });
  return { ok: true, brandId: data.id };
}
