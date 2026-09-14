# Saylent

The open-source audit of what AI assistants say about your brand, with the
receipts. One command asks ChatGPT, Claude, Gemini and Perplexity your buyers'
questions, judges the answers cross-family, checks whether the AI crawlers can
read your site, and writes `run.json`, `report.html` and `report.md`.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/yotambraun/saylent/main/website/public/media/hero-report-dark.png">
    <img src="https://raw.githubusercontent.com/yotambraun/saylent/main/website/public/media/hero-report-light.png" alt="A Saylent report open in a browser: the verdict, the numbers behind it, and the buyer questions it came from" width="900">
  </picture>
</p>

```bash
npx saylent audit example.com
```

Bring your own keys. One `OPENAI_API_KEY` or one `ANTHROPIC_API_KEY` runs the
audit with that engine; two keys turn on the cross-family judge, where one
provider family judges the other's answers. A `GEMINI_API_KEY` and a
`PERPLEXITY_API_KEY` add those two engines. Export them, put them in a `.env`
in the folder you run from, or run `saylent keys set openai`.

With all four engines, a smoke run costs about $0.60 to $1.20 of your own
provider credits and a full run about $3.70 to $5.50; our two recorded smoke
runs, both on four engines, cost $0.93 and $1.11. The preflight prints the
estimate and asks before spending anything. Nothing is sent through us, and
there is no telemetry. Node 20 or newer, on macOS, Linux or Windows.

## Common flags

| Flag | What it does |
| --- | --- |
| `--max-usd <n>` | Refuse to run if the high cost estimate exceeds this many dollars. |
| `--dry-run` | Print the plan, the questions it would ask and the cost estimate. Spends nothing. |
| `--profile <name>` | `smoke` (6 questions, the default) or `full` (23 questions). |
| `--engines <a,b>` | Which engines to ask: `chatgpt`, `claude`, `gemini`, `perplexity`. Default: every one you have a key for. |
| `--samples <n>` | How many times each scored question is asked, 1 to 5. Default: 1 on smoke, 2 plus an adaptive tiebreak on full. |
| `--skip <a,b>` | Skip costly stages: `drafts` (no fix artifacts), `corpus` (no cited-page fetches), `gates` (no site checks). |
| `--questions <file>` | Ask your own set: a `run.json`, a `questions.json` from `saylent questions`, or a text file with one question per line. |
| `--judge <model>` | The judge model. Its provider family is inferred from the name. |
| `--model <role>=<id>` | Override one role's model. Roles: `brand`, `drafter`, `chatgpt`, `claude`, `gemini`, `perplexity`. |
| `--format <a,b>` | Which files to write: `md`, `html`, `json`. Default: all three. |

`saylent gate-check example.com` runs the site check on its own: robots.txt per
AI bot, a live fetch as each bot, your JSON-LD and your meta directives, for $0
and no key at all. Every other flag, and the `verify`, `history`, `report`,
`keys`, `models` and `questions` commands, are in the
[CLI reference](https://yotambraun.github.io/saylent/docs/cli).

## The rest of it

The docs are one story in six parts, in this order:

- **[Run it once](https://yotambraun.github.io/saylent/docs/quickstart)**: this
  command. Keys, the run, the report, and how to re-ask the same questions next
  month with no database.
- **[Keep score as a team](https://yotambraun.github.io/saylent/docs/tour)**: the
  app on your own infrastructure, with history, a fix tracker, rival comparison,
  share links, and as many user accounts as you like on one deployment. Walk a
  [read-only copy](https://saylent-demo.vercel.app/app) first.
- **[Operate it for others](https://yotambraun.github.io/saylent/docs/self-host/admin)**: the
  operator console, with a spend cap, a kill switch, a model per role, users,
  runs, takedowns and an audit log.
- **[Automate](https://yotambraun.github.io/saylent/docs/integrations)**: the
  $0 GitHub Action, the MCP server (`saylent mcp`), and `runAudit()` from
  `@saylent/engine` in your own code.
- **[Understand](https://yotambraun.github.io/saylent/docs/how-it-works)**: the
  nine stages, the methodology, what it costs, and what leaves your machine.
- **[Project](https://yotambraun.github.io/saylent/docs/contributing)**: the $0
  dev setup, the extension points, and how to report a security issue.

Source, issues and the sample report:
[github.com/yotambraun/saylent](https://github.com/yotambraun/saylent).
Licensed under Apache-2.0 (see LICENSE).
