import * as path from "node:path";
import { defaultLogger } from "../../src/utilities/logger/logger.js";
import { TracedEventEmitter } from "../../src/utilities/logger/trace.js";
import { QuestManager } from "../../src/systems/quest/manager.js";
import { QuestLoader } from "../../src/systems/quest/load.js";

// defaultLogger uses ConsoleTransport out of the box — no setup needed.

// All *.quest.* events are auto-captured — no manual begin/end traces.
const bus     = new TracedEventEmitter({ capture: ["*.quest.*"], logger: defaultLogger });
const manager = new QuestManager();
const loader  = new QuestLoader(manager);

// Bind before loading so fact.quest.* events are captured.
manager.bindEvents(bus);

// Simulate a player level for level-gated quests
let playerLevel = 1;
manager.setLevelProvider(() => playerLevel);

async function main(): Promise<void> {

    // ── Load quest definitions from data.json ─────────────────────────────
    await loader.loadConfigFromFile(path.join(__dirname, "data.json"));

    // ── Show all quests and their statuses ────────────────────────────────
    defaultLogger.log("info", "Quest", "all-quests", {
        quests: manager.getAllQuests().map(q => ({ id: q.id, status: q.status })),
    });

    // ── Start the first quest (no prerequisites) ──────────────────────────
    manager.startQuest("gather_herbs");

    // Progress the objectives
    for (let i = 0; i < 5; i++) manager.updateObjective("gather_herbs", "collect_moonpetal");
    for (let i = 0; i < 3; i++) manager.updateObjective("gather_herbs", "collect_thornroot");
    // ^ auto-completes when all objectives are met

    // ── Prerequisite chain: find_the_cave unlocks after gather_herbs ──────
    defaultLogger.log("info", "Quest", "can-start-find_the_cave", {
        canStart: manager.canStartQuest("find_the_cave"),
    });

    manager.startQuest("find_the_cave");
    manager.updateObjective("find_the_cave", "talk_hermit");
    manager.updateObjective("find_the_cave", "explore_cave");

    // ── Level gate: slay_the_dragon requires level 5 ──────────────────────
    defaultLogger.log("info", "Quest", "can-start-slay_the_dragon-at-lvl-1", {
        canStart: manager.canStartQuest("slay_the_dragon"),  // false — level too low
    });

    playerLevel = 10;
    defaultLogger.log("info", "Quest", "can-start-slay_the_dragon-at-lvl-10", {
        canStart: manager.canStartQuest("slay_the_dragon"),  // true
    });

    manager.startQuest("slay_the_dragon");
    manager.updateObjective("slay_the_dragon", "kill_dragon");
    for (let i = 0; i < 5; i++) manager.updateObjective("slay_the_dragon", "collect_scales");

    // ── Repeatable quest: daily_patrol can be done multiple times ──────────
    manager.startQuest("daily_patrol");
    manager.updateObjective("daily_patrol", "visit_north");
    manager.updateObjective("daily_patrol", "visit_south");
    for (let i = 0; i < 3; i++) manager.updateObjective("daily_patrol", "kill_wolves");

    // Start it again — it's repeatable
    manager.startQuest("daily_patrol");
    defaultLogger.log("info", "Quest", "daily_patrol-restarted", {
        quest: manager.getQuest("daily_patrol"),
    });

    // Abandon mid-way
    manager.abandonQuest("daily_patrol");

    // ── Declarative trigger: bounty auto-starts from a bus event ──────────
    // Re-bind to pick up trigger listeners for the loaded quests
    manager.unbindEvents();
    manager.bindEvents(bus);

    (bus as any).emit("fact.character.died", { characterId: "boss_orc" });
    defaultLogger.log("info", "Quest", "bounty-auto-started", {
        quest: manager.getQuest("bounty_boss_orc"),
    });

    // Force-complete the bounty
    manager.completeQuest("bounty_boss_orc");

    // ── Bus intents — control quests via the shared bus ────────────────────
    manager.addQuest({
        id: "fetch_water",
        title: "Fetch Water",
        description: "Bring water from the well.",
        objectives: [{ id: "get_water", type: "collect", description: "Get water", target: "water_bucket", required: 1 }],
        rewards: { xp: 25 },
    });

    bus.emit("intent.quest.start", { questId: "fetch_water" });
    bus.emit("intent.quest.updateObjective", { questId: "fetch_water", objectiveId: "get_water" });

    // ── Query helpers ─────────────────────────────────────────────────────
    defaultLogger.log("info", "Quest", "active-quests", {
        active: manager.getActiveQuests(),
    });
    defaultLogger.log("info", "Quest", "completed-quests", {
        completed: manager.getCompletedQuests().map(p => p.questId),
    });

    // ── History ───────────────────────────────────────────────────────────
    defaultLogger.log("info", "Quest", "last-5-history", {
        history: manager.getLastHistory(5),
    });

    // ── Snapshot round-trip ───────────────────────────────────────────────
    const snapshot = manager.toSnapshot();
    defaultLogger.log("info", "Quest", "snapshot-saved", {
        questCount: snapshot.quests.length,
        progressKeys: Object.keys(snapshot.progress),
    });

    manager.clearQuests();
    manager.loadSnapshot(snapshot);
    defaultLogger.log("info", "Quest", "snapshot-restored", {
        quests: manager.getAllQuests().map(q => ({ id: q.id, status: q.status })),
    });

    // ── Finalize and summarize the auto-captured trace chains ─────────────
    for (const trace of bus.bundler.endAll()) {
        defaultLogger.log("info", "TraceBundler", "trace:summary", {
            pattern:  trace.rootEvent,
            traceId:  trace.traceId,
            duration: trace.duration,
            events:   trace.entries.length,
        });
    }
}

main().catch(console.error);

