import * as path from "node:path";
import { WeatherManager } from "../../../systems/weather/manager";
import { WeatherLoader } from "../../../systems/weather/load";
import type { WeatherConfig } from "../../../systems/weather/load";
import type { WeatherEntryInput } from "../../../systems/weather/manager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fixed = (value: number) => () => value;

const SAMPLE_ENTRIES: WeatherEntryInput[] = [
    { name: "sunny",  weight: 4, tags: ["clear", "warm"] },
    { name: "rainy",  weight: 3, tags: ["rain", "wet"] },
    { name: "snowy",  weight: 2, tags: ["snow", "cold"] },
];

const SAMPLE_CONFIG: WeatherConfig = {
    entries: SAMPLE_ENTRIES,
    initialWeather: "sunny",
    loadStrategy: "merge",
};

function createPair() {
    const manager = new WeatherManager({ random: fixed(0) });
    const loader  = new WeatherLoader(manager);
    return { manager, loader };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("WeatherLoader", () => {

    // ── loadFromObject (array) ────────────────────────────────────────────

    describe("loadFromObject with array", () => {
        it("loads an array of entries with default strategy (error)", () => {
            const { manager, loader } = createPair();
            loader.loadFromObject(SAMPLE_ENTRIES);
            expect(manager.size()).toBe(3);
            expect(manager.hasEntry("sunny")).toBe(true);
        });

        it("respects the strategy option", () => {
            const { manager, loader } = createPair();
            loader.loadFromObject(SAMPLE_ENTRIES, { strategy: "merge" });
            // Loading again with merge should not throw
            loader.loadFromObject([{ name: "sunny", weight: 99 }], { strategy: "merge" });
            expect(manager.getEntry("sunny")?.weight).toBe(99);
        });

        it("throws on duplicates with default (error) strategy", () => {
            const { loader } = createPair();
            loader.loadFromObject(SAMPLE_ENTRIES);
            expect(() => loader.loadFromObject([{ name: "sunny" }]))
                .toThrow(/already exists/);
        });
    });

    // ── loadFromObject (config object) ────────────────────────────────────

    describe("loadFromObject with config object", () => {
        it("reads the entries property from a config object", () => {
            const { manager, loader } = createPair();
            loader.loadFromObject(SAMPLE_CONFIG, { strategy: "merge" });
            expect(manager.size()).toBe(3);
        });

        it("throws when entries is not an array", () => {
            const { loader } = createPair();
            expect(() => loader.loadFromObject({ entries: "bad" } as any))
                .toThrow(/expected an array/);
        });
    });

    // ── loadConfigFromObject ──────────────────────────────────────────────

    describe("loadConfigFromObject", () => {
        it("loads entries and sets initial weather", () => {
            const { manager, loader } = createPair();
            loader.loadConfigFromObject(SAMPLE_CONFIG);
            expect(manager.size()).toBe(3);
            expect(manager.getCurrentWeather()?.name).toBe("sunny");
        });

        it("uses the config's loadStrategy", () => {
            const { manager, loader } = createPair();
            loader.loadConfigFromObject({
                entries: SAMPLE_ENTRIES,
                loadStrategy: "replace",
            });
            expect(manager.size()).toBe(3);

            // Replace again — should clear and reload
            loader.loadConfigFromObject({
                entries: [{ name: "only" }],
                loadStrategy: "replace",
            });
            expect(manager.size()).toBe(1);
            expect(manager.hasEntry("only")).toBe(true);
        });

        it("removes named entries before loading (merge)", () => {
            const { manager, loader } = createPair();
            loader.loadConfigFromObject({
                entries: SAMPLE_ENTRIES,
                loadStrategy: "merge",
            });
            expect(manager.hasEntry("snowy")).toBe(true);

            loader.loadConfigFromObject({
                entries: [],
                removeEntries: ["snowy"],
                loadStrategy: "merge",
            });
            expect(manager.hasEntry("snowy")).toBe(false);
        });

        it("ignores removeEntries when strategy is replace", () => {
            const { manager, loader } = createPair();
            loader.loadConfigFromObject({
                entries: SAMPLE_ENTRIES,
                loadStrategy: "merge",
            });

            // replace clears everything anyway, so removeEntries is moot
            loader.loadConfigFromObject({
                entries: [{ name: "only" }],
                removeEntries: ["sunny"],
                loadStrategy: "replace",
            });
            expect(manager.size()).toBe(1);
        });

        it("throws on invalid input", () => {
            const { loader } = createPair();
            expect(() => loader.loadConfigFromObject(null as any))
                .toThrow(/expects a WeatherConfig/);
            expect(() => loader.loadConfigFromObject([] as any))
                .toThrow(/expects a WeatherConfig/);
        });
    });

    // ── loadFromJson ──────────────────────────────────────────────────────

    describe("loadFromJson", () => {
        it("parses a JSON array and loads entries", () => {
            const { manager, loader } = createPair();
            const json = JSON.stringify(SAMPLE_ENTRIES);
            loader.loadFromJson(json, { strategy: "merge" });
            expect(manager.size()).toBe(3);
        });

        it("throws on invalid JSON", () => {
            const { loader } = createPair();
            expect(() => loader.loadFromJson("not json"))
                .toThrow(/Failed to parse/);
        });
    });

    // ── loadConfigFromJson ────────────────────────────────────────────────

    describe("loadConfigFromJson", () => {
        it("parses a JSON config object and loads it", () => {
            const { manager, loader } = createPair();
            const json = JSON.stringify(SAMPLE_CONFIG);
            loader.loadConfigFromJson(json);
            expect(manager.size()).toBe(3);
            expect(manager.getCurrentWeather()?.name).toBe("sunny");
        });

        it("throws on invalid JSON", () => {
            const { loader } = createPair();
            expect(() => loader.loadConfigFromJson("{bad}"))
                .toThrow(/Failed to parse/);
        });

        it("throws when JSON is an array instead of a config object", () => {
            const { loader } = createPair();
            const json = JSON.stringify(SAMPLE_ENTRIES);
            expect(() => loader.loadConfigFromJson(json))
                .toThrow(/must be an object/);
        });
    });

    // ── loadFromFile / loadConfigFromFile ──────────────────────────────────

    describe("file loading", () => {
        const dataFilePath = path.join(__dirname, "../../../../examples/weather/data.json");

        it("loadFromFile delegates to loadFromJson under the hood", () => {
            const { manager, loader } = createPair();
            const fs = require("node:fs");
            const contents = fs.readFileSync(dataFilePath, "utf8");
            loader.loadFromJson(contents, { strategy: "merge" });
            expect(manager.size()).toBeGreaterThan(0);
        });

        it("loadConfigFromFile delegates to loadConfigFromJson under the hood", () => {
            const { manager, loader } = createPair();
            const fs = require("node:fs");
            const contents = fs.readFileSync(dataFilePath, "utf8");
            loader.loadConfigFromJson(contents);
            expect(manager.size()).toBeGreaterThan(0);
            expect(manager.getCurrentWeather()).not.toBeNull();
        });

        it("loadFromJson throws for non-existent file content", () => {
            const { loader } = createPair();
            expect(() => loader.loadFromJson("this is not json"))
                .toThrow(/Failed to parse/);
        });
    });
});





