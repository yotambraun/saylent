// Settings › Appearance — the theme control (light / dark / system).
import { SettingRow, SettingsSection } from "../setting-row";
import { ThemeToggle } from "./theme-toggle";

export const metadata = { title: "Appearance · Saylent" };

export default function AppearancePage() {
  return (
    <SettingsSection title="Appearance" description="How Saylent looks on this device.">
      <SettingRow
        label="Theme"
        description="Match your system, or pick light or dark. Saved on this device."
      >
        <ThemeToggle />
      </SettingRow>
    </SettingsSection>
  );
}
