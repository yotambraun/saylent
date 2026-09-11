// /status — the public "is this deployment up?" page. It reports ONLY what it
// actually checks: the same public /api/health payload an uptime monitor gets
// ({ok, db}), read in-process so the page cannot disagree with the endpoint, and
// re-checked on every request. Nothing here is hand-maintained, so nothing here
// can go stale and lie. Anything the health check cannot prove (a slow engine, a
// bounced email) is stated as out of scope instead of being claimed green.
import Link from "next/link";
import { getHealthPayload, publicHealth } from "@/app/api/health/route";

export const dynamic = "force-dynamic";

export const metadata = { title: "System status · Saylent" };

const STATUS_LABEL = { up: "Operational", down: "Down" } as const;
const STATUS_DOT = { up: "bg-success", down: "bg-pill-dismissed" } as const;

/** UTC minute of the check, printed next to "checked just now" so a screenshot of
 *  this page still says when it was taken. */
function checkedAt(): string {
  return `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function StatusPage() {
  // publicHealth() is the anonymous view of the payload — exactly what
  // GET /api/health returns to a stranger. Never the operator payload.
  const { ok, db } = publicHealth(await getHealthPayload());
  const app = ok ? "up" : "down";

  const components: { name: string; description: string; status: "up" | "down" }[] = [
    {
      name: "App",
      description: "Sign-in, dashboard, reports and account.",
      status: app,
    },
    {
      name: "Database",
      description: "The store behind every brand, run and report.",
      status: db,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="font-display text-4xl leading-tight">System status</h1>
      <div className="mt-6 flex items-center gap-3 rounded-lg border border-line bg-card px-5 py-4">
        <span className={`h-3 w-3 shrink-0 rounded-full ${ok ? "bg-success" : "bg-pill-dismissed"}`} />
        <span className="font-display text-lg">
          {ok ? "All checks passing" : "This deployment is not healthy"}
        </span>
      </div>
      <p className="mt-2 font-mono text-xs text-wire">
        Checked just now · {checkedAt()}
      </p>

      <div className="mt-8 divide-y divide-line border-t border-line">
        {components.map((c) => (
          <div key={c.name} className="flex items-start justify-between gap-4 py-5">
            <div className="min-w-0">
              <div className="font-medium text-ink">{c.name}</div>
              <p className="mt-0.5 text-sm text-wire">{c.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[c.status]}`} />
              <span className="text-sm text-ink">{STATUS_LABEL[c.status]}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-8 text-sm text-wire">
        This page checks that the app is serving and can reach its database, and nothing more.
        A slow answer engine, a delayed email or a stuck audit will not show up here.
      </p>
      <p className="mt-3 text-sm text-wire">
        Seeing something we&apos;re not? Let us know from{" "}
        <Link href="/app/support" className="text-ink underline underline-offset-2">
          Contact support
        </Link>
        . For account questions, see the{" "}
        <Link href="/help" className="text-ink underline underline-offset-2">
          Help &amp; FAQ
        </Link>
        .
      </p>
    </div>
  );
}
