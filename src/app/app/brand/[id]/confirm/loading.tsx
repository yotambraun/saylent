// Instant skeleton for the Confirm-your-audit page.
import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingConfirm() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-10">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-10 w-56" />
    </div>
  );
}
