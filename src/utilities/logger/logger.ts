// logger.ts
import { newTraceId } from './common.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Unix timestamp (ms). */
  timestamp: number;
  level: LogLevel;
  /** The system that produced this entry (e.g. "WeatherManager"). */
  system: string;
  /** The event or action being logged (e.g. "weather:changed"). */
  event: string;
  /** Links this entry to a causal event chain. */
  traceId?: string;
  /** Arbitrary structured payload for the entry. */
  data?: unknown;
  /** Optional human-readable message. */
  message?: string;
}

export type LogSink = (entry: LogEntry) => void;

// ── Trace chain ───────────────────────────────────────────────────────────────

export interface TraceChain {
  traceId: string;
  /** The label given when the trace was opened. */
  rootEvent: string;
  startedAt: number;
  /**
   * Every entry recorded during this trace — both explicit logger.log() calls
   * and events auto-captured by TracedEventEmitter — in chronological order.
   */
  entries: LogEntry[];
}

export interface TraceResult extends TraceChain {
  /** Total ms from beginTrace() to endTrace(). */
  duration: number;
}

// ── Level ordinals ────────────────────────────────────────────────────────────

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// ── Core logger ───────────────────────────────────────────────────────────────

/**
 * Instance-based structured logger with trace-chain support.
 *
 * Every Logger instance owns its own sinks, min-level, and active trace —
 * no shared global state.  Use {@link defaultLogger} for the common case,
 * or create `new Logger()` when you need full isolation (tests, plugins, etc.).
 *
 * @example
 * ```ts
 * import { defaultLogger, consoleSink } from 'bic-game-systems';
 *
 * defaultLogger.addSink(consoleSink);
 * defaultLogger.log('info', 'App', 'ready');
 *
 * // Isolated instance for a test:
 * const logger = new Logger();
 * ```
 */
export class Logger {
  private sinks: LogSink[] = [];
  private minLevel: LogLevel = 'debug';
  private activeTrace: TraceChain | null = null;

  // ── Sinks ──────────────────────────────────────────────────────────────

  /** Register a sink that receives every log entry at or above the min level. */
  addSink(sink: LogSink): void { this.sinks.push(sink); }

  /** Remove a previously added sink. */
  removeSink(sink: LogSink): void {
    this.sinks = this.sinks.filter(s => s !== sink);
  }

  /** Discard all sinks (useful between tests). */
  clearSinks(): void { this.sinks = []; }

  /** Only emit entries at this level and above. */
  setMinLevel(level: LogLevel): void { this.minLevel = level; }

  /** Returns the current minimum log level. */
  getMinLevel(): LogLevel { return this.minLevel; }

  // ── Core log ───────────────────────────────────────────────────────────

  log(
    level: LogLevel,
    system: string,
    event: string,
    data?: unknown,
    traceId?: string,
    message?: string,
  ): void {
    if (LEVELS[level] < LEVELS[this.minLevel]) return;

    const resolvedTraceId = traceId ?? this.activeTrace?.traceId;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      system,
      event,
      ...(resolvedTraceId !== undefined && { traceId: resolvedTraceId }),
      ...(data !== undefined && { data }),
      ...(message !== undefined && { message }),
    };

    // Capture into the active trace chain if one is open.
    if (this.activeTrace) {
      this.activeTrace.entries.push(entry);
    }

    for (const sink of this.sinks) sink(entry);
  }

  // ── Trace lifecycle ────────────────────────────────────────────────────

  /**
   * Open a new trace chain.  All `logger.log()` calls — and any events
   * emitted through a TracedEventEmitter wired to this logger — will be
   * captured into this chain until {@link endTrace} is called.
   *
   * Calling `beginTrace()` while a trace is already active automatically
   * ends the previous one first.
   */
  beginTrace(rootEvent: string): TraceChain {
    if (this.activeTrace) this.endTrace();

    const chain: TraceChain = {
      traceId: newTraceId(),
      rootEvent,
      startedAt: Date.now(),
      entries: [],
    };

    this.activeTrace = chain;

    this.log('debug', 'Logger', 'trace:begin', { traceId: chain.traceId, rootEvent });

    return chain;
  }

  /**
   * Close the active trace and return a snapshot with the total duration.
   * Returns `null` if no trace was open.
   */
  endTrace(): TraceResult | null {
    const chain = this.activeTrace;
    if (!chain) return null;

    this.activeTrace = null;

    const result: TraceResult = {
      ...chain,
      entries: [...chain.entries],
      duration: Date.now() - chain.startedAt,
    };

    this.log('debug', 'Logger', 'trace:end', {
      traceId: result.traceId,
      rootEvent: result.rootEvent,
      duration: result.duration,
      steps: result.entries.length,
    });

    return result;
  }

  /** The traceId of the currently open chain, or `undefined` if idle. */
  get currentTraceId(): string | undefined {
    return this.activeTrace?.traceId;
  }

  /** Whether a trace is currently open. */
  get isTracing(): boolean {
    return this.activeTrace !== null;
  }

  /**
   * Returns a {@link SystemLogger} pre-scoped to a system name.
   *
   * @example
   * ```ts
   * const log = logger.forSystem('Player');
   * log.info('spawn', { id: 42 });
   * ```
   */
  forSystem(system: string): SystemLogger {
    return new SystemLogger(system, this);
  }
}

// ── Module-level default instance ─────────────────────────────────────────────
//
// Use this for simple setups where one shared logger is fine.
// For full isolation (tests, multiple plugins, etc.) create your own:
//
//   const logger = new Logger();
//   logger.addSink(consoleSink);
//

/**
 * Ready-to-use shared Logger instance.
 *
 * Most applications only need one logger — configure it once at startup:
 * ```ts
 * import { defaultLogger, consoleSink } from 'bic-game-systems';
 * defaultLogger.addSink(consoleSink);
 * ```
 *
 * For isolation create `new Logger()` instead.
 */
export const defaultLogger = new Logger();

// ── Per-system convenience wrapper ────────────────────────────────────────────

/**
 * Thin wrapper that scopes every call to a fixed system name
 * and delegates to a {@link Logger} instance.
 *
 * @example
 * ```ts
 * const log = new SystemLogger('Player');          // uses defaultLogger
 * const log = new SystemLogger('Player', myLogger); // uses custom instance
 * ```
 */
export class SystemLogger {
  constructor(
    private readonly system: string,
    private readonly logger: Logger = defaultLogger,
  ) {}

  debug(event: string, data?: unknown, traceId?: string, message?: string): void {
    this.logger.log('debug', this.system, event, data, traceId, message);
  }
  info(event: string, data?: unknown, traceId?: string, message?: string): void {
    this.logger.log('info', this.system, event, data, traceId, message);
  }
  warn(event: string, data?: unknown, traceId?: string, message?: string): void {
    this.logger.log('warn', this.system, event, data, traceId, message);
  }
  error(event: string, data?: unknown, traceId?: string, message?: string): void {
    this.logger.log('error', this.system, event, data, traceId, message);
  }
}
