// Instant skeleton for Questions and run options: the cost panel, the controls,
// then the question list, in the order the real page renders them.
import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingQuestions() {
  return (
    <div className="flex flex-col gap-10">
      <Skeleton className="h-14 w-80" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
