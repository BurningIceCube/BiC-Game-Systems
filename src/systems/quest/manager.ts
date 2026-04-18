/*

Quest Manager for v3.0.0

Config:
- quests: An array of Quest objects defining available quests with objectives,
  rewards, prerequisites, and optional event-based triggers.

Functionality:
- startQuest(questId): Begin tracking a quest's objectives.
- updateObjective(questId, objectiveId, amount?): Advance an objective's progress.
- completeQuest(questId): Force-complete a quest and dispatch rewards.
- abandonQuest(questId): Abandon an in-progress quest.
- canStartQuest(questId): Check prerequisites, level requirement, and repeatability.
- getQuest(questId) / getAllQuests(): Read quest state with enriched progress info.
- getActiveQuests() / getCompletedQuests(): Filtered views.
- addQuest(input) / removeQuest(id) / clearQuests(): Quest definition registry.
- loadEntries(quests, strategy): Bulk-load quest definitions with a strategy.
- toSnapshot() / loadSnapshot(): Serialize and restore full state.
- bindEvents(bus): Bridge local events to the shared SystemEvents bus.
- unbindEvents(): Remove all bus listeners.
- dispose(): Tear down the manager completely.

Quest Shape:
{
    id: "slay_the_dragon",
    title: "Slay the Dragon",
    description: "Defeat the ancient dragon terrorizing the village.",
    levelRequired: 10,
    prerequisites: ["find_the_cave"],
    objectives: [
        { id: "kill_dragon", type: "kill", description: "Kill the dragon", target: "dragon", required: 1 }
    ],
    rewards: {
        xp: 500,
        skillPoints: 2,
        actions: [
            { type: "reputation:change", entityId: "villagers", amount: 200 }
        ]
    }
}

*/

import { EventEmitter } from "eventemitter3";
import type { SystemEvents } from "../../events/bus.js";
export type { LoadStrategy } from "../common.js";
import type { LoadStrategy } from "../common.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export interface QuestObjective {
    id: string;
    type: "kill" | "collect" | "talk" | "visit" | "reach_level" | "custom";
    description: string;
    target?: string;
    required: number;
}

/**
 * A cross-system action dispatched as an intent on the shared bus when a quest completes.
 * Each `type` maps to a `SystemEvents` intent key.
 */
export type RewardAction =
    | { type: "intent.inventory.add";        inventoryId: string; itemId: string; quantity?: number }
    | { type: "intent.inventory.remove";     inventoryId: string; itemId: string; quantity?: number }
    | { type: "intent.reputation.change";    entityId: string; amount: number }
    | { type: "intent.reputation.set";       entityId: string; value: number }
    | { type: "intent.weather.set";          weatherName: string }
    | { type: "intent.weather.randomize" }
    | { type: "intent.leveling.awardXp";     amount: number }
    | { type: "intent.leveling.grantPoints"; amount: number }
    | { type: "intent.leveling.unlockSkill"; skillId: string }
    | { type: "intent.leveling.unlockPerk";  perkId: string };

export interface QuestReward {
    xp?: number;
    skillPoints?: number;
    unlockSkills?: string[];
    unlockPerks?: string[];
    /** Cross-system actions dispatched as intents on the shared bus. */
    actions?: RewardAction[];
}

/**
 * Declarative event trigger for auto-starting a quest from JSON.
 * When the named event fires on the shared bus and all `match` pairs are
 * satisfied against the event payload, the quest is started automatically.
 */
export interface QuestTrigger {
    /** The SystemEvents key to listen for. */
    event: string;
    /**
     * Flat key→value pairs that must all match the event payload.
     * Supports dot-notation for nested fields (e.g. "enemy.type": "boss").
     */
    match?: Record<string, string | number | boolean>;
}

export interface Quest {
    id: string;
    title: string;
    description: string;
    levelRequired?: number;
    prerequisites?: string[];
    trigger?: QuestTrigger;
    objectives: QuestObjective[];
    rewards: QuestReward;
    isRepeatable?: boolean;
}

export type QuestStatus = "available" | "in_progress" | "completed" | "locked";

