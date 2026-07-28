/**
 * Shared vocabulary types for the coordinator dispatch modules.
 *
 * Types only — no runtime values. Every dispatch module imports from here
 * one-directionally, which keeps the underlying module graph acyclic.
 * The original modules re-export these names, so external import paths
 * (including the `dispatch.ts` public API) are unchanged.
 */

export interface DispatchTask {
  name: string
  prompt: string
  context?: string
  executionContext?: "perun-headless"
}

export interface AgentInfo {
  mode: "primary" | "subagent" | "all"
}

export interface AgentTimeout {
  wallClockMs: number
  idleMs?: number
}

export interface DispatchResult {
  name: string
  status: "success" | "error" | "timeout" | "aborted"
  result: string
  duration_ms: number
  error?: string
  sessionId?: string
}

export interface DispatchScrubberSession {
  scrub: (text: string) => string
  release: () => void
}

export type DispatchScrubber = (text: string, parentSessionID: string) => string
export type DispatchScrubberFactory = (
  parentSessionID: string,
) => DispatchScrubberSession | undefined
