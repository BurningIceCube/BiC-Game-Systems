// sinks.ts
// All LogSink implementations in one place.
// Register any combination with logger.addSink() — they fan-out in parallel.
//
//   logger.addSink(consoleSink);                           // stdout
//   logger.addSink(fileSink('./logs/app.jsonl'));           // JSONL file
//   logger.addSink(new MemorySink().sink);                 // in-memory / tests
//   logger.addSink(new DatadogSink({ apiKey }).sink);      // Datadog HTTP intake

import type { LogEntry, LogLevel, LogSink } from './logger.js';

// Shared level-order map (mirrors the one in logger.ts).
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// ── Console sink ──────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: '\x1b[90m',
    info:  '\x1b[36m',
    warn:  '\x1b[33m',
    error: '\x1b[31m',
};
const RESET = '\x1b[0m';

/**
 * Pretty-prints structured entries to stdout with ANSI colours.
 *
 * Format: `[ISO timestamp] ·traceId [LEVEL] [system] event  { ...data }`
 *
 * @example
 * ```ts
 * logger.addSink(consoleSink);
 * ```
 */
export const consoleSink: LogSink = (entry: LogEntry): void => {
    const ts    = new Date(entry.timestamp).toISOString();
    const trace = entry.traceId ? ` ·${entry.traceId.slice(0, 8)}` : '';
    const color = LEVEL_COLORS[entry.level];
    const head  = `${color}[${ts}]${trace} [${entry.level.toUpperCase().padEnd(5)}] [${entry.system}] ${entry.event}${RESET}`;
    if (entry.data !== undefined && entry.message !== undefined) {
        console.log(head, entry.message, entry.data);
    } else if (entry.data !== undefined) {
        console.log(head, entry.data);
    } else {
        console.log(head, entry.message ?? '');
    }
};

// ── File sink ─────────────────────────────────────────────────────────────────

/**
 * Returns a {@link LogSink} that appends one JSON line per entry to `filePath`
 * (JSONL / newline-delimited JSON format).
 *
 * The file handle is opened and closed on every write — safe for crash
 * recovery. For high-throughput scenarios prefer {@link DatadogSink}-style
 * batching or a dedicated log-rotation library.
 *
 * @example
 * ```ts
 * logger.addSink(fileSink('./logs/app.jsonl'));
 * ```
 */
export function fileSink(filePath: string): LogSink {
    // Lazy-import so browser/edge consumers can use the rest of sinks without a bundler error.
    let _appendFileSync: typeof import('node:fs').appendFileSync | undefined;
    return (entry: LogEntry): void => {
        if (!_appendFileSync) {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            _appendFileSync = (require('node:fs') as typeof import('node:fs')).appendFileSync;
        }
        _appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
    };
}

// ── Memory sink ───────────────────────────────────────────────────────────────

/**
 * Accumulates {@link LogEntry} objects in memory.
 *
 * Useful for:
 * - **Testing** — assert on logged events without hitting stdout or disk.
 * - **Replay** — surface a causal chain to a UI or API response.
 *
 * @example
 * ```ts
 * const mem = new MemorySink();
 * logger.addSink(mem.sink);
 *
 * // … run operations …
 *
 * const weatherEvents = mem.getBySystem('EventBus');
 * const chain         = mem.getChain(someTraceId);
 * ```
 */
export class MemorySink {
    readonly entries: LogEntry[] = [];

    readonly sink: LogSink = (entry: LogEntry): void => {
        this.entries.push(entry);
    };

    /** All entries that belong to a given trace chain. */
    getChain(traceId: string): LogEntry[] {
        return this.entries.filter(e => e.traceId === traceId);
    }

    /** All entries emitted by a specific system. */
    getBySystem(system: string): LogEntry[] {
        return this.entries.filter(e => e.system === system);
    }

    /** All entries at or above a given level. */
    getByLevel(level: LogLevel): LogEntry[] {
        return this.entries.filter(e => LEVELS[e.level] >= LEVELS[level]);
    }

    /** Discard all accumulated entries. */
    clear(): void { this.entries.length = 0; }
}