export interface QuestProgress {
    questId: string;
    status: "in_progress" | "completed";
    objectivesProgress: Record<string, number>;
    completedAt?: number;
}

export interface QuestManagerOptions {
    quests?: Quest[];
    /**
     * Callback used by canStartQuest to check a character's level.
     * If not provided, level checks are skipped.
     */
    levelProvider?: () => number;
    /**
     * Maximum number of quest actions to keep in history.
     * Set to 0 to disable history tracking. Default: 50.
     */
    historySize?: number;
}

export interface QuestHistoryEntry {
    questId: string;
    action: string;
    data: Record<string, unknown>;
    timestamp: number;
}

export interface QuestSnapshot {
    quests: Quest[];
    progress: Record<string, QuestProgress>;
    history: QuestHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Local events
// ---------------------------------------------------------------------------

export interface QuestEvents {
    "quest:added": (quest: Quest) => void;
    "quest:removed": (quest: Quest) => void;
    "quest:cleared": (removed: Quest[]) => void;

    "quest:started": (payload: {
        questId: string;
    }) => void;

    "quest:objectiveUpdated": (payload: {
        questId: string;
        objectiveId: string;
        previous: number;
        current: number;
        required: number;
    }) => void;

    "quest:completed": (payload: {
        questId: string;
        rewards: QuestReward;
    }) => void;

    "quest:abandoned": (payload: {
        questId: string;
    }) => void;

    "quest:loaded": (quests: Quest[], strategy: LoadStrategy) => void;
}

// ---------------------------------------------------------------------------
// QuestManager
// ---------------------------------------------------------------------------

/**
 * Manages quest definitions, progress tracking, objective updates, and
 * reward dispatch. Emits typed local events and can bridge to a shared
 * SystemEvents bus.
 */
export class QuestManager {
    public readonly events = new EventEmitter<QuestEvents>();

    private readonly quests = new Map<string, Quest>();
    private readonly progress = new Map<string, QuestProgress>();

    private levelProvider: () => number;

    private readonly historySize: number;
    private readonly history: QuestHistoryEntry[] = [];

    /** Disposer returned by the most recent {@link bindEvents} call, or `null`. */
    private boundBusDisposer: (() => void) | null = null;

    /** Set by bindEvents to allow reward dispatch on the shared bus. */
    private dispatchRewardsOnBus: ((rewards: QuestReward) => void) | null = null;

