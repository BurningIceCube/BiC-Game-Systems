// sinks.ts
// MemorySink — in-memory LogEntry accumulator for tests and trace introspection.
//
// The old consoleSink, fileSink, and DatadogSink are no longer needed:
// LogLayer handles transport routing natively via its transport / plugin system.
//
// To add console output:   new Logger()  (default ConsoleTransport)
// To add file output:      use @loglayer/transport-pino + pino file destination
// To add Datadog output:   use @loglayer/transport-datadog
//
// MemorySink stays because it captures BiC-specific LogEntry objects for
// trace-chain introspection — something LogLayer transports don't provide.

import type { LogEntry, LogLevel } from './logger.js';

// Shared level-order map.
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// ── Memory sink ───────────────────────────────────────────────────────────────

/**
 * Accumulates {@link LogEntry} objects in memory.
 *
 * Useful for:
 * - **Testing** — assert on logged events without hitting stdout or disk.
 * - **Replay** — surface a causal chain to a UI or API response.
 *
 * Wire it into a {@link Logger} via a LogLayer plugin so every log call
 * is captured automatically:
 *
 * @example
 * ```ts
 * import { Logger, MemorySink } from 'bic-game-systems';
 *
 * const mem = new MemorySink();
 * const logger = new Logger({ logLayerConfig: {
 *   plugins: [mem.plugin()],
 * }});
 *
 * logger.log('info', 'App', 'ready');
 *
 * mem.getBySystem('App');   // [{ system: 'App', event: 'ready', … }]
 * mem.clear();
 * ```
 */
export class MemorySink {
    readonly entries: LogEntry[] = [];

    // Staging area: onBeforeDataOut fires before onBeforeMessageOut,
    // so we stash structured data here and assemble the full LogEntry
    // once the message arrives.
    private _pendingData: Record<string, unknown> | null = null;
    private _pendingLevel: string = 'info';

    /**
     * Returns a LogLayer plugin that captures every log call into this sink.
     *
     * @param id - Optional plugin id. Default: `"memory-sink"`.
     */
    plugin(id = 'memory-sink') {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        return {
            id,
            onBeforeDataOut(params: {
                data?: Record<string, unknown>;
                logLevel: string;
            }) {
                // Stash the merged context + metadata for the upcoming message hook.
                self._pendingData = params.data ?? null;
                self._pendingLevel = params.logLevel;
                return params.data;
            },
            onBeforeMessageOut(params: {
                messages: unknown[];
                logLevel: string;
            }) {
                const data = self._pendingData;
                const logLevel = self._pendingLevel;
                self._pendingData = null;

                // Extract BiC-specific fields that Logger.log() places in context
                const system  = (data?.['system']  as string) ?? 'Unknown';
                const event   = (data?.['event']   as string) ?? '';
                const traceId = data?.['traceId'] as string | undefined;

                // Build the user payload (everything except context keys)
                const payload: Record<string, unknown> = {};
                if (data) {
                    for (const [k, v] of Object.entries(data)) {
                        if (k !== 'system' && k !== 'event' && k !== 'traceId') {
                            payload[k] = v;
                        }
                    }
                }

                const entry: LogEntry = {
                    timestamp: Date.now(),
                    level: logLevel as LogLevel,
                    system,
                    event,
                    ...(traceId !== undefined && { traceId }),
                    ...(Object.keys(payload).length > 0 && { data: payload }),
                    ...(typeof params.messages[0] === 'string' && params.messages[0] !== event && { message: params.messages[0] }),
                };

                self.entries.push(entry);
                return params.messages;
            },
        };
    }

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
