# saylent

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

Bring your own `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. One is enough; two let
a model from the other provider family judge. Export them, put them in a `.env`
in the folder you run from, or run `saylent keys set openai`. A smoke run costs
about $0.40 to $1.20 with four engines of your own provider credits, a full run
$2.50 to $4.00; the preflight prints the estimate and asks before spending
anything. Nothing is sent through us, and there is no telemetry. Node 20 or
newer, on macOS, Linux or Windows.

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

Every other flag, and the `verify`, `history`, `report`, `keys`, `models`,
`questions` and `gate-check` commands, are in the
[CLI reference](https://yotambraun.github.io/saylent/docs/cli).

## Four ways in

- **This command.** No install, no account, no database.
  [Quickstart](https://yotambraun.github.io/saylent/docs/quickstart)
- **The app, on your own infrastructure.** History across runs, scheduled verifies, a fixes tracker, rival comparison and an operator console with spend caps. [Self-host](https://yotambraun.github.io/saylent/docs/self-host)
- **The GitHub Action.** `yotambraun/saylent@v0` runs the AI-access checks on every push. No LLM calls, no API keys, $0. [Integrations](https://yotambraun.github.io/saylent/docs/integrations)
- **The docs.** Methodology, costs, what is sent where, and how to extend it. [Docs](https://yotambraun.github.io/saylent/docs)

`import { runAudit } from "@saylent/engine"` and `saylent mcp` expose the same
pipeline to your own code and to an MCP client.

Source, issues and the sample report:
[github.com/yotambraun/saylent](https://github.com/yotambraun/saylent).
Licensed under Apache-2.0 (see LICENSE).
