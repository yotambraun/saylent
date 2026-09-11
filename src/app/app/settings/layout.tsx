// Unified settings shell — left section rail + centered content pane. Replaces
// the old /app/account + /app/settings split (one deep-linkable settings area).
import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
      <SettingsNav />
      <div className="w-full min-w-0 max-w-2xl">{children}</div>
    </div>
  );
}
