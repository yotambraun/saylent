import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingSearch() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-4 h-11 w-full" />
      <div className="mt-3 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
    </div>
  );
}
