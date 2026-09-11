// The /setup readiness computation. Pure: given the facts the page already
// gathered (the health payload from src/app/api/health/route.ts, env presence,
// the Inngest ping result), decide the status of each row and whether the
// deployment is ready. No I/O here — this is what readiness.test.ts pins, the
// same "pure predicate" shape as src/app/app/onboarding/operator.ts.
//
// Statuses map onto the Badge variants the rest of the admin console already
// uses for provider rows (src/app/admin/home-client.tsx): "ok" -> secondary,
// "warn" -> outline, "error" -> destructive. Only "error" rows block the
// ready state — "warn" is informational ("fine for local dev, needed before
// production" is the common shape) so a real dev setup can reach green.

export const ENVIRONMENT_DOCS_URL =
  "https://yotambraun.github.io/saylent/docs/self-host/environment";

export type ReadinessStatus = "ok" | "warn" | "error";

export interface ReadinessFix {
  /** the exact env var(s) to set — comma-separated when more than one */
  envVar?: string;
  /** an exact shell command to run */
  command?: string;
  /** where to go next: /admin/providers for keys, the environment docs otherwise */
  href?: string;
  hrefLabel?: string;
}

export interface ReadinessRow {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  fix?: ReadinessFix;
}

export interface ReadinessProviderInput {
  /** matches src/lib/provider-settings.ts PROVIDER_META id */
  id: string;
  label: string;
  envVar: string;
  /** env-only presence — a console-only key reads false here on purpose */
  present: boolean;
}

export interface ReadinessMigrationsInput {
  total: number;
  applied: number;
  latest: string | null;
  missing: string[];
  note?: string;
}

export interface ReadinessInngestInput {
  configuredKeys: boolean;
  /** true = answered, false = did not answer, null = not actively probed */
  reachable: boolean | null;
  target: string;
}

/**
 * "Who is the operator of this deployment?"
 *
 * Migration 0040 promotes the FIRST profile row on a project to `role='admin'`
 * and stays armed until one exists. A project that ends up with accounts but ZERO
 * admins (the demo seed used to do exactly this: it demotes the demo account and
 * walked away) will therefore hand `/admin` to the next person who signs up.
 * /setup is where an operator finds that out.
 */
export interface ReadinessAdminsInput {
  /** false when the probe failed — an unmigrated profiles table, DB down, bad key */
  known: boolean;
  /** profiles with role='admin' */
  count: number;
  /** whether ANY account exists yet */
  anyProfiles: boolean;
}

export interface ReadinessInput {
  db: "up" | "down";
  /** null when db is down — nothing to check yet */
  migrations: ReadinessMigrationsInput | null;
  authMethods: string[];
  providers: ReadinessProviderInput[];
  admins: ReadinessAdminsInput;
  inngest: ReadinessInngestInput;
  email: { resendApiKey: boolean; emailFrom: boolean };
  budget: { dailySpendCapUsd: number; brandLimit: number };
}

export interface ReadinessResult {
  rows: ReadinessRow[];
  ready: boolean;
}

export function computeReadiness(input: ReadinessInput): ReadinessResult {
  const rows: ReadinessRow[] = [
    databaseRow(input.db),
    migrationsRow(input.migrations),
    authMethodsRow(input.authMethods),
    adminRow(input.admins),
    ...providerRows(input.providers),
    inngestRow(input.inngest),
    emailRow(input.email),
    budgetRow(input.budget),
  ];
  return { rows, ready: rows.every((r) => r.status !== "error") };
}

function databaseRow(db: "up" | "down"): ReadinessRow {
  if (db === "up") {
    return { id: "database", label: "Database", status: "ok", detail: "Reachable." };
  }
  return {
    id: "database",
    label: "Database",
    status: "error",
    detail: "The app cannot reach Postgres through Supabase.",
    fix: {
      envVar: "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL",
      href: ENVIRONMENT_DOCS_URL,
      hrefLabel: "Environment variables",
    },
  };
}

function migrationsRow(migrations: ReadinessMigrationsInput | null): ReadinessRow {
  if (!migrations) {
    return {
      id: "migrations",
      label: "Migrations",
      status: "warn",
      detail: "Not checked. The database is unreachable (see the row above).",
    };
  }
  if (migrations.note) {
    return {
      id: "migrations",
      label: "Migrations",
      status: "warn",
      detail: migrations.note,
      fix: { command: "npm run db:migrate", href: ENVIRONMENT_DOCS_URL, hrefLabel: "Environment variables" },
    };
  }
  if (migrations.missing.length > 0) {
    return {
      id: "migrations",
      label: "Migrations",
      status: "error",
      detail: `${migrations.missing.length} of ${migrations.total} migration file(s) not applied: ${migrations.missing.join(", ")}.`,
      fix: { command: "npm run db:migrate" },
    };
  }
  return {
    id: "migrations",
    label: "Migrations",
    status: "ok",
    detail: `${migrations.applied}/${migrations.total} applied. Latest ${migrations.latest ?? "none"}.`,
  };
}

function authMethodsRow(authMethods: string[]): ReadinessRow {
  return {
    id: "auth-methods",
    label: "Auth methods",
    status: "ok",
    detail: authMethods.length > 0 ? authMethods.join(", ") : "password, magic-link (default)",
  };
}

/** The operator row (#2). "No admin, but accounts exist" is an ERROR: the
 *  deployment is one stranger's sign-up away from having a new operator. */
