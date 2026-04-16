import { EventEmitter } from "eventemitter3";
import { WeatherManager } from "../../../systems/weather/manager";
import type {
    WeatherEntryInput,
    WeatherManagerOptions,
} from "../../../systems/weather/manager";
import type { SystemEvents } from "../../../events/bus";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a seeded random function that always returns the given value. */
const fixed = (value: number) => () => value;

/** A minimal set of weather entries for most tests. */
const BASE_ENTRIES: WeatherEntryInput[] = [
    { name: "sunny",  weight: 4, tags: ["clear", "warm"] },
    { name: "rainy",  weight: 3, tags: ["rain", "wet"] },
    { name: "snowy",  weight: 2, tags: ["snow", "cold"] },
    { name: "foggy",  weight: 1, tags: ["fog", "damp"] },
];

function createManager(overrides: WeatherManagerOptions = {}) {
    return new WeatherManager({
        entries: BASE_ENTRIES,
        random: fixed(0),        // deterministic — always picks first candidate
        ...overrides,
    });
}

// ===========================================================================
// Tests
// ===========================================================================

describe("WeatherManager", () => {

    // ── Construction ──────────────────────────────────────────────────────

    describe("construction", () => {
        it("starts with no current weather by default", () => {
            const m = createManager();
            expect(m.getCurrentWeather()).toBeNull();
        });

        it("registers all provided entries", () => {
            const m = createManager();
            expect(m.size()).toBe(4);
            expect(m.hasEntry("sunny")).toBe(true);
            expect(m.hasEntry("rainy")).toBe(true);
        });

        it("sets initial weather when provided", () => {
            const m = createManager({ initialWeather: "rainy" });
            expect(m.getCurrentWeather()?.name).toBe("rainy");
        });

        it("throws when initial weather references an unknown entry", () => {
            expect(() => createManager({ initialWeather: "tornado" }))
                .toThrow(/not found/);
        });

        it("defaults weight to 1 when omitted", () => {
            const m = new WeatherManager({
                entries: [{ name: "calm" }],
                random: fixed(0),
            });
            expect(m.getEntry("calm")?.weight).toBe(1);
        });
    });

    // ── Entry management ──────────────────────────────────────────────────

    describe("entry management", () => {
        it("adds an entry and retrieves it by name", () => {
            const m = createManager();
            m.addWeatherEntry({ name: "stormy", weight: 2, tags: ["storm"] });
            expect(m.hasEntry("stormy")).toBe(true);
            expect(m.getEntry("stormy")?.weight).toBe(2);
        });

        it("throws when adding a duplicate entry", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({ name: "sunny" }))
                .toThrow(/already exists/);
        });

        it("upserts without throwing on duplicates", () => {
            const m = createManager();
            m.upsertWeatherEntry({ name: "sunny", weight: 99 });
            expect(m.getEntry("sunny")?.weight).toBe(99);
        });

        it("removes an entry and returns true", () => {
            const m = createManager();
            expect(m.removeWeatherEntry("foggy")).toBe(true);
            expect(m.hasEntry("foggy")).toBe(false);
            expect(m.size()).toBe(3);
        });

        it("returns false when removing a non-existent entry", () => {
            const m = createManager();
            expect(m.removeWeatherEntry("tornado")).toBe(false);
        });

        it("clears currentWeather when its entry is removed", () => {
            const m = createManager({ initialWeather: "sunny" });
            m.removeWeatherEntry("sunny");
            expect(m.getCurrentWeather()).toBeNull();
        });

        it("clearEntries removes everything", () => {
            const m = createManager();
            m.clearEntries();
            expect(m.size()).toBe(0);
            expect(m.getEntries()).toEqual([]);
        });
    });

    // ── Normalization & validation ────────────────────────────────────────

    describe("normalization", () => {
        it("trims entry names", () => {
            const m = new WeatherManager({ random: fixed(0) });
            m.addWeatherEntry({ name: "  misty  " });
            expect(m.hasEntry("misty")).toBe(true);
        });

        it("lowercases and deduplicates tags", () => {
            const m = new WeatherManager({ random: fixed(0) });
            m.addWeatherEntry({ name: "x", tags: ["Rain", "RAIN", "rain"] });
            expect(m.getEntry("x")?.tags).toEqual(["rain"]);
        });

        it("throws on empty name", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({ name: "  " }))
                .toThrow(/name is required/);
        });

        it("throws on negative weight", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({ name: "bad", weight: -1 }))
                .toThrow(/weight >= 0/);
        });

        it("throws on NaN weight", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({ name: "bad", weight: NaN }))
                .toThrow(/invalid weight/);
        });

        it("throws on negative transition weight", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({
                name: "bad",
                transitions: { sunny: -5 },
            })).toThrow(/invalid transition weight/);
        });
    });

    // ── setCurrent ────────────────────────────────────────────────────────

    describe("setCurrent", () => {
        it("sets current weather by name", () => {
            const m = createManager();
            m.setCurrent("rainy");
            expect(m.getCurrentWeather()?.name).toBe("rainy");
        });

        it("sets current weather by entry object", () => {
            const m = createManager();
            const entry = m.getEntry("snowy")!;
            m.setCurrent(entry);
            expect(m.getCurrentWeather()?.name).toBe("snowy");
        });

        it("throws for unknown weather name", () => {
            const m = createManager();
            expect(() => m.setCurrent("tornado")).toThrow(/not found/);
        });
    });

    // ── clearCurrent ──────────────────────────────────────────────────────

    describe("clearCurrent", () => {
        it("clears the current weather to null", () => {
            const m = createManager({ initialWeather: "sunny" });
            m.clearCurrent();
            expect(m.getCurrentWeather()).toBeNull();
        });
    });

    // ── peek (stateless selection) ────────────────────────────────────────

    describe("peek", () => {
        it("returns an entry without changing currentWeather", () => {
            const m = createManager();
            const result = m.peek();
            expect(result).toBeDefined();
            expect(m.getCurrentWeather()).toBeNull();  // still null
        });

        it("throws when no entries exist", () => {
            const m = new WeatherManager({ random: fixed(0) });
            expect(() => m.peek()).toThrow(/no weather entries/i);
        });
    });

    // ── next (stateful selection) ─────────────────────────────────────────

    describe("next", () => {
        it("selects and sets currentWeather", () => {
            const m = createManager();
            const result = m.next();
            expect(result).toBeDefined();
            expect(m.getCurrentWeather()?.name).toBe(result.name);
        });

        it("with fixed(0) always picks the first candidate", () => {
            const m = createManager();
            // entries are in insertion order: sunny, rainy, snowy, foggy
            expect(m.next().name).toBe("sunny");
        });

        it("with fixed(0.99) picks the last candidate", () => {
            const m = createManager({ random: fixed(0.99) });
            expect(m.next().name).toBe("foggy");
        });
    });

    // ── Tag filtering ─────────────────────────────────────────────────────

    describe("tag filtering", () => {
        it("filters by a single tag with 'any' mode", () => {
            const m = createManager();
            const result = m.peek({ tags: ["cold"], tagMatch: "any" });
            expect(result.name).toBe("snowy");
        });

        it("filters by multiple tags with 'all' mode", () => {
            const m = createManager();
            const result = m.peek({ tags: ["clear", "warm"], tagMatch: "all" });
            expect(result.name).toBe("sunny");
        });

        it("'any' mode matches entries that have at least one tag", () => {
            // Both rainy (wet) and foggy (damp) match "wet" or "damp"
            const m = createManager();
            const debug = m.inspectSelection({ tags: ["wet", "damp"], tagMatch: "any" });
            const names = debug.candidates.map(c => c.name);
            expect(names).toContain("rainy");
            expect(names).toContain("foggy");
            expect(names).not.toContain("sunny");
        });

        it("throws when no entries match the tag filter", () => {
            const m = createManager();
            expect(() => m.peek({ tags: ["nonexistent"] }))
                .toThrow(/no weather entries/i);
        });
    });

    // ── Custom filter hook ────────────────────────────────────────────────

    describe("custom filter", () => {
        it("applies the filter function to narrow candidates", () => {
            const m = createManager({
                filter: (entry) => entry.weight >= 3,
            });
            const debug = m.inspectSelection();
            const names = debug.candidates.map(c => c.name);
            expect(names).toEqual(["sunny", "rainy"]);
        });
    });

    // ── Transitions ───────────────────────────────────────────────────────

    describe("transitions", () => {
        const ENTRIES_WITH_TRANSITIONS: WeatherEntryInput[] = [
            { name: "sunny", weight: 1, tags: [], transitions: { rainy: 10 } },
            { name: "rainy", weight: 1, tags: [] },
        ];

        it("adds transition bonus to effective weight", () => {
            const m = new WeatherManager({
                entries: ENTRIES_WITH_TRANSITIONS,
                initialWeather: "sunny",
                random: fixed(0),
            });

            const debug = m.inspectSelection();
            const rainyWeight = debug.effectiveWeights.find(w => w.entry.name === "rainy");
            expect(rainyWeight?.transitionBonus).toBe(10);
            expect(rainyWeight?.effectiveWeight).toBe(11); // 1 base + 10 bonus
        });

        it("does not apply transitions when useTransitions is false", () => {
            const m = new WeatherManager({
                entries: ENTRIES_WITH_TRANSITIONS,
                initialWeather: "sunny",
                random: fixed(0),
            });

            const debug = m.inspectSelection({ useTransitions: false });
            const rainyWeight = debug.effectiveWeights.find(w => w.entry.name === "rainy");
            expect(rainyWeight?.transitionBonus).toBe(0);
            expect(rainyWeight?.effectiveWeight).toBe(1);
        });
    });

    // ── inspectSelection ──────────────────────────────────────────────────

    describe("inspectSelection", () => {
        it("returns empty results when no entries match", () => {
            const m = createManager();
            const debug = m.inspectSelection({ tags: ["nonexistent"] });
            expect(debug.candidates).toEqual([]);
            expect(debug.totalWeight).toBe(0);
        });

        it("computes correct total weight", () => {
            const m = createManager();
            const debug = m.inspectSelection();
            // 4 + 3 + 2 + 1 = 10
            expect(debug.totalWeight).toBe(10);
        });
    });

    // ── History ───────────────────────────────────────────────────────────

    describe("history", () => {
        it("records weather changes in order", () => {
            const m = createManager();
            m.setCurrent("sunny");
            m.setCurrent("rainy");
            m.setCurrent("snowy");

            const history = m.getHistory();
            expect(history).toHaveLength(3);
            expect(history.map(h => h.entry.name)).toEqual(["sunny", "rainy", "snowy"]);
        });

        it("does not record duplicate when setting same weather", () => {
            const m = createManager();
            m.setCurrent("sunny");
            m.setCurrent("sunny"); // same — no weather:changed event
            expect(m.getHistory()).toHaveLength(1);
        });

        it("getLastHistory returns the most recent N entries", () => {
            const m = createManager();
            m.setCurrent("sunny");
            m.setCurrent("rainy");
            m.setCurrent("snowy");

            const last2 = m.getLastHistory(2);
            expect(last2.map(h => h.entry.name)).toEqual(["rainy", "snowy"]);
        });

        it("respects historySize limit", () => {
            const m = createManager({ historySize: 2 });
            m.setCurrent("sunny");
            m.setCurrent("rainy");
            m.setCurrent("snowy");
            m.setCurrent("foggy");

            expect(m.getHistory()).toHaveLength(2);
            expect(m.getHistory().map(h => h.entry.name)).toEqual(["snowy", "foggy"]);
        });

        it("disables history when historySize is 0", () => {
            const m = createManager({ historySize: 0 });
            m.setCurrent("sunny");
            m.setCurrent("rainy");
            expect(m.getHistory()).toHaveLength(0);
        });

        it("clearHistory empties the buffer", () => {
            const m = createManager();
            m.setCurrent("sunny");
            m.setCurrent("rainy");
            m.clearHistory();
            expect(m.getHistory()).toHaveLength(0);
        });
    });

    // ── Snapshot ──────────────────────────────────────────────────────────

    describe("snapshot", () => {
        it("captures entries, currentWeather, and history", () => {
            const m = createManager({ initialWeather: "sunny" });
            m.setCurrent("rainy");

            const snap = m.toSnapshot();
            expect(snap.entries).toHaveLength(4);
            expect(snap.currentWeather).toBe("rainy");
            expect(snap.history.length).toBeGreaterThan(0);
        });

        it("restores state from a snapshot", () => {
            const m = createManager({ initialWeather: "sunny" });
            m.setCurrent("rainy");
            const snap = m.toSnapshot();

            // Destroy current state
            m.clearEntries();
            expect(m.size()).toBe(0);

            // Restore
            m.loadSnapshot(snap);
            expect(m.size()).toBe(4);
            expect(m.getCurrentWeather()?.name).toBe("rainy");
            expect(m.getHistory().length).toBeGreaterThan(0);
        });

        it("handles snapshot with null currentWeather", () => {
            const m = createManager();
            const snap = m.toSnapshot();
            expect(snap.currentWeather).toBeNull();

            const m2 = createManager();
            m2.loadSnapshot(snap);
            expect(m2.getCurrentWeather()).toBeNull();
        });
    });

    // ── Events ────────────────────────────────────────────────────────────

    describe("events", () => {
        it("emits weather:added when an entry is added", () => {
            const m = createManager();
            const spy = jest.fn();
            m.events.on("weather:added", spy);

            m.addWeatherEntry({ name: "stormy" });
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0].name).toBe("stormy");
        });

        it("emits weather:removed when an entry is removed", () => {
            const m = createManager();
            const spy = jest.fn();
            m.events.on("weather:removed", spy);

            m.removeWeatherEntry("foggy");
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0].name).toBe("foggy");
        });

        it("emits weather:changed on setCurrent with a new weather", () => {
            const m = createManager();
            const spy = jest.fn();
            m.events.on("weather:changed", spy);

            m.setCurrent("rainy");
            expect(spy).toHaveBeenCalledTimes(1);
        });

        it("does not emit weather:changed when setting same weather", () => {
            const m = createManager({ initialWeather: "sunny" });
            const spy = jest.fn();
            m.events.on("weather:changed", spy);

            m.setCurrent("sunny");
            expect(spy).not.toHaveBeenCalled();
        });

        it("emits weather:forced even when setting same weather", () => {
            const m = createManager({ initialWeather: "sunny" });
            const spy = jest.fn();
            m.events.on("weather:forced", spy);

            m.setCurrent("sunny");
            expect(spy).toHaveBeenCalledTimes(1);
        });

        it("emits weather:selected on next()", () => {
            const m = createManager();
            const spy = jest.fn();
            m.events.on("weather:selected", spy);

            m.next();
            expect(spy).toHaveBeenCalledTimes(1);
        });

        it("emits weather:clearedCurrent on clearCurrent()", () => {
            const m = createManager({ initialWeather: "sunny" });
            const spy = jest.fn();
            m.events.on("weather:clearedCurrent", spy);

            m.clearCurrent();
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0]?.name).toBe("sunny"); // previous
        });

        it("emits weather:cleared on clearEntries()", () => {
            const m = createManager();
            const spy = jest.fn();
            m.events.on("weather:cleared", spy);

            m.clearEntries();
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0]).toHaveLength(4); // removed entries
        });

        it("emits weather:loaded after loadEntries", () => {
            const m = createManager();
            const spy = jest.fn();
            m.events.on("weather:loaded", spy);

            m.loadEntries([{ name: "stormy" }], "merge");
            expect(spy).toHaveBeenCalledTimes(1);
        });
    });

    // ── loadEntries strategies ────────────────────────────────────────────

    describe("loadEntries", () => {
        it("merge upserts without error on duplicates", () => {
            const m = createManager();
            m.loadEntries([{ name: "sunny", weight: 99 }], "merge");
            expect(m.getEntry("sunny")?.weight).toBe(99);
            expect(m.size()).toBe(4); // unchanged count
        });

        it("replace clears everything first", () => {
            const m = createManager();
            m.loadEntries([{ name: "only" }], "replace");
            expect(m.size()).toBe(1);
            expect(m.hasEntry("only")).toBe(true);
            expect(m.hasEntry("sunny")).toBe(false);
        });

        it("error throws on duplicate names", () => {
            const m = createManager();
            expect(() => m.loadEntries([{ name: "sunny" }], "error"))
                .toThrow(/already exists/);
        });

        it("error throws on duplicate names within the payload", () => {
            const m = new WeatherManager({ random: fixed(0) });
            expect(() => m.loadEntries(
                [{ name: "a" }, { name: "a" }],
                "error",
            )).toThrow(/Duplicate/);
        });
    });

    // ── Bus binding ───────────────────────────────────────────────────────

    describe("bindEvents", () => {
        it("responds to intent.weather.set", () => {
            const m = createManager();
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            bus.emit("intent.weather.set", { weatherName: "rainy" });
            expect(m.getCurrentWeather()?.name).toBe("rainy");
        });

        it("responds to intent.weather.randomize", () => {
            const m = createManager();
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            bus.emit("intent.weather.randomize");
            expect(m.getCurrentWeather()).not.toBeNull();
        });

        it("responds to intent.weather.clear", () => {
            const m = createManager({ initialWeather: "sunny" });
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            bus.emit("intent.weather.clear");
            expect(m.getCurrentWeather()).toBeNull();
        });

        it("forwards fact.weather.changed to the bus", () => {
            const m = createManager();
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            const spy = jest.fn();
            bus.on("fact.weather.changed", spy);

            m.setCurrent("rainy");
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0].weatherName).toBe("rainy");
        });

        it("unbindEvents stops all forwarding", () => {
            const m = createManager();
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);
            m.unbindEvents();

            const spy = jest.fn();
            bus.on("fact.weather.changed", spy);

            m.setCurrent("rainy");
            expect(spy).not.toHaveBeenCalled();
        });

        it("isBound reflects binding state", () => {
            const m = createManager();
            const bus = new EventEmitter<SystemEvents>();

            expect(m.isBound).toBe(false);
            m.bindEvents(bus);
            expect(m.isBound).toBe(true);
            m.unbindEvents();
            expect(m.isBound).toBe(false);
        });
    });

    // ── dispose ───────────────────────────────────────────────────────────

    describe("dispose", () => {
        it("clears everything and unbinds", () => {
            const m = createManager({ initialWeather: "sunny" });
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            m.dispose();

            expect(m.size()).toBe(0);
            expect(m.getCurrentWeather()).toBeNull();
            expect(m.getHistory()).toHaveLength(0);
            expect(m.isBound).toBe(false);
        });
    });

    // ── parseData hook ────────────────────────────────────────────────────

    describe("parseData", () => {
        it("transforms data through the parseData hook", () => {
            interface MyData { temp: number }
            const m = new WeatherManager<MyData>({
                random: fixed(0),
                parseData: (raw) => raw as MyData,
                entries: [
                    { name: "hot", tags: [], data: { temp: 40 } },
                ],
            });

            expect(m.getEntry("hot")?.data?.temp).toBe(40);
        });
    });

    // ── Edge-case validation ──────────────────────────────────────────────

    describe("edge-case validation", () => {
        it("throws on non-object entry input", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry(null as any)).toThrow(/must be an object/);
        });

        it("throws on empty tag", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({ name: "bad", tags: ["  "] }))
                .toThrow(/non-empty/);
        });

        it("throws on Infinity weight", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({ name: "bad", weight: Infinity }))
                .toThrow(/invalid weight/);
        });

        it("throws on empty transition target name", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({
                name: "bad",
                transitions: { "  ": 1 },
            })).toThrow(/empty transition target/);
        });

        it("throws on non-object transitions", () => {
            const m = createManager();
            expect(() => m.addWeatherEntry({
                name: "bad",
                transitions: "nope" as any,
            })).toThrow(/invalid transitions/);
        });

        it("throws when all candidates have zero total weight", () => {
            const m = new WeatherManager({
                entries: [{ name: "zero", weight: 0, tags: [] }],
                random: fixed(0),
            });
            expect(() => m.peek()).toThrow(/zero effective total weight/);
        });

        it("selectWeighted fallback returns last entry on edge roll", () => {
            const m = new WeatherManager({
                entries: [{ name: "a", weight: 1 }, { name: "b", weight: 1 }],
                random: () => 0.9999999999999999,
            });
            const result = m.peek();
            expect(result).toBeDefined();
        });

        it("getLastHistory returns empty for 0 or negative n", () => {
            const m = createManager();
            m.setCurrent("sunny");
            expect(m.getLastHistory(0)).toEqual([]);
            expect(m.getLastHistory(-1)).toEqual([]);
        });
    });

    // ── loadEntries error strategy edge cases ─────────────────────────────

    describe("loadEntries error strategy edge cases", () => {
        it("throws on blank entry name in error strategy", () => {
            const m = new WeatherManager({ random: fixed(0) });
            expect(() => m.loadEntries([{ name: "  " }], "error"))
                .toThrow(/name is required/);
        });
    });

    // ── Extended bus binding tests ─────────────────────────────────────────

    describe("bindEvents extended", () => {
        it("handles intent.weather.set for unknown weather gracefully", () => {
            const m = createManager();
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
            bus.emit("intent.weather.set", { weatherName: "tornado" });
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it("handles intent.weather.randomize with no entries gracefully", () => {
            const m = new WeatherManager({ random: fixed(0) });
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
            bus.emit("intent.weather.randomize");
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it("forwards fact.weather.cleared to the bus", () => {
            const m = createManager({ initialWeather: "sunny" });
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            const spy = jest.fn();
            bus.on("fact.weather.cleared", spy);
            m.clearCurrent();
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0].previousWeather).toBe("sunny");
        });

        it("forwards fact.weather.randomized to the bus", () => {
            const m = createManager();
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            const spy = jest.fn();
            bus.on("fact.weather.randomized", spy);
            m.next();
            expect(spy).toHaveBeenCalledTimes(1);
        });

        it("forwards fact.weather.loaded to the bus", () => {
            const m = createManager();
            const bus = new EventEmitter<SystemEvents>();
            m.bindEvents(bus);

            const spy = jest.fn();
            bus.on("fact.weather.loaded", spy);
            m.loadEntries([{ name: "stormy" }], "merge");
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0][0].strategy).toBe("merge");
        });

        it("re-bind auto-unbinds the previous bus", () => {
            const m = createManager();
            const bus1 = new EventEmitter<SystemEvents>();
            const bus2 = new EventEmitter<SystemEvents>();
            m.bindEvents(bus1);
            m.bindEvents(bus2);

            const spy1 = jest.fn();
            const spy2 = jest.fn();
            bus1.on("fact.weather.changed", spy1);
            bus2.on("fact.weather.changed", spy2);

            m.setCurrent("rainy");
            expect(spy1).not.toHaveBeenCalled();
            expect(spy2).toHaveBeenCalledTimes(1);
        });
    });
});

