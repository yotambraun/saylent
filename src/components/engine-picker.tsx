"use client";
// The answer-engine picker,
// shared by onboarding (brand creation) and settings (brand edit). Default is all four
// model APIs ("we ask all four"); narrowing is the advanced lever. Floor is enforced here
// in the UI AND re-checked server-side (normalizeSelection). The judge/brand/drafter brain
// is never shown here — it's not user-configurable.
//
// The answer SURFACES (Google AI Overviews, Google AI Mode, Microsoft Copilot) are an
// opt-in group under the four: they are read through the deployment's SerpApi key, so
// they are disabled, with the reason said, when the deployment has none. The page
// resolves that PRESENCE server-side and passes a boolean; no key ever reaches here.
import { ALL_ENGINES, ENGINE_FLOOR, SELECTABLE_ENGINES } from "@saylent/engine/engines";
import { SERP_PROVIDERS, SURFACE_IDS, SURFACES, engineLabel } from "@saylent/engine/surfaces";
import type { Engine } from "@saylent/engine/types";

export function enginesDefault(): Engine[] {
  return [...ALL_ENGINES];
}

const SERP_LABEL = SERP_PROVIDERS.serpapi.label;
const SERP_ENV = SERP_PROVIDERS.serpapi.envVar;

/** The opt-in surface checkboxes, used by EnginePicker and the run-options form.
 *  A surface already selected stays un-tickable even with no key, so a stale
 *  selection can always be removed. */
export function SurfacePicker({
  selected,
  onToggle,
  serpAvailable,
  idPrefix,
  lockedIds = [],
}: {
  selected: readonly string[];
  onToggle: (id: Engine, checked: boolean) => void;
  serpAvailable: boolean;
  idPrefix: string;
  /** ids that may not be unticked right now (the floor guard) */
  lockedIds?: readonly string[];
}) {
  return (
    <fieldset className="grid gap-2 rounded border border-line p-3">
      <legend className="px-1 font-mono text-[10px] uppercase tracking-wider text-wire">
        Answer surfaces · needs a {SERP_LABEL} key
      </legend>
      <div className="grid gap-2">
        {SURFACE_IDS.map((s) => {
          const checked = selected.includes(s);
          const locked = checked && lockedIds.includes(s);
          const disabled = (!serpAvailable && !checked) || locked;
          return (
            <label
              key={s}
              htmlFor={`${idPrefix}-eng-${s}`}
              className={`flex items-start gap-2 text-sm ${disabled ? "opacity-60" : "cursor-pointer"}`}
            >
              <input
                id={`${idPrefix}-eng-${s}`}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(ev) => onToggle(s, ev.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-signal"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-ink">{SURFACES[s].label}</span>
                <span className="text-xs text-wire">{SURFACES[s].description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-xs text-wire">
        {serpAvailable
          ? `Billed per search on your own ${SERP_LABEL} plan. Google shows an AI Overview or AI Mode answer for some queries only; a question without one is recorded as "not shown", a coverage gap, never as "not recommended".`
          : `This deployment has no ${SERP_LABEL} key, so the surfaces cannot be read. An operator can add ${SERP_ENV} in the environment or on Providers & models.`}
      </p>
    </fieldset>
  );
}

export function EnginePicker({
  value,
  onChange,
  idPrefix,
  serpAvailable = false,
}: {
  value: Engine[];
  onChange: (next: Engine[]) => void;
  idPrefix: string;
  /** the deployment has a SerpApi key (presence only, resolved server-side) */
  serpAvailable?: boolean;
}) {
  const atFloor = value.length <= ENGINE_FLOOR;

  function toggle(engine: Engine, checked: boolean) {
    if (checked) {
      if (!value.includes(engine)) onChange([...SELECTABLE_ENGINES.filter((e) => value.includes(e) || e === engine)]);
    } else {
      if (atFloor && value.includes(engine)) return; // floor guard
      onChange(value.filter((e) => e !== engine));
    }
  }

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        {ALL_ENGINES.map((e) => {
          const checked = value.includes(e);
          const lockedOn = checked && atFloor;
          return (
            <label
              key={e}
              htmlFor={`${idPrefix}-eng-${e}`}
              className={`flex items-center gap-2 rounded border border-line px-2.5 py-2 text-sm ${
                lockedOn ? "opacity-70" : "cursor-pointer"
              }`}
            >
              <input
                id={`${idPrefix}-eng-${e}`}
                type="checkbox"
                checked={checked}
                onChange={(ev) => toggle(e, ev.target.checked)}
                className="h-4 w-4 shrink-0 accent-signal"
              />
              <span>{engineLabel(e)}</span>
            </label>
          );
        })}
      </div>
      <SurfacePicker
        selected={value}
        onToggle={toggle}
        serpAvailable={serpAvailable}
        idPrefix={idPrefix}
        lockedIds={atFloor ? value : []}
      />
      <p className="text-xs text-wire">
        We ask all four by default: the widest, most honest verdict. Fewer engines costs
        less but weakens it. Minimum {ENGINE_FLOOR}. The judge always reads every answer
        across families. That never changes.
      </p>
    </div>
  );
}
