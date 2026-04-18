import type { LogEntry } from '../utilities/logger/logger.js';
import type { WeatherEntry } from '../systems/weather/manager.js';
import type { LoadStrategy } from '../systems/common.js';
import type { QuestReward } from '../systems/quest/manager.js';

/**
 * Defines the structure of system events that can be emitted and listened to within the application. Each event is categorized by its type (e.g., intents, facts) and includes the relevant data payload for that event. This interface serves as a contract for event handling, ensuring that all events adhere to a consistent format and can be easily managed throughout the application.
 */
export interface SystemEvents {

    // == System Control Events ==

    // Intents
    // Intent to begin capturing a named trace chain
    "intent.system.traceOn": {
        rootEvent: string;
    };
    // Intent to end the active trace chain and emit the result
    "intent.system.traceOff": void;

    // Facts
    // Emitted when a trace chain has been completed and is ready to inspect
    "fact.system.traceCompleted": {
        traceId: string;
        rootEvent: string;
        startedAt: number;
        duration: number;
        entries: LogEntry[];
    };

    // == Weather System Events ==

    // Intents
    // Intent to set the weather to a specific type (e.g., sunny, rainy, etc.)
    "intent.weather.set": {
        weatherName: string;
    };
    // Intent to clear the current weather, reverting to default conditions
    "intent.weather.clear": void;
    // Intent to pick a random weather type using weighted probability
    "intent.weather.randomize": void;

    // Facts
    "fact.weather.changed": {
        previousWeather: string;
        weatherName: string;
        entry: WeatherEntry;
    };
    // Emitted specifically when weather was explicitly cleared to the default
    "fact.weather.cleared": {
        previousWeather: string;
        /** The entry that was cleared, or `undefined` if there was no active weather. */
        entry?: WeatherEntry;
    };
    // Emitted when weather was changed via weighted random selection
    "fact.weather.randomized": {
        previousWeather: string;
        weatherName: string;
        entry: WeatherEntry;
    };
    // Emitted when weather entries were bulk-loaded into the registry
    "fact.weather.loaded": {
        count: number;
        strategy: LoadStrategy;
    };

    // == Reputation System Events ==

    // Intents
    // Intent to change reputation for an entity by a delta
    "intent.reputation.change": {
        entityId: string;
        amount: number;
    };
    // Intent to set reputation for an entity to an absolute value
    "intent.reputation.set": {
        entityId: string;
        value: number;
    };

    // Facts
    "fact.reputation.changed": {
        entityId: string;
        previous: number;
        current: number;
        delta: number;
        tierId: string;
    };
    "fact.reputation.tierChanged": {
        entityId: string;
        previousTierId: string;
        currentTierId: string;
        current: number;
    };
    "fact.reputation.loaded": {
        count: number;
        strategy: LoadStrategy;
    };

    // == Quest System Events ==

    // Intents
    "intent.quest.start": {
        questId: string;
    };
    "intent.quest.updateObjective": {
        questId: string;
        objectiveId: string;
        amount?: number;
    };
    "intent.quest.complete": {
        questId: string;
    };
    "intent.quest.abandon": {
        questId: string;
    };

    // Facts
    "fact.quest.started": {
        questId: string;
    };
    "fact.quest.objectiveUpdated": {
        questId: string;
        objectiveId: string;
        previous: number;
        current: number;
        required: number;
    };
    "fact.quest.completed": {
        questId: string;
        rewards: QuestReward;
    };
    "fact.quest.abandoned": {
        questId: string;
    };
    "fact.quest.loaded": {
        count: number;
        strategy: LoadStrategy;
    };

    // == Leveling System Events (intent-only, consumed by future leveling system) ==

    "intent.leveling.awardXp": {
        amount: number;
    };
    "intent.leveling.grantPoints": {
        amount: number;
    };
    "intent.leveling.unlockSkill": {
        skillId: string;
    };
    "intent.leveling.unlockPerk": {
        perkId: string;
    };

}