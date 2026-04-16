
import { EventEmitter } from "eventemitter3";
import type { SystemEvents } from "../../events/bus.js";
export type { LoadStrategy } from "../common.js";
import type { LoadStrategy } from "../common.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type ReputationEntityType = "faction" | "character" | string;

/**
 * A tier defines a named band of the reputation scale.
 * Tiers are evaluated in order — the highest `threshold` that the current
 * value is >= wins.  Negative tiers work the same way (e.g. threshold: -500).
 *
 * @example
 * { id: 'exalted',  label: 'Exalted',  threshold:  750, description: 'They would die for you.' }
 * { id: 'hated',    label: 'Hated',    threshold: -500, description: 'Kill on sight.'           }
 */
export interface ReputationTier {
    id: string;
    label: string;
    /** Minimum value (inclusive) required to be in this tier. */
    threshold: number;
    description?: string;
}

/**
 * Defines a single trackable entity (faction, character, guild, etc.).
 * Each entity carries its own tier ladder and value bounds.
 */
export interface ReputationEntity {
    id: string;
    name: string;
    type: ReputationEntityType;
    description?: string;
    /** Starting reputation value. Defaults to 0. */
    initialValue: number;
    /** Floor — reputation cannot drop below this. Defaults to -1000. */
    minValue: number;
    /** Ceiling — reputation cannot rise above this. Defaults to 1000. */
    maxValue: number;
    /**
     * Ordered list of tiers for this entity.
     * Sorted descending by threshold at runtime so the highest matching tier wins.
     */
    tiers: ReputationTier[];
}

/** Loose input shape accepted by addEntity / loadEntries. */
export interface ReputationEntityInput {
    id: string;
    name?: string;
    type?: ReputationEntityType;
    description?: string;
    initialValue?: number;
    minValue?: number;
    maxValue?: number;
    tiers?: ReputationTier[];
}

export interface ReputationManagerOptions {
    entities?: ReputationEntityInput[];
    /**
     * Optional map of entityId → starting value.
     * Applied after entities are loaded, overriding each entity's own initialValue.
     */
    initialValues?: Record<string, number>;
    /**
     * Maximum number of reputation changes to keep in history.
     * Set to 0 to disable history tracking. Default: 50.
     */
    historySize?: number;
}

export interface ReputationHistoryEntry {
    entityId: string;
    previous: number;
    current: number;
    delta: number;
    tierId: string;
    timestamp: number;
}

export interface ReputationSnapshot {
    /** All registered entities at snapshot time. */
    entities: ReputationEntity[];
    /** entityId → current numeric value */
    values: Record<string, number>;
    /** History buffer at snapshot time. */
    history: ReputationHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Local events
// ---------------------------------------------------------------------------

export interface ReputationEvents {
    "reputation:added": (entity: ReputationEntity) => void;
    "reputation:removed": (entity: ReputationEntity) => void;
    "reputation:cleared": (removed: ReputationEntity[]) => void;
    "reputation:changed": (payload: {
        entityId: string;
        previous: number;
        current: number;
        delta: number;
        tierId: string;
    }) => void;
    "reputation:tierChanged": (payload: {
        entityId: string;
        previousTierId: string;
        currentTierId: string;
        current: number;
    }) => void;
    "reputation:loaded": (entities: ReputationEntity[], strategy: LoadStrategy) => void;
}

// ---------------------------------------------------------------------------
// ReputationManager
// ---------------------------------------------------------------------------

/**
 * Manages a registry of reputation entities, tracks numeric reputation values
 * with tier resolution, and emits typed events for lifecycle changes.
 */
export class ReputationManager {
    public readonly events = new EventEmitter<ReputationEvents>();

    private readonly entities = new Map<string, ReputationEntity>();
    /** entityId → current numeric value */
    private readonly values = new Map<string, number>();

    private readonly historySize: number;
    private readonly history: ReputationHistoryEntry[] = [];

    /** Disposer returned by the most recent {@link bindEvents} call, or `null`. */
    private boundBusDisposer: (() => void) | null = null;

