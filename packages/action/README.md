# Saylent AI Access Gate

A GitHub Action that checks whether AI search and browsing bots can read your
site: robots.txt per bot class, a live fetch sent as each user-agent, JSON-LD
presence, and meta directives. No LLM calls, no API keys, $0. It writes an
"AI access" status badge into your repo and fails the job only when a
search-index or user-fetch bot is blocked.

It runs the same checks as `saylent gate-check`, from the same engine package.

## Use it

```yaml
# .github/workflows/ai-access.yml
on: [push]
jobs:
  ai-access:
    runs-on: ubuntu-latest
    steps:
      - uses: yotambraun/saylent@v0
        with:
          domain: example.com
```

## Inputs

| Input | Required | Default | What it does |
| --- | --- | --- | --- |
| `domain` | yes | | The domain to check, for example `example.com`. |
| `fail_on` | no | `search,user` | Comma-separated bot classes that fail the job when blocked: `training`, `search`, `user`. A blocked training bot (GPTBot or ClaudeBot via robots.txt) is a legitimate choice, so it is excluded unless you opt in. |
| `badge_path` | no | `.github/badges/ai-access.svg` | Path, relative to the repo root, for the AI-access badge SVG. |
| `write_badge` | no | `true` | Whether to write the badge SVG at all. |
| `site_root` | no | empty | Path prefix for a site hosted under a subpath, for example `/docs` for a project site at `example.github.io/docs`. robots.txt is still read from the host root; the crawl and the live probe stay inside the path. |

## Outputs

| Output | What it is |
| --- | --- |
| `result` | `pass`, `warn` or `fail`. |
| `summary` | The markdown summary, also written to the job summary. |

## More

[The GitHub Action](https://yotambraun.github.io/saylent/docs/action) has the
badge-commit recipe and what the live probe can and cannot know;
[Run it automatically](https://yotambraun.github.io/saylent/docs/integrations)
is this Action next to the MCP server and the library.
[The crawler](https://yotambraun.github.io/saylent/docs/crawler) documents the
user-agent this Action sends and how to allow or block it.

Licensed under Apache-2.0.
