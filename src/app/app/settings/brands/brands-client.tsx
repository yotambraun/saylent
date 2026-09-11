"use client";
// Brands section — hairline-row list; one editor open at a time (project rule:
// stacked forms feel weird). Preserves the verbatim re-baseline confirm.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EnginePicker } from "@/components/engine-picker";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import { resolveEngines } from "@saylent/engine/engines";
import type { Engine } from "@saylent/engine/types";
import { deleteBrand, updateBrand } from "../actions";
import { SettingRow } from "../setting-row";

interface BrandForm {
  id: string;
  name: string;
  domain: string;
  competitorsCsv: string;
  category: string;
  // Editable buyer context (TODO: surface brands.icp/problems as editable context).
  icp: string;
  problemsCsv: string;
  engines: string[] | null;
  version: number;
}

export function BrandsList({
  brands,
  canPickEngines = false,
}: {
  brands: BrandForm[];
  canPickEngines?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (brands.length === 0) {
    return (
      <SettingRow label="No brands yet" description="Run your first audit to add one." />
    );
  }

  return (
    <>
      {brands.map((b) => (
        <div key={b.id} className="py-2">
          <button
            className="flex w-full items-center justify-between gap-3 py-3 text-left"
            onClick={() => setOpenId(openId === b.id ? null : b.id)}
            aria-expanded={openId === b.id}
          >
            <span className="flex min-w-0 items-baseline gap-3">
              <span className="truncate text-sm font-medium text-ink">{b.name}</span>
              <span className="truncate font-mono text-xs text-wire">{b.domain}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3 font-mono text-xs text-wire">
              <span>questions v{b.version}</span>
              <span aria-hidden>{openId === b.id ? "▴" : "▾"}</span>
            </span>
          </button>
          {openId === b.id && (
            <div className="pb-3">
              <BrandEditor initial={b} canPickEngines={canPickEngines} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function BrandEditor({
  initial,
  canPickEngines,
}: {
  initial: BrandForm;
  canPickEngines: boolean;
}) {
  const [form, setForm] = useState(initial);
  // ENGINE-SELECT: resolve the stored selection (null → all four) for display.
  const [engines, setEngines] = useState<Engine[]>(resolveEngines(initial.engines));
  const [state, setState] = useState<"idle" | "saving" | "confirm" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(confirmed: boolean) {
    setState("saving");
    setError(null);
    try {
      const res = await updateBrand({
        brandId: form.id,
        name: form.name,
        domain: form.domain,
        competitorsCsv: form.competitorsCsv,
        category: form.category,
        icp: form.icp,
        problemsCsv: form.problemsCsv,
        // only send engines when the user may edit them — undefined leaves them untouched
        ...(canPickEngines ? { engines } : {}),
        confirmedRebaseline: confirmed,
      });
      if (res.needsConfirm) return setState("confirm");
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return setState("error");
      }
      setState("saved");
    } catch {
      setError("Something went wrong. Try again.");
      setState("error");
    }
  }

  const set = (k: keyof BrandForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setState("idle");
  };

  return (
    <div className="grid gap-3 rounded-lg border border-line bg-card p-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`name-${form.id}`}>Brand name</Label>
        <Input id={`name-${form.id}`} value={form.name} onChange={set("name")} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`domain-${form.id}`}>Domain</Label>
        <Input id={`domain-${form.id}`} value={form.domain} onChange={set("domain")} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`cat-${form.id}`}>What are you? (category)</Label>
        <Input
          id={`cat-${form.id}`}
          value={form.category}
          onChange={set("category")}
          placeholder="e.g. B2B contact data platform"
        />
        {form.category.split(",").filter((s) => s.trim()).length >= 3 && (
          <p className="text-xs text-signal">
            This looks like a list of competitors. It belongs in the field below.
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`comp-${form.id}`}>Who are you against? (competitors, comma-separated)</Label>
        <Input
          id={`comp-${form.id}`}
          value={form.competitorsCsv}
          onChange={set("competitorsCsv")}
          placeholder="e.g. ZoomInfo, Apollo, Cognism"
        />
      </div>
      {/* Buyer context — surfaced from the audit-derived brand model so the owner can
          correct who Saylent thinks buys them + the problems it writes fixes around.
          Editing these does NOT re-baseline; an edit is kept until cleared (context_source, 0031). */}
      <div className="grid gap-1.5">
        <Label htmlFor={`icp-${form.id}`}>Who buys you? (ideal customer)</Label>
        <Input
          id={`icp-${form.id}`}
          value={form.icp}
          onChange={set("icp")}
          placeholder="e.g. B2B SaaS product teams"
        />
        <p className="text-xs text-wire">
          Saylent inferred this from your last audit. Correct it to fix how your buyers are
          described in fixes. Your edit is kept until you clear it.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`prob-${form.id}`}>
          What problems do buyers hire you for? (comma-separated)
        </Label>
        <Input
          id={`prob-${form.id}`}
          value={form.problemsCsv}
          onChange={set("problemsCsv")}
          placeholder="e.g. tracking email delivery, reducing onboarding drop-off"
        />
        <p className="text-xs text-wire">
          The concrete jobs buyers hire you to do. Inferred from your last audit; your edits are
          kept until you clear them.
        </p>
      </div>
      {/* ENGINE-SELECT — Pro-only; changing it re-baselines like a question change. */}
      {canPickEngines && (
        <div className="grid gap-1.5">
          <Label>Answer engines</Label>
          <EnginePicker
            value={engines}
            onChange={(next) => {
              setEngines(next);
              setState("idle");
            }}
            idPrefix={`brand-${form.id}`}
          />
        </div>
      )}

      {state === "confirm" ? (
        <div className="rounded border border-signal/50 bg-signal/10 p-3 text-sm">
          <p>This changes your question set on the next audit and re-baselines trends. Continue?</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => save(true)}>
              Continue
            </Button>
            <Button size="sm" variant="outline" onClick={() => setState("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button onClick={() => save(false)} disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : "Save brand"}
          </Button>
          {state === "saved" && <span className="text-sm text-success">Saved.</span>}
          {error && <span className="text-sm text-pill-dismissed">{error}</span>}
        </div>
      )}

      <DeleteBrandControl brandId={form.id} brandName={initial.name} />
    </div>
  );
}

// Danger zone — soft-delete this brand (migration 0038). Type-the-name confirm so it
// can't be a fat-finger; honest copy about what it does and where full deletion lives.
function DeleteBrandControl({ brandId, brandName }: { brandId: string; brandName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "deleting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const matches = confirm.trim().toLowerCase() === brandName.trim().toLowerCase();

  async function run() {
    setState("deleting");
    setError(null);
    try {
      const res = await deleteBrand({ brandId, confirmName: confirm });
      if (!res.ok) {
        setError(res.error ?? "Could not delete.");
        return setState("error");
      }
      router.refresh(); // brand drops out of the (deleted_at is null) list
    } catch {
      setError("Something went wrong. Try again.");
      setState("error");
    }
  }

  return (
    <div className="mt-1 border-t border-line pt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-pill-dismissed underline underline-offset-2 hover:opacity-80"
        >
          Delete this brand
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded border border-pill-dismissed/40 bg-pill-dismissed/5 p-3 text-sm">
          <p className="text-wire">
            This hides <span className="font-medium text-ink">{brandName}</span> and its runs from
            your account; data is retained per our privacy policy. Full account deletion lives in
            Settings → Account.
          </p>
          <Label htmlFor={`del-${brandId}`} className="text-xs text-wire">
            Type <span className="font-mono text-ink">{brandName}</span> to confirm
          </Label>
          <Input
            id={`del-${brandId}`}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setState("idle");
            }}
            placeholder={brandName}
            autoComplete="off"
          />
          <div className="flex items-center gap-3">
            <Button
              variant="destructive"
              size="sm"
              disabled={!matches || state === "deleting"}
              onClick={run}
            >
              {state === "deleting" ? "Deleting…" : "Delete brand"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOpen(false);
                setConfirm("");
                setState("idle");
                setError(null);
              }}
            >
              Cancel
            </Button>
            {error && <span className="text-sm text-pill-dismissed">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
