"use client";
// The bell + inbox. Server seeds the unseen count + last 20
// rows; here we keep them live (dual-channel: Realtime INSERT+UPDATE on
// public.notifications + a 30s slow poll while mounted). Opening the panel marks
// every unseen row seen (badge clears); clicking an item marks it read (its dot
// clears). Those two writes are all the browser is allowed (RLS: seen_at/read_at
// only) — the sync back to every tab/device rides the UPDATE subscription for
// free.
import { FileTextIcon, TrendingUpIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { PendingLink } from "@/components/pending-link";
import { Popover, PopoverContent, PopoverTrigger } from "@saylent/report/ui/popover";
import { relativeTime } from "@saylent/report/relative-time";
import { createClient } from "@/lib/supabase/browser";

export interface NotificationRow {
  id: number;
  type: string;
  title: string;
  href: string;
  created_at: string;
  seen_at: string | null;
  read_at: string | null;
}

const SELECT = "id,type,title,href,created_at,seen_at,read_at";

// TODO: notification-type icons — decorative glyph per stored `type` (src/lib/db.ts):
// audit_ready → report/dossier, verify_ready → movement/delta, run_failed → honest
// alert. aria-hidden (the title stays the primary label); run_failed carries the
// signal tint so a failure reads as one at a glance. Unknown type → no icon.
function TypeIcon({ type }: { type: string }) {
  const cls = "mt-0.5 h-4 w-4 shrink-0";
  switch (type) {
    case "audit_ready":
      return <FileTextIcon className={`${cls} text-wire`} aria-hidden />;
    case "verify_ready":
      return <TrendingUpIcon className={`${cls} text-wire`} aria-hidden />;
    case "run_failed":
      return <TriangleAlertIcon className={`${cls} text-signal`} aria-hidden />;
    default:
      return null;
  }
}

export function NotificationsBell({
  initialItems,
  initialUnseen,
  uid,
}: {
  initialItems: NotificationRow[];
  initialUnseen: number;
  uid: string;
}) {
  const [items, setItems] = useState<NotificationRow[]>(initialItems);
  // unseen rows beyond the loaded 20 (rare) — zeroed the first time we mark seen.
  const [unseenExtra, setUnseenExtra] = useState(() =>
    Math.max(0, initialUnseen - initialItems.filter((i) => !i.seen_at).length),
  );
  const [open, setOpen] = useState(false);
  const unseen = unseenExtra + items.filter((i) => !i.seen_at).length;

  // Realtime: INSERT prepends, UPDATE reconciles seen/read in place.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`notifications-${uid}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (p) => {
          const row = p.new as NotificationRow;
          setItems((cur) => (cur.some((i) => i.id === row.id) ? cur : [row, ...cur].slice(0, 20)));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
        (p) => {
          const row = p.new as NotificationRow;
          setItems((cur) => cur.map((i) => (i.id === row.id ? { ...i, ...row } : i)));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid]);

  // Slow safety poll (30s) — the channel can drop silently (dual-channel law).
  useEffect(() => {
    const supabase = createClient();
    const poll = async () => {
      const { data } = await supabase
        .from("notifications")
        .select(SELECT)
        .order("created_at", { ascending: false })
        .limit(20);
      if (data) setItems(data as NotificationRow[]);
    };
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  }, [uid]);

  // Panel open → one UPDATE marking every unseen row seen (badge clears).
  async function markAllSeen() {
    const unseenIds = items.filter((i) => !i.seen_at).map((i) => i.id);
    setUnseenExtra(0);
    if (unseenIds.length === 0) return;
    const seenAt = new Date().toISOString();
    setItems((cur) => cur.map((i) => (i.seen_at ? i : { ...i, seen_at: seenAt })));
    const supabase = createClient();
    await supabase.from("notifications").update({ seen_at: seenAt }).in("id", unseenIds);
  }

  // Item click → UPDATE read_at on that row (its dot clears).
  async function markRead(id: number, alreadyRead: boolean) {
    if (alreadyRead) return;
    const readAt = new Date().toISOString();
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, read_at: readAt } : i)));
    const supabase = createClient();
    await supabase.from("notifications").update({ read_at: readAt }).eq("id", id);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void markAllSeen();
      }}
    >
      <PopoverTrigger
        aria-label={unseen > 0 ? `Notifications, ${unseen} unread` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-line text-ink transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseen > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal px-1 font-mono text-[10px] font-medium leading-none text-paper"
            aria-hidden
          >
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <div className="border-b border-line px-4 py-3">
          <p className="font-mono text-xs uppercase tracking-wider text-wire">Notifications</p>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-wire">
            Nothing yet. Your first audit will land here.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {items.map((n) => {
              const unread = !n.read_at;
              return (
                <li key={n.id}>
                  <PendingLink
                    href={n.href}
                    onClick={() => {
                      void markRead(n.id, !unread);
                      setOpen(false);
                    }}
                    className="flex items-start gap-2 px-4 py-3 transition-colors hover:bg-paper"
                  >
                    <span
                      className={
                        unread
                          ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal"
                          : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-transparent"
                      }
                      aria-hidden
                    />
                    <TypeIcon type={n.type} />
                    <span className="min-w-0 flex-1">
                      <span className={unread ? "block text-sm text-ink" : "block text-sm text-wire"}>
                        {n.title}
                      </span>
                      <span
                        className="mt-0.5 block font-mono text-xs text-wire"
                        suppressHydrationWarning
                      >
                        {relativeTime(n.created_at)}
                      </span>
                    </span>
                  </PendingLink>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
