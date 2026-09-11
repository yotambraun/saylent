import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Deterministic day formatting, UTC, no Intl: "09 Sept 2026". The report is
 *  server-rendered and hydrated in whatever browser opens it; Node and browser
 *  locale data disagree on month spellings, and a one-character difference
 *  is a hydration error. Month names follow the en-GB short form used so far. */
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
export function formatDayUtc(input: string | number | Date, opts: { year?: boolean } = {}): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = MONTHS_SHORT[d.getUTCMonth()];
  return opts.year === false ? `${day} ${mon}` : `${day} ${mon} ${d.getUTCFullYear()}`;
}
