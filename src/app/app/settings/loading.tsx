import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingSettings() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-36 w-full" />
      ))}
    </div>
  );
}
