import type {
    WeatherEntryInput,
    WeatherContext,
    LoadStrategy
} from "./manager.js";
import { WeatherManager } from "./manager.js";

// ---------------------------------------------------------------------------
// Load-specific types
// ---------------------------------------------------------------------------

export interface WeatherConfig<TData = unknown> {
    /**
     * Weather entries to load into the registry.
     */
    entries: WeatherEntryInput<TData>[];

    /**
     * Names of registered entries to remove before applying `entries`.
     * Ignored when `loadStrategy` is "replace" (a replace already clears everything).
     */
    removeEntries?: string[];

    /**
     * Name of a registered entry to set as the initial current weather
     * after entries are loaded.
     */
    initialWeather?: string;

    /**
     * Strategy to use when loading entries.
     * - "replace": clears all existing entries first
     * - "merge":   upserts, overwriting duplicates
     * - "error":   throws on any duplicate (default)
     */
    loadStrategy?: LoadStrategy;
}

export interface LoadOptions {
    strategy?: LoadStrategy;
}

// ---------------------------------------------------------------------------
// WeatherLoader
// ---------------------------------------------------------------------------

/**
 * Wraps a {@link WeatherManager} with JSON/file loading APIs.
 *
 * Use this when you want to hydrate a manager from config files or JSON strings
 * without embedding that I/O logic inside the manager itself.
 *
 * @example
 * ```ts
 * const manager = new WeatherManager({ random: seededRng });
 * const loader  = new WeatherLoader(manager);
 *
 * await loader.loadConfigFromFile("./data/weather.json");
 * ```
 */
export class WeatherLoader<
    TData = unknown,
    TContext extends WeatherContext = WeatherContext
> {
    constructor(private readonly manager: WeatherManager<TData, TContext>) {}

    // ---------------------------------------------------------------------------
    // Object-based loading
    // ---------------------------------------------------------------------------

    /**
     * Load an array of entries or a full config object into the manager.
     *
     * When passing an array the `options.strategy` controls behaviour (default: "error").
     * When passing a {@link WeatherConfig} object the config's own `loadStrategy` takes
     * precedence — use {@link loadConfigFromObject} for the full config path.
     */
    public loadFromObject(
        data: WeatherEntryInput<TData>[] | WeatherConfig<TData>,
        options: LoadOptions = {}
    ): void {
        const strategy: LoadStrategy = options.strategy ?? "error";
        const entries = Array.isArray(data) ? data : data.entries;

        if (!Array.isArray(entries)) {
            throw new Error("Invalid weather config: expected an array of entries.");
        }

        this.manager.loadEntries(entries, strategy);
    }

    /**
     * Apply a full {@link WeatherConfig} object — handles `removeEntries`,
     * `loadStrategy`, and `initialWeather` in one call.
     */
    public loadConfigFromObject(config: WeatherConfig<TData>): void {
        if (!config || typeof config !== "object" || Array.isArray(config)) {
            throw new Error("loadConfigFromObject expects a WeatherConfig object.");
        }

        const strategy: LoadStrategy = config.loadStrategy ?? "error";

        // Remove named entries first (no-op under "replace" since clearEntries fires anyway).
        if (config.removeEntries?.length && strategy !== "replace") {
            for (const name of config.removeEntries) {
                this.manager.removeWeatherEntry(name);
            }
        }

        this.manager.loadEntries(config.entries, strategy);

        if (config.initialWeather) {
            this.manager.setCurrent(config.initialWeather);
        }
    }

    // ---------------------------------------------------------------------------
    // JSON string loading
    // ---------------------------------------------------------------------------

    /**
     * Parse a JSON string as an entry array or config and load it.
     */
    public loadFromJson(json: string, options: LoadOptions = {}): void {
        let parsed: unknown;

        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new Error(
                `Failed to parse weather JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        this.loadFromObject(
            parsed as WeatherEntryInput<TData>[] | WeatherConfig<TData>,
            options
        );
    }

    /**
     * Parse a JSON string as a {@link WeatherConfig} and apply it via
     * {@link loadConfigFromObject}.
     */
    public loadConfigFromJson(json: string): void {
        let parsed: unknown;

        try {
            parsed = JSON.parse(json);
        } catch (error) {
            throw new Error(
                `Failed to parse weather config JSON: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(
                'Weather config JSON must be an object with at least an "entries" array.'
            );
        }

        this.loadConfigFromObject(parsed as WeatherConfig<TData>);
    }

    // ---------------------------------------------------------------------------
    // File loading
    // ---------------------------------------------------------------------------

    /**
     * Read a JSON file from disk and load it as an entry array or config.
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
     * Read a JSON file from disk and apply it as a full {@link WeatherConfig}.
     *
     * Example file (`weatherConfig.json`):
     * ```json
     * {
     *   "loadStrategy": "merge",
     *   "initialWeather": "sunny",
     *   "removeEntries": ["old_weather"],
     *   "entries": [
     *     { "name": "sunny",  "tags": ["clear"],   "weight": 5 },
     *     { "name": "cloudy", "tags": ["overcast"], "weight": 3 },
     *     { "name": "rainy",  "tags": ["wet"],      "weight": 2,
     *       "transitions": { "sunny": 1, "cloudy": 4 } }
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
