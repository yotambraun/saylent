// Instant skeleton for the rival head-to-head (the dossier RPC + compose runs
// server-side; this reserves the layout so there's no jump).
import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingVs() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-72" />
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full" />
          ))}
        </div>
      </div>
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
