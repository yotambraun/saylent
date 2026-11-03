---
name: verify
description: Re-ask the exact frozen questions of an earlier Saylent audit and show what moved since then - recommendations, mentions, cited pages - after the user shipped fixes. Spends the user's own provider credits (about the same as the original audit), so it states the cost and asks first. Use when the user asks whether their fixes worked, wants a before/after comparison, or wants to re-measure a brand against a previous run.json.
argument-hint: "[path to run.json or its folder]"
---

# Verify fixes against a frozen baseline

Baseline: $ARGUMENTS (a `run.json` or the folder holding it; if empty, find one).

A verify asks the same questions, of the same engines, as the baseline run,
so the comparison is fair. It writes a new `run.json` and `movement.html`.

## 1. Find the baseline

- If no path was given, look for `./<domain>/<YYYY-MM-DD>/run.json` in the
  project. `npx -y saylent@0 history ./<domain>` lists the runs in a brand's
  folder. Use the oldest run as the baseline unless the user says otherwise,
  and confirm which one.
- If there is no earlier run, there is nothing to verify: offer the `audit`
  skill to create a baseline.

## 2. State the cost and ask

Verify has no dry run. Read the baseline with the `read_report` tool of the
saylent MCP server (free) to name the brand, profile and date, and read
`run.est_cost_usd` from the baseline `run.json`: the recorded cost of the
original run. Tell the user: "Re-measuring <brand> against the <date> baseline asks
the same <n> engines and should cost about the same as the original,
$<cost>. Run it with a $<ceiling> ceiling?" Use a ceiling of the original
cost times 1.5, rounded up to the next $0.50, unless the user picks one.
Wait for a yes.

Keys: the same provider keys the baseline used must be available (environment,
`.env`, or `~/.saylent/config.json` via `npx saylent keys set <provider>` in
the user's own terminal). Never ask for a key in the chat, never echo one. If
a refusal names a missing key, explain how to add it and stop.

## 3. Run

Call the `verify` tool with `{ "bundle_path": "<path>", "max_usd": <ceiling> }`.
Shell fallback: `npx -y saylent@0 verify <path> --max-usd <n> --yes`.

The server refuses, before spending, when the estimate is above `max_usd`,
when the daily spend cap is reached, or when the question templates or the
sample count changed since the baseline. Report the refusal in plain words;
for template drift, the fix is a fresh audit as a new baseline. Never raise
the ceiling or retry on your own.

## 4. Present the movement

From the result (`verdict`, `band`, `summary_blocks`, `report_paths`,
`cost_usd`):

1. Before and after in one line: for example, recommended in 0 of 11 scored
   answers before, 3 of 11 now.
2. What moved and what did not, engine by engine where the summary shows it.
3. The real cost and the path to `movement.html` for the receipts.

Do not attribute movement to a specific fix unless the report shows it; AI
answers also vary between runs. Small changes (one answer) are within normal
variation; say so.
