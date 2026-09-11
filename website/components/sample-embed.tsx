// website/components/sample-embed.tsx - the real sample report, embedded on
// the landing page, plus the link that opens it in full.
//
// Two review-4 findings live here:
//  #5  the report themes itself from its own localStorage key
//      (`saylent-report-theme`, packages/report/src/render/html.tsx) or, with
//      nothing stored, from prefers-color-scheme - so on a light OS with the
//      site toggled dark it stayed a white rectangle on a dark page. The file
//      is same-origin (website/public/samples/kestrel/report.html), so this
//      component reaches into the loaded document and sets the same
//      `dark`/`light` class the report's own toggle sets, from the site's
//      class, and keeps it in sync while the reader flips the site theme.
//  #10 the embed was a dead-end: clipped mid-sentence with no way to open it.
"use client";

import { useCallback, useEffect, useRef } from "react";

export function SampleEmbed({ src, className }: { src: string; className?: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);

  const sync = useCallback(() => {
    const el = frame.current;
    if (!el) return;
    try {
      // Same-origin static file: contentDocument is readable. A cross-origin
      // or not-yet-parsed frame simply throws/returns null and is skipped.
      const doc = el.contentDocument;
      if (!doc?.documentElement) return;
      const isDark = document.documentElement.classList.contains("dark");
      doc.documentElement.classList.toggle("dark", isDark);
      doc.documentElement.classList.toggle("light", !isDark);
    } catch {
      // nothing to do - the embed keeps its own theme
    }
  }, []);

  useEffect(() => {
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [sync]);

  return (
    <iframe
      ref={frame}
      src={src}
      title="Sample report for Kestrel Uptime, a fictional company we audit"
      loading="lazy"
      onLoad={sync}
      className={className}
    />
  );
}
