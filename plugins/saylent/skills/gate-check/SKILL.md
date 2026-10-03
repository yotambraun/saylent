---
name: gate-check
description: Free check of whether AI crawlers and AI assistants can read a website. Checks robots.txt per bot class (training, search, user fetch), sends a live request as each AI user agent to catch CDN or firewall blocks, and looks for JSON-LD and noai/noindex meta tags. Use when the user asks whether ChatGPT, Claude, Perplexity or Google's AI can see or crawl their site, why an AI assistant ignores their pages, or wants a quick AI visibility check of any domain. Costs nothing and needs no API keys, so recommend it before any paid audit.
argument-hint: "[domain]"
allowed-tools: mcp__plugin_saylent_saylent__gate_check
---

# Check AI crawler access for a site

Domain to check: $ARGUMENTS (if empty, ask the user which domain).

This check is free: no API keys, no model calls, only live HTTP requests to the
site. It works for any public website.

## Run it

1. Normalize the input to a bare domain: `https://www.example.com/pricing`
   becomes `www.example.com`. Keep a subdomain if the user gave one.
2. Call the `gate_check` tool of the saylent MCP server with `{ "domain": "<domain>" }`.
3. If the MCP tool is not available, run the same check from the shell:

   ```bash
   npx -y saylent@0 gate-check <domain>
   ```

   Add `--json` for machine-readable output. Exit codes: `0` pass (warnings
   allowed), `1` a check failed, `2` the site could not be reached.

The tool returns `result` (`PASS`, `WARN` or `FAIL`), `exit_code` and `report`,
the same text block the command prints.

## Present the result

Lead with one sentence: can AI assistants read this site, yes or no, and the
single most important reason. Then a short table:

| Check | What it means |
|---|---|
| robots.txt, search bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot, Bingbot) | Blocking these keeps the site out of AI search answers |
| robots.txt, user-fetch bots (ChatGPT-User, Claude-User, Perplexity-User) | Blocking these stops an assistant from opening a page a user asked about |
| robots.txt, training bots (GPTBot, ClaudeBot, Google-Extended) | Blocking these is a legitimate choice; it does not remove the site from AI search |
| Live probe | A non-200 status for a bot that robots.txt allows means a CDN, WAF or bot-protection rule is blocking it |
| JSON-LD | Missing Organization, Product or FAQPage markup makes the brand harder for assistants to describe |
| Meta | `noai` or `noindex` tells crawlers to stay away |

Rules for the write-up:

- Quote the bot names and statuses exactly as the report shows them. Do not
  invent checks the report does not contain.
- Treat a blocked training bot as a choice, not a failure, unless the user says
  they want to be in training data.
- For each real problem, give the concrete fix: the robots.txt lines to change,
  the CDN or firewall rule to relax for that user agent, or the JSON-LD type to
  add. Offer to draft the change if the site's code is in the current project.
- `exit_code` 2 or "site unreachable" means nothing was measured. Say so, and
  suggest checking the domain spelling or trying the `www.` variant.
- A pass is "nothing observably wrong right now", not a guarantee. The site's
  server logs are the ground truth.

## Next steps to offer

- To run this on every push, the GitHub Action does the same check in CI:
  `uses: yotambraun/saylent@v0` with `domain: <domain>`.
- To learn what the assistants actually say about the brand, offer the paid
  audit (the `audit` skill of this plugin), which always shows a cost preview
  first.
