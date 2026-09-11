# @saylent/engine

The pure audit pipeline behind Saylent: crawl a site, model the brand, freeze the
buyer questions, ask each answer engine, judge the answers, score them and draft
fixes. No app framework, no database, no UI — functions and a serialisable bundle.

    npm i @saylent/engine

```ts
import { runAudit, MemoryDbWriter, toBundle } from "@saylent/engine";

const db = new MemoryDbWriter();
const result = await runAudit(input, { db, ask, llm, fetcher });
const bundle = toBundle(db, meta);
```

Docs: https://yotambraun.github.io/saylent/docs · Licensed under Apache-2.0 (see LICENSE).
