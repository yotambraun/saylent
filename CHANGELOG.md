# Changelog

All notable changes to Saylent are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-09-13

### Fixed

- The GitHub Action is consumed as `yotambraun/saylent@v0`, the floating tag that follows this 0.x line; the README shipped inside the npm package said `@v1`.
- The CLI's `bin` entry is stored in the form npm expects, so publishing no longer reports an auto-correction.

## [0.1.0] - 2026-09-11

First public release. Saylent is an open-source audit of what AI assistants
say about your brand: every verdict traced to the answer, the cited page,
and a fix.

### Added

- **`saylent` CLI** (`npx saylent audit <domain>`): runs a full audit with
  no database, using your own OpenAI and Anthropic API keys (Gemini and
  Perplexity optional). Nine commands: `audit`, `verify` (movement against a
  frozen baseline), `gate-check` (alias `check`; a $0, no-LLM pass/fail on
  AI-bot access, JSON-LD, and meta directives), `report` (re-render a saved
  run), `history` (list a folder of run bundles), `keys` (store and test
  provider keys), `questions` (print or edit the buyer-question set),
  `models` (print the resolved model registry), and `mcp` (a Model Context
  Protocol server on stdio for agents).
- **`@saylent/engine`**: the audit pipeline as a standalone package, zero
  Next.js/Supabase/Inngest/React dependency. Crawls a site, derives a brand
  model, generates and freezes a question set, asks each configured answer
  engine, judges the answers with a cross-family LLM judge, aggregates
  citations, runs the site's bot-access and structured-data checks, and
  diagnoses weighted fixes.
- **`@saylent/report`**: pure report composers and renderers, shared by the
  CLI and the app so both produce the same output. Renders a run to
  Markdown (`report.md`) and to a self-contained, dark/light, print-clean
  `report.html` with the same components the full app uses.
- **The run bundle format** (`run.json`): a lossless, versioned record of a
  run, including raw answer text, the frozen question set, engine subset,
  model versions, and cost, so a run can be replayed, re-rendered, or used
  as a `verify` baseline without a database.
- **Self-hosted app**: the full dashboard, brand history, verify, compare,
  and share-link experience, deployable on your own Supabase project plus
  Inngest for jobs. Three supported run targets: locally on one machine
  (`npm run app:local`), on your own server via Docker, or on Vercel with
  the Supabase and Inngest integrations pre-wired. First sign-up on a fresh
  deployment becomes the operator/admin.
- **Operator budget controls**: a daily spend cap, per-kind throttles, and
  a kill switch, all self-hosted-first (no billing provider involved).
- **`saylent.config.ts`**: project-level configuration (question templates
  and quotas, competitor list, engine subset, profile overrides, crawler
  user agent, locale), read by the CLI and the engine's config loader alike -
  `branding` is validated by the same schema but not yet read by anything
  downstream. See [Configuration
  reference](https://yotambraun.github.io/saylent/docs/configuration) for the
  full key-by-key table.
- **Extension points**: an engine adapter is one file implementing `Ask`; a
  site check is one registry entry in `domainChecks.ts`; a fix family is one
  rule in `diagnose()`; a report block is one case in the `BriefBlock`
  union plus its renderer. See `CONTRIBUTING.md` and `ARCHITECTURE.md`.
- **The golden set**: a labeled set of judged answers, with raw answer text
  inlined and no database required, that anyone can rerun
  (`scripts/judge-golden.ts`) to check agreement before and after a
  judge-rubric change - a live pass costs about $0.20 in judge calls;
  `--offline` replays the stored verdicts instead, at $0.
- Docs site with the quickstart, CLI reference, self-host guides, and the
  methodology behind what is measured, sampled, and diagnosed, and what is
  explicitly not claimed.

[0.1.1]: https://github.com/yotambraun/saylent/releases/tag/v0.1.1
[0.1.0]: https://github.com/yotambraun/saylent/releases/tag/v0.1.0
