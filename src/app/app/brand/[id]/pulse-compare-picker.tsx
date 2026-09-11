"use client";
// THE PULSE — compare picker (TODO E4g "Two-run compare, pick any A vs C").
// Implements the product rule honesty for a USER-chosen pair: the
// server only offers runs that share a frozen question set + profile (built via
// pulse.ts comparableRunIds), and re-validates the choice with the same
// areRunsComparable predicate before diffing. Still a plain GET <form> that writes
// `?a=&b=` so the comparison stays shareable / refreshable — the two run values ride
// in hidden inputs. The native <select>s are replaced by the app's styled
// listbox (@saylent/report/ui/select, the same radix primitive settings uses), and this
// became a client component only so Compare can disable itself when the pair is empty
// or identical (a==b or either side missing → nothing to diff). The default (no
// params) view is untouched; this is an override.
import { useState } from "react";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@saylent/report/ui/select";

export interface PickerOption {
  id: string;
  /** deterministic, timezone-stable label built server-side (e.g. "18 Jul 26 · verify · full") */
  label: string;
}

export function PulseComparePicker({
  options,
  baselineRunId,
  currentRunId,
  note,
  brandId,
  isOverride,
}: {
  options: PickerOption[];
  baselineRunId: string;
  currentRunId: string;
  note: string | null;
  brandId: string;
  isOverride: boolean;
}) {
  // "a" is the older (baseline) side, "b" the newer (current) side, matching the
  // auto-picker's direction; validateChosenPair re-orders defensively regardless.
  const [a, setA] = useState(baselineRunId);
  const [b, setB] = useState(currentRunId);
  // Nothing to diff when either side is empty or both point at the same run.
  const sameRun = Boolean(a) && a === b;
  const canCompare = Boolean(a) && Boolean(b) && a !== b;

  return (
    <form
      method="get"
      action={`/app/brand/${brandId}`}
      className="flex flex-col gap-3 rounded-xl border border-line bg-paper p-4"
    >
      {/* The chosen run ids submit via hidden inputs, so the GET URL stays ?a=&b=. */}
      <input type="hidden" name="a" value={a} />
      <input type="hidden" name="b" value={b} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-wire">Baseline</span>
          <RunSelect ariaLabel="Baseline run" options={options} value={a} onChange={setA} />
        </label>
        <span className="pb-2 font-mono text-xs text-wire">vs</span>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-wire">Compared</span>
          <RunSelect ariaLabel="Compared run" options={options} value={b} onChange={setB} />
        </label>
        <button
          type="submit"
          disabled={!canCompare}
          className="rounded-md border border-line bg-card px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-card"
        >
          Compare
        </button>
        {isOverride && (
          <Link
            href={`/app/brand/${brandId}`}
            className="pb-1.5 font-mono text-xs text-wire underline underline-offset-2 hover:text-ink"
          >
            reset to latest
          </Link>
        )}
      </div>
      <p className="text-xs leading-relaxed text-wire">
        {sameRun ? (
          <span className="text-signal">
            Pick two different runs. A run can&apos;t be compared with itself.
          </span>
        ) : note ? (
          <span className="text-signal">{note}</span>
        ) : (
          "Only runs with the same question set and profile are listed. A diff across different questions or a smoke/full boundary isn't an honest comparison."
        )}
      </p>
    </form>
  );
}

function RunSelect({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: PickerOption[];
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} className="min-w-[13rem]">
        <SelectValue placeholder="Select a run" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
