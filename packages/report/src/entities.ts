// Display-side entity normalization. ONE implementation, shared with the engine
// that extracts the titles (packages/engine/src/entities.ts) so extraction and
// rendering can never disagree — a title stored before the extraction fix still
// renders decoded, because every renderer normalizes on the way out.
export { decodeEntities } from "@saylent/engine/entities";
