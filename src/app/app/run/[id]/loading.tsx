// Instant skeleton while the dossier server-renders — the click must feel
// immediate even when compile/data takes seconds (observed as a UX gap in testing).
import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingRun() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
      <Skeleton className="h-4 w-72" />
      <div className="grid grid-cols-2 gap-6 rounded-lg border border-line bg-card p-6 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-64" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
      <p className="font-mono text-xs text-wire">opening the report…</p>
    </div>
  );
}
