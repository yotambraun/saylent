// App layout: left sidebar (Brands/Runs, Search, Settings),
// top bar (brand switcher placeholder, user menu with email + sign out).
// Proxy already gates /app/*; here we just read the user for the menu.
import { AnalyticsProvider } from "@/components/analytics-provider";
import { DemoBanner } from "@/components/demo-banner";
import { NavLink } from "@/components/nav-link";
import { PendingLink } from "@/components/pending-link";
import { isDemoReadOnly } from "@/lib/demo-mode";
import type { PillRun } from "@/lib/run-pill";
import { createClient } from "@/lib/supabase/server";
import { GlobalRunPill } from "./global-run-pill";
import { MobileNav } from "./mobile-nav";
import { NotificationsBell, type NotificationRow } from "./notifications-bell";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Seed the header awareness UI. RLS scopes every read to this user.
  // Active runs feed the GlobalRunPill; notifications feed the bell + badge.
  const uid = user?.id ?? "";
  const [{ data: activeRunRows }, { data: notifRows }, { count: unseenCount }] = uid
    ? await Promise.all([
        supabase
          .from("runs")
          .select("id,stage,status,brand_id,created_at,brands(name)")
          .in("status", ["queued", "running"])
          .is("hidden_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("notifications")
          .select("id,type,title,href,created_at,seen_at,read_at")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .is("seen_at", null),
      ])
    : [{ data: null }, { data: null }, { count: 0 }];

  const initialRuns: PillRun[] = (activeRunRows ?? []).map(
    (r: { id: string; stage: string; status: string; created_at: string; brands: unknown }) => {
      const b = r.brands as { name?: string } | { name?: string }[] | null;
      const brandName = Array.isArray(b) ? (b[0]?.name ?? "") : (b?.name ?? "");
      return { id: r.id, brandName, stage: r.stage, status: r.status, created_at: r.created_at };
    },
  );
  const initialNotifications = (notifRows ?? []) as NotificationRow[];

  // Surface the operator console in the sidebar for admins only (role is
  // service-role-writable; a normal user can never see or reach /admin).
  const { data: roleRow } = uid
    ? await supabase.from("profiles").select("role").eq("id", uid).maybeSingle()
    : { data: null };
  const isAdmin = roleRow?.role === "admin";

  // Hosted read-only demo: the banner explains the sample
  // data; the account controls are hidden because a shared demo account has no sign-out
  // worth offering and no email worth showing.
  const demo = isDemoReadOnly();

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="flex min-h-0 flex-1">
        <AnalyticsProvider />
        <aside className="hidden w-52 shrink-0 flex-col border-r border-line bg-card sm:flex">
          <PendingLink href="/app" className="flex h-14 items-center border-b border-line px-4">
            <span className="font-display text-lg font-semibold">Saylent</span>
          </PendingLink>
          <nav className="flex flex-col gap-1 p-3 text-sm">
            <PendingLink
              href="/app/onboarding"
              className="mb-2 rounded-md bg-ink px-3 py-2 text-center font-medium text-paper hover:opacity-90"
            >
              + New audit
            </PendingLink>
            <NavLink href="/app" className="rounded-md px-3 py-2 hover:bg-paper">
              Brands &amp; runs
            </NavLink>
            <NavLink href="/app/fixes" className="rounded-md px-3 py-2 hover:bg-paper">
              Fix tracker
            </NavLink>
            <NavLink href="/app/compare" className="rounded-md px-3 py-2 hover:bg-paper">
              Compare
            </NavLink>
            <NavLink href="/app/search" className="rounded-md px-3 py-2 hover:bg-paper">
              Search
            </NavLink>
            <NavLink href="/app/settings" className="rounded-md px-3 py-2 hover:bg-paper">
              Settings
            </NavLink>
            <NavLink href="/app/support" className="rounded-md px-3 py-2 hover:bg-paper">
              Support
            </NavLink>
            {/* Help area — /demo is the "Sample
                report" and /help the FAQ, both self-hosted in-app pages now. */}
            <NavLink href="/demo" className="rounded-md px-3 py-2 hover:bg-paper">
              Sample report
            </NavLink>
            <NavLink href="/help" className="rounded-md px-3 py-2 hover:bg-paper">
              Help
            </NavLink>
            {isAdmin && (
              <NavLink
                href="/admin"
                className="mt-1 rounded-md px-3 py-2 font-medium text-signal hover:bg-paper"
                // keep the signal tint when active; just add the surface
                activeClassName="bg-paper"
              >
                Admin
              </NavLink>
            )}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-line bg-card px-4">
            <div className="flex items-center gap-3">
              <MobileNav />
              <span className="font-display text-lg font-semibold sm:hidden">Saylent</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {uid && <GlobalRunPill initialRuns={initialRuns} uid={uid} />}
              {uid && (
                <NotificationsBell
                  initialItems={initialNotifications}
                  initialUnseen={unseenCount ?? 0}
                  uid={uid}
                />
              )}
              {!demo && <span className="hidden text-wire sm:inline">{user?.email}</span>}
              {!demo && <SignOutButton />}
            </div>
          </header>
          <main className="flex-1 p-6 lg:px-12 lg:py-10">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
