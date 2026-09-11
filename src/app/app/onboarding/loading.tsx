import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingOnboarding() {
  return (
    <div className="mx-auto w-full max-w-md pt-10">
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}
