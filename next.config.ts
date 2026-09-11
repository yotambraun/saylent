import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // OWN-SERVER run target (see Dockerfile): standalone output
  // traces the files the server actually needs into .next/standalone, so the image
  // ships without node_modules
  // (node_modules/next/dist/docs/.../output.md).
  // Gated on an env var the Dockerfile sets, so the Vercel/dev build is untouched.
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // Workspace packages: @saylent/engine and @saylent/report ship raw
  // TypeScript with no build step (source-level `exports` in their
  // package.json) — Next must compile them like app code rather than treat
  // them as pre-built node_modules. Turbopack transpiles monorepo workspace
  // packages automatically, and so does webpack for the App Router (this app
  // is App Router only), so this is redundant with the default in both of
  // this app's build paths today; kept explicit so the guarantee doesn't
  // depend on which bundler is active (see
  // node_modules/next/dist/docs/.../transpilePackages.md).
  transpilePackages: ["@saylent/engine", "@saylent/report"],
  // GET /api/health (src/app/api/health/route.ts) reads supabase/migrations/*.sql
  // off disk at request time to report which migrations are applied — outside
  // src/, so file tracing drops it by default on the standalone/Vercel output
  // modes unless listed here.
  outputFileTracingIncludes: {
    "/api/health": ["./supabase/migrations/**/*"],
  },
  // The floating Next.js dev-tools button (bottom-left "N" circle) is
  // dev-only and not part of the product. Off.
  devIndicators: false,
  // Dev-only: on a Windows→WSL setup, when the localhost bridge breaks, the
  // browser uses the WSL IP directly; Next blocks its dev scripts from
  // unknown origins (page renders but ALL JS/animations freeze). If you hit
  // this, add your own WSL subnet IP here (`hostname -I`).
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // Security headers (Vercel adds none by default).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // SEC-HARDEN CSP. The ENFORCED policy (with a per-request nonce) is now minted
          // in src/proxy.ts — App Router inlines its bootstrap + streamed flight-data
          // scripts, which have no stable hash, so enforcement needs a nonce the proxy
          // threads onto each request. This static Report-Only header STAYS for bake-in
          // comparison: it surfaces the same directives as a report (no nonce, so in prod
          // it reports Next's inline scripts — exactly the gap the nonce closes) with zero
          // rendering risk. Toggle enforcement with FLAG_CSP_ENFORCE (default on).
          // Directives:
          //   default-src 'self'            — deny by default.
          //   script-src  'self' + theme-hash — the one inline script is the pre-paint
          //     theme setter in layout.tsx (hashed below so enforce needs no nonce for it);
          //     dev adds 'unsafe-eval'/'unsafe-inline' for HMR. JSON-LD marketing blocks are
          //     type="application/ld+json" data blocks — not executed, not governed here.
          //   style-src   'self' 'unsafe-inline' — Next/Tailwind inject inline styles;
          //     style injection is not the account-takeover vector (that's script XSS).
          //   img-src     'self' data: — host favicons are now self-proxied via
          //     /api/favicon (SEC-HARDEN), so no remote image host is needed.
          //   font-src    'self' data:        — next/font is self-hosted at build.
          //   connect-src 'self' + Supabase (https + wss realtime); dev adds ws: for HMR.
          //   frame-ancestors 'none' · base-uri 'self' · form-action 'self' ·
          //   object-src 'none' — clickjacking / base-tag / form-exfil / plugin hardening.
          {
            key: "Content-Security-Policy-Report-Only",
            value: contentSecurityPolicy(),
          },
        ],
      },
    ];
  },
};

// SHA-256 of the exact inline theme script in src/app/layout.tsx (THEME_SCRIPT).
// If that script changes, recompute: it is the pre-paint no-FOUC theme setter.
const THEME_SCRIPT_HASH = "sha256-BMWPZkW/VJNVV2U5juQhilTr+fTuFdRAkANnWYCLFLE=";

function contentSecurityPolicy(): string {
  const dev = process.env.NODE_ENV !== "production";
  // Supabase realtime uses wss:; REST/storage use https:. Wildcarded so the same
  // policy holds across the dev/preview/prod Supabase projects.
  const supabase = "https://*.supabase.co wss://*.supabase.co";
  return [
    "default-src 'self'",
    `script-src 'self' '${THEME_SCRIPT_HASH}'${dev ? " 'unsafe-eval' 'unsafe-inline'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

// Wrap with Sentry's build plugin. Source-map upload only
// runs when SENTRY_AUTH_TOKEN + org/project are present (silent otherwise); with
// no Sentry env at all this is a near-identity wrap that keeps the build green.
// `silent` in dev suppresses the plugin's noise; CI/prod surfaces upload logs.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: process.env.NODE_ENV !== "production",
  // Do not fail the build if source-map upload can't run (e.g. no auth token).
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // We tag/scrub ourselves; skip the SDK's extra tunneling/telemetry surface.
  telemetry: false,
});
