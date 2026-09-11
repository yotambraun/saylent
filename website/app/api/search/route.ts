// website/app/api/search/route.ts — the docs search index, exported once at
// build time. `output: "export"` (next.config.ts) has no server to query, so
// Fumadocs' `staticGET` writes the whole index as a static file and the search
// dialog (layout.tsx: `search.options.type: "static"`) downloads it and runs
// the query in the browser. 22 docs pages with no search at all.
//
// Confirm against the installed fumadocs-core version, not training data —
// node_modules/fumadocs-core/dist/search/server.d.ts (`SearchAPI.staticGET`).
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

export const revalidate = false;
export const dynamic = "force-static";

export const { staticGET: GET } = createFromSource(source);
