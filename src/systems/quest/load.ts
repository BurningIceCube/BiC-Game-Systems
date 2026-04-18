import type {
    Quest,
    QuestSnapshot,
    LoadStrategy
} from "./manager.js";
import { QuestManager } from "./manager.js";

// ---------------------------------------------------------------------------
// Load-specific types
// ---------------------------------------------------------------------------

export type { Quest, QuestSnapshot };

export interface QuestConfig {
    quests: Quest[];
    removeQuests?: string[];
    loadStrategy?: LoadStrategy;
}

export interface LoadOptions {
    strategy?: LoadStrategy;
}

// ---------------------------------------------------------------------------
// QuestLoader
// ---------------------------------------------------------------------------

/**
 * Wraps a {@link QuestManager} with JSON/file loading APIs.
 *
 * Use this when you want to hydrate a manager from config files or JSON strings
 * without embedding that I/O logic inside the manager itself.
 *
 * @example
 * ```ts
 * const manager = new QuestManager();
 * const loader  = new QuestLoader(manager);
 *
 * await loader.loadConfigFromFile("./data/quests.json");
 * ```
 */
export class QuestLoader {
    constructor(private readonly manager: QuestManager) {}

    // ---------------------------------------------------------------------------
    // Object-based loading — quest definitions
    // ---------------------------------------------------------------------------

    /**
     * Load quest definitions from a raw array or a QuestConfig wrapper.
     *
     * When passing an array the `options.strategy` controls behaviour (default: "error").
     * When passing a {@link QuestConfig} object the config's own `loadStrategy` takes
     * precedence — use {@link loadConfigFromObject} for the full config path.
     */
    public loadFromObject(
        data: Quest[] | QuestConfig,
        options: LoadOptions = {}
    ): void {
        const strategy: LoadStrategy = options.strategy ?? "error";
        const quests = Array.isArray(data) ? data : data.quests;

        if (!Array.isArray(quests)) {
            throw new Error("Invalid quest config: expected an array of quests.");
        }

        this.manager.loadEntries(quests, strategy);
    }

    /**
     * Apply a full {@link QuestConfig} object — handles `removeQuests`,
     * `loadStrategy` in one call.
     */
    public loadConfigFromObject(config: QuestConfig): void {
        if (!config || typeof config !== "object" || Array.isArray(config)) {
            throw new Error("loadConfigFromObject expects a QuestConfig object.");
        }

        const strategy: LoadStrategy = config.loadStrategy ?? "error";

        // Remove named quests first (no-op under "replace" since clearQuests fires anyway).
        if (config.removeQuests?.length && strategy !== "replace") {
            for (const id of config.removeQuests) {
                this.manager.removeQuest(id);
            }
        }

        this.manager.loadEntries(config.quests, strategy);
    }

    // ---------------------------------------------------------------------------
    // JSON string loading
    // ---------------------------------------------------------------------------

    /**
     * Parse a JSON string as a quest array or config and load it.
     */
    public loadFromJson(json: string, options: LoadOptions = {}): void {
        let parsed: unknown;

        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new Error(
                `Failed to parse quest JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        this.loadFromObject(parsed as Quest[] | QuestConfig, options);
    }

    /**
     * Parse a JSON string as a {@link QuestConfig} and apply it via
     * {@link loadConfigFromObject}.
     */
    public loadConfigFromJson(json: string): void {
        let parsed: unknown;

        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new Error(
                `Failed to parse quest config JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(
                'Quest config JSON must be an object with at least a "quests" array.'
            );
        }

        this.loadConfigFromObject(parsed as QuestConfig);
    }

    // ---------------------------------------------------------------------------
    // File loading
    // ---------------------------------------------------------------------------

    /**
     * Read a JSON file from disk and load it as a quest array or config.
     *
     * **Note:** `node:fs` is imported lazily so that browser or non-Node
     * consumers can use the rest of the loader without a bundler error.
     */
    public async loadFromFile(filePath: string, options: LoadOptions = {}): Promise<void> {
        const { promises: fs } = await import("node:fs");
        const contents = await fs.readFile(filePath, "utf8");
        this.loadFromJson(contents, options);
    }

    /**
     * Read a JSON file from disk and apply it as a full {@link QuestConfig}.
     *
     * **Note:** `node:fs` is imported lazily so that browser or non-Node
     * consumers can use the rest of the loader without a bundler error.
     *
     * Example file (`quests.json`):
     * ```json
     * {
     *   "loadStrategy": "merge",
     *   "removeQuests": ["old_quest"],
     *   "quests": [
     *     {
     *       "id": "slay_the_dragon",
     *       "title": "Slay the Dragon",
     *       "description": "Defeat the ancient dragon.",
     *       "objectives": [
     *         { "id": "kill_dragon", "type": "kill", "description": "Kill the dragon", "target": "dragon", "required": 1 }
     *       ],
     *       "rewards": { "xp": 500 }
     *     }
     *   ]
     * }
     * ```
     */
    public async loadConfigFromFile(filePath: string): Promise<void> {
        const { promises: fs } = await import("node:fs");
        const contents = await fs.readFile(filePath, "utf8");
        this.loadConfigFromJson(contents);
    }
}
