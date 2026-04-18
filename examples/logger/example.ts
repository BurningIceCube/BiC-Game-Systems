/**
 * examples/logger/example.ts
 * Quick tour of Logger, SystemLogger, MemorySink, trace chains, and TraceBundler.
 *
 * LogLayer powers all log output — swap transports (pino, winston, datadog, etc.)
 * by passing a custom `logLayerConfig` or `logLayer` instance to `new Logger()`.
 */

import { Logger, defaultLogger }   from '../../src/utilities/logger/logger.js';
import { MemorySink }              from '../../src/utilities/logger/sinks.js';
import { TraceBundler }            from '../../src/utilities/logger/trace.js';
import { ConsoleTransport }        from 'loglayer';

// ── 1. Default logger (ConsoleTransport out of the box) ───────────────────────
// defaultLogger is ready to use — no setup needed.

defaultLogger.log('debug', 'App', 'startup',      { version: '1.0.0' });
defaultLogger.log('info',  'App', 'ready',        undefined, undefined, 'Server is up');
defaultLogger.log('warn',  'App', 'config:missing', { key: 'DB_URL' });
defaultLogger.log('error', 'App', 'crash',        new Error('boom'));

// ── 2. Custom logger with MemorySink plugin ──────────────────────────────────
// MemorySink captures LogEntry objects via a LogLayer plugin — great for tests.

const mem = new MemorySink();
const logger = new Logger({
    logLayerConfig: {
        transport: new ConsoleTransport({ logger: console }),
        plugins:   [mem.plugin()],
    },
});

// ── 3. SystemLogger ───────────────────────────────────────────────────────────
// Scopes every call to a fixed system name so you don't repeat it.

const log = logger.forSystem('Player');
log.info ('spawn',  { id: 42, x: 0, y: 0 });
log.warn ('low-hp', { id: 42, hp: 3 });
log.error('death',  { id: 42 });

// ── 4. Manual trace chain ─────────────────────────────────────────────────────
// beginTrace / endTrace bracket a causal chain.
// Every logger.log() call inside the bracket gets the same traceId.

const chain  = logger.beginTrace('player:respawn');

log.info('respawn:start', { id: 42 });
log.debug('respawn:pos',  { x: 10, y: 5 });
log.info('respawn:done',  { id: 42 });

const result = logger.endTrace();
console.log(`\nTrace "${result?.rootEvent}" captured ${result?.entries.length} entries in ${result?.duration}ms\n`);

// ── 5. MemorySink introspection ───────────────────────────────────────────────
// Useful in tests: assert on exactly what was logged.

const playerEntries = mem.getBySystem('Player');
const warnAndAbove  = mem.getByLevel('warn');
const traceEntries  = mem.getChain(chain.traceId);

console.log('Player entries :', playerEntries.length);
console.log('Warn+ entries  :', warnAndAbove.length);
console.log('Trace entries  :', traceEntries.length);

mem.clear();   // wipe between test cases

// ── 6. TraceBundler ───────────────────────────────────────────────────────────
// Automatically groups events that match a dot-segment glob into chains.
// '*' matches exactly one segment.  No beginTrace/endTrace needed.

const bundler = new TraceBundler(['*.player.*', '*.world.*']);

bundler.record('fact.player.spawned',  { id: 1 });
bundler.record('fact.player.moved',    { id: 1, x: 3 });
bundler.record('fact.world.loaded',    { map: 'forest' });
bundler.record('fact.unrelated.event', { ignored: true }); // no match → dropped

const results = bundler.endAll();

for (const r of results) {
    logger.log('info', 'TraceBundler', 'summary', {
        pattern:  r.rootEvent,
        events:   r.entries.length,
        duration: `${r.duration}ms`,
    });
}

// ── 7. Direct LogLayer access ─────────────────────────────────────────────────
// Need LogLayer-specific features? Access the underlying instance directly.

logger.ll.withContext({ module: 'advanced' }).info('LogLayer API available directly');

