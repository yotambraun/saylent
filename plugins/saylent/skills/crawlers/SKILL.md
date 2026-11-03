---
name: crawlers
description: Free analysis of a site's own access log for AI crawlers. Shows which AI bots actually visit (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Googlebot, Bingbot and more), what each is for, the pages they fetch, and the requests that were blocked or failed, with redacted log lines as receipts. Use when the user has an nginx/Apache access log, a Vercel log drain or a Cloudflare Logpush file and asks whether AI crawlers reach their site, why an assistant does not cite a page, or what their firewall blocks. Costs nothing; the log never leaves the machine.
argument-hint: "[path to access log or folder] [optional run.json]"
---

# What AI crawlers actually do on a site

Log: $ARGUMENTS (if empty, ask the user for the access log file or folder, and
whether there is a saylent run.json for the same site).

This is free and local: no API key, no model call, and the log is read where it
is. Client IPs are redacted in everything it returns.

## Run it

1. The log must be inside the current working directory (copy it in if needed).
   It can be nginx/Apache combined, a Vercel log drain export (NDJSON or a JSON
   array) or Cloudflare Logpush `http_requests` NDJSON; `.gz` files and folders work.
2. Call the `crawlers` tool of the saylent MCP server with
   `{ "log_path": "<path>" }`. Add `"run_path": "<run.json>"` when an audit of
   the same site exists, to list the cited pages no AI crawler fetched. Add
   `"verify_ips": true` only if the user agrees to download the operators'
   public IP-range lists (nothing about the log is sent).
3. If the MCP tool is not available, run the same analysis from the shell:

   ```bash
   npx -y saylent@0 crawlers <path> --run <run.json>
   ```

   `--out <dir>` writes crawlers.json and crawlers.md.

## Present the result

Lead with the `summary` sentence. Then:

- A short table of the AI bots: purpose, requests, pages, blocked, 5xx.
- The top problems, each with its path, bot and one receipt line, and the fix
  that matches the kind: a firewall or CDN rule to relax for that user agent
  (blocked), the failing route (5xx), a redirect for a moved page (404).
- With a run: the cited pages no AI crawler fetched in this window, and pages
  the citing engine's own crawler never fetched.

Rules for the write-up:

- Quote counts and bot names exactly as returned. Never invent a bot or a cause.
- A page no crawler fetched in this window may have been fetched before it:
  say "in this log window".
- Without IP verification every bot request is unverified, because a user
  agent is a claim. Say so when it matters.
- Google-Extended never appears in logs: it is a robots.txt token, and
  Googlebot does the fetching.

## Next steps to offer

- The free `gate-check` skill shows what robots.txt and a live probe allow,
  next to what the log shows actually happened.
- If there is no audit yet, the `audit` skill (paid, with a cost preview)
  shows what the assistants say and which pages they cite.
