// website/components/copy-command.tsx — the command
// with a copy button and the cost line.
"use client";

import { useState } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — nothing to fall back to on a static page
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-4 py-3 font-mono text-sm text-ink">
      <code className="min-w-0 overflow-x-auto whitespace-pre">{command}</code>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-wire hover:text-ink hover:border-wire transition-colors"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
