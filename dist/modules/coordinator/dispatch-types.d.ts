/**
 * Shared vocabulary types for the coordinator dispatch modules.
 *
 * Types only — no runtime values. Every dispatch module imports from here
 * one-directionally, which keeps the underlying module graph acyclic.
 * The original modules re-export these names, so external import paths
 * (including the `dispatch.ts` public API) are unchanged.
 */
interface DispatchTask {
    name: string;
    prompt: string;
    context?: string;
    executionContext?: "perun-headless";
}
interface AgentInfo {
    mode: "primary" | "subagent" | "all";
}
interface AgentTimeout {
    wallClockMs: number;
    idleMs?: number;
}
interface DispatchResult {
    name: string;
    status: "success" | "error" | "timeout" | "aborted";
    result: string;
    duration_ms: number;
    error?: string;
    sessionId?: string;
}
interface DispatchScrubberSession {
    scrub: (text: string) => string;
    release: () => void;
}
type DispatchScrubber = (text: string, parentSessionID: string) => string;
type DispatchScrubberFactory = (parentSessionID: string) => DispatchScrubberSession | undefined;

export type { AgentInfo, AgentTimeout, DispatchResult, DispatchScrubber, DispatchScrubberFactory, DispatchScrubberSession, DispatchTask };
