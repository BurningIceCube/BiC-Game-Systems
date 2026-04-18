// logger.ts
// Wraps LogLayer to provide structured logging with trace-chain support.
// Users get full LogLayer customizability (transports, plugins, child loggers)
// while BiC systems retain the trace lifecycle they depend on.

import { LogLayer, ConsoleTransport } from 'loglayer';
import type { ILogLayer, LogLayerConfig } from 'loglayer';
import { newTraceId } from './common.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry used by the trace system.
 * These are captured into {@link TraceChain}s — they are *not* sent to
 * LogLayer (LogLayer receives its own calls).  This keeps the trace
 * ledger lightweight and independent of the chosen transport.
 */
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

// ── Logger options ────────────────────────────────────────────────────────────

export interface LoggerOptions {
  /**
   * Provide a fully-configured {@link LogLayer} instance.
   * When set, `logLayerConfig` is ignored.
   */
  logLayer?: ILogLayer;

  /**
   * Configuration object forwarded to `new LogLayer(config)`.
   * Ignored when `logLayer` is provided.
   *
   * If neither `logLayer` nor `logLayerConfig` is given, a default
   * `ConsoleTransport` is created automatically.
   */
  logLayerConfig?: LogLayerConfig;
}

// ── Core logger ───────────────────────────────────────────────────────────────

/**
 * Structured logger with trace-chain support, powered by
 * [LogLayer](https://loglayer.dev).
 *
 * Every `Logger` owns its own LogLayer instance and active trace.
 * Use {@link defaultLogger} for the common case, or create `new Logger()`
 * when you need full isolation (tests, plugins, etc.).
 *
 * @example
 * ```ts
 * import { defaultLogger } from 'bic-game-systems';
 *
 * // Uses ConsoleTransport by default — just start logging:
 * defaultLogger.log('info', 'App', 'ready');
 *
 * // Full customization via LogLayer:
 * import { Logger } from 'bic-game-systems';
 * import { LogLayer } from 'loglayer';
 * const logger = new Logger({
 *   logLayerConfig: { transport: new ConsoleTransport({ logger: console }) },
 * });
 * ```
 */
export class Logger {
  private activeTrace: TraceChain | null = null;

  /**
   * The underlying LogLayer instance.
   * Access it directly when you need LogLayer-specific features
   * (child loggers, plugins, transports, etc.).
   */
  public readonly ll: ILogLayer;

  constructor(options?: LoggerOptions) {
    if (options?.logLayer) {
      this.ll = options.logLayer;
    } else {
      this.ll = new LogLayer(
        options?.logLayerConfig ?? {
          transport: new ConsoleTransport({ logger: console }),
        },
      );
    }
  }

  // ── Core log ───────────────────────────────────────────────────────────

  /**
   * Emit a structured log entry.
   *
   * The entry is:
   * 1. Captured into the active trace chain (if any).
   * 2. Forwarded to LogLayer with `system`, `event`, and `traceId` as
   *    contextual metadata so every configured transport receives them.
   */
  log(
    level: LogLevel,
    system: string,
    event: string,
    data?: unknown,
    traceId?: string,
    message?: string,
  ): void {
    const resolvedTraceId = traceId ?? this.activeTrace?.traceId;

    // ── Trace capture (lightweight — no transport overhead) ──────────
    if (this.activeTrace) {
      const entry: LogEntry = {
        timestamp: Date.now(),
        level,
        system,
        event,
        ...(resolvedTraceId !== undefined && { traceId: resolvedTraceId }),
        ...(data !== undefined && { data }),
        ...(message !== undefined && { message }),
      };
      this.activeTrace.entries.push(entry);
    }

    // ── LogLayer dispatch ───────────────────────────────────────────
    let builder = this.ll.withContext({
      system,
      event,
      ...(resolvedTraceId !== undefined && { traceId: resolvedTraceId }),
    });

    if (data !== undefined) {
      if (data instanceof Error) {
        builder = builder.withError(data) as typeof builder;
      } else {
        builder = builder.withMetadata(
          typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : { data },
        ) as typeof builder;
      }
    }

    const msg = message ?? event;

    switch (level) {
      case 'debug': builder.debug(msg); break;
      case 'info':  builder.info(msg);  break;
      case 'warn':  builder.warn(msg);  break;
      case 'error': builder.error(msg); break;
    }
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

/**
 * Ready-to-use shared Logger instance with a default ConsoleTransport.
 *
 * Most applications only need one logger — start using it immediately:
 * ```ts
 * import { defaultLogger } from 'bic-game-systems';
 * defaultLogger.log('info', 'App', 'ready');
 * ```
 *
 * For full customization, create `new Logger({ logLayerConfig: { ... } })`.
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
