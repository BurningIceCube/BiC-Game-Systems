// trace.ts
import { EventEmitter } from 'eventemitter3';
import type { SystemEvents } from '../../events/bus.js';
import { Logger, defaultLogger } from './logger.js';
import type { LogEntry, TraceChain, TraceResult } from './logger.js';
import { newTraceId } from './common.js';

export type { TraceChain, TraceResult } from './logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a dot-segment glob (`*` = one segment) into a RegExp. */
function globToRegex(glob: string): RegExp {
    let regex = '';
    for (const ch of glob) {
        if (ch === '*')                               regex += '[^.]+';
        else if ('.+^${}()|[]\\'.includes(ch))        regex += '\\' + ch;
        else                                          regex += ch;
    }
    return new RegExp(`^${regex}$`);
}

// ── TraceBundler ──────────────────────────────────────────────────────────────

/**
 * Manages pattern-based trace chains.
 *
 * Register one or more dot-segment globs (e.g. `"*.weather.*"`).
 * Every event whose name matches a pattern is automatically recorded
 * into a dedicated {@link TraceChain} for that pattern — no manual
 * `beginTrace` / `endTrace` required.
 *
 * ```ts
 * const bundler = new TraceBundler(["*.weather.*"]);
 * // … later, after events have fired …
 * const results = bundler.endAll();   // finalize every chain
 * ```
 */
export class TraceBundler {
    private readonly patterns: Array<{ glob: string; regex: RegExp }> = [];
    private readonly chains = new Map<string, TraceChain>();
    private _paused = false;

    constructor(capture?: string | string[]) {
        const globs = capture
            ? (Array.isArray(capture) ? capture : [capture])
            : [];
        for (const g of globs) this.addCapture(g);
    }

    /** Stop recording new events into any chain. Existing chains are kept intact. */
    pause(): void  { this._paused = true; }

    /** Resume recording after a {@link pause}. */
    resume(): void { this._paused = false; }

    /** Whether the bundler is currently paused. */
    get paused(): boolean { return this._paused; }

    /** Register a new capture pattern. */
    addCapture(glob: string): void {
        this.patterns.push({ glob, regex: globToRegex(glob) });
    }

    /** Remove a previously registered pattern (does not clear its chain). */
    removeCapture(glob: string): void {
        const idx = this.patterns.findIndex(p => p.glob === glob);
        if (idx >= 0) this.patterns.splice(idx, 1);
    }

    /**
     * Record an event into every chain whose pattern matches.
     * No-op while the bundler is {@link paused}.
     * @returns The traceId of the first matching chain, or `undefined`.
     */
    record(event: string, data?: unknown): string | undefined {
        if (this._paused) return undefined;
        let firstTraceId: string | undefined;

        for (const { glob, regex } of this.patterns) {
            if (!regex.test(event)) continue;

            let chain = this.chains.get(glob);
            if (!chain) {
                chain = {
                    traceId:   newTraceId(),
                    rootEvent: glob,
                    startedAt: Date.now(),
                    entries:   [],
                };
                this.chains.set(glob, chain);
            }

            const entry: LogEntry = {
                timestamp: Date.now(),
                level:     'debug',
                system:    'EventBus',
                event,
                traceId:   chain.traceId,
                ...(data !== undefined && { data }),
            };

            chain.entries.push(entry);
            firstTraceId ??= chain.traceId;
        }

        return firstTraceId;
    }

    /** Get the live chain for a capture pattern. */
    getChain(glob: string): TraceChain | undefined {
        return this.chains.get(glob);
    }

    /** Get all live chains (keyed by glob). */
    getChains(): ReadonlyMap<string, TraceChain> {
        return this.chains;
    }

    /** Finalize one chain into a {@link TraceResult} and remove it. */
    end(glob: string): TraceResult | null {
        const chain = this.chains.get(glob);
        if (!chain) return null;
        this.chains.delete(glob);
        return {
            ...chain,
            entries:  [...chain.entries],
            duration: Date.now() - chain.startedAt,
        };
    }

