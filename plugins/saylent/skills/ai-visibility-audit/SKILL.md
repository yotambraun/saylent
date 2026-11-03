---
name: ai-visibility-audit
description: The whole AI visibility loop for a brand, end to end - a free cost estimate, the user's yes, the audit of what ChatGPT, Claude, Gemini and Perplexity tell buyers, where those answers come from and which sites to get onto, the drafted fixes with their evidence, and a plan to verify them. Use when the user wants to improve how AI assistants talk about their brand or site, asks for a GEO/AEO plan, or wants "the full audit" rather than one step. Spends the user's own provider credits only after an explicit yes to a stated price.
argument-hint: "[domain] [smoke|full]"
allowed-tools: mcp__plugin_saylent_saylent__gate_check mcp__plugin_saylent_saylent__read_report mcp__plugin_saylent_saylent__sources mcp__plugin_saylent_saylent__fixes mcp__plugin_saylent_saylent__history
---

# AI visibility audit, end to end

Request: $ARGUMENTS (a domain, optionally a profile; ask for the domain if missing).

Saylent measures and returns receipts; you do the reasoning. Every claim you
make to the user points at something a tool returned: a count, a quoted
answer, a cited URL, a question id and engine. Never invent a number, a
percentage, a traffic or revenue effect, or a cause.

## 0. What already exists (free)

- Look for `./<domain>/<YYYY-MM-DD>/run.json`. If a recent run exists, skip to
  step 4 with it, and say how old it is.
- Two or more runs of the brand: the `history` tool of the saylent MCP server
  (`bundle_paths: ["./<domain>"]`) says what moved between the oldest and the
  newest, each change with the answers it was read from.

## 1. Can the AI crawlers read the site? (free)

Call the `gate_check` tool of the saylent MCP server with the domain. A
blocked search or user-fetch crawler explains most bad results; name each
FAIL row and its fix. If the user has access logs, offer the `crawlers` skill:
which AI crawlers actually came, and what they were refused.

## 2. The free estimate, then ask

Call the `audit` tool of the saylent MCP server with `dry_run: true`, the
`domain` and the user's options (`profile`: `smoke`, the default, or `full`;
`engines`; `competitors`; `surfaces` only if they asked for Google AI
Overviews, AI Mode or Copilot and a SerpApi key is set).

Report, in plain words: the providers with a key (by name, never a value),
`engines_with_keys`, the judge, `question_set.count`, and
`estimate_usd.low` to `estimate_usd.high`.

If `ready_to_run` is false, follow the `audit` skill's "keys are missing"
steps: keys go in the user's own terminal (`npx saylent keys set openai`),
never into this chat. Offer `npx -y saylent@0 demo` meanwhile: a full sample
report, offline, $0.

Then ask one question with the preview's own numbers: "This smoke audit of
<domain> asks <engines_with_keys> and should cost about $<estimate_usd.low> to
$<estimate_usd.high> of your own credits. Run it with a $<ceiling> ceiling?"
**Wait for a yes.**

## 3. Run the audit (paid, after the yes)

Call `audit` again without `dry_run`, with `max_usd` set to the agreed
ceiling. On a refusal, report the message and ask; never raise the ceiling or
retry on your own. Progress arrives as log messages: summarize, do not relay.

From the result: the verdict (`summary_blocks.hero`), the real `cost_usd` and
`report_paths`. Keep counts as counts ("0 of 11 scored answers").

## 4. Where the answers come from (free)

Call the `sources` tool of the saylent MCP server with `bundle_path` (the run
folder) and `view: "opportunities"`. For the top three off-site
opportunities, say: the domain and its type, how many answers that name a
rival and not the brand cite it, which rivals, and one receipt (question,
engine, the cited URL). These are the sites to get onto; the counts are the
reason, not a promise of an outcome.

Use `view: "voice"` for who the answers name, and `domain` for one domain's
pages and every answer citing it.

## 5. The fixes, with their evidence (free)

Call the `fixes` tool of the saylent MCP server with `bundle_path`. Present
the first three by rank: the title, the evidence lines (the receipts), the
effort. Call it with `fix` set to a `fix_key` to show one drafted artifact in
full. Say plainly that values marked TODO-VERIFY must be checked before
anything ships.

For the site-side fixes (`site_fixes`: robots.txt groups, JSON-LD), offer to
put them on a branch of the user's site repository. The user runs this in
their own terminal; it shows a diff and asks before writing, commits locally
and never pushes:

```bash
npx -y saylent@0 fixes apply ./<domain>/<YYYY-MM-DD>/run.json --repo <path-to-site-repo>
```

Off-site fixes (outreach to the opportunity domains, content) stay a list for
the user; offer to draft the outreach from the receipts if they want.

## 6. Verify plan

Close with a short plan the user can follow:

1. Ship the fixes. After a deploy, the `gate_check` tool again ($0).
2. Wait for the engines to re-crawl (days to weeks; Saylent cannot say how
   long). With access logs, `crawlers` shows when the AI crawlers came back.
3. Re-ask the same frozen questions with the `verify` skill: a free dry run
   first, then the paid run after a yes. Movement after a fix is correlation,
   not proof the fix caused it.
4. Two runs or more: the `history` tool, or `npx -y saylent@0 history ./<domain> --digest`.

For data out (CSV or JSON of answers, citations, sources, share of voice),
`npx -y saylent@0 export ./<domain>`; columns are documented at
https://yotambraun.github.io/saylent/docs/export.

## Costs at a glance

Only the audit and verify spend. Quote the dry run's estimate; as a guide, a
smoke audit across four engines is about $0.80 to $1.20 and a full audit about
$5.10 to $7.10. Everything else in this skill is $0.
