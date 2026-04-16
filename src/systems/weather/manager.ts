import { EventEmitter } from "eventemitter3";
import type { SystemEvents } from "../../events/bus.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type WeatherContext = Record<string, unknown>;

export type TagMatchMode = "all" | "any";
export type LoadStrategy = "replace" | "merge" | "error";

export interface WeatherEntry<TData = unknown> {
    /** Unique identifier. */
    name: string;
    /** Optional tags for filtering, e.g. ["winter", "wet", "night"]. */
    tags: string[];
    /** Relative weight used during weighted random selection. Must be >= 0. */
    weight: number;
    /** Optional description for UI/debugging. */
    description?: string | undefined;
    /** Arbitrary metadata owned by the library user. */
    data?: TData;
    /**
     * Optional transition weights from this weather to another.
     * If current weather is "sunny", and sunny.transitions.rainy = 5,
     * rainy gets extra weight when selecting next weather.
     */
    transitions?: Record<string, number>;
}

export interface WeatherEntryInput<TData = unknown> {
    name: string;
    tags?: string[];
    weight?: number;
    description?: string;
    data?: TData;
    transitions?: Record<string, number>;
}

export interface WeatherPickOptions<TContext extends WeatherContext = WeatherContext> {
    /** Filter by tags before selection. */
    tags?: string[];
    /**
     * Tag matching semantics.
     * - "all": entry must include every requested tag
     * - "any": entry must include at least one requested tag
     */
    tagMatch?: TagMatchMode;
    /** Optional arbitrary context for consumer-defined filtering logic. */
    context?: TContext;
    /**
     * If true, transition weights from currentWeather are applied.
     * Default: true
     */
    useTransitions?: boolean;
}

export interface WeatherManagerOptions<
    TData = unknown,
    TContext extends WeatherContext = WeatherContext
> {
    entries?: WeatherEntryInput<TData>[];
    initialWeather?: string | WeatherEntry<TData>;
    random?: () => number;
    /**
     * Optional custom filter hook for advanced use cases such as:
     * season, biome, region, altitude, time of day, story state, etc.
     * Return true to keep the entry, false to exclude it.
     */
    filter?: (entry: WeatherEntry<TData>, options: WeatherPickOptions<TContext>) => boolean;
    /**
     * Optional hook to parse/transform the raw `data` value from a
     * JSON-loaded entry into the typed `TData` shape.
     *
     * @example
     * ```ts
     * const manager = new WeatherManager<MyData>({
     *   parseData: (raw) => MyDataSchema.parse(raw),
     * });
     * ```
     */
    parseData?: (raw: unknown) => TData;
    /**
     * Maximum number of weather changes to keep in history.
     * Set to 0 to disable history tracking. Default: 50.
     */
    historySize?: number;
}

export interface WeatherSelectionDebug<TData = unknown> {
    candidates: WeatherEntry<TData>[];
    effectiveWeights: Array<{
        entry: WeatherEntry<TData>;
        baseWeight: number;
        transitionBonus: number;
        effectiveWeight: number;
    }>;
    totalWeight: number;
}

export interface WeatherHistoryEntry<TData = unknown> {
    entry: WeatherEntry<TData>;
    timestamp: number;
}

export interface WeatherSnapshot<TData = unknown> {
    /** All registered entries at snapshot time. */
    entries: WeatherEntry<TData>[];
    /** Name of the current weather, or null. */
    currentWeather: string | null;
    /** History buffer at snapshot time. */
    history: WeatherHistoryEntry<TData>[];
}

