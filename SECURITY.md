# Security Policy

## Reporting a vulnerability

Report privately through GitHub's built-in private vulnerability reporting,
not by email and not as a public issue:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected component, and steps to reproduce.

This opens a private advisory visible only to you and the maintainer, so the
issue is not exposed while a fix is worked out. If your GitHub account
cannot see the Security tab for some reason, open a regular issue asking for
a private channel to be opened, without any exploit details in that issue.

## Supported versions

Only the latest minor release on the current major version receives
security fixes. There is no long-term-support branch. If you are on an
older minor version, update first and confirm the issue still reproduces.

## Response and disclosure timeline

This is a solo-maintained project. The target is:

- Acknowledgment within one week of the report.
- A fix, a mitigation, or a clear explanation of the assessed severity
  within 90 days of acknowledgment.
- Coordinated disclosure: the reporter and the maintainer agree on a
  publication date once a fix is available, defaulting to 90 days from the
  original report if no agreement is reached sooner.

Credit is given to the reporter in the advisory and the changelog, unless
you ask to stay anonymous.

## Scope

In scope:

- The `saylent` CLI (`packages/cli`).
- The self-hosted app (`src/app`, `src/lib`, `src/inngest`, and the
  Supabase migrations under `supabase/migrations`).
- The audit engine's crawler and its handling of untrusted site content
  (`packages/engine`, including `domainChecks.ts` and the corpus builder).

Examples of what belongs here: request forgery or injection through crawled
page content, authentication or row-level-security bypass in the self-hosted
app, secret leakage through logs or generated reports, and dependency
vulnerabilities in the published packages.

## Out of scope

- The fictional demo site used in the sample reports and fixtures (the
  Kestrel example). It is a static, non-production teaching artifact; issues
  in it are a documentation bug, not a security report.
- Vulnerabilities that require an attacker to already have your provider API
  keys or service-role database credentials.
- Findings from automated scanners with no working proof of concept.
- Third-party services this project integrates with (Supabase, Inngest,
  the LLM providers themselves), report those upstream.
