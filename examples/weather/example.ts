import * as path from "node:path";
import { defaultLogger } from "../../src/utilities/logger/logger.js";
import { consoleSink } from "../../src/utilities/logger/sinks.js";
import { TracedEventEmitter } from "../../src/utilities/logger/trace.js";
import { WeatherManager } from "../../src/systems/weather/manager.js";
import { WeatherLoader } from "../../src/systems/weather/load.js";

// consoleSink prints every captured event to stdout in real-time.
defaultLogger.addSink(consoleSink);

// All *.weather.* events are auto-captured — no manual begin/end traces.
// The bus uses defaultLogger; pass your own `new Logger()` for isolation.
const bus     = new TracedEventEmitter({ capture: ["*.weather.*"], logger: defaultLogger });
const manager = new WeatherManager();
const loader  = new WeatherLoader(manager);

// Bind before loading so fact.weather.* from the initial setCurrent are captured.
manager.bindEvents(bus);

async function main(): Promise<void> {

    // Load entries + initialWeather from data.json
    await loader.loadConfigFromFile(path.join(__dirname, "data.json"));

    // next() × 5 — each fires fact.weather.randomized (+ fact.weather.changed)
    for (let i = 0; i < 5; i++) manager.next();

    // peek() — stateless weighted draw, no bus events
    manager.peek({ tags: ["cold"], tagMatch: "any" });
    manager.peek({ tags: ["wet", "damp"], tagMatch: "any" });

    // setCurrent — fires fact.weather.changed
    manager.setCurrent("sunny");

    // Bus intents — intent.weather.* and resulting fact.weather.* all captured
    bus.emit("intent.weather.set",       { weatherName: "foggy" });
    bus.emit("intent.weather.randomize");
    bus.emit("intent.weather.clear");

    // inspectSelection — pure data query, no bus events
    manager.setCurrent("sunny");
    manager.inspectSelection();

    // Snapshot round-trip
    manager.setCurrent("rainy");
    const snapshot = manager.toSnapshot();
    manager.clearEntries();
    manager.loadSnapshot(snapshot);

    // Runtime entry management
    manager.addWeatherEntry({ name: "stormy", weight: 2, tags: ["storm", "wet", "cold"] });
    manager.upsertWeatherEntry({ name: "sunny", weight: 10, tags: ["clear", "warm"] });
    manager.removeWeatherEntry("stormy");

    // Merge batch
    manager.loadEntries(
        [{ name: "blizzard", weight: 1, tags: ["snow", "cold", "storm"] }],
        "merge",
    );

    // Finalize and summarize the auto-captured trace chain
    for (const trace of bus.bundler.endAll()) {
        defaultLogger.log("info", "TraceBundler", "trace:summary", {
            pattern:  trace.rootEvent,
            traceId:  trace.traceId,
            duration: trace.duration,
            events:   trace.entries.length,
        });
    }

    // Example of turning off the trace
    defaultLogger.log("info", "Example", "Turning off trace....");
    bus.emit("intent.system.traceOff");
    manager.setCurrent("foggy"); // not captured, no traceId
    defaultLogger.log("info", "TraceBundler", "Non-captured event after traceOff", {
        event: "fact.weather.changed",
    })

    defaultLogger.log("info", "Example", "Turning trace back on for manual tracing example");
    defaultLogger.beginTrace("example");
    manager.setCurrent("sunny");
    manager.inspectSelection();
    defaultLogger.endTrace();
}

main().catch(console.error);
