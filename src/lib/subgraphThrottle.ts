// Subgraph rate-limit management
// Tracks 429 errors and provides cooldown to prevent hammering

let lastRateLimitAt = 0;
let cooldownMs = 60_000; // Start with 60s cooldown (was 30s — too aggressive)
const MAX_COOLDOWN_MS = 5 * 60 * 1000; // Max 5 minutes

/**
 * Record that a 429 was received. Increases cooldown exponentially.
 */
export function recordRateLimit() {
  lastRateLimitAt = Date.now();
  cooldownMs = Math.min(cooldownMs * 2, MAX_COOLDOWN_MS);
  console.warn(`[subgraphThrottle] 429 received. Cooldown set to ${cooldownMs / 1000}s`);
}

/**
 * Record a successful subgraph request. Resets cooldown.
 */
export function recordSuccess() {
  cooldownMs = 60_000; // Reset to 60s base
}

/**
 * Check if we should skip the subgraph request due to recent 429.
 */
export function isSubgraphInCooldown(): boolean {
  if (lastRateLimitAt === 0) return false;
  const elapsed = Date.now() - lastRateLimitAt;
  return elapsed < cooldownMs;
}

/**
 * Get remaining cooldown time in seconds.
 */
export function getCooldownRemaining(): number {
  if (!isSubgraphInCooldown()) return 0;
  return Math.ceil((cooldownMs - (Date.now() - lastRateLimitAt)) / 1000);
}
