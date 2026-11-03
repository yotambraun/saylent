// The words a report uses for an answer's searches (query fan-out), shared by
// the evidence drawer and report.md so both say the same thing. The facts are
// the engine's (@saylent/engine/search-queries): which engines report their
// queries, and what an empty or missing list means.
import { searchQueriesState, type SearchQueriesState } from "@saylent/engine/search-queries";
import { engineLabel } from "@saylent/engine/surfaces";

export interface SearchQueriesView {
  state: SearchQueriesState;
  /** the queries, in the order the engine ran them; [] unless state is "listed" */
  queries: string[];
  /** one sentence for every state but "listed" */
  note: string | null;
}

export function searchQueriesView(a: {
  engine: string;
  search_queries?: readonly string[] | null;
  usage?: { searches?: number } | null;
}): SearchQueriesView {
  const state = searchQueriesState(a);
  const label = engineLabel(a.engine);
  switch (state.kind) {
    case "listed":
      return { state, queries: state.queries, note: null };
    case "none":
      return { state, queries: [], note: "It answered without searching the web." };
    case "unreported":
      return {
        state,
        queries: [],
        note: `It ran ${state.searches} web ${state.searches === 1 ? "search" : "searches"}, but the response did not include the queries.`,
      };
    case "not_exposed":
      return { state, queries: [], note: `${label} does not report the searches behind its answer.` };
    case "not_recorded":
      return { state, queries: [], note: "Not recorded for this run." };
  }
}