    /** Finalize every chain and return the results. */
    endAll(): TraceResult[] {
        const results: TraceResult[] = [];
        for (const glob of [...this.chains.keys()]) {
            const r = this.end(glob);
            if (r) results.push(r);
        }
        return results;
    }

    /** Discard all chains without producing results. */
    clear(): void {
        this.chains.clear();
    }

    /** Whether any capture patterns are registered. */
    get hasPatterns(): boolean {
        return this.patterns.length > 0;
    }
}

// ── TracedEventEmitter ────────────────────────────────────────────────────────

export interface TracedEventEmitterOptions {
    /**
     * Dot-segment globs whose matching events are auto-captured into
     * a {@link TraceBundler} chain.
     *
     * `*` matches exactly one segment:
     * - `"*.weather.*"` → `fact.weather.changed`, `intent.weather.set`, …
     *
     * @example
     * ```ts
     * const bus = new TracedEventEmitter({ capture: ["*.weather.*"] });
     * ```
     */
    capture?: string | string[];

    /**
     * The {@link Logger} instance used for structured log output and
     * manual trace lifecycle (`traceOn` / `traceOff`).
     *
     * Defaults to {@link defaultLogger} when omitted.
     * Pass your own `new Logger()` for full isolation:
     *
     * ```ts
     * const logger = new Logger();
     * const bus = new TracedEventEmitter({ logger });
     * ```
     */
    logger?: Logger;
}

/**
 * Drop-in replacement for `EventEmitter<SystemEvents>` that auto-captures
 * matching events into pattern-based trace chains via a {@link TraceBundler}.
 *
 * Also supports the `intent.system.traceOn` / `intent.system.traceOff`
 * manual trace lifecycle for one-off, ad-hoc traces.
 *
 * @example
 * ```ts
 * const bus = new TracedEventEmitter({ capture: ["*.weather.*"] });
 * manager.bindEvents(bus);
 *
 * // … operations that emit fact.weather.* / intent.weather.* …
 *
 * const results = bus.bundler.endAll(); // finalize captured chains
 * ```
 */
export class TracedEventEmitter extends EventEmitter<SystemEvents> {
    /** The bundler that holds pattern-based trace chains. */
    public readonly bundler: TraceBundler;

    /** The logger instance this emitter delegates to. */
    public readonly logger: Logger;

    constructor(options: TracedEventEmitterOptions = {}) {
        super();
        this.logger = options.logger ?? defaultLogger;
        this.bundler = new TraceBundler(options.capture);

        // Manual trace support via bus events
        this.on('intent.system.traceOn', ({ rootEvent }) => {
            this.bundler.resume();
            this.logger.beginTrace(rootEvent);
        });

        this.on('intent.system.traceOff', () => {
            this.bundler.pause();
            const result = this.logger.endTrace();
            if (!result) return;

            this.emit('fact.system.traceCompleted', {
                traceId:   result.traceId,
                rootEvent: result.rootEvent,
                startedAt: result.startedAt,
                duration:  result.duration,
                entries:   result.entries,
            });
        });
    }

    /**
     * Emits the event and — if it matches a bundler pattern or a manual
     * Logger trace is active — records a structured log entry.
     */
    override emit<T extends keyof SystemEvents>(
        event: T,
        ...args: EventEmitter.ArgumentMap<SystemEvents>[Extract<T, keyof SystemEvents>]
    ): boolean {
        const eventName = event as string;
        const data      = args[0];

        // 1. Bundler: auto-capture into pattern-based chains
        const bundlerTraceId = this.bundler.record(eventName, data);

        if (bundlerTraceId) {
            // Push through Logger so sinks (consoleSink) receive the entry
            this.logger.log('debug', 'EventBus', eventName, data, bundlerTraceId);
        } else if (this.logger.isTracing) {
            // 2. Fallback: manual Logger trace is active (traceOn/Off)
            this.logger.log('debug', 'EventBus', eventName, data);
        }

        return super.emit(event, ...args);
    }
}
