// /admin chrome. requireAdmin() here gates the WHOLE area (session +
// role); every page and action re-checks independently. Deliberately minimal —
// this is an internal operator surface, not a product page.
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";

export const metadata = { title: "Saylent · Operator console" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-line bg-card px-4 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="font-display text-lg font-semibold">
            Saylent <span className="text-wire">· Operator console</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin" className="text-wire hover:text-ink">
              Users
            </Link>
            <Link href="/admin#budget-limits" className="text-wire hover:text-ink">
              Budget &amp; limits
            </Link>
            <Link href="/admin/providers" className="text-wire hover:text-ink">
              Providers
            </Link>
            <Link href="/admin/runs" className="text-wire hover:text-ink">
              Runs
            </Link>
            <Link href="/admin/takedown" className="text-wire hover:text-ink">
              Takedowns
            </Link>
            <Link href="/admin/support" className="text-wire hover:text-ink">
              Support
            </Link>
            <Link href="/admin/analytics" className="text-wire hover:text-ink">
              Analytics
            </Link>
            <Link href="/admin/audit" className="text-wire hover:text-ink">
              Audit log
            </Link>
            {/* /setup is the readiness page a fresh operator needs FIRST. It used
                to be linked only from admin error pages. */}
            <Link href="/setup" className="text-wire hover:text-ink">
              Setup
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="hidden text-wire sm:inline">{admin.email}</span>
          <Link href="/app" className="text-wire hover:text-ink">
            ← back to app
          </Link>
        </div>
      </header>
      <main className="flex-1 p-6 lg:px-10 lg:py-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
