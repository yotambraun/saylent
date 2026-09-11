// website/lib/source.ts — the /docs/* loader over the
// content/docs MDX collection defined in source.config.ts.
import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
