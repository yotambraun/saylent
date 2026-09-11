// Instant skeleton for the dashboard.
import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingApp() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <Skeleton className="h-8 w-44" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-52 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
