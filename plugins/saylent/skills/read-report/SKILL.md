---
name: read-report
description: Summarize a Saylent audit that already ran, from its run.json or report folder - the verdict, who AI assistants recommend instead, the pages they cite, the bot-access findings and the fix plan - or answer a question about one section. Free and offline. Use when the user points at a Saylent run.json, report.html or report folder, asks what an earlier audit found, or asks a follow-up about a report.
argument-hint: "[path to run.json or its folder] [section]"
allowed-tools: mcp__plugin_saylent_saylent__read_report
---

# Summarize an existing Saylent report

Report: $ARGUMENTS (a `run.json`, the folder holding it, and optionally a section).

Free: no network, no model calls, nothing re-run.

## 1. Find the run

- Use the given path. If the user points at `report.html` or `report.md`,
  use the `run.json` in the same folder.
- With no path, look for `./<domain>/<YYYY-MM-DD>/run.json` in the project and
  pick the newest, or ask when there are several brands.

## 2. Read it

Call the `read_report` tool of the saylent MCP server with
`{ "bundle_path": "<path>" }` for the whole summary, or add `section` for one
part. Sections, when present: `hero` (headline numbers), `am-i-in-the-answer`,
`who-wins-instead`, `deciding-pages`, `where-from`, `do-first` (the fix
plan), `sent-elsewhere`, `bots-read-site`, `how-described`, `trust-this`, and
`questions` (the frozen question set). An unknown section returns an error
that lists the available ones; use that list.

If the MCP tool is unavailable, read `report.md` in the run folder, or
re-render it with `npx -y saylent@0 report <run.json>`.

## 3. Present it

The result has `brand`, `domain`, `profile`, `measured_at` and
`summary_blocks` (`hero` plus question `cards`, each with blocks of text,
stats and receipt-linked lists).

For a full summary, keep it short and in this order:

1. **Headline**: `hero.headline`, then the hero stats (recommended, mentioned,
   top rival) exactly as written.
2. **Who wins instead** and **which pages decide the answers**, two or three
   bullets each.
3. **Do first**: the top three fixes, in the report's order.
4. **How to read it**: the run's basis line (how many questions were asked
   and scored, any engine failures), the measurement date and the profile.

For a question about one part, read just that section and answer it directly.

Rules:

- Quote numbers as the report states them ("0 of 11"), never as invented
  percentages or trends. One run is a snapshot; say so if asked about change
  over time, and offer the `verify` skill.
- Every claim in the report links to a receipt (an answer, a cited page, a
  check). Mention that `report.html` shows them, and offer to open the file
  path.
- Do not add competitors, pages or causes the report does not contain.
