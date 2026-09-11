# @saylent/report

Render a Saylent audit report — HTML or Markdown — from a run bundle. No app, no
database, no model calls: the same components the product ships, server-rendered
into one self-contained file that opens from `file://`.

    npm i @saylent/report

```ts
import { renderMarkdown } from "@saylent/report/render";
import { reportDataFromBundle } from "@saylent/report/render/from-bundle";

const markdown = renderMarkdown(reportDataFromBundle(bundle));
```

Docs: https://yotambraun.github.io/saylent/docs · Licensed under Apache-2.0 (see LICENSE).
