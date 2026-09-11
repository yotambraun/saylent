// We audit sites for AI-crawler hygiene — our own robots.txt practices what we
// preach: explicit welcome for every bot in our registry (2026-07-05).
import type { MetadataRoute } from "next";

const AI_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "OAI-SearchBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "ChatGPT-User",
  "Claude-User",
  "Perplexity-User",
  "Bingbot",
];

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/app/", "/api/"] },
      ...AI_BOTS.map((userAgent) => ({ userAgent, allow: "/", disallow: ["/app/", "/api/"] })),
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
