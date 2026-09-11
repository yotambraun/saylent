// Field-shaped skeleton for settings sections (loading state). Mirrors the
// row layout: a title, then hairline-separated rows with label + control shapes.
import { Skeleton } from "@saylent/report/ui/skeleton";

export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      <Skeleton className="h-8 w-40" />
      <div className="mt-4 divide-y divide-line border-t border-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-start justify-between gap-6 py-5">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-8 w-28 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
