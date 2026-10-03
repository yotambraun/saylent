---
name: audit
description: Audit what ChatGPT, Claude, Gemini and Perplexity tell buyers about a brand - whether they recommend it, which competitors they name instead, which pages they cite - and get a fix plan with receipts. Spends the user's own provider credits, so it always starts with a free dry-run cost preview and asks before spending. Use when the user wants an AI visibility or generative engine optimization (GEO) audit of a brand or domain, or asks what AI assistants say about their company, product or competitors.
argument-hint: "[domain] [smoke|full]"
---

# Audit what AI assistants say about a brand

Request: $ARGUMENTS (a domain, optionally a profile; ask for the domain if missing).

An audit crawls the site, writes buyer questions, asks each AI engine, judges
every answer with a second model, and writes `run.json`, `report.html` and
`report.md`. It spends the user's own API credits. **Never start a paid run
without the user's explicit yes to a stated price.**

## 1. Before anything paid

- **Existing report?** Look for `./<domain>/<YYYY-MM-DD>/run.json` in the
  project. If a recent one exists, offer the `read-report` skill instead (free).
- **Site access first.** If the user has not run it yet, offer the free
  `gate-check` skill: a blocked crawler explains most bad results.

## 2. Free preview (always)

Call the `audit` tool of the saylent MCP server with `dry_run: true` and the
options the user chose: `domain` (required), `profile` (`smoke`, the default,
or `full`), `engines`, `competitors`, `brand`. Nothing is sent to any provider.

Report from the result, in plain words:

- **Keys found**: list the providers whose `keys_configured` value is true, by
  name only (OpenAI, Anthropic, Gemini, Perplexity). Never print, echo or
  guess a key value.
- **Engines that will be asked**: `engines_with_keys`. **Judge**: `judge`.
- **Questions**: `question_set.count` (template defaults are shown with
  placeholders like `[your category]`; the real run fills them from the site).
- **Estimated cost**: `estimate_usd.low` to `estimate_usd.high`, and the basis
  (`estimate_basis`).

If the result has no `keys_configured` field (an older Saylent version), run
`npx -y saylent@0 keys list` in the shell instead: it prints which providers
are set, masked.

If the MCP tool is unavailable, use `npx -y saylent@0 audit <domain> --dry-run`
(it prints the same keys, engines and estimate).

## 3. When keys are missing

If `ready_to_run` is false, the run would be refused. One of OpenAI or
Anthropic is required (both give cross-family judging); Gemini and Perplexity
are optional extra engines. Tell the user how to add a key, and that a key
must never be pasted into this chat:

- In their own terminal: `npx saylent keys set openai` (or `anthropic`,
  `gemini`, `perplexity`). It prompts with masked input and saves to
  `~/.saylent/config.json` (owner-only permissions). This works no matter how
  Claude Code was started. Then `npx saylent keys test` makes a free call to
  confirm each key.
- Or export `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` /
  `PERPLEXITY_API_KEY` in a shell and start Claude Code from that shell; the
  saylent server reads them when it starts.
- Or a `.env` file in the project folder (make sure it is gitignored).

If the user pastes a key into the chat anyway: do not repeat it, do not use it
on a command line, and suggest they rotate it.

Until a key exists, offer what is free: `gate-check`, and `read-report` on any
existing run.

## 4. Ask, then run

Ask one clear question, for example: "This smoke audit of example.com asks 2
engines and should cost about $0.21 to $0.27 of your OpenAI credits. Run it
with a $0.50 ceiling?" Wait for a yes.

Then call `audit` with the same options, without `dry_run`, and with `max_usd`
set to the ceiling the user agreed to (default: the preview's high estimate,
rounded up to the next $0.50). The server checks the estimate against
`max_usd` and the daily spend cap before anything is sent, and refuses if it is
higher. On a refusal, report the message and ask; never raise the ceiling or
retry on your own.

Shell fallback: `npx -y saylent@0 audit <domain> --max-usd <n> --yes`.

A smoke run takes a few minutes; a full run longer. Progress arrives as log
messages; summarize, do not relay every line.

## 5. Present the result

The result has `verdict`, `band`, `summary_blocks`, `report_paths` and the
real `cost_usd`.

1. One-line verdict: recommended in how many scored answers, and who is named
   instead (`summary_blocks.hero`).
2. The first three fixes, in order, from the fix plan section (`do-first`).
3. The actual cost, and where the files are. Suggest opening `report.html` in
   a browser for the receipts behind every number.
4. Offer the `verify` skill after fixes ship: it re-asks the same frozen
   questions so before and after are comparable.

Keep the numbers exactly as returned; do not round "0 of 11" into a percentage
or add claims the report does not make.

## Costs at a glance

The dry run's estimate is the number to quote. As a guide, a smoke audit
(6 questions) across four engines is about $0.60 to $1.20, and a full audit
(23 questions) about $3.70 to $5.50. Fewer engines cost less.
