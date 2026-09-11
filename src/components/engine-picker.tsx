"use client";
// The Pro-only answer-engine picker,
// shared by onboarding (brand creation) and settings (brand edit). Default is all four
// ("we ask all four"); narrowing is the advanced lever. Floor is enforced here in the UI
// AND re-checked server-side (normalizeSelection). The judge/brand/drafter brain is never
// shown here — it's not user-configurable.
import { ALL_ENGINES, ENGINE_FLOOR } from "@saylent/engine/engines";
import type { Engine } from "@saylent/engine/types";

const ENGINE_LABEL: Record<Engine, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

export function enginesDefault(): Engine[] {
  return [...ALL_ENGINES];
}

export function EnginePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: Engine[];
  onChange: (next: Engine[]) => void;
  idPrefix: string;
}) {
  const atFloor = value.length <= ENGINE_FLOOR;

  function toggle(engine: Engine, checked: boolean) {
    if (checked) {
      if (!value.includes(engine)) onChange([...ALL_ENGINES.filter((e) => value.includes(e) || e === engine)]);
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
              <span>{ENGINE_LABEL[e]}</span>
            </label>
          );
        })}
      </div>
      <p className="text-xs text-wire">
        We ask all four by default: the widest, most honest verdict. Fewer engines costs
        less but weakens it. Minimum {ENGINE_FLOOR}. The judge always reads every answer
        across families. That never changes.
      </p>
    </div>
  );
}
