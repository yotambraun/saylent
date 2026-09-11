// Inngest client — local dev uses `npx inngest-cli dev` (no keys needed);
// cloud keys are only needed for a hosted deployment.
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: process.env.NEXT_PUBLIC_APP_NAME || "saylent" });