export interface WeatherEvents<TData = unknown> {
    "weather:added": (entry: WeatherEntry<TData>) => void;
    "weather:removed": (entry: WeatherEntry<TData>) => void;
    "weather:cleared": (removed: WeatherEntry<TData>[]) => void;
    "weather:selected": (
        selected: WeatherEntry<TData>,
        previous: WeatherEntry<TData> | null,
        debug: WeatherSelectionDebug<TData>
    ) => void;
    "weather:changed": (
        current: WeatherEntry<TData>,
        previous: WeatherEntry<TData> | null
    ) => void;
    "weather:forced": (
        current: WeatherEntry<TData>,
        previous: WeatherEntry<TData> | null
    ) => void;
    "weather:clearedCurrent": (previous: WeatherEntry<TData> | null) => void;
    "weather:loaded": (entries: WeatherEntry<TData>[], strategy: LoadStrategy) => void;
}

// ---------------------------------------------------------------------------
// WeatherManager
// ---------------------------------------------------------------------------

/**
 * Manages a registry of weather entries, selects active weather via weighted
 * random choice with optional transition biases, and emits typed events for
 * lifecycle changes.
 */
export class WeatherManager<
    TData = unknown,
    TContext extends WeatherContext = WeatherContext
> {
    public readonly events = new EventEmitter<WeatherEvents<TData>>();
    private currentWeather: WeatherEntry<TData> | null = null;

    private readonly entries = new Map<string, WeatherEntry<TData>>();
    private readonly random: () => number;
    private readonly filterFn: ((
        entry: WeatherEntry<TData>,
        options: WeatherPickOptions<TContext>
    ) => boolean) | undefined;
    private readonly parseDataFn: ((raw: unknown) => TData) | undefined;
    private readonly historySize: number;
    private readonly history: WeatherHistoryEntry<TData>[] = [];

    /** Disposer returned by the most recent {@link bindEvents} call, or `null`. */
    private boundBusDisposer: (() => void) | null = null;

    constructor(options: WeatherManagerOptions<TData, TContext> = {}) {
        this.random = options.random ?? Math.random;
        this.filterFn = options.filter;
        this.parseDataFn = options.parseData;
        this.historySize = options.historySize ?? 50;

        // Automatically track weather changes in a ring buffer.
        if (this.historySize > 0) {
            this.events.on("weather:changed", (current) => {
                this.history.push({ entry: current, timestamp: Date.now() });
                if (this.history.length > this.historySize) {
                    this.history.splice(0, this.history.length - this.historySize);
                }
            });
        }

        if (options.entries?.length) {
            this.loadEntries(options.entries, "merge");
        }

        if (options.initialWeather) {
            this.setCurrent(options.initialWeather);
        }
    }

    // ---------------------------------------------------------------------------
    // Public read APIs
    // ---------------------------------------------------------------------------

    public getEntries(): WeatherEntry<TData>[] {
        return Array.from(this.entries.values());
    }

    public getEntry(name: string): WeatherEntry<TData> | undefined {
        return this.entries.get(name);
    }

    public hasEntry(name: string): boolean {
        return this.entries.has(name);
    }

    public size(): number {
        return this.entries.size;
    }

    public getCurrentWeather(): WeatherEntry<TData> | null {
        return this.currentWeather;
    }

    /** Returns the full history of weather changes (oldest first). */
    public getHistory(): ReadonlyArray<WeatherHistoryEntry<TData>> {
        return this.history;
    }

    /** Returns the last `n` history entries (most recent last). */
    public getLastHistory(n: number): WeatherHistoryEntry<TData>[] {
        if (n <= 0) return [];
        return this.history.slice(-n);
    }

    /** Clears all history entries. */
    public clearHistory(): void {
        this.history.length = 0;
    }

    /**
     * Serializes the current state into a plain JSON-safe object.
     * Useful for save/load game state.
     */
    public toSnapshot(): WeatherSnapshot<TData> {
        return {
            entries: this.getEntries(),
            currentWeather: this.currentWeather?.name ?? null,
            history: [...this.history],
        };
    }

    /**
     * Restores state from a snapshot. Replaces all entries, sets current
     * weather, and restores history. Does not emit lifecycle events.
     */
    public loadSnapshot(snapshot: WeatherSnapshot<TData>): void {
        // Replace all entries silently
        this.entries.clear();
        for (const entry of snapshot.entries) {
            this.entries.set(entry.name, entry);
        }

        // Restore current weather
        this.currentWeather = snapshot.currentWeather
            ? this.entries.get(snapshot.currentWeather) ?? null
            : null;

        // Restore history
        this.history.length = 0;
        if (snapshot.history) {
            for (const h of snapshot.history) {
                this.history.push(h);
            }
        }
    }

    /**
     * Returns a debug view of how a selection would be evaluated
     * without mutating currentWeather.
     */
    public inspectSelection(
        options: WeatherPickOptions<TContext> = {}
    ): WeatherSelectionDebug<TData> {
        const candidates = this.filterEntries(options);

        if (candidates.length === 0) {
            return { candidates: [], effectiveWeights: [], totalWeight: 0 };
        }

        const effectiveWeights = candidates.map((entry) => {
            const baseWeight = entry.weight;
            const transitionBonus = this.getTransitionBonus(entry, options);
            const effectiveWeight = Math.max(0, baseWeight + transitionBonus);
            return { entry, baseWeight, transitionBonus, effectiveWeight };
        });

        const totalWeight = effectiveWeights.reduce(
            (sum, item) => sum + item.effectiveWeight,
            0
        );

        return { candidates, effectiveWeights, totalWeight };
    }

    // ---------------------------------------------------------------------------
    // Public mutation APIs
    // ---------------------------------------------------------------------------

    public addWeatherEntry(input: WeatherEntryInput<TData>): WeatherEntry<TData> {
        const entry = this.normalizeEntry(input);

        if (this.entries.has(entry.name)) {
            throw new Error(`Weather entry "${entry.name}" already exists.`);
        }

        this.validateTransitions(entry);
        this.entries.set(entry.name, entry);
        this.events.emit("weather:added", entry);

        return entry;
    }

    public upsertWeatherEntry(input: WeatherEntryInput<TData>): WeatherEntry<TData> {
        const entry = this.normalizeEntry(input);
        this.validateTransitions(entry);
        this.entries.set(entry.name, entry);
        return entry;
    }

    public removeWeatherEntry(name: string): boolean {
        const entry = this.entries.get(name);
        if (!entry) return false;

        this.entries.delete(name);

        if (this.currentWeather?.name === name) {
            this.currentWeather = null;
        }

        this.events.emit("weather:removed", entry);
        return true;
    }

    public clearEntries(): void {
        const removed = this.getEntries();
        this.entries.clear();

        if (this.currentWeather) {
            this.currentWeather = null;
        }

        this.events.emit("weather:cleared", removed);
    }

    public clearCurrent(): void {
        const previous = this.currentWeather;
        this.currentWeather = null;
        this.events.emit("weather:clearedCurrent", previous);
    }

    /**
     * Force current weather by name or entry.
     * Emits:
     * - weather:forced  always
     * - weather:changed  only if it differs from previous
     */
    public setCurrent(weather: string | WeatherEntry<TData>): WeatherEntry<TData> {
        const entry = this.resolveWeather(weather);
        const previous = this.currentWeather;

        this.currentWeather = entry;
        this.events.emit("weather:forced", entry, previous);

        if (!previous || previous.name !== entry.name) {
            this.events.emit("weather:changed", entry, previous);
        }

        return entry;
    }

    /**
     * Select a weather entry without mutating state.
     * Same as {@link peek} (preferred).
     * @deprecated Use {@link peek} instead.
     */
    public pick(options: WeatherPickOptions<TContext> = {}): WeatherEntry<TData> {
        return this.peek(options);
    }

    /**
     * Select a weather entry via weighted random without changing currentWeather.
     * Use {@link next} to select and apply.
     */
    public peek(options: WeatherPickOptions<TContext> = {}): WeatherEntry<TData> {
        const debug = this.inspectSelection(options);
        return this.selectWeighted(debug);
    }

    /**
     * Select a weather entry and update currentWeather.
     * Same as {@link next} (preferred).
     * @deprecated Use {@link next} instead.
     */
    public poll(options: WeatherPickOptions<TContext> = {}): WeatherEntry<TData> {
        return this.next(options);
    }

    /**
     * Select a weather entry via weighted random and set it as current.
     * Emits:
     * - weather:selected always on successful selection
     * - weather:changed  only if selected differs from previous
     */
    public next(options: WeatherPickOptions<TContext> = {}): WeatherEntry<TData> {
        const debug = this.inspectSelection(options);
        const selected = this.selectWeighted(debug);

        const previous = this.currentWeather;
        this.currentWeather = selected;

        this.events.emit("weather:selected", selected, previous, debug);

        if (!previous || previous.name !== selected.name) {
            this.events.emit("weather:changed", selected, previous);
        }

        return selected;
    }

    // ---------------------------------------------------------------------------
    // Internal entry loading (used by WeatherLoader)
    // ---------------------------------------------------------------------------

    /**
     * Bulk-load normalized entries with a given strategy.
     * Called by WeatherLoader — not intended for direct use.
     * @internal
     */
    public loadEntries(inputs: WeatherEntryInput<TData>[], strategy: LoadStrategy): void {
        if (strategy === "replace") {
            this.clearEntries();
            for (const input of inputs) {
                this.addWeatherEntry(input);
            }
        } else if (strategy === "merge") {
            for (const input of inputs) {
                this.upsertWeatherEntry(input);
            }
        } else {
            // "error" — pre-validate for duplicates before mutating
            const names = new Set<string>();
            for (const raw of inputs) {
                if (!raw?.name?.trim()) {
                    throw new Error("Weather entry name is required.");
                }
                if (names.has(raw.name)) {
                    throw new Error(`Duplicate weather entry "${raw.name}" in load payload.`);
                }
                names.add(raw.name);
                if (this.entries.has(raw.name)) {
                    throw new Error(
                        `Weather entry "${raw.name}" already exists and strategy is "error".`
                    );
                }
            }
            for (const input of inputs) {
                this.addWeatherEntry(input);
            }
        }

        this.events.emit("weather:loaded", this.getEntries(), strategy);
    }

    // ---------------------------------------------------------------------------
    // Shared event bus binding
    // ---------------------------------------------------------------------------

    /**
     * Connects this WeatherManager to the shared SystemEvents bus.
     *
     * **Inbound** — the bus can now control weather:
     * - `intent.weather.set`       → `setCurrent(name)`
     * - `intent.weather.randomize` → `next()`
     * - `intent.weather.clear`     → `clearCurrent()`
     *
     * **Outbound** — all internal WeatherEvents are forwarded onto the bus.
     *
     * Calling `bindEvents` while already bound automatically unbinds the
     * previous bus first (safe re-bind).
     *
     * @returns A disposer function that removes all listeners when called.
     *          Equivalent to calling {@link unbindEvents}.
     */
    public bindEvents(bus: EventEmitter<SystemEvents>): () => void {
        // Guard: clean up previous binding if any
        if (this.boundBusDisposer) {
            this.boundBusDisposer();
        }

        // ── Inbound ───────────────────────────────────────────────────────────
        const onSet = ({ weatherName }: { weatherName: string }) => {
            try { this.setCurrent(weatherName); } catch (e) {
                this.events.emit("weather:cleared", []);
                console.warn(`[WeatherManager] intent.weather.set failed for "${weatherName}":`, e instanceof Error ? e.message : e);
            }
        };
        const onRandomize = () => {
            try { this.next(); } catch (e) {
                console.warn('[WeatherManager] intent.weather.randomize failed:', e instanceof Error ? e.message : e);
            }
        };
        const onClear = () => {
            this.clearCurrent();
        };

        bus.on("intent.weather.set", onSet);
        bus.on("intent.weather.randomize", onRandomize);
        bus.on("intent.weather.clear", onClear);

        // ── Outbound bridge ───────────────────────────────────────────────────
        // WeatherEntry<TData> → WeatherEntry<unknown> for the shared bus contract.
        const toBusEntry = (e: WeatherEntry<TData>): WeatherEntry =>
            e as unknown as WeatherEntry;

        const onChanged = (current: WeatherEntry<TData>, previous: WeatherEntry<TData> | null) => {
            bus.emit("fact.weather.changed", {
                previousWeather: previous?.name ?? "",
                weatherName: current.name,
                entry: toBusEntry(current),
            });
        };

        const onCleared = (previous: WeatherEntry<TData> | null) => {
            bus.emit("fact.weather.cleared", {
                previousWeather: previous?.name ?? "",
                ...(previous && { entry: toBusEntry(previous) }),
            });
        };

        const onSelected = (selected: WeatherEntry<TData>, previous: WeatherEntry<TData> | null) => {
            bus.emit("fact.weather.randomized", {
                previousWeather: previous?.name ?? "",
                weatherName: selected.name,
                entry: toBusEntry(selected),
            });
        };

        const onLoaded = (entries: WeatherEntry<TData>[], strategy: LoadStrategy) => {
            bus.emit("fact.weather.loaded", {
                count: entries.length,
                strategy,
            });
        };

        this.events.on("weather:changed", onChanged);
        this.events.on("weather:clearedCurrent", onCleared);
        this.events.on("weather:selected", onSelected);
        this.events.on("weather:loaded", onLoaded);

        // ── Disposer ──────────────────────────────────────────────────────────
        const dispose = () => {
            bus.off("intent.weather.set", onSet);
            bus.off("intent.weather.randomize", onRandomize);
            bus.off("intent.weather.clear", onClear);

            this.events.off("weather:changed", onChanged);
            this.events.off("weather:clearedCurrent", onCleared);
            this.events.off("weather:selected", onSelected);
            this.events.off("weather:loaded", onLoaded);

            this.boundBusDisposer = null;
        };

        this.boundBusDisposer = dispose;
        return dispose;
    }

    /**
     * Removes all listeners registered by the most recent {@link bindEvents}
     * call. Safe to call when not bound (no-op).
     */
    public unbindEvents(): void {
        this.boundBusDisposer?.();
    }

    /** Whether this manager is currently bound to a bus. */
    public get isBound(): boolean {
        return this.boundBusDisposer !== null;
    }

    /**
     * Tears down the manager: unbinds the bus, removes all internal event
     * listeners, clears entries and history. Safe to call multiple times.
     *
     * After calling `dispose()`, the manager should not be reused.
     */
    public dispose(): void {
        this.unbindEvents();
        this.events.removeAllListeners();
        this.entries.clear();
        this.history.length = 0;
        this.currentWeather = null;
    }

    // ---------------------------------------------------------------------------
    // Weighted selection (shared by pick + poll)
    // ---------------------------------------------------------------------------

    /**
     * Performs a weighted random selection from a pre-computed debug view.
     * Throws if there are no candidates or zero total weight.
     */
    private selectWeighted(debug: WeatherSelectionDebug<TData>): WeatherEntry<TData> {
        if (debug.candidates.length === 0) {
            throw new Error("No weather entries match the given filter.");
        }

        if (debug.totalWeight <= 0) {
            throw new Error("Matching weather entries have zero effective total weight.");
        }

        let roll = this.random() * debug.totalWeight;

        for (const item of debug.effectiveWeights) {
            roll -= item.effectiveWeight;
            if (roll < 0) return item.entry;
        }

        // Fallback: floating-point edge case — return the last entry.
        return debug.effectiveWeights[debug.effectiveWeights.length - 1]!.entry;
    }

    // ---------------------------------------------------------------------------
    // Normalization & validation (transition logic lives here)
    // ---------------------------------------------------------------------------

    private normalizeEntry(input: WeatherEntryInput<TData>): WeatherEntry<TData> {
        if (!input || typeof input !== "object") {
            throw new Error("Weather entry must be an object.");
        }

        if (!input.name || !input.name.trim()) {
            throw new Error("Weather entry name is required.");
        }

        const name = input.name.trim();

        const tags = Array.from(
            new Set((input.tags ?? []).map((tag) => this.normalizeTag(tag)))
        );

        const weight = input.weight ?? 1;

        if (Number.isNaN(weight) || !Number.isFinite(weight)) {
            throw new Error(`Weather entry "${name}" has an invalid weight.`);
        }

        if (weight < 0) {
            throw new Error(`Weather entry "${name}" must have weight >= 0.`);
        }

        const transitions = input.transitions
            ? this.normalizeTransitions(name, input.transitions)
            : undefined;

        const data =
            input.data !== undefined && this.parseDataFn
                ? this.parseDataFn(input.data)
                : input.data;

        return {
            name,
            tags,
            weight,
            ...(input.description !== undefined && { description: input.description }),
            ...(data !== undefined && { data: data as TData }),
            ...(transitions !== undefined && { transitions }),
        };
    }

    private normalizeTransitions(
        ownerName: string,
        transitions: Record<string, number>
    ): Record<string, number> {
        if (!transitions || typeof transitions !== "object" || Array.isArray(transitions)) {
            throw new Error(`Weather entry "${ownerName}" has invalid transitions.`);
        }

        const normalized: Record<string, number> = {};

        for (const [target, weight] of Object.entries(transitions)) {
            const targetName = target.trim();

            if (!targetName) {
                throw new Error(`Weather entry "${ownerName}" has an empty transition target.`);
            }

            if (Number.isNaN(weight) || !Number.isFinite(weight) || weight < 0) {
                throw new Error(
                    `Weather entry "${ownerName}" has invalid transition weight for "${targetName}".`
                );
            }

            normalized[targetName] = weight;
        }

        return normalized;
    }

    private validateTransitions(entry: WeatherEntry<TData>): void {
        if (!entry.transitions) return;

        for (const value of Object.values(entry.transitions)) {
            if (value < 0 || !Number.isFinite(value)) {
                throw new Error(`Weather entry "${entry.name}" has invalid transition values.`);
            }
        }
    }

    private resolveWeather(weather: string | WeatherEntry<TData>): WeatherEntry<TData> {
        const name = typeof weather === "string" ? weather : weather.name;
        const resolved = this.entries.get(name);

        if (!resolved) {
            throw new Error(`Weather entry "${name}" not found.`);
        }

        return resolved;
    }

    private normalizeTag(tag: string): string {
        if (!tag.trim()) {
            throw new Error("Weather tags must be non-empty strings.");
        }

        return tag.trim().toLowerCase();
    }

    private filterEntries(options: WeatherPickOptions<TContext>): WeatherEntry<TData>[] {
        let entries = this.getEntries();

        const requestedTags = (options.tags ?? []).map((tag) => this.normalizeTag(tag));

        if (requestedTags.length > 0) {
            const mode = options.tagMatch ?? "all";

            entries = entries.filter((entry) => {
                if (mode === "all") {
                    return requestedTags.every((tag) => entry.tags.includes(tag));
                }
                return requestedTags.some((tag) => entry.tags.includes(tag));
            });
        }

        if (this.filterFn) {
            entries = entries.filter((entry) => this.filterFn!(entry, options));
        }

        return entries;
    }

    /** Returns the transition weight bonus for a candidate given current weather. */
    private getTransitionBonus(
        candidate: WeatherEntry<TData>,
        options: WeatherPickOptions<TContext>
    ): number {
        const useTransitions = options.useTransitions ?? true;
        if (!useTransitions) return 0;
        if (!this.currentWeather?.transitions) return 0;

        return this.currentWeather.transitions[candidate.name] ?? 0;
    }
}
