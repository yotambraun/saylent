"use client";
// Onboarding form — brand name nonempty; domain regex plus a server preflight
// warning ("we couldn't reach this site — audits may be partial. Continue?").
//
// CATEGORY AND BUYER ARE REQUIRED. They are the two question-
// template slots that have a stand-in fallback: leave them blank and the audit
// asks 23 questions that read "What is the best product for teams evaluating
// options?" — a real ~$3 spend on questions no buyer has ever typed. Both
// carry a concrete example, and createBrand + createRun refuse them server-side
// too (src/lib/placeholder-guard.ts).
//
// VALIDATION IS OURS, NOT THE BROWSER'S. The form is noValidate:
// with the native `required` attribute in place, Chrome's grey bubble ("Please
// check this box if you want to proceed.") fired first and the styled inline
// copy this file already computes was unreachable dead code.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EnginePicker, enginesDefault } from "@/components/engine-picker";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import type { Engine } from "@saylent/engine/types";
import { splitSiteRoot, validateSiteRoot } from "@saylent/report/validation";
import { createBrand, preflightDomain } from "./actions";

export function OnboardingForm({ canPickEngines = false }: { canPickEngines?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [category, setCategory] = useState("");
  const [icp, setIcp] = useState("");
  const [authorized, setAuthorized] = useState(false);
  // ENGINE-SELECT: default all four; only sent when the user is entitled to narrow.
  const [engines, setEngines] = useState<Engine[]>(enginesDefault());
  const [state, setState] = useState<"idle" | "checking" | "confirm-unreachable" | "submitting">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  // Per-field validation errors — shown under the offending field, announced to
  // screen readers, with the first invalid field focused on a failed submit.
  type FieldErrors = {
    name?: string;
    domain?: string;
    category?: string;
    icp?: string;
    authorized?: string;
  };
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // SUBPATH HOSTING: a brand site may be a host root
  // (acme.com) or a path root (acme.com/docs — a docs subpath, a GitHub-Pages
  // project site). One shared normalizer with the server (validateSiteRoot), so
  // what we preflight, show, and store is exactly what the engine will audit.
  const siteRoot = validateSiteRoot(domain);
  const cleanDomain = siteRoot.ok ? siteRoot.value : splitSiteRoot(domain).host;
  const sitePath = splitSiteRoot(domain).path;

  async function launch() {
    setState("submitting");
    setError(null);
    try {
      const brand = await createBrand({
        name,
        domain: cleanDomain,
        competitorsCsv: competitors,
        category,
        icp,
        authorized,
        ...(canPickEngines ? { engines } : {}),
      });
      if (!brand.ok) {
        setError(brand.error);
        setState("idle");
        return;
      }
      // The audit is NOT fired here. The buyer gets the exact question set to
      // review and aim first; the run is spent only from the confirm page. Keep
      // "submitting" until the route swaps.
      router.push(`/app/brand/${brand.brandId}/confirm`);
    } catch {
      // any throw (createBrand) must un-stick the button
      setError("Something went wrong. Try again.");
      setState("idle");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fe: FieldErrors = {};
    if (!name.trim()) fe.name = "Brand name is required.";
    if (!siteRoot.ok) fe.domain = "That doesn't look like a domain (e.g. example.com).";
    if (!category.trim())
      fe.category =
        "Tell us your category — every question asks about it. For example “uptime monitoring”.";
    if (!icp.trim())
      fe.icp =
        "Tell us who buys from you — the questions are asked on their behalf. For example “SRE teams at high-traffic SaaS”.";
    if (!authorized) fe.authorized = "Please confirm you're authorized to run this audit for this brand.";
    setFieldErrors(fe);
    if (fe.name || fe.domain || fe.category || fe.icp || fe.authorized) {
      // Focus the first invalid field so keyboard/screen-reader users land on it.
      const firstBad = fe.name
        ? "name"
        : fe.domain
          ? "domain"
          : fe.category
            ? "category"
            : fe.icp
              ? "icp"
              : "authorized";
      if (typeof document !== "undefined") {
        (document.getElementById(firstBad) as HTMLElement | null)?.focus();
      }
      return;
    }
    setState("checking");
    try {
      const { reachable } = await preflightDomain(cleanDomain);
      if (!reachable) {
        setState("confirm-unreachable");
        return;
      }
    } catch {
      // preflight is a courtesy check — on failure fall through to the audit
      // rather than trapping the user on "Checking your site…"
      await launch();
      return;
    }
    await launch();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="font-display text-2xl">Tell us your brand</CardTitle>
        <CardDescription>
          That&apos;s all we need. Next you&apos;ll review the exact questions before we spend the
          audit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Brand name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Cloud"
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
            />
            {fieldErrors.name && (
              <p id="name-error" role="alert" aria-live="polite" className="text-sm text-pill-dismissed">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="domain">Domain *</Label>
            <Input
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="acmecloud.example"
              aria-invalid={fieldErrors.domain ? true : undefined}
              aria-describedby={fieldErrors.domain ? "domain-error" : undefined}
            />
            {fieldErrors.domain && (
              <p id="domain-error" role="alert" aria-live="polite" className="text-sm text-pill-dismissed">
                {fieldErrors.domain}
              </p>
            )}
            {!fieldErrors.domain && siteRoot.ok && sitePath && (
              <p className="text-xs text-wire">
                We&apos;ll audit <span className="font-mono">{cleanDomain}</span> and the pages under
                it. Drop the path to audit the whole site.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="category">What are you? (your category) *</Label>
            <Input
              id="category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setFieldErrors((prev) => ({ ...prev, category: undefined }));
              }}
              placeholder="e.g. uptime monitoring"
              aria-invalid={fieldErrors.category ? true : undefined}
              aria-describedby={fieldErrors.category ? "category-error" : "category-hint"}
            />
            {fieldErrors.category ? (
              <p
                id="category-error"
                role="alert"
                aria-live="polite"
                className="text-sm text-pill-dismissed"
              >
                {fieldErrors.category}
              </p>
            ) : (
              <p id="category-hint" className="text-xs text-wire">
                The words a buyer would search, not your tagline. &ldquo;uptime
                monitoring&rdquo;, &ldquo;payroll software for restaurants&rdquo;.
              </p>
            )}
            {category.split(",").filter((s) => s.trim()).length >= 3 && (
              <p className="text-xs text-signal">
                This looks like a list of competitors. It belongs in the field below.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="icp">Who buys you? (your buyer) *</Label>
            <Input
              id="icp"
              value={icp}
              onChange={(e) => {
                setIcp(e.target.value);
                setFieldErrors((prev) => ({ ...prev, icp: undefined }));
              }}
              placeholder="e.g. SRE teams at high-traffic SaaS"
              aria-invalid={fieldErrors.icp ? true : undefined}
              aria-describedby={fieldErrors.icp ? "icp-error" : "icp-hint"}
            />
            {fieldErrors.icp ? (
              <p id="icp-error" role="alert" aria-live="polite" className="text-sm text-pill-dismissed">
                {fieldErrors.icp}
              </p>
            ) : (
              <p id="icp-hint" className="text-xs text-wire">
                Every question is asked on their behalf, so this is not optional: blank, the
                engines get asked about &ldquo;teams evaluating options&rdquo; and the answers
                are worthless.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="competitors">Who are you against? (competitors, optional, comma-separated)</Label>
            {/* Fictional rivals on purpose — the same invented set the sample report
                uses (Acme Cloud vs Nimbus / StratoCDN / Fleetly). A placeholder that
                names real vendors reads as an endorsement, or a slight, of companies
                that never agreed to appear here. */}
            <Input id="competitors" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="e.g. Nimbus, StratoCDN, Fleetly" />
            {competitors.trim().length > 0 &&
              !competitors.includes(",") &&
              competitors.trim().split(/\s+/).length >= 4 && (
                <p className="text-xs text-signal">
                  This reads like a category description. It belongs in the field above.
                </p>
              )}
            <p className="text-xs text-wire">Leave empty and we&apos;ll detect them from your site.</p>
          </div>
          {/* ENGINE-SELECT — advanced, and hidden unless this account is allowed to
              narrow the engine set; the default is all four. */}
          {canPickEngines && (
            <div className="grid gap-1.5">
              <Label>Answer engines <span className="font-normal text-wire">(advanced)</span></Label>
              <EnginePicker value={engines} onChange={setEngines} idPrefix="onb" />
            </div>
          )}
          {/* Consent attestation — required before any brand can be audited */}
          <div className="grid gap-1.5">
            <label htmlFor="authorized" className="flex items-start gap-2 text-sm text-wire">
              <input
                id="authorized"
                type="checkbox"
                checked={authorized}
                onChange={(e) => {
                  setAuthorized(e.target.checked);
                  setError(null);
                  setFieldErrors((prev) => ({ ...prev, authorized: undefined }));
                }}
                aria-invalid={fieldErrors.authorized ? true : undefined}
                aria-describedby={fieldErrors.authorized ? "authorized-error" : undefined}
                className="mt-0.5 h-4 w-4 shrink-0 accent-signal"
              />
              <span>I&apos;m authorized to run this audit for this brand.</span>
            </label>
            {fieldErrors.authorized && (
              <p
                id="authorized-error"
                role="alert"
                aria-live="polite"
                className="text-sm text-pill-dismissed"
              >
                {fieldErrors.authorized}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" aria-live="polite" className="text-sm text-pill-dismissed">
              {error}
            </p>
          )}
          {state === "confirm-unreachable" ? (
            <div className="rounded border border-signal/50 bg-signal/10 p-3 text-sm">
              <p>We couldn&apos;t reach this site. Audits may be partial. Continue?</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={launch}>
                  Continue anyway
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setState("idle")}>
                  Fix the domain
                </Button>
              </div>
            </div>
          ) : (
            <Button type="submit" disabled={state !== "idle"}>
              {state === "checking"
                ? "Checking your site…"
                : state === "submitting"
                  ? "Setting up…"
                  : "Review my questions"}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
