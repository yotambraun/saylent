import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  // "/" always redirects (signed in → /app, else /login) — not a real page, so it
  // is left out of the sitemap. /demo is the deployment's front page for strangers.
  return ["/demo", "/methodology", "/about", "/help", "/login"].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: "weekly",
    priority: path === "/demo" ? 1 : 0.7,
  }));
}