// ── Datadog sink ──────────────────────────────────────────────────────────────

export interface DatadogSinkOptions {
    /** Datadog API key (required). */
    apiKey: string;
    /** Service name tag. Default: `"bic-game-systems"`. */
    service?: string;
    /** Log source tag. Default: `"nodejs"`. */
    source?: string;
    /** Hostname tag sent with every log. Default: `"localhost"`. */
    host?: string;
    /**
     * Datadog site to send logs to.
     * Use `"datadoghq.eu"` for the EU region.
     * Default: `"datadoghq.com"`.
     */
    site?: string;
    /**
     * How often (ms) to auto-flush buffered entries.
     * Set to `0` to disable the interval (manual `flush()` only).
     * Default: `5000`.
     */
    flushInterval?: number;
    /**
     * Maximum entries to buffer before an immediate flush is triggered.
     * Default: `100`.
     */
    maxBatchSize?: number;
}

/**
 * Buffers {@link LogEntry} objects and ships them to the
 * [Datadog HTTP Logs Intake](https://docs.datadoghq.com/api/latest/logs/#send-logs)
 * in batches.
 *
 * - Auto-flushes on a configurable interval (default 5 s).
 * - Immediately flushes when the buffer reaches `maxBatchSize`.
 * - Call `await sink.flush()` before process exit to drain the buffer.
 * - Call `sink.stop()` to cancel the interval timer.
 *
 * @example
 * ```ts
 * const dd = new DatadogSink({ apiKey: process.env.DD_API_KEY! });
 * logger.addSink(dd.sink);
 *
 * // … on shutdown …
 * await dd.flush();
 * dd.stop();
 * ```
 */
export class DatadogSink {
    private readonly buffer: LogEntry[] = [];
    private readonly url: string;
    private readonly maxBatchSize: number;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly options: DatadogSinkOptions) {
        const site = options.site ?? 'datadoghq.com';
        this.url = `https://http-intake.logs.${site}/api/v2/logs`;
        this.maxBatchSize = options.maxBatchSize ?? 100;

        const interval = options.flushInterval ?? 5_000;
        if (interval > 0) {
            this.timer = setInterval(() => {
                this.flush().catch(console.error);
            }, interval);
            // Don't hold the process open just for log flushing.
            if (typeof this.timer === 'object' && this.timer !== null && 'unref' in this.timer) {
                (this.timer as NodeJS.Timeout).unref();
            }
        }
    }

    /** Pass this to `logger.addSink()`. */
    readonly sink: LogSink = (entry: LogEntry): void => {
        this.buffer.push(entry);
        if (this.buffer.length >= this.maxBatchSize) {
            this.flush().catch(console.error);
        }
    };

    /**
     * Immediately ship all buffered entries to Datadog.
     * Resolves when the HTTP request completes.
     * Safe to call when the buffer is empty (no-op).
     */
    async flush(): Promise<void> {
        if (this.buffer.length === 0) return;

        const batch = this.buffer.splice(0);
        const { apiKey, service = 'bic-game-systems', source = 'nodejs', host = 'localhost' } = this.options;

        const payload = batch.map(entry => ({
            ddsource:  source,
            ddtags:    `service:${service},level:${entry.level}${entry.traceId ? `,traceId:${entry.traceId}` : ''}`,
            hostname:  host,
            service,
            status:    entry.level,
            timestamp: entry.timestamp,
            message:   entry.message ?? entry.event,
            // Full structured data nested under `evt` so Datadog facets stay clean.
            evt: {
                system:  entry.system,
                event:   entry.event,
                traceId: entry.traceId,
                data:    entry.data,
            },
        }));

        const response = await fetch(this.url, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                'DD-API-KEY':   apiKey,
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            console.error(`[DatadogSink] flush failed: ${response.status} ${response.statusText}`);
        }
    }

    /** Cancel the auto-flush interval. Call before process exit. */
    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /** Number of entries currently waiting to be flushed. */
    get buffered(): number {
        return this.buffer.length;
    }
}