    constructor(options: ReputationManagerOptions = {}) {
        this.historySize = options.historySize ?? 50;

        // Automatically track reputation changes in a ring buffer.
        if (this.historySize > 0) {
            this.events.on("reputation:changed", (payload) => {
                this.history.push({
                    entityId: payload.entityId,
                    previous: payload.previous,
                    current: payload.current,
                    delta: payload.delta,
                    tierId: payload.tierId,
                    timestamp: Date.now(),
                });
                if (this.history.length > this.historySize) {
                    this.history.splice(0, this.history.length - this.historySize);
                }
            });
        }

        if (options.entities?.length) {
            this.loadEntries(options.entities, "merge");
        }

        // Apply explicit initial values (overrides entity defaults).
        if (options.initialValues) {
            for (const [id, value] of Object.entries(options.initialValues)) {
                if (this.entities.has(id)) {
                    this.values.set(id, this.clampById(id, value));
                }
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Public read APIs
    // ---------------------------------------------------------------------------

    public getEntities(): ReputationEntity[] {
        return Array.from(this.entities.values());
    }

    public getEntity(id: string): ReputationEntity | undefined {
        return this.entities.get(id);
    }

    public hasEntity(id: string): boolean {
        return this.entities.has(id);
    }

    public size(): number {
        return this.entities.size;
    }

    /** Returns the raw numeric reputation value for an entity, or 0 if unknown. */
    public getValue(entityId: string): number {
        return this.values.get(entityId) ?? 0;
    }

    /** Returns the active tier ID for an entity, or undefined if no tier matches. */
    public getTierId(entityId: string): string | undefined {
        const entity = this.entities.get(entityId);
        if (!entity) return undefined;
        return this.resolveTier(entity, this.getValue(entityId))?.id;
    }

    /** Returns the full active tier object for an entity. */
    public getTier(entityId: string): ReputationTier | undefined {
        const entity = this.entities.get(entityId);
        if (!entity) return undefined;
        return this.resolveTier(entity, this.getValue(entityId));
    }

    /**
     * Returns an enriched view for an entity — value, tier, bounds, and all tiers.
     */
    public getReputation(entityId: string) {
        const entity = this.entities.get(entityId);
        if (!entity) return undefined;
        const value = this.getValue(entityId);
        const tier = this.resolveTier(entity, value);
        return {
            entityId: entity.id,
            entityName: entity.name,
            entityType: entity.type,
            value,
            tierId: tier?.id,
            tierLabel: tier?.label,
            tierDescription: tier?.description,
            minValue: entity.minValue,
            maxValue: entity.maxValue,
            tiers: this.sortedTiers(entity),
        };
    }

    /** Returns enriched views for every registered entity. */
    public getAllReputations() {
        return this.getEntities().map((e) => this.getReputation(e.id)!);
    }

    /** Returns all entities of a given type (e.g. 'faction'). */
    public getByType(type: ReputationEntityType) {
        return this.getEntities()
            .filter((e) => e.type === type)
            .map((e) => this.getReputation(e.id)!);
    }

    /** Returns all entity IDs currently at the given tier. */
    public getEntitiesAtTier(tierId: string): string[] {
        return this.getEntities()
            .filter((e) => this.getTierId(e.id) === tierId)
            .map((e) => e.id);
    }

    /** Returns the full history of reputation changes (oldest first). */
    public getHistory(): ReadonlyArray<ReputationHistoryEntry> {
        return this.history;
    }

    /** Returns the last `n` history entries (most recent last). */
    public getLastHistory(n: number): ReputationHistoryEntry[] {
        if (n <= 0) return [];
        return this.history.slice(-n);
    }

    /** Clears all history entries. */
    public clearHistory(): void {
        this.history.length = 0;
    }

    // ---------------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------------

    /**
     * Serializes the current state into a plain JSON-safe object.
     * Useful for save/load game state.
     */
    public toSnapshot(): ReputationSnapshot {
        const values: Record<string, number> = {};
        for (const [id, val] of this.values) {
            values[id] = val;
        }
        return {
            entities: this.getEntities(),
            values,
            history: [...this.history],
        };
    }

    /**
     * Restores state from a snapshot. Replaces all entities, values, and
     * history. Does not emit lifecycle events.
     */
    public loadSnapshot(snapshot: ReputationSnapshot): void {
        this.entities.clear();
        this.values.clear();

        for (const entity of snapshot.entities) {
            this.entities.set(entity.id, entity);
        }

        for (const [id, val] of Object.entries(snapshot.values)) {
            if (this.entities.has(id)) {
                this.values.set(id, val);
            }
        }

        this.history.length = 0;
        if (snapshot.history) {
            for (const h of snapshot.history) {
                this.history.push(h);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Public mutation APIs — reputation values
    // ---------------------------------------------------------------------------

    /**
     * Adjust reputation for an entity by a delta (positive or negative).
     * Emits `reputation:changed` and, when the tier changes, `reputation:tierChanged`.
     *
     * @returns `true` if the entity was found and updated, `false` otherwise.
     */
    public change(entityId: string, amount: number): boolean {
        const entity = this.entities.get(entityId);
        if (!entity) return false;

        const previous = this.values.get(entityId) ?? entity.initialValue;
        const previousTier = this.resolveTier(entity, previous);

        const next = this.clamp(entity, previous + amount);
        this.values.set(entityId, next);
        const nextTier = this.resolveTier(entity, next);

        this.events.emit("reputation:changed", {
            entityId,
            previous,
            current: next,
            delta: amount,
            tierId: nextTier?.id ?? "",
        });

        if (previousTier?.id !== nextTier?.id) {
            this.events.emit("reputation:tierChanged", {
                entityId,
                previousTierId: previousTier?.id ?? "",
                currentTierId: nextTier?.id ?? "",
                current: next,
            });
        }

        return true;
    }

    /**
     * Directly set the reputation value for an entity.
     * Emits the same events as `change()`.
     */
    public set(entityId: string, value: number): boolean {
        const entity = this.entities.get(entityId);
        if (!entity) return false;
        const previous = this.values.get(entityId) ?? entity.initialValue;
        return this.change(entityId, this.clamp(entity, value) - previous);
    }

    // ---------------------------------------------------------------------------
    // Public mutation APIs — entity registry
    // ---------------------------------------------------------------------------

    public addEntity(input: ReputationEntityInput): ReputationEntity {
        const entity = this.normalizeEntity(input);

        if (this.entities.has(entity.id)) {
            throw new Error(`Reputation entity "${entity.id}" already exists.`);
        }

        this.entities.set(entity.id, entity);
        this.values.set(entity.id, entity.initialValue);
        this.events.emit("reputation:added", entity);

        return entity;
    }

    public upsertEntity(input: ReputationEntityInput): ReputationEntity {
        const entity = this.normalizeEntity(input);
        this.entities.set(entity.id, entity);
        // Only seed value if this is a new entity
        if (!this.values.has(entity.id)) {
            this.values.set(entity.id, entity.initialValue);
        }
        return entity;
    }

    public removeEntity(id: string): boolean {
        const entity = this.entities.get(id);
        if (!entity) return false;

        this.entities.delete(id);
        this.values.delete(id);
        this.events.emit("reputation:removed", entity);
        return true;
    }

    public clearEntities(): void {
        const removed = this.getEntities();
        this.entities.clear();
        this.values.clear();
        this.events.emit("reputation:cleared", removed);
    }

    // ---------------------------------------------------------------------------
    // Internal entry loading
    // ---------------------------------------------------------------------------

    /**
     * Bulk-load normalized entities with a given strategy.
     * Called by ReputationLoader — not intended for direct use.
     */
    public loadEntries(inputs: ReputationEntityInput[], strategy: LoadStrategy): void {
        if (strategy === "replace") {
            this.clearEntities();
            for (const input of inputs) {
                this.addEntity(input);
            }
        } else if (strategy === "merge") {
            for (const input of inputs) {
                this.upsertEntity(input);
            }
        } else {
            // "error" — pre-validate for duplicates before mutating
            const ids = new Set<string>();
            for (const raw of inputs) {
                if (!raw?.id?.trim()) {
                    throw new Error("Reputation entity id is required.");
                }
                if (ids.has(raw.id)) {
                    throw new Error(`Duplicate reputation entity "${raw.id}" in load payload.`);
                }
                ids.add(raw.id);
                if (this.entities.has(raw.id)) {
                    throw new Error(
                        `Reputation entity "${raw.id}" already exists and strategy is "error".`
                    );
                }
            }
            for (const input of inputs) {
                this.addEntity(input);
            }
        }

        this.events.emit("reputation:loaded", this.getEntities(), strategy);
    }

    // ---------------------------------------------------------------------------
    // Shared event bus binding
    // ---------------------------------------------------------------------------

    /**
     * Connects this ReputationManager to the shared SystemEvents bus.
     *
     * **Inbound** — the bus can now control reputation:
     * - `intent.reputation.change` → `change(entityId, amount)`
     * - `intent.reputation.set`    → `set(entityId, value)`
     *
     * **Outbound** — local events are forwarded as facts on the bus.
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
        const onChange = ({ entityId, amount }: { entityId: string; amount: number }) => {
            this.change(entityId, amount);
        };

        const onSet = ({ entityId, value }: { entityId: string; value: number }) => {
            this.set(entityId, value);
        };

        bus.on("intent.reputation.change", onChange);
        bus.on("intent.reputation.set", onSet);

        // ── Outbound bridge ───────────────────────────────────────────────────
        const onChanged = (payload: {
            entityId: string;
            previous: number;
            current: number;
            delta: number;
            tierId: string;
        }) => {
            bus.emit("fact.reputation.changed", payload);
        };

        const onTierChanged = (payload: {
            entityId: string;
            previousTierId: string;
            currentTierId: string;
            current: number;
        }) => {
            bus.emit("fact.reputation.tierChanged", payload);
        };

        const onLoaded = (entities: ReputationEntity[], strategy: LoadStrategy) => {
            bus.emit("fact.reputation.loaded", {
                count: entities.length,
                strategy,
            });
        };

        this.events.on("reputation:changed", onChanged);
        this.events.on("reputation:tierChanged", onTierChanged);
        this.events.on("reputation:loaded", onLoaded);

        // ── Disposer ──────────────────────────────────────────────────────────
        const dispose = () => {
            bus.off("intent.reputation.change", onChange);
            bus.off("intent.reputation.set", onSet);

            this.events.off("reputation:changed", onChanged);
            this.events.off("reputation:tierChanged", onTierChanged);
            this.events.off("reputation:loaded", onLoaded);

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
     * listeners, clears entities and history. Safe to call multiple times.
     *
     * After calling `dispose()`, the manager should not be reused.
     */
    public dispose(): void {
        this.unbindEvents();
        this.events.removeAllListeners();
        this.entities.clear();
        this.values.clear();
        this.history.length = 0;
    }

    // ---------------------------------------------------------------------------
    // Normalization & validation
    // ---------------------------------------------------------------------------

    /** @internal */
    public normalizeEntity(input: ReputationEntityInput): ReputationEntity {
        if (!input || typeof input !== "object") {
            throw new Error("Reputation entity must be an object.");
        }

        if (!input.id || !input.id.trim()) {
            throw new Error("Reputation entity id is required.");
        }

        const id = input.id.trim();
        const name = input.name?.trim() || id;
        const type: ReputationEntityType = input.type ?? "faction";
        const initialValue = input.initialValue ?? 0;
        const minValue = input.minValue ?? -1000;
        const maxValue = input.maxValue ?? 1000;

        if (!Number.isFinite(initialValue)) {
            throw new Error(`Reputation entity "${id}" has an invalid initialValue.`);
        }
        if (!Number.isFinite(minValue)) {
            throw new Error(`Reputation entity "${id}" has an invalid minValue.`);
        }
        if (!Number.isFinite(maxValue)) {
            throw new Error(`Reputation entity "${id}" has an invalid maxValue.`);
        }
        if (minValue > maxValue) {
            throw new Error(`Reputation entity "${id}" has minValue > maxValue.`);
        }

        const tiers = this.normalizeTiers(id, input.tiers ?? []);

        return {
            id,
            name,
            type,
            ...(input.description !== undefined && { description: input.description }),
            initialValue,
            minValue,
            maxValue,
            tiers,
        };
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private normalizeTiers(ownerId: string, tiers: ReputationTier[]): ReputationTier[] {
        if (!Array.isArray(tiers)) {
            throw new Error(`Reputation entity "${ownerId}" has invalid tiers.`);
        }

        const seen = new Set<string>();
        for (const tier of tiers) {
            if (!tier.id?.trim()) {
                throw new Error(`Reputation entity "${ownerId}" has a tier with an empty id.`);
            }
            if (!tier.label?.trim()) {
                throw new Error(`Reputation entity "${ownerId}" tier "${tier.id}" has an empty label.`);
            }
            if (!Number.isFinite(tier.threshold)) {
                throw new Error(`Reputation entity "${ownerId}" tier "${tier.id}" has an invalid threshold.`);
            }
            if (seen.has(tier.id)) {
                throw new Error(`Reputation entity "${ownerId}" has duplicate tier id "${tier.id}".`);
            }
            seen.add(tier.id);
        }

        // Sort descending by threshold so the first match wins.
        return [...tiers].sort((a, b) => b.threshold - a.threshold);
    }

    private clamp(entity: ReputationEntity, value: number): number {
        return Math.max(entity.minValue, Math.min(entity.maxValue, value));
    }

    /** Convenience overload when you only have an id. */
    private clampById(id: string, value: number): number {
        const entity = this.entities.get(id);
        if (!entity) return value;
        return this.clamp(entity, value);
    }

    /** Returns tiers sorted descending by threshold so the first match wins. */
    private sortedTiers(entity: ReputationEntity): ReputationTier[] {
        return [...entity.tiers].sort((a, b) => b.threshold - a.threshold);
    }

    /** Resolves the active tier for a given value. */
    private resolveTier(entity: ReputationEntity, value: number): ReputationTier | undefined {
        return this.sortedTiers(entity).find((t) => value >= t.threshold);
    }
}
