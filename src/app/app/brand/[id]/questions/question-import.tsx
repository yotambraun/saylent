"use client";
// Import real questions into the editor: a Search Console Queries export, a
// CSV, a text file or a questions.json, parsed IN THE BROWSER with the same
// engine function as `saylent questions import` (@saylent/engine/question-import).
// Nothing is uploaded and nothing is stored until the owner saves the draft.
// Every dropped row is counted by reason before anything is added.
import { useState } from "react";
import { importQuestions, importSummary, type ImportResult } from "@saylent/engine/question-import";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";

const check = "size-4 accent-[var(--color-signal,currentColor)]";

export function QuestionImport({
  capacity,
  onImport,
}: {
  /** how many more rows the editor can take */
  capacity: number;
  onImport: (texts: string[], locale: { language?: string; country?: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<{ name: string; body: string } | null>(null);
  const [column, setColumn] = useState("");
  const [exclude, setExclude] = useState("");
  const [questionsOnly, setQuestionsOnly] = useState(false);
  const [cluster, setCluster] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(file = text, col = column) {
    if (!file) return;
    try {
      setError(null);
      setResult(
        importQuestions(
          file.body,
          { column: col.trim() || null, exclude: exclude.trim() ? [exclude.trim()] : [], questionsOnly, cluster, max: Math.max(1, Math.min(50, capacity)) },
          file.name,
        ),
      );
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > 5_000_000) {
      setError("That file is larger than 5 MB. A Search Console Queries export is far smaller: export the Queries tab.");
      return;
    }
    if (/\.zip$/i.test(f.name)) {
      setError("That is the export ZIP. Unzip it and choose the Queries.csv inside.");
      return;
    }
    const file = { name: f.name, body: await f.text() };
    setText(file);
    run(file);
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} disabled={capacity <= 0}>
        Import questions
      </Button>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-ink">Import real questions</p>
        <p className="text-xs text-wire">
          A Search Console Performance export (the Queries.csv in its ZIP), any CSV, a text file with one question per line, or a
          questions.json. Read in your browser; nothing is uploaded. Imported rows are tagged as your own (custom), so they are asked
          and reported but not counted in the band unless you tag them.
        </p>
      </div>
      <input
        type="file"
        accept=".csv,.tsv,.txt,.json,text/csv,text/plain,application/json"
        onChange={(e) => void pick(e.target.files?.[0])}
        className="text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-sm"
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-wire">
          Column (CSV)
          <Input value={column} onChange={(e) => setColumn(e.target.value)} placeholder="detected" className="w-36" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-wire">
          Leave out rows matching
          <Input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="e.g. your brand name" className="w-48" />
        </label>
        <label className="flex items-center gap-2 text-xs text-wire">
          <input type="checkbox" className={check} checked={questionsOnly} onChange={(e) => setQuestionsOnly(e.target.checked)} /> Question-shaped only
        </label>
        <label className="flex items-center gap-2 text-xs text-wire">
          <input type="checkbox" className={check} checked={cluster} onChange={(e) => setCluster(e.target.checked)} /> Merge near-identical
        </label>
        <Button variant="outline" onClick={() => run()} disabled={!text}>
          Apply
        </Button>
      </div>
      {error && <p className="text-sm text-pill-dismissed">{error}</p>}
      {result && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink">{importSummary(result)}</p>
          {result.warnings.map((w) => (
            <p key={w} className="text-xs text-wire">
              {w}
            </p>
          ))}
          {result.kept.length > 0 ? (
            <ol className="flex max-h-56 list-decimal flex-col gap-1 overflow-y-auto pl-6 text-sm text-ink">
              {result.kept.map((q) => (
                <li key={q.row}>
                  {q.text}
                  {q.impressions !== undefined && <span className="ml-2 font-mono text-xs text-wire">{q.impressions.toLocaleString("en-US")} impr.</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-wire">No row is left to add.</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            if (!result) return;
            onImport(result.kept.map((q) => q.text), result.locale);
            setOpen(false);
            setResult(null);
            setText(null);
          }}
          disabled={!result || result.kept.length === 0}
        >
          {result && result.kept.length > 0 ? `Add ${result.kept.length} question${result.kept.length === 1 ? "" : "s"}` : "Add"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
