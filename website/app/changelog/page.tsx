// website/app/changelog/page.tsx - renders the repo-root changelog, read at
// build time, so this page can never drift from the file that ships with the
// release. CHANGELOG.public.md is tried FIRST and CHANGELOG.md only as a
// fallback: in this working copy both exist, and CHANGELOG.md is the INTERNAL
// one (phase/spec vocabulary, paths to private docs) - preferring it published
// that vocabulary on the public site. A public-repo snapshot has
// only CHANGELOG.md, renamed from CHANGELOG.public.md by
// scripts/publish-snapshot.mjs, so the fallback is what renders there. No
// hand-kept copy of the entries here.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";

export const metadata = { title: "Changelog" };

interface ReleaseGroup {
  heading: string;
  items: string[];
}

interface ReleaseSection {
  version: string;
  intro: string[];
  groups: ReleaseGroup[];
}

/** `process.cwd()` is the workspace dir (`website/`) under `npm run site:build`
 *  / `npm run site:dev` (npm workspaces convention, same one next.config.ts's
 *  own BASE_PATH logic relies on) - one level up is the repo root. Falls back
 *  to the repo-root-relative path in case this ever runs with a different cwd. */
function changelogPath(): string {
  // turbopackIgnore: this reads one fixed file outside website/ at build
  // time only (never a runtime/user-controlled path) - without the hint
  // Turbopack's file tracer over-traces the whole monorepo from this call.
  // CHANGELOG.public.md FIRST: it is the only changelog meant for this site.
  // CHANGELOG.md is the fallback, because a published snapshot has just that
  // one file (renamed from CHANGELOG.public.md by scripts/publish-snapshot.mjs)
  // - while in THIS tree CHANGELOG.md is the internal one and must never be
  // rendered.
  const candidates = [
    path.join(/* turbopackIgnore: true */ process.cwd(), "..", "CHANGELOG.public.md"),
    path.join(/* turbopackIgnore: true */ process.cwd(), "CHANGELOG.public.md"),
    path.join(/* turbopackIgnore: true */ process.cwd(), "..", "CHANGELOG.md"),
    path.join(/* turbopackIgnore: true */ process.cwd(), "CHANGELOG.md"),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/** Keep a Changelog shape: `## [version]`, an optional lead paragraph, then
 *  zero or more `### Heading` groups of `- ` bullets. Trailing reference-style
 *  link definitions (`[version]: https://...`) are stripped before parsing -
 *  they're link targets, not body content. */
function parseChangelog(md: string): ReleaseSection[] {
  const lines = md.split("\n").filter((l) => !/^\[[^\]]+\]:\s*https?:\/\//.test(l));
  const sections: ReleaseSection[] = [];
  let current: ReleaseSection | null = null;
  let group: ReleaseGroup | null = null;
  /** true while the parser is inside a bullet's own (hard-wrapped) paragraph */
  let openItem = false;
  /** the same, for a release's lead-in paragraph before its first `###` */
  let openIntro = false;

  for (const raw of lines) {
    const line = raw.trim();
    const h2 = /^##\s+\[(.+?)\]\s*$/.exec(line);
    if (h2) {
      current = { version: h2[1], intro: [], groups: [] };
      sections.push(current);
      group = null;
      openItem = false;
      openIntro = false;
      continue;
    }
    if (!current) continue; // before the first "## [...]" - the doc's own H1 + lead-in

    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      group = { heading: h3[1].trim(), items: [] };
      current.groups.push(group);
      openItem = false;
      openIntro = false;
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!group) {
        group = { heading: "", items: [] };
        current.groups.push(group);
      }
      group.items.push(bullet[1].trim());
      openItem = true;
      openIntro = false;
      continue;
    }

    // A blank line ends the paragraph a bullet (or the lead-in) was building,
    // so the next wrapped line starts a new one instead of gluing itself onto
    // the previous bullet.
    if (line === "") {
      openItem = false;
      openIntro = false;
      continue;
    }
    // Markdown hard-wraps: every line after a `- ` until the next blank line
    // BELONGS to that bullet. Without this, each entry was cut off at its
    // first newline - the whole changelog rendered as half-sentences.
    if (openItem && group && group.items.length > 0) {
      group.items[group.items.length - 1] += ` ${line}`;
      continue;
    }
    if (!group) {
      if (openIntro && current.intro.length > 0) current.intro[current.intro.length - 1] += ` ${line}`;
      else current.intro.push(line);
      openIntro = true;
    }
  }
  return sections;
}

/** Minimal inline Markdown - `**bold**`, `` `code` ``, and `[text](url)` -
 *  the only three inline forms CHANGELOG.public.md's own entries use. Bold
 *  recurses, because entries routinely open with a bolded code span
 *  (`**\`report.html\` now renders in full.**`) and a flat pass printed the
 *  backticks literally. */
function renderInline(text: string): ReactNode[] {
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text))) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index));
    if (m[1] !== undefined) {
      nodes.push(<strong key={key++}>{renderInline(m[1])}</strong>);
    } else if (m[2] !== undefined) {
      nodes.push(<code key={key++}>{m[2]}</code>);
    } else if (m[3] !== undefined) {
      nodes.push(
        <a key={key++} href={m[4]} className="text-signal underline">
          {m[3]}
        </a>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export default function ChangelogPage() {
  const sections = parseChangelog(readFileSync(changelogPath(), "utf8"));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <h1 className="font-display text-3xl text-ink">Changelog</h1>
        <p className="mt-3 text-wire">
          Notable changes to the public project, rendered from the repo&apos;s
          public changelog at build time - never a hand-kept copy. Format
          follows{" "}
          <a href="https://keepachangelog.com/en/1.1.0/" className="text-signal underline">
            Keep a Changelog
          </a>
          . Every release also gets a{" "}
          <a
            href="https://github.com/yotambraun/saylent/releases"
            className="text-signal underline"
          >
            GitHub Release
          </a>{" "}
          with the same notes.
        </p>

        {sections.map((s) => (
          <section key={s.version} className="mt-10">
            <h2 className="font-display text-xl text-ink">[{s.version}]</h2>
            {s.intro.map((p, i) => (
              <p key={i} className="mt-2 text-sm text-wire">
                {renderInline(p)}
              </p>
            ))}
            {s.groups.map((g, gi) => (
              <div key={gi} className="mt-4">
                {g.heading && (
                  <h3 className="font-mono text-xs uppercase tracking-wide text-signal">
                    {g.heading}
                  </h3>
                )}
                {g.items.length > 0 && (
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-ink">
                    {g.items.map((item, ii) => (
                      <li key={ii}>{renderInline(item)}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        ))}
        </main>
    </>
  );
}
