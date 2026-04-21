// Shared types
export type { LoadStrategy } from './systems/common.js';

// Event bus
export type { SystemEvents } from './events/bus.js';

// Weather system
export { WeatherManager }          from './systems/weather/manager.js';
export { WeatherLoader }           from './systems/weather/load.js';
export type {
    WeatherEntry,
    WeatherEntryInput,
    WeatherManagerOptions,
    WeatherPickOptions,
    WeatherEvents,
    WeatherSnapshot,
    WeatherHistoryEntry,
    WeatherSelectionDebug,
    WeatherContext,
    TagMatchMode,
} from './systems/weather/manager.js';
export type {
    WeatherConfig,
    LoadOptions,
} from './systems/weather/load.js';

// Reputation system
export { ReputationManager }       from './systems/reputation/manager.js';
export { ReputationLoader }        from './systems/reputation/load.js';
export type {
    ReputationEntityType,
    ReputationTier,
    ReputationEntity,
    ReputationEntityInput,
    ReputationManagerOptions,
    ReputationEvents,
    ReputationSnapshot,
    ReputationHistoryEntry,
} from './systems/reputation/manager.js';
export type {
    ReputationConfig,
} from './systems/reputation/load.js';

// Quest system
export { QuestManager }            from './systems/quest/manager.js';
export { QuestLoader }             from './systems/quest/load.js';
export type {
    Quest,
    QuestObjective,
    QuestReward,
    RewardAction,
    QuestTrigger,
    QuestStatus,
    QuestProgress,
    QuestManagerOptions,
    QuestEvents,
    QuestSnapshot,
    QuestHistoryEntry,
} from './systems/quest/manager.js';
export type {
    QuestConfig,
} from './systems/quest/load.js';

// Logger
export { Logger, SystemLogger, defaultLogger } from './utilities/logger/logger.js';
export type {
    LogEntry,
    LogLevel,
    LoggerOptions,
    TraceChain,
    TraceResult,
} from './utilities/logger/logger.js';

// Memory sink (test / introspection utility)
export { MemorySink } from './utilities/logger/sinks.js';

// Tracing
export { TraceBundler, TracedEventEmitter } from './utilities/logger/trace.js';
export type { TracedEventEmitterOptions }   from './utilities/logger/trace.js';