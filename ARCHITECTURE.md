# Architecture

## What are the two doors?

**The CLI** (`packages/cli`) is a single Node binary: `saylent audit`,
`verify`, `gate-check` (alias `check`), `report`, `history`, `keys`,
`questions`, `models`, `mcp`. It needs provider keys and a directory to write
to. No database, no server. **The app** (`src/`) is a
Next.js application with accounts, stored runs, schedules and a live progress
view.

Both call `runAudit()` in `packages/engine/src/run-audit.ts`, one pure function
with three seams: `deps.step` (a step runner), `deps.db` (a `DbWriter`) and
`deps.hooks` (optional side effects that must stay inside the step that owns
them). A CLI run supplies no hooks and still produces a complete result.

## What are the pipeline stages?

Each stage is one step with a stable id, so a durable runner can retry it
alone.

| Stage | File | What it does |
|---|---|---|
| `crawl` | `crawl.ts` | homepage plus prioritized internal links; schema types, meta directives and links extracted at fetch time, then raw HTML dropped |
| `brand-model` | `brandModel.ts` | one model call over the top crawled pages; operator-supplied fields win |
| `questions` | `questions.ts` | generate the frozen set, or reuse the stored one verbatim |
| `observe:<engine>` | `observe.ts`, `adapters/` | ask each engine, one step per engine, sampled draws |
| `judge` | `judge.ts`, `score.ts` | deterministic presence, cross-family judge, tiebreak draw, vote |
| `corpus` | `corpus.ts` | aggregate citations, fetch the top pages, brand and competitor presence |
| `domain-checks` | `domainChecks.ts`, `robots.ts`, `coverage.ts` | robots per agent, live per-agent probe, schema, meta, coverage |
| `fixes` | `fixes.ts`, `rival-owner.ts` | deterministic diagnosis, weighting, drafted artifacts |
| `finish` | `score.ts` | scores, recommended band, verify movement, persist and notify |

## Where does the data go?

`DbWriter` (`packages/engine/src/types.ts`) is the persistence port, eight
methods: `setStage`, `saveAnswer`, `saveVerdict`, `saveCorpusPage`,
`saveCheck`, `saveFix`, `finishRun`, `failRun`, `notify`. The app passes a
Supabase service-role writer; the CLI passes `MemoryDbWriter`, which collects
the same row shapes in arrays. The engine cannot tell the difference.

## What is a run bundle?

`bundle.ts` projects those rows into `run.json`. Version 1, top-level keys:
`version`, `run`, `brand_model`, `questions`, `answers`, `citations`,
`corpus_pages`, `domain_checks`, `fixes`, `scores`, `health`. It is lossless:
full raw answer text, every sampled draw under its canonical answer, every
citation with its position. The header records the frozen engine set, the model
per role, the judge mode, the template version, timings and cost.

A verify run needs the frozen `questions` reused verbatim, the baseline run id,
and the baseline answers with verdicts plus the fixes marked shipped, which is
how movement and watch notes are computed. Compatibility is additive only, and
a bundle with a different `version` is refused rather than guessed at.
`bundleFromRows` builds the same bundle from rows the app already persisted, so
an app run and a CLI run are the same artifact.

## How does the report render in two places?

`packages/report` holds pure composers and React components. The composers
(`brief.ts`, `report-intel.ts`, `trend.ts` and others) take plain row arrays
and return a typed block union: `text`, `stat`, `bars`, `list`, `quote`,
`status`, `pages`, `moves`, `kv`. Blocks hide themselves when their data is
absent, so a thin run renders fewer cards instead of empty ones. No composer
calls a model or the network.

Everything a running app can do that a file cannot is reached through one
context, `ReportHostValue` in `src/host.tsx`: `Link`, `track`, `faviconUrl`,
`actions`, `contactEmail`, `methodologyUrl`, `refresh` and the live run feed.
The app provides the real implementation; `staticReportHost` provides plain
anchors, a no-op tracker and `actions.available === false`, so interactive
controls hide instead of rendering dead buttons. `renderReportHtml`
server-renders the same components and inlines one hydration script and the
compiled stylesheet, so `report.html` makes no network request and opens from
`file://`.

