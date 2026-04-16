import type {
    ReputationEntityInput,
    LoadStrategy
} from "./manager.js";
import { ReputationManager } from "./manager.js";

// ---------------------------------------------------------------------------
// Load-specific types
// ---------------------------------------------------------------------------

export interface ReputationConfig {
    /**
     * Reputation entities to load into the registry.
     */
    entries: ReputationEntityInput[];

    /**
     * IDs of registered entities to remove before applying `entries`.
     * Ignored when `loadStrategy` is "replace" (a replace already clears everything).
     */
    removeEntries?: string[];

    /**
     * Optional map of entityId → starting value.
     * Applied after entities are loaded, overriding each entity's own initialValue.
     */
    initialValues?: Record<string, number>;

    /**
     * Strategy to use when loading entities.
     * - "replace": clears all existing entities first
     * - "merge":   upserts, overwriting duplicates
     * - "error":   throws on any duplicate (default)
     */
    loadStrategy?: LoadStrategy;
}

export interface LoadOptions {
    strategy?: LoadStrategy;
}

// ---------------------------------------------------------------------------
// ReputationLoader
// ---------------------------------------------------------------------------

/**
 * Wraps a {@link ReputationManager} with JSON/file loading APIs.
 *
 * Use this when you want to hydrate a manager from config files or JSON strings
 * without embedding that I/O logic inside the manager itself.
 *
 * @example
 * ```ts
 * const manager = new ReputationManager();
 * const loader  = new ReputationLoader(manager);
 *
 * await loader.loadConfigFromFile("./data/reputation.json");
 * ```
 */
export class ReputationLoader {
    constructor(private readonly manager: ReputationManager) {}

    // ---------------------------------------------------------------------------
    // Object-based loading
    // ---------------------------------------------------------------------------

    /**
     * Load an array of entities or a full config object into the manager.
     *
     * When passing an array the `options.strategy` controls behaviour (default: "error").
     * When passing a {@link ReputationConfig} object the config's own `loadStrategy` takes
     * precedence — use {@link loadConfigFromObject} for the full config path.
     */
    public loadFromObject(
        data: ReputationEntityInput[] | ReputationConfig,
        options: LoadOptions = {}
    ): void {
        const strategy: LoadStrategy = options.strategy ?? "error";
        const entries = Array.isArray(data) ? data : data.entries;

        if (!Array.isArray(entries)) {
            throw new Error("Invalid reputation config: expected an array of entries.");
        }

        this.manager.loadEntries(entries, strategy);
    }

    /**
     * Apply a full {@link ReputationConfig} object — handles `removeEntries`,
     * `loadStrategy`, and `initialValues` in one call.
     */
    public loadConfigFromObject(config: ReputationConfig): void {
        if (!config || typeof config !== "object" || Array.isArray(config)) {
            throw new Error("loadConfigFromObject expects a ReputationConfig object.");
        }

        const strategy: LoadStrategy = config.loadStrategy ?? "error";

        // Remove named entities first (no-op under "replace" since clearEntities fires anyway).
        if (config.removeEntries?.length && strategy !== "replace") {
            for (const id of config.removeEntries) {
                this.manager.removeEntity(id);
            }
        }

        this.manager.loadEntries(config.entries, strategy);

        // Apply explicit initial values after loading.
        if (config.initialValues) {
            for (const [id, value] of Object.entries(config.initialValues)) {
                if (this.manager.hasEntity(id)) {
                    this.manager.set(id, value);
                }
            }
        }
    }

    // ---------------------------------------------------------------------------
    // JSON string loading
    // ---------------------------------------------------------------------------

    /**
     * Parse a JSON string as an entity array or config and load it.
     */
    public loadFromJson(json: string, options: LoadOptions = {}): void {
        let parsed: unknown;

        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new Error(
                `Failed to parse reputation JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        this.loadFromObject(
            parsed as ReputationEntityInput[] | ReputationConfig,
            options
        );
    }

    /**
     * Parse a JSON string as a {@link ReputationConfig} and apply it via
     * {@link loadConfigFromObject}.
     */
    public loadConfigFromJson(json: string): void {
        let parsed: unknown;

        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new Error(
                `Failed to parse reputation config JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(
                'Reputation config JSON must be an object with at least an "entries" array.'
            );
        }

        this.loadConfigFromObject(parsed as ReputationConfig);
    }

    // ---------------------------------------------------------------------------
    // File loading
    // ---------------------------------------------------------------------------

    /**
     * Read a JSON file from disk and load it as an entity array or config.
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
     * Read a JSON file from disk and apply it as a full {@link ReputationConfig}.
     *
     * **Note:** `node:fs` is imported lazily so that browser or non-Node
     * consumers can use the rest of the loader without a bundler error.
     *
     * Example file (`reputation.json`):
     * ```json
     * {
     *   "loadStrategy": "merge",
     *   "initialValues": { "silverhand": 100 },
     *   "removeEntries": ["old_faction"],
     *   "entries": [
     *     {
     *       "id": "silverhand",
     *       "name": "Order of the Silver Hand",
     *       "type": "faction",
     *       "tiers": [
     *         { "id": "exalted", "label": "Exalted", "threshold": 750 },
     *         { "id": "honored", "label": "Honored", "threshold": 300 },
     *         { "id": "neutral", "label": "Neutral", "threshold": -299 },
     *         { "id": "hated",   "label": "Hated",   "threshold": -1000 }
     *       ]
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