    constructor(options: QuestManagerOptions = {}) {
        this.historySize = options.historySize ?? 50;
        this.levelProvider = options.levelProvider ?? (() => 1);

        // Automatically track quest actions in a ring buffer.
        if (this.historySize > 0) {
            this.events.on("quest:started", (payload) => {
                this.recordHistory(payload.questId, "started", {});
            });

            this.events.on("quest:objectiveUpdated", (payload) => {
                this.recordHistory(payload.questId, "objectiveUpdated", {
                    objectiveId: payload.objectiveId,
                    previous: payload.previous,
                    current: payload.current,
                    required: payload.required,
                });
            });

            this.events.on("quest:completed", (payload) => {
                this.recordHistory(payload.questId, "completed", { rewards: payload.rewards });
            });

            this.events.on("quest:abandoned", (payload) => {
                this.recordHistory(payload.questId, "abandoned", {});
            });
        }

        if (options.quests?.length) {
            this.loadEntries(options.quests, "merge");
        }
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private recordHistory(questId: string, action: string, data: Record<string, unknown>): void {
        this.history.push({ questId, action, data, timestamp: Date.now() });
        if (this.history.length > this.historySize) {
            this.history.splice(0, this.history.length - this.historySize);
        }
    }

    /**
     * Resolve a dot-notation path against an object.
     * e.g. resolvePath({ enemy: { type: "boss" } }, "enemy.type") → "boss"
     */
    private static resolvePath(obj: unknown, path: string): unknown {
        return path.split(".").reduce((acc: any, key) => acc?.[key], obj);
    }

    /** Returns true when every match entry equals the corresponding payload value. */
    private static matchesPayload(
        payload: unknown,
        match: Record<string, string | number | boolean>
    ): boolean {
        return Object.entries(match).every(
            ([path, expected]) => QuestManager.resolvePath(payload, path) === expected
        );
    }

    // ---------------------------------------------------------------------------
    // Public read APIs
    // ---------------------------------------------------------------------------

    public getQuest(questId: string) {
        const quest = this.quests.get(questId);
        if (!quest) return undefined;
        const prog = this.progress.get(questId);
        return {
            ...quest,
            status: prog?.status ?? (this.canStartQuest(questId) ? "available" as QuestStatus : "locked" as QuestStatus),
            objectivesProgress: prog?.objectivesProgress ?? {},
            completedAt: prog?.completedAt,
            canStart: this.canStartQuest(questId),
        };
    }

    public getAllQuests() {
        return Array.from(this.quests.values()).map((q) => this.getQuest(q.id)!);
    }

    public getActiveQuests(): QuestProgress[] {
        return Array.from(this.progress.values()).filter((p) => p.status === "in_progress");
    }

    public getCompletedQuests(): QuestProgress[] {
        return Array.from(this.progress.values()).filter((p) => p.status === "completed");
    }

    public getQuestDefinition(questId: string): Quest | undefined {
        return this.quests.get(questId);
    }

    public getQuestDefinitions(): Quest[] {
        return Array.from(this.quests.values());
    }

    public hasQuest(questId: string): boolean {
        return this.quests.has(questId);
    }

    public size(): number {
        return this.quests.size;
    }

    /** Returns the full history of quest actions (oldest first). */
    public getHistory(): ReadonlyArray<QuestHistoryEntry> {
        return this.history;
    }

    /** Returns the last `n` history entries (most recent last). */
    public getLastHistory(n: number): QuestHistoryEntry[] {
        if (n <= 0) return [];
        return this.history.slice(-n);
    }

    /** Clears all history entries. */
    public clearHistory(): void {
        this.history.length = 0;
    }

    // ---------------------------------------------------------------------------
    // Public mutation APIs — quest registry
    // ---------------------------------------------------------------------------

    public addQuest(quest: Quest): Quest {
        this.validateQuest(quest);

        if (this.quests.has(quest.id)) {
            throw new Error(`Quest "${quest.id}" already exists.`);
        }
        this.quests.set(quest.id, { ...quest });
        this.events.emit("quest:added", quest);
        return quest;
    }

    public upsertQuest(quest: Quest): Quest {
        this.validateQuest(quest);
        this.quests.set(quest.id, { ...quest });
        return quest;
    }

    public removeQuest(questId: string): boolean {
        const quest = this.quests.get(questId);
        if (!quest) return false;
        this.quests.delete(questId);
        this.progress.delete(questId);
        this.events.emit("quest:removed", quest);
        return true;
    }

    public clearQuests(): void {
        const removed = Array.from(this.quests.values());
        this.quests.clear();
        this.progress.clear();
        this.events.emit("quest:cleared", removed);
    }

    // ---------------------------------------------------------------------------
    // Internal entry loading
    // ---------------------------------------------------------------------------

    /**
     * Bulk-load quest definitions with a given strategy.
     * Called by QuestLoader — not intended for direct use.
     */
    public loadEntries(quests: Quest[], strategy: LoadStrategy): void {
        if (strategy === "replace") {
            this.clearQuests();
            for (const quest of quests) {
                this.addQuest(quest);
            }
        } else if (strategy === "merge") {
            for (const quest of quests) {
                this.upsertQuest(quest);
            }
        } else {
            // "error" — pre-validate for duplicates before mutating
            const ids = new Set<string>();
            for (const quest of quests) {
                this.validateQuest(quest);
                if (!quest.id?.trim()) {
                    throw new Error("Quest id is required.");
                }
                if (ids.has(quest.id)) {
                    throw new Error(`Duplicate quest "${quest.id}" in load payload.`);
                }
                ids.add(quest.id);
                if (this.quests.has(quest.id)) {
                    throw new Error(
                        `Quest "${quest.id}" already exists and strategy is "error".`
                    );
                }
            }
            for (const quest of quests) {
                this.addQuest(quest);
            }
        }

        this.events.emit("quest:loaded", this.getQuestDefinitions(), strategy);
    }

    // ---------------------------------------------------------------------------
    // Public mutation APIs — quest actions
    // ---------------------------------------------------------------------------

    /**
     * Check if a quest can be started.
     * Validates: exists, not already in progress, not completed (unless repeatable),
     * level requirement, and prerequisite completion.
     */
    public canStartQuest(questId: string): boolean {
        const quest = this.quests.get(questId);
        if (!quest) return false;

        const prog = this.progress.get(questId);
        if (prog?.status === "in_progress") return false;
        if (prog?.status === "completed" && !quest.isRepeatable) return false;

        if (quest.levelRequired && this.levelProvider() < quest.levelRequired) return false;

        if (quest.prerequisites) {
            for (const prereqId of quest.prerequisites) {
                if (this.progress.get(prereqId)?.status !== "completed") return false;
            }
        }

        return true;
    }

    /**
     * Start a quest. Returns true on success.
     * Initializes objective progress to 0 for each objective.
     */
    public startQuest(questId: string): boolean {
        const quest = this.quests.get(questId);
        if (!quest || !this.canStartQuest(questId)) return false;

        const prog: QuestProgress = {
            questId,
            status: "in_progress",
            objectivesProgress: {},
        };
        for (const obj of quest.objectives) {
            prog.objectivesProgress[obj.id] = 0;
        }
        this.progress.set(questId, prog);

        this.events.emit("quest:started", { questId });
        return true;
    }

    /**
     * Advance an objective's progress. Auto-completes the quest when all
     * objectives are satisfied.
     */
    public updateObjective(questId: string, objectiveId: string, amount = 1): boolean {
        const prog = this.progress.get(questId);
        if (!prog || prog.status !== "in_progress") return false;

        const quest = this.quests.get(questId);
        if (!quest) return false;

        const objective = quest.objectives.find((o) => o.id === objectiveId);
        if (!objective) return false;

        const previous = prog.objectivesProgress[objectiveId] ?? 0;
        const current = Math.min(previous + amount, objective.required);
        prog.objectivesProgress[objectiveId] = current;

        this.events.emit("quest:objectiveUpdated", {
            questId,
            objectiveId,
            previous,
            current,
            required: objective.required,
        });

        // Auto-complete check
        const allDone = quest.objectives.every(
            (obj) => (prog.objectivesProgress[obj.id] ?? 0) >= obj.required
        );
        if (allDone) {
            this.completeQuest(questId);
        }

        return true;
    }

    /**
     * Complete a quest. Dispatches reward intents on the shared bus (if bound)
     * and emits the local completed event.
     */
    public completeQuest(questId: string): boolean {
        const prog = this.progress.get(questId);
        if (!prog || prog.status === "completed") return false;

        const quest = this.quests.get(questId);
        if (!quest) return false;

        prog.status = "completed";
        prog.completedAt = Date.now();

        // Dispatch reward intents on the shared bus
        this.dispatchRewards(quest.rewards);

        this.events.emit("quest:completed", { questId, rewards: quest.rewards });
        return true;
    }

    /**
     * Abandon an in-progress quest. Removes its progress.
     */
    public abandonQuest(questId: string): boolean {
        const prog = this.progress.get(questId);
        if (!prog || prog.status !== "in_progress") return false;

        this.progress.delete(questId);

        this.events.emit("quest:abandoned", { questId });
        return true;
    }

    /**
     * Replace the level provider callback.
     */
    public setLevelProvider(provider: () => number): void {
        this.levelProvider = provider;
    }

    // ---------------------------------------------------------------------------
    // Reward dispatch
    // ---------------------------------------------------------------------------

    /**
     * Dispatches reward intents on the shared bus. Only works after
     * `bindEvents()` has been called.
     *
     * Built-in reward shortcuts (xp, skillPoints, unlockSkills, unlockPerks)
     * are converted to their matching intents automatically.
     */
    private dispatchRewards(rewards: QuestReward): void {
        this.dispatchRewardsOnBus?.(rewards);
    }

    // ---------------------------------------------------------------------------
    // Normalization & validation
    // ---------------------------------------------------------------------------

    /** @internal */
    public validateQuest(quest: Quest): void {
        if (!quest || typeof quest !== "object") {
            throw new Error("Quest entry must be an object.");
        }
        if (!quest.id || !quest.id.trim()) {
            throw new Error("Quest entry id is required.");
        }
        if (!quest.title || !quest.title.trim()) {
            throw new Error(`Quest "${quest.id}" must have a title.`);
        }
        if (!Array.isArray(quest.objectives) || quest.objectives.length === 0) {
            throw new Error(`Quest "${quest.id}" must have at least one objective.`);
        }
        for (const obj of quest.objectives) {
            if (!obj.id || !obj.id.trim()) {
                throw new Error(`Quest "${quest.id}" has an objective with a missing id.`);
            }
            if (typeof obj.required !== "number" || obj.required < 1) {
                throw new Error(
                    `Quest "${quest.id}" objective "${obj.id}" must have required >= 1.`
                );
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------------

    public toSnapshot(): QuestSnapshot {
        const progressMap: Record<string, QuestProgress> = {};
        for (const [id, prog] of this.progress) {
            progressMap[id] = { ...prog, objectivesProgress: { ...prog.objectivesProgress } };
        }
        return {
            quests: Array.from(this.quests.values()),
            progress: progressMap,
            history: [...this.history],
        };
    }

    public loadSnapshot(snapshot: QuestSnapshot): void {
        this.quests.clear();
        this.progress.clear();

        for (const quest of snapshot.quests) {
            this.quests.set(quest.id, quest);
        }

        for (const [id, prog] of Object.entries(snapshot.progress)) {
            if (!this.quests.has(id)) continue;
            this.progress.set(id, {
                ...prog,
                objectivesProgress: { ...prog.objectivesProgress },
            });
        }

        this.history.length = 0;
        if (snapshot.history) {
            for (const h of snapshot.history) {
                this.history.push(h);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Shared event bus binding
    // ---------------------------------------------------------------------------

    /**
     * Connects this QuestManager to the shared SystemEvents bus.
     *
     * **Inbound** — the bus can control quests:
     * - `intent.quest.start`            → `startQuest(questId)`
     * - `intent.quest.updateObjective`  → `updateObjective(questId, objectiveId, amount)`
     * - `intent.quest.complete`         → `completeQuest(questId)`
     * - `intent.quest.abandon`          → `abandonQuest(questId)`
     *
     * **Outbound** — local events are forwarded as facts on the bus.
     *
     * **Triggers** — quest trigger listeners are wired to the bus so quests
     * can auto-start when matching events fire.
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

        // ── Reward dispatch closure ───────────────────────────────────────────
        this.dispatchRewardsOnBus = (rewards: QuestReward) => {
            if (rewards.xp) {
                bus.emit("intent.leveling.awardXp", { amount: rewards.xp });
            }
            if (rewards.skillPoints) {
                bus.emit("intent.leveling.grantPoints", { amount: rewards.skillPoints });
            }
            if (rewards.unlockSkills) {
                for (const skillId of rewards.unlockSkills) {
                    bus.emit("intent.leveling.unlockSkill", { skillId });
                }
            }
            if (rewards.unlockPerks) {
                for (const perkId of rewards.unlockPerks) {
                    bus.emit("intent.leveling.unlockPerk", { perkId });
                }
            }
            if (rewards.actions) {
                for (const action of rewards.actions) {
                    const { type, ...payload } = action as any;
                    bus.emit(type, payload);
                }
            }
        };

        // ── Inbound ───────────────────────────────────────────────────────────
        const onStart = ({ questId }: { questId: string }) => {
            this.startQuest(questId);
        };

        const onUpdateObjective = ({ questId, objectiveId, amount }: { questId: string; objectiveId: string; amount?: number }) => {
            this.updateObjective(questId, objectiveId, amount);
        };

        const onComplete = ({ questId }: { questId: string }) => {
            this.completeQuest(questId);
        };

        const onAbandon = ({ questId }: { questId: string }) => {
            this.abandonQuest(questId);
        };

        bus.on("intent.quest.start", onStart);
        bus.on("intent.quest.updateObjective", onUpdateObjective);
        bus.on("intent.quest.complete", onComplete);
        bus.on("intent.quest.abandon", onAbandon);

        // ── Outbound bridge ───────────────────────────────────────────────────
        const onStarted = (payload: { questId: string }) => {
            bus.emit("fact.quest.started", payload);
        };

        const onObjectiveUpdated = (payload: {
            questId: string;
            objectiveId: string;
            previous: number;
            current: number;
            required: number;
        }) => {
            bus.emit("fact.quest.objectiveUpdated", payload);
        };

        const onCompleted = (payload: { questId: string; rewards: QuestReward }) => {
            bus.emit("fact.quest.completed", payload);
        };

        const onAbandoned = (payload: { questId: string }) => {
            bus.emit("fact.quest.abandoned", payload);
        };

        const onLoaded = (quests: Quest[], strategy: LoadStrategy) => {
            bus.emit("fact.quest.loaded", {
                count: quests.length,
                strategy,
            });
        };

        this.events.on("quest:started", onStarted);
        this.events.on("quest:objectiveUpdated", onObjectiveUpdated);
        this.events.on("quest:completed", onCompleted);
        this.events.on("quest:abandoned", onAbandoned);
        this.events.on("quest:loaded", onLoaded);

        // ── Trigger listeners ─────────────────────────────────────────────────
        const cleanupTriggers = this.wireTriggers(bus);

        // ── Disposer ──────────────────────────────────────────────────────────
        const dispose = () => {
            bus.off("intent.quest.start", onStart);
            bus.off("intent.quest.updateObjective", onUpdateObjective);
            bus.off("intent.quest.complete", onComplete);
            bus.off("intent.quest.abandon", onAbandon);

            this.events.off("quest:started", onStarted);
            this.events.off("quest:objectiveUpdated", onObjectiveUpdated);
            this.events.off("quest:completed", onCompleted);
            this.events.off("quest:abandoned", onAbandoned);
            this.events.off("quest:loaded", onLoaded);

            cleanupTriggers();

            this.dispatchRewardsOnBus = null;
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
     * listeners, clears quests, progress, and history. Safe to call multiple times.
     *
     * After calling `dispose()`, the manager should not be reused.
     */
    public dispose(): void {
        this.unbindEvents();
        this.events.removeAllListeners();
        this.quests.clear();
        this.progress.clear();
        this.history.length = 0;
    }

    // ---------------------------------------------------------------------------
    // Trigger wiring
    // ---------------------------------------------------------------------------

    /**
     * Wire declarative `trigger` entries from quest definitions to the shared bus.
     * Groups quests by trigger event so we only register one listener per event name.
     *
     * @returns A cleanup function that removes all trigger listeners.
     */
    private wireTriggers(bus: EventEmitter<SystemEvents>): () => void {
        const byEvent = new Map<string, Quest[]>();

        for (const quest of this.quests.values()) {
            if (!quest.trigger) continue;
            const list = byEvent.get(quest.trigger.event) ?? [];
            list.push(quest);
            byEvent.set(quest.trigger.event, list);
        }

        const cleanups: Array<() => void> = [];

        for (const [eventName, quests] of byEvent) {
            const handler = (payload: unknown) => {
                for (const quest of quests) {
                    const trigger = quest.trigger!;
                    const matchOk =
                        !trigger.match || QuestManager.matchesPayload(payload, trigger.match);
                    if (matchOk && this.canStartQuest(quest.id)) {
                        this.startQuest(quest.id);
                    }
                }
            };
            (bus as EventEmitter<any>).on(eventName, handler);
            cleanups.push(() => (bus as EventEmitter<any>).off(eventName, handler));
        }

        return () => {
            for (const cleanup of cleanups) cleanup();
        };
    }
}

