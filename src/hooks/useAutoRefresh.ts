import { useEffect, useRef, useCallback } from "react";

/**
 * Hook that automatically polls a refresh function at a configurable interval.
 * Pauses when the tab is hidden and resumes when visible again.
 * Supports exponential backoff on errors to reduce load when services are degraded.
 *
 * @param refreshFn - The function to call on each interval tick (can return boolean: false = error/backoff)
 * @param intervalMs - Base polling interval in milliseconds (default: 30000 = 30s)
 * @param enabled - Whether polling is active (default: true)
 * @param maxIntervalMs - Maximum interval when backing off (default: 5 minutes)
 */
export function useAutoRefresh(
  refreshFn: () => void | Promise<void> | Promise<boolean>,
  intervalMs: number = 30000,
  enabled: boolean = true,
  maxIntervalMs: number = 5 * 60 * 1000
) {
  const refreshRef = useRef(refreshFn);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentIntervalRef = useRef(intervalMs);
  const consecutiveErrorsRef = useRef(0);

  // Keep the ref up-to-date without re-creating the interval
  useEffect(() => {
    refreshRef.current = refreshFn;
  }, [refreshFn]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    const interval = currentIntervalRef.current;
    intervalRef.current = setInterval(async () => {
      try {
        const result = await refreshRef.current();
        // If refreshFn explicitly returns false, treat as error
        if (result === false) {
          consecutiveErrorsRef.current++;
        } else {
          // Success — reset backoff
          if (consecutiveErrorsRef.current > 0) {
            consecutiveErrorsRef.current = 0;
            currentIntervalRef.current = intervalMs;
            // Restart with base interval
            stopPolling();
            intervalRef.current = setInterval(() => {
              refreshRef.current();
            }, intervalMs);
          }
        }
      } catch {
        consecutiveErrorsRef.current++;
        // Apply exponential backoff
        const backoffFactor = Math.min(Math.pow(2, consecutiveErrorsRef.current), 16);
        const newInterval = Math.min(intervalMs * backoffFactor, maxIntervalMs);
        if (newInterval !== currentIntervalRef.current) {
          currentIntervalRef.current = newInterval;
          console.log(`[useAutoRefresh] Backing off to ${newInterval / 1000}s (${consecutiveErrorsRef.current} errors)`);
          stopPolling();
          intervalRef.current = setInterval(() => {
            refreshRef.current();
          }, newInterval);
        }
      }
    }, interval);
  }, [intervalMs, maxIntervalMs, stopPolling]);

  useEffect(() => {
    if (!enabled) {
      stopPolling();
      return;
    }

    // Reset interval on enable
    currentIntervalRef.current = intervalMs;
    consecutiveErrorsRef.current = 0;
    startPolling();

    // Pause polling when tab is hidden, resume when visible
    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Refresh immediately when tab becomes visible, then restart interval
        refreshRef.current();
        startPolling();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [enabled, startPolling, stopPolling, intervalMs]);
}
