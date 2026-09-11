"use client";
// Host favicon at 16px with a DESIGNED fallback (extracted from
// dossier.tsx so the demo + the paid dossier share one component). The same-origin
// favicon proxy 404s on redirect-wrapper hosts (e.g. vertexaisearch.cloud.google.com)
// and on hosts that simply have no icon; on error we swap the <img> for a
// deterministic gradient letter-tile in the SAME 16px footprint — the host's initial
// over a hue derived from a stable hash of the host — never a broken-image glyph.
import { useState } from "react";
import { useReportHost } from "../host";

/**
 * Deterministic hue in [0, 360) for a host string (FNV-1a 32-bit → mod 360). Pure
 * and stable across server/client and across runs, so a given host always gets the
 * same tile colour (no hydration mismatch, no flicker). Case-insensitive.
 */
export function hostHue(host: string): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  const s = host.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // murmur3 fmix32 finalizer — avalanche so hosts sharing a suffix (every
  // ".example" outlet in the demo) scatter across the wheel instead of clustering.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % 360;
}

/** The gradient + initial for a host's fallback tile (pure; exported for tests). */
export function faviconTile(host: string): { background: string; initial: string } {
  const hue = hostHue(host);
  return {
    // subtle two-stop diagonal — designed, not a flat block
    background: `linear-gradient(135deg, hsl(${hue} 58% 56%), hsl(${(hue + 42) % 360} 62% 42%))`,
    initial: host.charAt(0),
  };
}

export function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  // The icon source is the HOST's business: the app proxies it same-origin via
  // /api/favicon; a static report.html has no server, returns null, and gets the
  // deterministic letter tile below (no external request, ever).
  const src = useReportHost().faviconUrl(host);

  // No host at all — a neutral dot in the same footprint (nothing to hash or draw).
  if (!host) {
    return (
      <span
        aria-hidden
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-wire/15 font-mono text-[9px] uppercase leading-none text-wire"
      >
        ·
      </span>
    );
  }

  // Image failed/absent (or the host serves no icons at all) — the deterministic
  // gradient letter-tile fallback.
  if (failed || !src) {
    const { background, initial } = faviconTile(host);
    return (
      <span
        aria-hidden
        style={{ background }}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm font-mono text-[9px] font-semibold uppercase leading-none text-paper shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.28)]"
      >
        {initial}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- host-supplied icon URL; next/image adds no benefit at 16px
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}
