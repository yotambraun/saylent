import { Skeleton } from "@saylent/report/ui/skeleton";

export default function LoadingAdmin() {
  return (
    <div className="flex w-full flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
