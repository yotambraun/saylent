// Instant skeleton for the fix tracker.
import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingFixes() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-6 w-72" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