function adminRow(admins: ReadinessAdminsInput): ReadinessRow {
  if (!admins.known) {
    return {
      id: "operator",
      label: "Operator account",
      status: "warn",
      detail: "Not checked. The profiles table could not be read (see the rows above).",
    };
  }
  if (admins.count > 0) {
    return {
      id: "operator",
      label: "Operator account",
      status: "ok",
      detail: `${admins.count} admin account${admins.count === 1 ? "" : "s"}.`,
    };
  }
  if (!admins.anyProfiles) {
    return {
      id: "operator",
      label: "Operator account",
      status: "warn",
      detail:
        "Nobody has signed up yet. The FIRST account created on this deployment becomes the operator (migration 0040) — make sure that account is yours.",
    };
  }
  return {
    id: "operator",
    label: "Operator account",
    status: "error",
    detail:
      "NO admin account exists, but accounts do. Migration 0040 promotes the first profile row and is still armed, so the next person who signs up here becomes the operator of this deployment. Promote one of your own accounts now.",
    fix: {
      command: "npx tsx --env-file=.env.local scripts/grant-admin.ts <your-email> admin",
      href: ENVIRONMENT_DOCS_URL,
      hrefLabel: "Environment variables",
    },
  };
}

/** At least one of openai/anthropic must be present — packages/engine/src/models.ts
 *  resolveRoles() and scripts/check-env.ts --profile cli both gate on exactly this.
 *  Every other provider id is an optional extra answer engine. */
const REQUIRED_PROVIDER_IDS = new Set(["openai", "anthropic"]);

function providerRows(providers: ReadinessProviderInput[]): ReadinessRow[] {
  const hasRequired = providers.some((p) => REQUIRED_PROVIDER_IDS.has(p.id) && p.present);

  return providers.map((p) => {
    if (p.present) {
      return {
        id: `provider-${p.id}`,
        label: p.label,
        status: "ok",
        detail: "Key set.",
        fix: { href: "/admin/providers", hrefLabel: "Providers & models" },
      };
    }
    const isRequiredSlot = REQUIRED_PROVIDER_IDS.has(p.id);
    const status: ReadinessStatus = isRequiredSlot && !hasRequired ? "error" : "warn";
    const detail = !isRequiredSlot
      ? "Not set: optional answer engine."
      : hasRequired
        ? "Not set. Fine, another required-family key already covers it."
        : "Not set. At least one of OPENAI_API_KEY / ANTHROPIC_API_KEY is required.";
    return {
      id: `provider-${p.id}`,
      label: p.label,
      status,
      detail,
      fix: { envVar: p.envVar, href: "/admin/providers", hrefLabel: "Providers & models" },
    };
  });
}

function inngestRow(inngest: ReadinessInngestInput): ReadinessRow {
  if (inngest.reachable === true) {
    return { id: "inngest", label: "Inngest", status: "ok", detail: `Reachable at ${inngest.target}.` };
  }
  if (inngest.reachable === null) {
    return {
      id: "inngest",
      label: "Inngest",
      status: "warn",
      detail: `${inngest.target} configured; not actively probed from this page.`,
    };
  }
  if (inngest.configuredKeys) {
    return {
      id: "inngest",
      label: "Inngest",
      status: "error",
      detail: `INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY are set but ${inngest.target} did not answer.`,
      fix: {
        envVar: "INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY",
        href: ENVIRONMENT_DOCS_URL,
        hrefLabel: "Environment variables",
      },
    };
  }
  return {
    id: "inngest",
    label: "Inngest",
    status: "warn",
    detail: `${inngest.target} did not answer. Fine for local dev (\`npx inngest-cli dev\` needs no keys); set INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY before deploying.`,
    fix: {
      envVar: "INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY",
      href: ENVIRONMENT_DOCS_URL,
      hrefLabel: "Environment variables",
    },
  };
}

function emailRow(email: { resendApiKey: boolean; emailFrom: boolean }): ReadinessRow {
  if (email.resendApiKey && email.emailFrom) {
    return { id: "email", label: "Email", status: "ok", detail: "RESEND_API_KEY and EMAIL_FROM are set." };
  }
  const missing = [!email.resendApiKey && "RESEND_API_KEY", !email.emailFrom && "EMAIL_FROM"]
    .filter((v): v is string => Boolean(v))
    .join(", ");
  return {
    id: "email",
    label: "Email",
    status: "warn",
    detail: `${missing} not set. Transactional email is a no-op until both are set.`,
    fix: { envVar: missing, href: ENVIRONMENT_DOCS_URL, hrefLabel: "Environment variables" },
  };
}

function budgetRow(budget: { dailySpendCapUsd: number; brandLimit: number }): ReadinessRow {
  return {
    id: "budget",
    label: "Budget defaults",
    status: "ok",
    detail: `Daily spend cap $${budget.dailySpendCapUsd} · ${budget.brandLimit} brand(s) per user.`,
    fix: { href: "/admin#budget-limits", hrefLabel: "Budget & limits" },
  };
}

// ---------------------------------------------------------------------------
// Who may see /setup
// ---------------------------------------------------------------------------

/** What a probe of the profiles table came back with. `unknown` covers every
 *  failure: the table doesn't exist yet, Postgres is unreachable, the service
 *  role key is wrong, the query threw. */
export type ProfilesProbe =
  | { readable: true; empty: boolean }
  | { readable: false };

/** /setup fails CLOSED. It is open with NO auth in exactly one situation — the
 *  profiles table was READ successfully and is EMPTY, i.e. a fresh deployment
 *  where nobody has signed up yet and there is no admin to authenticate as (the
 *  first profile row is promoted to admin by migration 0040). Any other
 *  answer — rows exist, OR the probe failed for any reason — requires an admin.
 *  A DB error must never be mistaken for "fresh deployment", because that would
 *  expose the setup page of a running deployment during an outage. */
export function setupRequiresAdmin(probe: ProfilesProbe): boolean {
  if (!probe.readable) return true;
  return !probe.empty;
}
