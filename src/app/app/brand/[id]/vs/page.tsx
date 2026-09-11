// /app/brand/[id]/vs → the compare experience moved to /app/compare (a real
// sidebar destination, project rule). This stub keeps every
// older link working: it forwards the brand (and a picked rival) into the
// canonical page. The client island lives on in ./vs-client.tsx, imported by
// /app/compare.
import { redirect } from "next/navigation";

export default async function VsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rival?: string | string[] }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const rival = Array.isArray(sp.rival) ? sp.rival[0] : sp.rival;
  redirect(
    `/app/compare?brand=${encodeURIComponent(id)}${rival ? `&rival=${encodeURIComponent(rival)}` : ""}`,
  );
}
