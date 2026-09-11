// Public surface of @saylent/report — a barrel of TYPES plus the main composer functions from each pure
// report module. Consumers should prefer the subpath import for a single
// module (e.g. `@saylent/report/brief`) so an app's client bundle only pulls
// in what it actually renders; this barrel is for callers that want the
// whole composed surface (CLI, static-render pipeline) at once.
export type { BriefStory, BriefReceipt, BriefBar } from "./brief";
export { buildBrief } from "./brief";

export type {
  IntelPage,
  IntelAnswer,
  RivalOwnerFn,
  AnswerRef,
  BandLike,
  RunHealthLike,
  SitePageMeta,
} from "./report-intel";
export {
  bandDescriptor,
  battlefieldRows,
  buriedBehind,
  citationDepth,
  consensusSources,
  degradedEngines,
  entityConfusion,
  mergedPricingClaims,
  ownSiteCoverage,
  perceptionClaims,
  pricingFigures,
  rankRiskClaims,
  sendElsewhere,
  sourceMix,
} from "./report-intel";

export type { CompareReceipt, CellFavor, CompareCell } from "./compare";
export { buildRivalCompare } from "./compare";

export type { SourceMapPage, EngineSourceProfile, ChannelMix } from "./source-map";
export { buildSourceMap } from "./source-map";

export type { FollowingAnswerRow, PersistentRival, PersistentObjection } from "./following";
export { computeFollowing, comparableCohort } from "./following";

export type { RivalGapAnswer, RivalGapPage, RivalGap } from "./rival-gaps";
export { rivalGaps } from "./rival-gaps";

export type { FixLike, FixGroup } from "./fix-groups";
export { groupFixes, pickTopMoves } from "./fix-groups";

export type { GateCheck, GatesLede } from "./gates-lede";
export { gatesLede } from "./gates-lede";

export type { PagePresencePage, PagePresence } from "./page-presence";
export { pagePresence } from "./page-presence";

export { sovEntries, topRival } from "./sov";

export { previewText, stripMarkdownForPreview, trimEdgeFragments, tidyPreviewQuote } from "./strip-md";

export type { InlineSeg } from "./inline-markdown";
export { parseInline } from "./inline-markdown";

export type { DiffSentence, AnswerDiff, DiffAnswerInput } from "./answer-diff";
export { diffAnswer, diffRuns } from "./answer-diff";

export type { PulseRun, PulsePair, PulseView, PulseViewOptions } from "./pulse";
export { areRunsComparable, pickComparablePair, comparableRunIds, validateChosenPair, pulseView } from "./pulse";

export type { TrendRun, TrendPoint } from "./trend";
export { deltaState, trendSeries, engineSeries, sparklinePath, runEvents } from "./trend";

export type { TrackerFixRow, TrackerVerify } from "./fix-tracker";
export { normalizeFixKey, trackFixes, fixWinRate } from "./fix-tracker";

export { buildRunExportJson, summarizeCorpus, answerCsvRows, toCsv, slugifyBrand, exportFilename } from "./run-export";

export type { RunHealthGrade, RunHealth } from "./run-health";
export { gradeRunHealth } from "./run-health";

export type { HealthVerdictInput, HealthAnswerInput } from "./run-health-build";
export { buildRunHealth } from "./run-health-build";

export type { ParsedStage } from "./run-stages";
export { STAGES, parseStage } from "./run-stages";

export type {
  TheaterQuestion,
  TheaterAnswer,
  SlotState,
  Slot,
  BoardRow,
  Spotlight,
  TheaterPhase,
  Counters,
  TheaterState,
  TheaterInput,
} from "./theater";
export { deriveTheater } from "./theater";

export type { NextMoveKind, NextMove, NextMoveRun } from "./next-moves";
export { computeNextMoves } from "./next-moves";

export { normUrl, unwrapArchiveUrl, citationHost } from "./citation-url";

export { relativeTime } from "./relative-time";

export { isHidden, isDeleted, partitionByHidden } from "./hygiene";

export {
  MAX_COMPETITORS,
  brandNameSchema,
  domainSchema,
  displayNameSchema,
  isValidTimeZone,
  parseCompetitors,
  validateBrandFields,
} from "./validation";

export { cn } from "./utils";
