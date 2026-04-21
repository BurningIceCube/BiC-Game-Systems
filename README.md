# BiC Game Systems

Modular, event-driven game systems built in TypeScript with a JSON-first approach.

Define your game systems in JSON — stats, quests, factions, items, and more — and let the systems handle the rest.

The core philosophy is simple: **define once, done**.

> **Work in Progress**  
> This is an early version of BiC Game Systems. Expect new features, improvements, and breaking changes as development continues. Feedback and contributions are welcome.

## TOC
- [Features](#features)
- [Planned Features](#planned-features)
- [Getting Started](#getting-started)
- [Why "BiC Game Systems"?](#why-bic-game-systems)
- [Systems Design Principles](#systems-design-principles)
- [Event Design](#event-design)
- [Dependencies](#dependencies)
- [Current Systems](#current-systems)
- [Weather System](#weather-system)
- [Reputation System](#reputation-system)
- [Logging and Tracing](#logging--tracing)

## Features
- **Modular Systems** — Each system is self-contained and can run independently or alongside others through a shared event bus.
- **Event-Driven** — Systems communicate through typed events, keeping them decoupled, extensible, and easy to maintain.
- **JSON Configuration** — All game data is defined in JSON. Configure it once and the systems will handle the rest.
- **TypeScript** — Fully typed interfaces for a predictable developer experience.
- **Easy Injection** — Customize and extend core behavior without modifying the original system code.
- **Traceable State Changes** — Built-in structured logging and tracing for every system.
- **Snapshot Serialization** — Save and load game state with built-in snapshot functionality.

## Planned Features
- **Wrappers** — Composite systems that coordinate multiple core systems (e.g. Combat, Party, Vendor).
- **Builder UI** — Browser-based interface for creating and editing JSON configs with live previews and validation.
- **EasyLang** — Support for formulas and expressions inside JSON (e.g. `"damage": "2D6+STR"`).
- **NPM Packages** — Publish core systems as separate packages for easier consumption and versioning.
- **More Systems** — Character, Inventory, Quests, Factions, Loot, Cycle, and more.

---

## Known Issues / Bounty Board

The following are known design limitations to be addressed in a future release:

- [ ] **Concurrent trace chains in Logger** — `Logger` only supports a single active trace at a time (`beginTrace` auto-ends the previous). A stack-based approach or named concurrent traces would allow multiple overlapping trace chains. The `TraceBundler` partially addresses this for pattern-based grouping, but the two mechanisms should be unified.
- [ ] **Input validation in WeatherLoader** — `loadFromJson` / `loadConfigFromJson` parse JSON and cast the result without validating the shape of the data. Adding structural validation (e.g. via Zod or manual checks) would prevent confusing runtime errors deep inside the manager when malformed JSON is provided.

---

## Getting Started

### Installation

Install from [npm](https://www.npmjs.com/package/bic-game-systems):

```bash
npm install bic-game-systems
```

Then import any system directly:

```ts
import { WeatherManager, QuestManager, ReputationManager, defaultLogger } from 'bic-game-systems';
```

---

### Contributing / Local Development

#### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- npm

#### Setup

```bash
npm install
```

#### Build

```bash
npm run build
```

> Compiles TypeScript and outputs to `dist/`.

### Running Examples

```bash
npm run example:weather
npm run example:quest
npm run example:logger
```

### Running Tests

```bash
npm test
```

> Runs the full test suite via [Jest](https://jestjs.io/).  
> To run with coverage reporting:

```bash
npx jest --coverage
```

---

## Why "BiC Game Systems"?

Building games often means repeatedly writing the same complex systems — characters, inventories, quests, weather, loot, and more. Every time you add a new feature, you risk creating fragile interdependencies.

BiC Game Systems solves this by letting you define everything in clean, reusable JSON. Each system is self-contained, fully event-driven, and works independently or together through a shared bus.

**Define once, done.** That’s the vision.

---

## Systems Design Principles

All systems follow the same core rules:

1. **Self-contained** — Every system must work independently.
2. **JSON-configurable** — All behavior and data must be definable through JSON to support the "define once, done" philosophy.
3. **Event-driven** — Systems communicate through a shared `EventEmitter` to remain decoupled and extensible.
4. **Fully typed** — TypeScript interfaces are used throughout for safety and developer ergonomics.
5. **Injectable** — Custom implementations can be provided without changing the original source.
6. **Traceable** — State changes must produce trace logs to support debugging and development.

Each system follows the same usage pattern: define it in JSON, instantiate it with that configuration, and optionally connect it to other systems through a shared EventEmitter.

---

## Event Design

The event system is the backbone of BiC Game Systems. It allows systems to communicate without direct dependencies, keeping them modular, extensible, and easy to reason about.

Each system emits and listens for specific events. Systems may react to events from other systems, but only the system that owns a piece of state will emit facts about changes to that state.

For example, the leveling system emits a `fact.leveling.leveledUp` event whenever a character gains a level. Other systems can listen for that event and react accordingly, such as granting new abilities, updating the UI, or unlocking new content.

### Intents vs Facts

Events are divided into two categories:

- **Intents** — A request for a system to perform an action. An intent does not guarantee that anything has happened; it only signals that some system should evaluate and handle the request.
- **Facts** — A record of something that has already happened. Facts are emitted after a system has applied a change or completed an action.

### Naming Convention

Event names follow the pattern `<category>.<system>.<action>`.

- **Intents** use the `intent.` prefix and describe a requested action.
    - Example: `intent.leveling.awardXp`
- **Facts** use the `fact.` prefix and describe a completed action or state change, usually in past tense.
    - Examples: `fact.leveling.xpAwarded`, `fact.leveling.leveledUp`

In general:
- intents ask for action
- facts report completed outcomes

### Rules

- Intents may be emitted by any system that wants something to happen.
- Facts are emitted only by the system that owns the affected state.
- Facts should be written in past tense.
- Systems should react to facts when possible, and use intents when requesting changes.

---

## Dependencies

- [eventemitter3](https://www.npmjs.com/package/eventemitter3) — Lightweight event emitter for decoupled communication between systems.
- [loglayer](https://loglayer.dev) — Universal logging layer with pluggable transports (console, pino, winston, datadog, and more).
- [serialize-error](https://www.npmjs.com/package/serialize-error) — Serializes Error objects into plain objects for structured logging.

### Dev Dependencies

- [jest](https://jestjs.io/) — Testing framework for unit and integration tests.
- [tsx](https://www.npmjs.com/package/tsx) — TypeScript execution for examples.
- [typescript](https://www.typescriptlang.org/) — TypeScript compiler.

---

## Current Systems

The following systems are available:

- **Weather System** — Weighted random weather with tags and transitions.
- **Reputation System** — Numeric reputation with tier resolution and clamped bounds.
- **Quest System** — Quest tracking with objectives, prerequisites, and rewards.
- **Logging & Tracing** — Production-ready structured logger with trace chaining.

More systems (Cycle, Loot, Character, etc.) are being crafted and will be added soon.

---

## Weather System

Weighted-random weather selection with tag filtering, transition biases, history tracking, and snapshot save/load — all defined in JSON.

### Quick Config

```json
{
  "entries": [
    { "name": "sunny",  "weight": 4, "tags": ["clear", "warm"], "transitions": { "rainy": 3 } },
    { "name": "rainy",  "weight": 3, "tags": ["rain", "wet"],   "transitions": { "snowy": 2 } },
    { "name": "snowy",  "weight": 2, "tags": ["snow", "cold"] },
    { "name": "foggy",  "weight": 1, "tags": ["fog", "damp"] }
  ],
  "initialWeather": "sunny"
}
```

### Usage

```ts
import { WeatherManager } from "./systems/weather/manager.js";
import { WeatherLoader }  from "./systems/weather/load.js";

// Create from config
const manager = new WeatherManager({ entries, initialWeather: "sunny" });

// Or load from JSON / file
const loader = new WeatherLoader(manager);
await loader.loadConfigFromFile("./weather.json");

// Random selection (weighted + transitions)
manager.next();

// Filter by tags (stateless — does not change current weather)
manager.peek({ tags: ["cold"], tagMatch: "any" });

// Listen for changes
manager.events.on("weather:changed", (current, previous) => { /* ... */ });

// Connect to the shared event bus
manager.bindEvents(bus);

// Save / restore state
const snapshot = manager.toSnapshot();
manager.loadSnapshot(snapshot);
```

### Key Features
- **Weighted random** with per-entry transition bonuses
- **Tag filtering** (`all` / `any` match modes) and custom filter hooks
- **History tracking** (configurable ring buffer, default 50)
- **Snapshot serialization** for save/load game state
- **Event-driven** — local `WeatherEvents` + shared `SystemEvents` bus bridge
- **WeatherLoader** — load configs from objects, JSON strings, or files with `replace` / `merge` / `error` strategies

[More Example Code](./examples/weather/example.ts)

---

## Reputation System

Track numeric reputation values per entity (factions, characters, guilds) with tier-based resolution, clamped bounds, and automatic tier-change detection — all defined in JSON.

### Quick Config

```json
{
  "entries": [
    {
      "id": "silverhand",
      "name": "Order of the Silver Hand",
      "type": "faction",
      "initialValue": 0,
      "minValue": -1000,
      "maxValue": 1000,
      "tiers": [
        { "id": "exalted", "label": "Exalted", "threshold": 750 },
        { "id": "honored", "label": "Honored", "threshold": 300 },
        { "id": "neutral", "label": "Neutral", "threshold": -299 },
        { "id": "hated",   "label": "Hated",   "threshold": -1000 }
      ]
    }
  ]
}
```

### Usage

```ts
import { ReputationManager } from "./systems/reputation/manager.js";
import { ReputationLoader }  from "./systems/reputation/load.js";

// Create from config
const manager = new ReputationManager({ entities });

// Or load from JSON / file
const loader = new ReputationLoader(manager);
await loader.loadConfigFromFile("./reputation.json");

// Adjust reputation
manager.change("silverhand", 100);
manager.set("silverhand", 500);

// Query state
manager.getValue("silverhand");   // 500
manager.getTierId("silverhand");  // "honored"
manager.getReputation("silverhand"); // enriched view

// Listen for changes
manager.events.on("reputation:changed", (payload) => { /* ... */ });
manager.events.on("reputation:tierChanged", (payload) => { /* ... */ });

// Connect to the shared event bus
manager.bindEvents(bus);

// Save / restore state
const snapshot = manager.toSnapshot();
manager.loadSnapshot(snapshot);
```

### Key Features
- **Tier resolution** — automatic tier lookup against a sorted threshold ladder
- **Clamped bounds** — per-entity min/max values prevent overflow
- **Entity registry** — full CRUD (`addEntity` / `upsertEntity` / `removeEntity` / `clearEntities`)
- **History tracking** (configurable ring buffer, default 50)
- **Snapshot serialization** for save/load game state
- **Event-driven** — local `ReputationEvents` + shared `SystemEvents` bus bridge
- **ReputationLoader** — load configs from objects, JSON strings, or files with `replace` / `merge` / `error` strategies

---

## Quest System

Track quests with objectives, prerequisite chains, level gates, reward dispatch, and event-driven auto-start triggers — all defined in JSON.

### Quick Config

```json
{
  "quests": [
    {
      "id": "find_the_cave",
      "title": "Find the Cave",
      "description": "Locate the hidden cave entrance.",
      "objectives": [
        { "id": "explore", "type": "visit", "description": "Find the cave entrance", "target": "cave_entrance", "required": 1 }
      ],
      "rewards": { "xp": 100 }
    },
    {
      "id": "slay_the_dragon",
      "title": "Slay the Dragon",
      "description": "Defeat the ancient dragon terrorizing the village.",
      "levelRequired": 10,
      "prerequisites": ["find_the_cave"],
      "objectives": [
        { "id": "kill_dragon", "type": "kill", "description": "Kill the dragon", "target": "dragon", "required": 1 },
        { "id": "collect_scales", "type": "collect", "description": "Collect dragon scales", "target": "dragon_scale", "required": 5 }
      ],
      "rewards": {
        "xp": 500,
        "skillPoints": 2,
        "actions": [
          { "type": "intent.reputation.change", "entityId": "villagers", "amount": 200 },
          { "type": "intent.inventory.add", "inventoryId": "player_bag", "itemId": "dragon_trophy", "quantity": 1 }
        ]
      }
    },
    {
      "id": "auto_bounty",
      "title": "Bounty: Boss Slain",
      "description": "Automatically awarded when a boss dies.",
      "trigger": {
        "event": "fact.character.died",
        "match": { "characterId": "boss_orc" }
      },
      "objectives": [
        { "id": "done", "type": "custom", "description": "Boss defeated", "required": 1 }
      ],
      "rewards": { "xp": 300 }
    }
  ]
}
```

### Usage

```ts
import { QuestManager } from "./systems/quest/manager.js";
import { QuestLoader }  from "./systems/quest/load.js";

// Create from config
const manager = new QuestManager({ quests });

// Or load from JSON / file
const loader = new QuestLoader(manager);
await loader.loadConfigFromFile("./quests.json");

// Inject a level provider for prerequisite checks
manager.setLevelProvider(() => leveling.getLevel());

// Start and progress quests
manager.canStartQuest("find_the_cave");          // prerequisite check
manager.startQuest("find_the_cave");
manager.updateObjective("find_the_cave", "explore");  // +1 progress
manager.completeQuest("find_the_cave");          // force-complete

// Abandon
manager.abandonQuest("slay_the_dragon");

// Query state
manager.getQuest("slay_the_dragon");             // enriched view with status & progress
manager.getAllQuests();                           // all quests with status
manager.getActiveQuests();                       // in-progress quests
manager.getCompletedQuests();                    // completed quests

// Quest registry
manager.addQuest(newQuest);
manager.removeQuest("old_quest");

// Listen for changes
manager.events.on("quest:started", (payload) => { /* ... */ });
manager.events.on("quest:objectiveUpdated", (payload) => { /* ... */ });
manager.events.on("quest:completed", (payload) => { /* ... */ });

// Connect to the shared event bus
manager.bindEvents(bus);

// Save / restore state
const snapshot = manager.toSnapshot();
manager.loadSnapshot(snapshot);
```

### Key Features
- **Objective tracking** — typed objectives (`kill`, `collect`, `talk`, `visit`, `reach_level`, `custom`) with progress counters and auto-complete when all are met
- **Prerequisites** — quests can require other quests to be completed first
- **Level gates** — optional `levelRequired` checked via an injectable `levelProvider` callback
- **Repeatable quests** — `isRepeatable` flag allows re-starting after completion
- **Reward dispatch** — on completion, built-in shortcuts (`xp`, `skillPoints`, `unlockSkills`, `unlockPerks`) and arbitrary `RewardAction` intents are dispatched on the shared bus
- **Declarative triggers** — `trigger` config auto-starts a quest when a matching bus event fires, with dot-notation payload matching
- **Quest registry** — full CRUD (`addQuest` / `upsertQuest` / `removeQuest` / `clearQuests`)
- **History tracking** (configurable ring buffer, default 50)
- **Snapshot serialization** for save/load game state (quest definitions + progress)
- **Event-driven** — local `QuestEvents` + shared `SystemEvents` bus bridge
- **QuestLoader** — load configs from objects, JSON strings, or files with `replace` / `merge` / `error` strategies

[More Example Code](./examples/quest/example.ts)

---

## Logging & Tracing

BiC Game Systems includes a powerful, production-ready structured logger with tracing capabilities built in from day one. Under the hood, logging is powered by [LogLayer](https://loglayer.dev) — giving you full control over transports, plugins, and output formats while BiC handles trace chains automatically.

### Quick Start

```ts
import { defaultLogger } from 'bic-game-systems';

// Ready to use out of the box — ConsoleTransport is included by default.
defaultLogger.log('info', 'App', 'ready', undefined, undefined, 'Server is up');
defaultLogger.log('warn', 'App', 'config:missing', { key: 'DB_URL' });
defaultLogger.log('error', 'App', 'crash', new Error('boom'));
```

### Custom Transports

Swap in any LogLayer-compatible transport — pino, winston, datadog, or your own:

```ts
import { Logger } from 'bic-game-systems';
import { ConsoleTransport } from 'loglayer';

// Custom LogLayer config
const logger = new Logger({
    logLayerConfig: {
        transport: new ConsoleTransport({ logger: console }),
    },
});

// Or inject a fully-configured LogLayer instance
import { LogLayer } from 'loglayer';
const ll = new LogLayer({ /* your config */ });
const logger2 = new Logger({ logLayer: ll });

// Access the underlying LogLayer instance directly for advanced features
logger.ll.withContext({ module: 'advanced' }).info('Direct LogLayer access');
```

### MemorySink (Tests & Introspection)

`MemorySink` captures structured `LogEntry` objects via a LogLayer plugin — ideal for tests and trace replay:

```ts
import { Logger, MemorySink } from 'bic-game-systems';
import { ConsoleTransport }   from 'loglayer';

const mem = new MemorySink();
const logger = new Logger({
    logLayerConfig: {
        transport: new ConsoleTransport({ logger: console }),
        plugins:   [mem.plugin()],
    },
});

logger.log('info', 'App', 'ready');

mem.getBySystem('App');        // entries from a specific system
mem.getByLevel('warn');        // entries at warn+
mem.getChain(someTraceId);     // entries belonging to one trace
mem.clear();                   // wipe between test cases
```

### Basic Logging

```ts
defaultLogger.log('info',  'App', 'ready',         undefined, undefined, 'Server is up');
defaultLogger.log('warn',  'App', 'config:missing', { key: 'DB_URL' });
defaultLogger.log('error', 'App', 'crash',         new Error('boom'));
```

### SystemLogger

Scopes every call to a fixed system name so you don't repeat it:

```ts
const log = defaultLogger.forSystem('Player');
log.info ('spawn',  { id: 42, x: 0, y: 0 });
log.warn ('low-hp', { id: 42, hp: 3 });
log.error('death',  { id: 42 });
```

### Manual Trace Chains

`beginTrace` / `endTrace` bracket a causal chain — every `logger.log()` call inside gets the same `traceId`:

```ts
const chain  = defaultLogger.beginTrace('player:respawn');

log.info('respawn:start', { id: 42 });
log.debug('respawn:pos',  { x: 10, y: 5 });
log.info('respawn:done',  { id: 42 });

const result = defaultLogger.endTrace();
// result.entries   — every log entry in the chain
// result.duration  — total ms
```

### TraceBundler

Automatically groups events into chains by dot-segment glob — no `beginTrace` / `endTrace` needed:

```ts
import { TraceBundler } from 'bic-game-systems';

const bundler = new TraceBundler(['*.player.*', '*.world.*']);

bundler.record('fact.player.spawned', { id: 1 });
bundler.record('fact.player.moved',   { id: 1, x: 3 });
bundler.record('fact.world.loaded',   { map: 'forest' });

const results = bundler.endAll(); // finalize all chains
```

### TracedEventEmitter

Drop-in replacement for `EventEmitter<SystemEvents>` that auto-captures matching events into a `TraceBundler`:

```ts
import { TracedEventEmitter } from 'bic-game-systems';

const bus = new TracedEventEmitter({ capture: ['*.weather.*'] });
manager.bindEvents(bus);

// … emit events normally …
bus.emit('intent.weather.set', { weatherName: 'foggy' });

// Finalize and inspect
for (const trace of bus.bundler.endAll()) {
    console.log(trace.rootEvent, trace.entries.length, `${trace.duration}ms`);
}
```

Manual on/off control is also available via bus events:

```ts
bus.emit('intent.system.traceOn',  { rootEvent: 'my-trace' });
// … operations …
bus.emit('intent.system.traceOff'); // emits fact.system.traceCompleted
```

### MemorySink Introspection

```ts
mem.getBySystem('Player');      // entries from a specific system
mem.getByLevel('warn');         // entries at warn+
mem.getChain(chain.traceId);    // entries belonging to one trace
mem.clear();                    // wipe between test cases
```

[More Logger Examples](./examples/logger/example.ts)

---

## License
Apache-2.0. See [LICENSE](LICENSE) for details.