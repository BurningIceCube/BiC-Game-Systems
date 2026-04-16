// ---------------------------------------------------------------------------
// Shared types used across all game systems
// ---------------------------------------------------------------------------

/**
 * Strategy used when bulk-loading entries into a system registry.
 * - "replace": clears all existing entries first
 * - "merge":   upserts, overwriting duplicates
 * - "error":   throws on any duplicate (default)
 */
export type LoadStrategy = "replace" | "merge" | "error";

