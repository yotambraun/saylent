// website/components/site-image.tsx - images for MDX pages and the landing
// page. Two jobs, both of which a bare <img> in MDX gets wrong here:
//
//  1. GitHub Pages serves this repo under /saylent (next.config.ts), and a raw
//     src string is not rewritten by Next - so the prefix is applied by hand,
//     the same way website/app/page.tsx and layout.tsx do it.
//  2. The site's dark mode is CLASS based (layout.tsx's theme script + the
//     `dark` variant in src/tokens.css), so `<picture><source
//     media="(prefers-color-scheme: dark)">` picks the WRONG asset whenever a
//     reader toggles dark on a light OS. ThemedImage renders both
//     files and lets the same class that themes the page choose between them.
//
// Server components - no state, no client bundle.
const BASE_PATH = process.env.SITE_BASE_PATH === "1" ? "/saylent" : "";

export function assetUrl(src: string): string {
  return `${BASE_PATH}${src}`;
}

/** One asset, base-path corrected. */
export function SiteImage({
  src,
  alt,
  className,
  width,
  height,
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export, no image server
    <img src={assetUrl(src)} alt={alt} className={className} width={width} height={height} />
  );
}

/** A light/dark pair, switched by the `dark` class - never by the OS media
 *  query, which disagrees with the site's own theme control. */
export function ThemedImage({
  light,
  dark,
  alt,
  className,
  width,
  height,
}: {
  light: string;
  dark: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image server */}
      <img
        src={assetUrl(light)}
        alt={alt}
        width={width}
        height={height}
        className={`${className ?? ""} dark:hidden`.trim()}
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image server */}
      <img
        src={assetUrl(dark)}
        alt=""
        aria-hidden
        width={width}
        height={height}
        className={`${className ?? ""} hidden dark:block`.trim()}
      />
    </>
  );
}
