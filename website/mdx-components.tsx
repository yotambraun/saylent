// website/mdx-components.tsx — shared MDX component set for
// every content/docs/*.mdx page. ThemedImage/SiteImage are here so a docs page
// can show one of the repo's own assets without hard-coding the GitHub Pages
// sub-path or reaching for a prefers-color-scheme <picture> the site's
// class-based dark mode disagrees with (see components/site-image.tsx).
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { SiteImage, ThemedImage } from "@/components/site-image";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    SiteImage,
    ThemedImage,
    ...components,
  };
}
