/**
 * Hook that polls for on-chain events from the Registry contract using eth_getLogs.
 * When a relevant event is detected, it waits for the subgraph to index it,
 * then triggers a callback to refresh data.
 *
 * Uses eth_getLogs (supported by all RPCs including WalletConnect)
 * instead of eth_newFilter which is not universally supported.
 */
import { useEffect, useRef, useCallback } from "react";
import { usePublicClient } from "wagmi";
import { type Address, parseAbiItem, type AbiEvent } from "viem";
import { CONTRACTS } from "@/config/contracts";

// Events we care about for ranking changes
const REGISTRY_EVENTS: AbiEvent[] = [
  parseAbiItem("event MyBlockCreated(address indexed center, uint256 indexed level, address blockAddress)") as AbiEvent,
  parseAbiItem("event InviteCountUpdated(address indexed blockAddr, uint256 newCount)") as AbiEvent,
  parseAbiItem("event BlockSettled(address indexed blockAddress, address indexed center, uint256 level, bool advanced, address payoutTo)") as AbiEvent,
  parseAbiItem("event UserRegistered(address indexed user, address indexed referrer, uint256 level)") as AbiEvent,
];

const SEPOLIA_CHAIN_ID = 11155111;

// Delay to allow the subgraph to index the new event before querying
const SUBGRAPH_INDEX_DELAY_MS = 8_000;

// How often to poll for new logs (every 15 seconds)
const POLL_INTERVAL_MS = 15_000;

// How many blocks back to check on each poll (Sepolia ~12s/block, 15s poll → ~2 blocks)
const BLOCKS_PER_POLL = 5n;

interface UseContractEventRefreshOptions {
  /** Callback to execute when an event is detected (after indexing delay) */
  onEvent: () => void;
  /** Whether the watcher is active */
  enabled?: boolean;
}

export function useContractEventRefresh({ onEvent, enabled = true }: UseContractEventRefreshOptions) {
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const onEventRef = useRef(onEvent);
  const lastCheckedBlockRef = useRef<bigint>(0n);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const scheduleRefresh = useCallback(() => {
    // Clear existing timer (debounce)
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(() => {
      console.log("[useContractEventRefresh] Event detected → refreshing after indexing delay");
      onEventRef.current();
      refreshTimerRef.current = null;
    }, SUBGRAPH_INDEX_DELAY_MS);
  }, []);

  const pollForEvents = useCallback(async () => {
    if (!publicClient) return;

    try {
      const currentBlock = await publicClient.getBlockNumber();

      // On first poll, just set the baseline
      if (lastCheckedBlockRef.current === 0n) {
        lastCheckedBlockRef.current = currentBlock;
        console.log(`[useContractEventRefresh] Baseline block set: ${currentBlock}`);
        return;
      }

      // Skip if no new blocks
      if (currentBlock <= lastCheckedBlockRef.current) return;

      const fromBlock = lastCheckedBlockRef.current + 1n;
      const registryAddress = CONTRACTS.REGISTRY as Address;

      // Query logs for all events in a single call
      const logs = await publicClient.getLogs({
        address: registryAddress,
        fromBlock,
        toBlock: currentBlock,
      });

      if (logs.length > 0) {
        console.log(
          `[useContractEventRefresh] ${logs.length} event(s) in blocks ${fromBlock}-${currentBlock}`
        );
        scheduleRefresh();
      }

      lastCheckedBlockRef.current = currentBlock;
    } catch (err: any) {
      // Silently ignore known RPC limitations (WalletConnect doesn't support eth_getLogs well)
      const msg = err?.message || "";
      const isKnownRpcIssue =
        msg.includes("invalid block range") ||
        msg.includes("rate limit") ||
        msg.includes("filter not found") ||
        msg.includes("Missing or invalid parameters");

      if (!isKnownRpcIssue) {
        console.warn("[useContractEventRefresh] Poll error:", msg);
      }
    }
  }, [publicClient, scheduleRefresh]);

  useEffect(() => {
    if (!enabled || !publicClient) return;

    console.log("[useContractEventRefresh] Starting on-chain event polling (eth_getLogs)");

    // Initial poll
    pollForEvents();

    // Set up interval
    pollIntervalRef.current = setInterval(pollForEvents, POLL_INTERVAL_MS);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      lastCheckedBlockRef.current = 0n;
      console.log("[useContractEventRefresh] Polling stopped");
    };
  }, [enabled, publicClient, pollForEvents]);
}
