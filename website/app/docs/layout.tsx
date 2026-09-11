// website/app/docs/layout.tsx — sidebar + nav shell for
// every /docs/* page, built from the content/docs page tree.
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ title: "Saylent", url: "/" }}
      githubUrl="https://github.com/yotambraun/saylent"
    >
      {children}
    </DocsLayout>
  );
}