## What does the app layer add?

Next.js App Router for routing and rendering. Supabase for auth, Postgres with
row-level security so a user reads only their own rows, and Realtime
`postgres_changes` for live run progress. Inngest for durability: the app hands
Inngest's own `step.run` to the engine as the `StepRunner`, so each pipeline
stage above is one durable, memoized, individually retried step, mapping one to
one. Two schedules exist, a weekly verify and a monthly audit. Budget controls
live in `src/lib/limits.ts` (per-plan brand limit, rolling-window run throttle)
and `src/lib/app-settings.ts` (pause switch, daily spend cap). The CLI has its
own: a printed cost estimate, a confirmation prompt, `--max-usd`, `--dry-run`.

## What keeps the engine portable?

A lint rule, not a convention. `packages/engine/**` may not import `next`,
`next/*`, `@supabase/*`, `inngest`, `react`, `react-dom`, `@/*` or
`server-only`; `packages/report/**` carries the same rule with React allowed,
since these are components. Both are `no-restricted-imports` blocks in
`eslint.config.mjs`. Everything else arrives injected: `AskFn`, `JudgeCaller`,
`LlmCall`, a `fetcher`, `HostLookup`, `StepRunner`, `DbWriter`, hooks.

## Where do I extend it?

| To add | Interface | File |
|---|---|---|
| an answer engine | `Ask` / `AskResult`, then register it | `packages/engine/src/adapters/` |
| a site check | push a `DomainCheck` | `packages/engine/src/domainChecks.ts` |
| a fix family | push a `Fix` in `diagnose()`, add its drafter task | `packages/engine/src/fixes.ts` |
| a report block | extend `BriefBlock` and its renderer | `packages/report/src/brief.ts`, `components/brief.tsx` |
| a judge rule | the rubric in the prompt, then rerun the golden set | `packages/engine/src/judge.ts` |
| a report host | implement `ReportHostValue` | `packages/report/src/host.tsx` |
| configuration | `saylentConfigSchema` | `packages/engine/src/config.ts` |

`saylent.config.{json,js,mjs,ts}` in the working directory is read at CLI
startup: config, then environment, then flags, a later layer winning field by
field. Competitors, the engine set, the profile, question templates
(`questions.ts`), extra bots (`domainChecks.ts`), the model registry
(`models.ts`), coverage/fix-weight thresholds (`coverage.ts`, `fixes.ts`),
`userAgent` (the CLI's crawler fetcher, `run.ts`) and `locale` (the CLI's
`--locale` question-translation path, `commands/audit.ts`) are all wired
today; `branding` is validated by the config schema but not yet read by
anything downstream (the app reads `NEXT_PUBLIC_APP_NAME` /
`NEXT_PUBLIC_CONTACT_EMAIL` instead). See [Configuration
reference](https://yotambraun.github.io/saylent/docs/configuration) for the
full key-by-key table.

## How do I run the pieces?

From the repository root: `npm run cli -- audit example.com` for the CLI,
`npm run dev` for the app, `npm test` for the suite,
`npm run typecheck && npm run lint && npm run build` for the gates, and
`npm run build:cli` for the bundled binary.

## What happens during one audit?

The site is crawled and a brand model derived from those pages. The question
set is generated and frozen, or read back unchanged on a verify. Each engine is
asked its questions, twice for scored ones; the raw draws return without
verdicts. The judge step checks alias presence deterministically, asks a model
from the other family for the qualitative fields, takes one more draw where two
disagreed, votes, and writes the canonical answer plus every draw behind it.
Citations are aggregated and the most-cited pages fetched and checked, and the
site's own gates are tested. Diagnosis reads all of that and emits weighted
fixes with drafted artifacts. The finish step computes scores and the band,
compares against the baseline on a verify, and hands the run to whatever is
persisting it. The CLI writes `run.json`, `report.html` and `report.md`; the
app writes rows and the run page renders them.

Last verified against the code on 2026-09-09.
