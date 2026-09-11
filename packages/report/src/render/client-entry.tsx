// THE HYDRATION ENTRY — bundled by esbuild into the one <script> report.html
// carries. It rebuilds the exact tree that was server-rendered, from the exact
// same props (read back out of the <script type="application/json"> block), so
// tabs, drawers, the Brief's card canvas and the theme toggle all work offline.
import { hydrateRoot } from "react-dom/client";
import { MovementView } from "../components/movement";
import type { Movement } from "../movement";
import { ReportDocument, REPORT_DATA_ID, REPORT_ROOT_ID, type ReportPayload } from "./document";
import { StaticReportHost, type StaticHostOptions } from "./static-host";

export const MOVEMENT_ROOT_ID = "saylent-movement-root";
export const MOVEMENT_DATA_ID = "saylent-movement-data";

const THEME_KEY = "saylent-report-theme";

/** The toggle cycles light → dark → light and remembers the choice per reader.
 *  With no stored choice the CSS media query decides, so JS-off is still right. */
function wireChrome() {
  const root = document.documentElement;
  const prefersDark = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  const apply = (theme: "light" | "dark") => {
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
  };

  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_KEY);
  } catch {
    // storage blocked (private mode, file:// in some browsers) — media query wins
  }
  if (stored === "light" || stored === "dark") apply(stored);

  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement | null)?.closest("[data-report-theme-toggle],[data-report-print]");
    if (!el) return;
    if (el.hasAttribute("data-report-print")) {
      window.print();
      return;
    }
    const isDark = root.classList.contains("dark") || (!root.classList.contains("light") && prefersDark());
    const next = isDark ? "light" : "dark";
    apply(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // a reader who cannot store still gets the toggle for this session
    }
  });
}

/** One bundle serves both delivered files; each page carries only its own root
 *  and payload, and anything absent is simply skipped. Without JS the server-
 *  rendered HTML still reads and prints correctly. */
function boot() {
  wireChrome();

  const reportRoot = document.getElementById(REPORT_ROOT_ID);
  const reportRaw = document.getElementById(REPORT_DATA_ID)?.textContent;
  if (reportRoot && reportRaw) {
    const payload = JSON.parse(reportRaw) as ReportPayload;
    hydrateRoot(reportRoot, <ReportDocument data={payload.data} options={payload.options} />);
  }

  const movementRoot = document.getElementById(MOVEMENT_ROOT_ID);
  const movementRaw = document.getElementById(MOVEMENT_DATA_ID)?.textContent;
  if (movementRoot && movementRaw) {
    const payload = JSON.parse(movementRaw) as { model: Movement; host: StaticHostOptions };
    hydrateRoot(
      movementRoot,
      <StaticReportHost
        contactEmail={payload.host.contactEmail}
        methodologyUrl={payload.host.methodologyUrl ?? null}
      >
        <div className="px-4 py-10 sm:px-8">
          <MovementView model={payload.model} />
        </div>
      </StaticReportHost>,
    );
  }
}

boot();
