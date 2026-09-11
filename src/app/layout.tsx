import type { Metadata } from "next";
import { Fraunces, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
// fail-fast env validation at boot (src/lib/env.ts)
import "@/lib/env";
// No-FOUC theme + the `js` class. THE SCRIPT ITSELF lives in src/lib/theme-script.ts
// because src/proxy.ts hashes that same constant into the enforced CSP — never
// inline a second copy here (that drift is exactly what broke dark mode once).
import { THEME_SCRIPT } from "@/lib/theme-script";

// Fraunces (display), Inter (body), IBM Plex Mono (data). next/font =
// self-hosted at build, so no runtime Google Fonts request.
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const DESCRIPTION =
  "AI is answering your buyers. Are you in the answer? Saylent shows exactly where you stand in ChatGPT, Claude, Gemini and Perplexity: with receipts and fixes.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Saylent", template: "%s" },
  description: DESCRIPTION,
  openGraph: {
    siteName: "Saylent",
    title: "Saylent: AI is answering your buyers. Are you in the answer?",
    description: DESCRIPTION,
    type: "website",
  },
  twitter: { card: "summary", title: "Saylent", description: DESCRIPTION },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fraunces.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-paper text-ink font-sans">{children}</body>
    </html>
  );
}
