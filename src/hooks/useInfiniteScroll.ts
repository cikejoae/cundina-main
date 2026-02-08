import { useState, useEffect, useCallback, useRef } from "react";

const PAGE_SIZE = 10;

interface UseInfiniteScrollOptions {
  totalItems: number;
  pageSize?: number;
}

/**
 * Hook for client-side infinite scroll pagination.
 * Shows first `pageSize` items, then loads more as user scrolls to the sentinel.
 * Uses a callback ref pattern to properly handle conditional rendering of the sentinel.
 */
export const useInfiniteScroll = ({ totalItems, pageSize = PAGE_SIZE }: UseInfiniteScrollOptions) => {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelNodeRef = useRef<HTMLDivElement | null>(null);

  // Reset visible count when total items change (level/status switch)
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [totalItems, pageSize]);

  const hasMore = visibleCount < totalItems;

  // Store latest values in refs for the observer callback
  const stateRef = useRef({ visibleCount, totalItems, pageSize });
  stateRef.current = { visibleCount, totalItems, pageSize };

  // Callback ref: attach/detach observer when sentinel mounts/unmounts
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    // Disconnect previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    sentinelNodeRef.current = node;

    if (!node) return;

    // Small delay to prevent immediate trigger on mount
    const timeoutId = setTimeout(() => {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          const { visibleCount: vc, totalItems: ti, pageSize: ps } = stateRef.current;
          if (entries[0]?.isIntersecting && vc < ti) {
            setVisibleCount((prev) => Math.min(prev + ps, ti));
          }
        },
        { threshold: 0.1, rootMargin: "100px" }
      );
      if (sentinelNodeRef.current) {
        observerRef.current.observe(sentinelNodeRef.current);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, []);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  // Re-observe when visibleCount changes (sentinel re-mounts)
  useEffect(() => {
    if (sentinelNodeRef.current && observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current.observe(sentinelNodeRef.current);
    }
  }, [visibleCount]);

  const reset = useCallback(() => {
    setVisibleCount(pageSize);
  }, [pageSize]);

  return {
    visibleCount,
    sentinelRef,
    hasMore,
    reset,
  };
};
