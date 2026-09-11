# Contributing to Saylent

Thanks for looking at this. Saylent is a small, opinionated audit engine plus
a CLI and a self-hostable app. This doc gets you from clone to a passing PR.

## Dev setup, on the $0 fixture rig

Node 22+ for the app (root workspace); the published `saylent` CLI and
`@saylent/engine` / `@saylent/report` packages support Node 20+ on their own.

Nothing here spends money. Every command below runs against fixtures or a
frozen sample run, not a live LLM call. The test suite needs no keys and no
database. Running the app locally needs a Supabase project (see
[self-host](https://yotambraun.github.io/saylent/docs/self-host)).

```bash
npm install
npm run typecheck
npm run lint
npm run test          # about 1,750 tests, no keys required, a few minutes
npm run build
```

To run the CLI from source against the example fixture:

```bash
npm run cli -- audit example.com --dry-run
```

`--dry-run` prints the plan (engines, question count, cost estimate) and
exits without contacting any provider. It is the fastest way to check that
your change to argument parsing, config loading, or the report pipeline did
not break the command.

To see the app itself, seed the $0 fixture and start the dev server:

```bash
npx tsx --env-file=.env.local scripts/seed-fixture-run.ts you@example.com
npm run dev
```

`scripts/simulate-run.ts` replays a captured run over ~90 seconds if you want
to see the live "audit theater" view without spending anything (`--fast` for
a quick pass). Neither script calls a real provider.

If you want to exercise a real, paid run end to end, that is your call and
your API keys, never required for a contribution. `AUDIT_PROFILE=smoke`
keeps a real run cheap (about $0.40 to $1.20 with four engines; our recorded
runs cost $0.93 and $1.11); `full` is explicit and costs more.

## Test rules

- Tests live next to the code they cover: `packages/engine/src/foo.ts` and
  `packages/engine/src/foo.test.ts` in the same directory. Same for
  `src/lib/`. There is no separate `tests/` tree.
- `npm run test` is the whole suite and it is what CI runs. Scope a single
  area while iterating: `npx vitest run packages/engine` or
  `npx vitest run src/lib`.
- Tests do not hit real services. Anything that must call a live provider is
  a script under `scripts/`, not a vitest test, and it is not part of CI.
- A new engine adapter, site check, fix family, or report block needs a test
  alongside it: one file, one concern, plain assertions on plain data.
- New tests in `packages/**` are picked up automatically (`vitest.config.ts`
  includes `packages/**/*.test.ts`).

## The purity rule (and its lint)

`packages/engine` is the audit pipeline and it has to run standalone: the
CLI, a GitHub Action, an MCP server, and the self-hosted app all import it,
and only the last one has Next.js, Supabase, Inngest, or React available.
So `packages/engine/**` may not import `next`, `@supabase/*`, `inngest`,
`react`, `react-dom`, `server-only`, or the app's `@/*` alias. `packages/report`
carries the same rule, minus the React restriction (its output is React
components rendered both inside the app and to a static `report.html`); it
still may not import `next`, `@supabase/*`, `inngest`, or `@/*`.

This is enforced by an ESLint rule, not just convention:
`eslint.config.mjs` sets `no-restricted-imports` with those patterns scoped
to `files: ["packages/engine/**/*.{ts,tsx}"]` and
`files: ["packages/report/**/*.{ts,tsx}"]`. `npm run lint` fails if a stray
app import creeps back in. If your change needs something app-shaped inside
`packages/report`, it goes through the `ReportHost` context
(`packages/report/src/host.tsx`), not a direct import.

## Adding a piece

Every extension point has a typed interface, one shipped example to copy,
and a short recipe. The canonical list, kept current, is in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) under "Where do I extend it?", with
longer walkthroughs on the docs site under `/docs/extending`. In short:

| To add | Interface | File |
|---|---|---|
| an answer engine adapter | `Ask` / `AskResult` | `packages/engine/src/adapters/` |
| a site check | `DomainCheck` | `packages/engine/src/domainChecks.ts` |
| a fix family | a rule inside `diagnose()` | `packages/engine/src/fixes.ts` |
| a report block | `BriefBlock` + its renderer | `packages/report/src/brief.ts`, `components/brief.tsx` |
| a judge rule | the rubric text, then rerun the golden set | `packages/engine/src/judge.ts` |
| a report host | `ReportHostValue` | `packages/report/src/host.tsx` |
| configuration | `saylentConfigSchema` | `packages/engine/src/config.ts` |

A new engine adapter or site check is genuinely a one-file change plus one
test file. If you are proposing a new judge rule, run it against the golden
set (`scripts/judge-golden.ts`) and include the before/after agreement
numbers in the PR description.

## PR checklist

Before you open a PR:

- [ ] `npm run typecheck` is clean
- [ ] `npm run lint` is clean (this includes the purity rule above)
- [ ] `npm run test` is green
- [ ] `npm run build` succeeds
- [ ] Docs updated if the change touches a documented command, flag,
      extension point, or environment variable (`ARCHITECTURE.md`,
      `METHODOLOGY.md`, or the relevant `website/content/docs/*` page)
- [ ] The PR description says what changed and why, in one or two sentences

Small, focused PRs review faster than large ones. If a change touches the
judge, the sampling logic, or the fix-diagnosis weights, say so explicitly in
the description, those are the parts most likely to need a second look.

## Commit message style

Plain, imperative, one line summarizing the change: "Add Google AI Mode
adapter", "Fix robots.txt wildcard precedence", not "Added a new adapter for
Google AI Mode which handles the case where...". No tool or assistant
mentions in commit messages or PR descriptions, whatever wrote the diff.

## Review window

This project has one maintainer. Issues and PRs are triaged weekly, not
necessarily answered same day. A PR that fails CI will not be reviewed until
it is green; check the Actions tab before pinging for a look.

## Good first issues

These are seeded, real gaps, not busywork:

1. Full `robots.txt` parser (wildcards, `Allow`, longest-match precedence);
   the shipped parser only handles root-level `Disallow` blocks.
2. A Google AI Mode adapter.
3. A Copilot adapter.
4. Locale-aware question templates (the generator is English-only today).
5. Live-probe tests for `domainChecks` against a wider bot registry.
6. Merge tests for `corpus` (citation aggregation edge cases).
7. HTML report i18n (the static `report.html` renderer has no locale hook yet).
8. A Docker Compose recipe for self-hosted Supabase, documented end to end.
9. `saylent ui`, a local viewer that lists a folder of run bundles and
   renders them in the browser with no server.
10. Windows path handling review across the CLI and its scripts.

Pick one, open an issue first if you want a design check before writing
code, or just open a draft PR. Both are welcome.

## License

By contributing, you agree your contribution is licensed under the
project's [Apache License 2.0](./LICENSE).
