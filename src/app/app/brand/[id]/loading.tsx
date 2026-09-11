// Instant skeleton for the movement page.
import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingMovement() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-52 w-full" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-36 w-full" />
        ))}
      </div>
      <Skeleton className="h-52 w-full" />
    </div>
  );
}
