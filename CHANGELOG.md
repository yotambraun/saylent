# Changelog

All notable changes to Saylent are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-04

### Security

- **Alerts can no longer be pointed at internal services.** A webhook or Slack URL could name a private address, or a host that resolves to one, and delivery followed redirects, so on a deployment with several users any of them could make the server send requests into its own network (for example to a cloud metadata address). Webhook and Slack URLs must now be https to a public host: private, loopback, link-local, reserved and encoded-IP hosts are refused when the URL is saved and again on every send, each send resolves the host and refuses a private answer, the connection is pinned to the checked address, and a redirect is a failed delivery instead of being followed. To test a receiver on your own machine, opt in with `--notify-allow-loopback` (CLI) or `SAYLENT_ALERTS_ALLOW_LOOPBACK=1` (self-hosted app); it opens loopback only. See [where alerts can be sent](https://yotambraun.github.io/saylent/docs/alerts#where-alerts-can-be-sent).

### Added

- **`npx saylent demo`: a full report before any key.** Renders the bundled sample run (Kestrel Uptime, a fictional product we host, audited by a real smoke run) into `./saylent-demo/` as `report.html`, `report.md` and `run.json`, offline: no key, no network, no cost. `--open` opens the report. `saylent --help`, the README and the docs now start here, then price a real audit with `--dry-run`.
- **MCP setup for seven clients.** [The MCP server](https://yotambraun.github.io/saylent/docs/mcp#connect-a-client) page has copy-paste setup for Claude Code, Claude Desktop, Cursor (with an install link), VS Code with Copilot (with an install link), Windsurf, Codex CLI and Gemini CLI, and how each one passes keys.
- **Answer surfaces: Google AI Overviews, Google AI Mode and Microsoft Copilot.** They have no official API, so a run reads them through your own SerpApi key (`SERPAPI_API_KEY`, `saylent keys set serpapi`). Add them with `--surfaces google_ai_overview,google_ai_mode,copilot`, or name them in `--engines`; set where they answer from with `--country` and `--location`. Each surface answer is judged, scored and reported like any engine. Searches are priced at 2.5 cents, SerpApi's Starter rate (checked 2026-11-02), and an AI Overviews answer can take two. The four model engines stay the default. See [Answer surfaces](https://yotambraun.github.io/saylent/docs/surfaces).
- **Sources & opportunities.** Every run now reads its own answers and cited pages three ways: citation share by domain per engine and surface, who the answers name (as counts), and off-site opportunities, the domains cited in answers that name a rival and not you, where you are not on any page we read. Every domain shows its type and the rule that set it, and every count opens its receipts. It is a new report section (04), a `## Sources & opportunities` section in `report.md`, two lines in the `saylent audit` summary, and an optional `sources` block in `run.json` (older bundles read unchanged). Correct a type with `sources.domainTypes` in `saylent.config.json`. See [Sources & opportunities](https://yotambraun.github.io/saylent/docs/sources).
- **`saylent sources <run.json>`**, $0 and offline: the opportunities, the domains and who the answers name, filtered by `--view`, `--engine`, `--type` or `--domain`, or as JSON with `--json`. Two or more runs of one brand print the history.
- **The MCP `sources` tool** ($0, read-only), the fifth tool: the same data with receipts. The `audit` tool takes `surfaces`, `country` and `location`, returns `sources_summary`, and its dry run reports whether a SerpApi key is set.
- **Self-hosted app:** an opt-in Answer surfaces group on the run options page (disabled, with the reason, when the deployment has no SerpApi key), Country, Language and Location for the surfaces, a Source types editor, and the surfaces in the estimate. The brand page gets **Sources over time** across the last six finished runs. SerpApi is listed on Providers and models with a free Test. Apply migration `0045_serpapi_provider.sql` to save a SerpApi key from the console.
- **`saylent crawlers <log>`: which AI crawlers actually visit your site**, from your own access log, $0 and offline. Requests per bot (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Googlebot, Bingbot and more) and purpose (training, search index, user-triggered fetch), the pages they fetch, and the requests that were blocked or failed, with the log lines as receipts (IPs redacted, query strings cut). Reads nginx/Apache combined logs, Vercel log drains and Cloudflare Logpush, `.gz` and folders too. `--verify-ips` checks each bot against its operator's published IP ranges and lists spoofed user agents; `--run <run.json>` lists the pages the answers cite that no AI crawler fetched. Every bot links to its operator's own page, checked 2026-11-02. See [AI crawlers](https://yotambraun.github.io/saylent/docs/crawlers).
- **Alerts.** `saylent verify --notify slack,webhook,email` sends what changed against the baseline: recommendations gained or lost per question and engine, rivals no baseline answer named, new off-site opportunities, and AI-crawler error spikes when logs exist. Nothing changed, nothing sent. `saylent history <dir> --digest` is a free weekly digest. Webhooks carry a versioned `saylent.alert/v1` JSON body signed with HMAC-SHA256. See [Alerts](https://yotambraun.github.io/saylent/docs/alerts).
- **`saylent questions import`**: turn a Google Search Console Queries export, any CSV or a text list into the questions an audit asks, $0 and offline, with every dropped row counted by reason. Optional `--rewrite` into natural questions (with an estimate first), and `--language`/`--country` that set the answer surfaces' locale. See [Import questions](https://yotambraun.github.io/saylent/docs/import-questions).
- **MCP: seven tools.** `crawlers` (free, a log inside the working directory) and `questions_import` (a free preview that writes nothing). The Claude Code plugin gets a `crawlers` skill and passes `SERPAPI_API_KEY` to the server.
- **Self-hosted app: AI crawlers, Alerts and question import.** Upload an access log on a brand's page: it streams through your own server and only the counts and a few redacted log lines are kept. A brand's Alerts page sends changes after each run and a Monday digest by email, Slack or a signed webhook (URLs stored encrypted with `APP_SECRET`). The question editor imports a Search Console export in the browser. Apply migrations `0046_crawler_reports.sql` and `0047_brand_alerts.sql`.
- **The summary names the sites to get onto**: the top off-site opportunities, each opening the answer that cited it.
- **`saylent export`: your data out**, $0 and offline. Answers, citations, sources, off-site opportunities, share of voice, fixes and, from a `crawlers.json`, AI-crawler counts, as one CSV per table or one JSON document. The columns are versioned (`saylent.export/v1`) and every one is documented. A brand folder of dated runs exports as one history. See [Export and API](https://yotambraun.github.io/saylent/docs/export).
- **`saylent fixes` and `saylent fixes apply`.** `fixes` lists the drafted fixes with the evidence behind each. `fixes apply <run.json> --repo <path>` writes the site-side ones into your own site repository on a new branch: the robots.txt groups for the AI crawlers a run found refused, and the drafted JSON-LD as snippet files, with a `PULL_REQUEST.md` carrying the receipts, a review checklist and what was not applied. It needs a clean work tree, never writes outside the repository, shows the diff and asks first (`--yes`, `--dry-run`), commits locally and never pushes: it prints the `git push` and `gh pr create` commands.
- **MCP: ten tools.** `fixes` (the drafted fixes with their evidence), `history` (compare runs of one brand: what moved, with receipts, by the same rules as alerts) and `export` (the documented tables, inline or as files), all $0. The server's instructions now say the agent reasons and every claim points at a receipt.
- **The `ai-visibility-audit` skill** in the Claude Code plugin walks the whole loop: a free estimate, your yes, the audit, the sites to get onto, the fixes with their evidence (and `fixes apply` for the site ones), and a verify plan. Six skills in all.
- **Self-hosted app: Export and a read-only API.** An **Export** menu on every run (each table as CSV, everything as JSON, the run bundle, which had no button before) and **Export history** on a brand's page (its last 24 runs and the latest crawler counts). `GET /api/v1/brands`, `/brands/{id}/runs`, `/brands/{id}/export` and `/runs/{id}` with a personal API token from **Settings › API tokens** (stored as a hash only, revocable, 60 requests a minute) or your session, and `/api/v1/openapi.json`. Apply migration `0048_api_tokens.sql`.

- **The searches behind each answer.** Before it answers, an engine with web search writes its own search queries, and those decide which pages it reads. Saylent now keeps them with the answer, verbatim and in order, for ChatGPT, Claude and Gemini, which report them in the response a run already pays for: no extra call, no extra cost. Open an answer to see **Searches it ran**; `report.md` lists them under each question; `saylent export` and the app's Export menu add a `search_queries` column to `answers` and a `search_queries` table (still `saylent.export/v1`). Perplexity's API and the answer surfaces do not report their searches, and the report says so. Self-hosted app: apply migration `0049_answer_search_queries.sql` to keep them; until then runs work as before without them.

- **Visits from AI assistants, from the same access log.** `saylent crawlers` and the brand page's AI crawlers section now also count the people AI assistants sent you: requests from a browser whose `Referer` host or `utm_source` names ChatGPT, Perplexity, Claude, Gemini, Microsoft Copilot, DeepSeek, Le Chat, Grok or Meta AI, with landing pages and redacted log lines as receipts. Many such visits carry no referrer (apps, privacy settings), so the number is a floor, and every surface says so. Only the referrer's host and the `utm_source` value are read. It is in `crawlers.json`, `crawlers.md`, the MCP `crawlers` tool and a new `ai_referrals` export table. See [AI crawlers](https://yotambraun.github.io/saylent/docs/crawlers#visits-from-ai-assistants).

### Changed

- **The comparison page is current.** [Compared with hosted tools](https://yotambraun.github.io/saylent/docs/compare) no longer lists alerts and run history as missing, states the remaining gaps plainly (daily tracking run for you, answers as the consumer apps show them), takes every entry price from the vendor's own pricing page as of November 2026 (where a vendor publishes no price, it says so), and adds a table of open-source alternatives described from their own repositories.
- **Docker Compose pins Inngest and keeps its data.** The `inngest` service now uses `inngest/inngest:v1.49.0` instead of `latest`, and keeps its SQLite database on an `inngest-data` volume. Inngest's in-memory queue is only snapshotted to that database, so treat queued runs as at risk across a restart unless you give it Postgres and Redis ([deploy on your own server](https://yotambraun.github.io/saylent/docs/self-host/own-server)).
- **Current default models**, checked against the providers' pages on 2026-11-02: `gpt-6.1-sol` (ChatGPT answers, OpenAI drafter), `gpt-6-luna` (OpenAI judge and brand model; `gpt-5-mini` shuts down on 2026-12-11), `claude-sonnet-5-5` (Claude answers, drafter), `claude-haiku-5-5` (Anthropic judge and brand model). `gemini-3.6-flash` and `sonar` are unchanged. Every run records the models it used, so a `verify` against a baseline taken on the old defaults says which models answered each side; override any role with `--model`, `--judge` or `MODEL_*` to keep the old ones.
- **Cost figures recomputed from the code.** One rate table, keyed by model id, now prices the run total, the CLI preflight, the app's estimate and the report's per-answer cost. The estimate for an answer with no recorded usage is the sample run's measured median, which was well above the old flat figure. A smoke run with four engines is now quoted at about **$0.80 to $1.20** (unchanged at the top; our recorded runs cost $0.93 and $1.11) and a full run at about **$5.10 to $7.10** (was $3.70 to $5.50).
- **Node 22 or newer.** Node 20 reached end of life in April 2026; `engines` is `>=22` and CI tests Node 22 and 24.
- **The README is shorter**: the keyless demo, the real sample report, a real audit, and one table of what Saylent does, each row linking to its page.
- **Report sections renumbered.** Sources & opportunities is section 04; the site checks, the fix plan and the method are now 05, 06 and 07.
- **"Not shown" is counted apart.** A question an answer surface showed no AI answer for is recorded as not shown: a coverage gap counted nowhere, never an absence and never an engine failure, so it does not change the exit code. The search is still billed.

### Fixed

- **The sample's robots.txt fix says robots.txt.** The pseudonymizer read the drafter's `https:///robots.txt` (an empty host) as a host named `robots.txt` and renamed it, so the Kestrel sample told readers to edit `brightfield.example`. File names are no longer treated as hosts, and the robots.txt drafter is now given the site's own robots.txt URL.
- **Small walkthrough fixes**: the crawler summary no longer calls one of two tied bots "the most", `questions import` says "1 click", and `saylent demo` ends with the $0 commands that read the run it wrote.
- **Answer surfaces read by name everywhere.** The verify view's per-engine table and the brand page's run events printed ids such as `google_ai_overview`.
- **The citation-share table no longer hides its last columns.** At 1280px with seven answer sources "Skip you" sat past the scroll edge; the verdict columns now sit beside the count, and on a phone the domain type moves under the domain.
- **The Anthropic judge works on current Claude models.** It sent an assistant prefill and `temperature: 0`, which current Claude models (including the new default) reject, and swallowed the error, so pointing `MODEL_JUDGE_ANTHROPIC` at one left every answer it judged on a neutral fallback verdict. It now uses structured outputs (a JSON schema), and the OpenAI judge uses strict structured outputs with the same schema. A failing judge, brand-model or drafter call now prints its reason to stderr once, with any key redacted.
- **A one-draw result is never called "stable".** On a smoke run each question is asked once, so a recommended count that did not move is a count, not a measured range; the report and the summary now say "asked once" there and keep "the number held" for runs that re-asked.
- **Self-hosted app: hide, unhide, delete brand and cancel work.** They failed with a database permission error (42501). Apply migration `0044_run_visibility_and_cancel.sql`; cancelling now goes through a function that only ever moves your own queued or running run to failed.
- **Docs:** `gate-check` exits `2` when the site cannot be reached, `saylent history` rows are shown in the format the command prints, and scheduled checks explain how to pin the version you baselined with instead of a stale pinned number.

## [0.1.3] - 2026-10-04

### Added

- **Claude Code plugin.** `/plugin marketplace add yotambraun/saylent`, then `/plugin install saylent@saylent`, adds the MCP server and four skills: `gate-check` (free crawler-access check), `audit` (shows the keys it found and the estimated cost, and asks before spending), `verify` (re-asks the frozen questions after your fixes) and `read-report` (summarizes an existing run). See [the Claude Code plugin](https://yotambraun.github.io/saylent/docs/claude-code).
- **The MCP `audit` dry run says what a real run would do.** It now reports which providers have a key (never the key itself), the engines that would be asked, the judge mode and whether the run would start, and prices only the engines that have a key, the same way `saylent audit --dry-run` does.

### Changed

- **Dependencies refreshed** within their existing major versions, including the Anthropic and Google provider SDKs, the MCP SDK (1.31), Next.js 16.3.7, React 19.3 and zod 4.6. Every test, the type check, the lint, the app build and the CLI dry run pass on the new set.

### Fixed

- **The GitHub Action resolves again.** `uses: yotambraun/saylent@v0` failed in every workflow because the repository was published without the Action's `action.yml`. It now ships with the built entry point it runs, and a test fails the release if either is ever missing again.
- **The site's changelog page lists every release.** It skipped any release heading that carried a date, so it showed no entries.

## [0.1.2] - 2026-09-14

### Changed

- **One computed cost range, everywhere** - both READMEs, the docs, `.env.example`, the landing page and the CLI preflight now quote the same two numbers, computed by the same estimator the app shows before a run: about **$0.60 to $1.20** for a smoke run across four engines and about **$3.70 to $5.50** for a full one. The old "$2.50 to $4.00" contradicted the product's own screenshot. A unit test recomputes both from the estimator and fails if the published copy drifts.
- **The site check is named once** - the free, keyless check (`saylent gate-check`) is "the site check" on the docs page, in the sidebar, on the landing card and in both READMEs, instead of seven different names for one feature.
- **Docs headings match the site** - `/docs/*` headings and the sidebar wordmark are set in the landing page's display serif at the same weight, so clicking "Docs" no longer changes the typographic voice. Body copy stays Inter.
- **Docs reorganized into six sections** - Run it once, Keep score as a team, Operate it for others, Automate, Understand, Project - in the same order and under the same names on the docs sidebar, the docs start page, the landing page and this repository's README. Every existing docs URL still resolves: nothing moved, the grouping is the sidebar's own. New pages, all lifted from where the content already lived: [Questions and models](https://yotambraun.github.io/saylent/docs/questions-and-models), [Verify and history](https://yotambraun.github.io/saylent/docs/verify-and-history), [Check again next month](https://yotambraun.github.io/saylent/docs/scheduled-checks), [Share, export and track fixes](https://yotambraun.github.io/saylent/docs/sharing), [Users and access](https://yotambraun.github.io/saylent/docs/self-host/users), and one page each for [the GitHub Action](https://yotambraun.github.io/saylent/docs/action), [the MCP server](https://yotambraun.github.io/saylent/docs/mcp) and [the library](https://yotambraun.github.io/saylent/docs/library). The operator screenshots now live on [The operator console](https://yotambraun.github.io/saylent/docs/self-host/admin) rather than in the middle of the app tour.

### Added

- **Docs: a visual tour of the app** (`/docs/tour`) - every screen of the self-hosted app in the order you meet them (run, read, act, verify, operate), in both themes, with a link that opens each user screen in the live demo; the operator console - setup readiness, provider keys, models per role, spend cap and kill switch, the run feed, the audit log, takedowns and one account end to end - is shown for the first time. The page closes with a feature map of what the app adds over the CLI and the GitHub Action. Every image, and the new `app.gif` on the README and the landing page, is generated by `npm run media` from a running deployment and regenerated on every release.
- **Docs: the operator console** (`/docs/self-host/admin`) - every admin page in the order an operator meets them: `/setup` readiness rows and what each blocking row means, Providers and models (env vs console keys, `APP_SECRET`, what each model role does, the free Test key check), Budget and limits (spend cap, throttles, brand cap, exactly what the kill switch stops), Users (who becomes admin, promoting another, disabling an account), Runs (health badges, re-run, retry, mark failed), Support and Takedowns (what unpublishing a share does), Analytics (the activation funnel) and the Audit log.
- **Docs: sharing, export and the fix tracker** in [Reading a report](/docs/reports) - creating and revoking a public unlisted link, what a reader of one gets, the takedown path, the CSV / JSON / run-bundle exports (the bundle is URL-only, with no button in the app), and the open → shipped → watched fix lifecycle with its win-rate line.
- **Docs: users and access** in [Self-host](/docs/self-host) - who can sign up to a deployment, the three ways to limit that, how a teammate joins, what a user can and cannot do next to an operator, and the per-account brand limit.
- **Docs: scheduled verifies without a database** in [the CLI reference](/docs/cli) - a cron entry and a scheduled GitHub Actions job for `saylent verify`, where the movement report lands, and when to deploy the app instead.
- **Docs: infrastructure cost** in [What it costs](/docs/costs) - the Supabase and Vercel free-tier limits that actually matter for a small team, and why scheduled runs need Inngest rather than platform cron.

### Fixed

- Settings › Notifications no longer promises a movement email. Two transactional emails send: the report when an audit finishes, and a day-10 reminder to re-measure. The row now says which, and says plainly when the deployment has no email configured at all.

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

[0.1.3]: https://github.com/yotambraun/saylent/releases/tag/v0.1.3
[0.1.2]: https://github.com/yotambraun/saylent/releases/tag/v0.1.2
[0.1.1]: https://github.com/yotambraun/saylent/releases/tag/v0.1.1
[0.1.0]: https://github.com/yotambraun/saylent/releases/tag/v0.1.0
