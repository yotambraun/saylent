// A tiny, dependency-free structured logger.
// One JSON line per event (level + message + context) so logs are grep-able and
// machine-parseable in Vercel/Inngest output, and so a later log drain can index
// them without a reformat. Used by the email helper, the crons, and the Inngest
// failure path (replaces ad-hoc console.* in the files that use it).
//
// Deliberately NOT a framework: no transports, no async, no external dep. If a
// hosted log pipeline lands later it wraps THIS (one call site to change).

export type LogLevel = "debug" | "info" | "warn" | "error";

/** JSON-safe context bag. Values are stringified by JSON.stringify as-is. */
export type LogContext = Record<string, unknown>;

// error/warn → stderr, everything else → stdout (matches console semantics so
// platform log levels line up).
const SINK: Record<LogLevel, (line: string) => void> = {
  debug: (l) => console.debug(l),
  info: (l) => console.info(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
};

/** Build the JSON line without emitting it — exported so tests can assert shape
 *  without capturing console. Never throws: an unserializable context degrades
 *  to a note rather than crashing the caller (a log must never break a run). */
export function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const base: Record<string, unknown> = {
    level,
    msg: message,
    ts: new Date().toISOString(),
  };
  if (context) {
    for (const [k, v] of Object.entries(context)) {
      if (k === "level" || k === "msg" || k === "ts") continue; // reserved keys win
      base[k] = v;
    }
  }
  try {
    return JSON.stringify(base);
  } catch {
    return JSON.stringify({ level, msg: message, ts: base.ts, ctxError: "unserializable" });
  }
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  SINK[level](formatLog(level, message, context));
}

export const log = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
