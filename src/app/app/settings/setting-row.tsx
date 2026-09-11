// Unified settings — row-based layout primitives (a common SaaS-settings pattern).
// Each setting is a row: label + one-line muted description on the left, control
// on the right, separated by 1px border-line hairlines. NOT a card-per-setting
// stack. Presentational only (no "use client") so server sections can use them.
import { cn } from "@saylent/report/utils";

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h1 className="font-display text-2xl">{title}</h1>
      {description && <p className="mt-1 text-sm text-wire">{description}</p>}
      <div className="mt-4 divide-y divide-line border-t border-line">{children}</div>
    </section>
  );
}

/**
 * One setting row. Default: label/description left, control right (top-aligned).
 * `stack`: control sits full-width below the label (for multi-field flows).
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  stack = false,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
  stack?: boolean;
}) {
  return (
    <div
      className={cn(
        "py-5",
        stack
          ? "flex flex-col gap-3"
          : "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
            {label}
          </label>
        ) : (
          <div className="text-sm font-medium text-ink">{label}</div>
        )}
        {description && <p className="mt-0.5 text-sm text-wire">{description}</p>}
      </div>
      {children && (
        <div className={cn("min-w-0", stack ? "" : "shrink-0 sm:max-w-xs sm:pl-6")}>{children}</div>
      )}
    </div>
  );
}
