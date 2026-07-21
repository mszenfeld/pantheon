import { SessionAgentRegistry } from '../_shared/session-agent-registry.js';
import { h as DispatchSpecialist } from '../../dispatch-scrubbers-CdWGxgiG.js';
import { AgentInfo } from './task-builder.js';
import { BackgroundTaskStore } from './background-store.js';
import './poller.js';

/** Per-parent cap on concurrent background tasks. Mirrors DISPATCH_CONCURRENCY;
 *  bounds spawn count (cost-DoS). Separate from the synchronous worker pool. */
declare const BACKGROUND_MAX_CONCURRENT = 4;
interface StartBackgroundInput {
    store: BackgroundTaskStore;
    specialist: DispatchSpecialist;
    agentRegistry: Record<string, AgentInfo>;
    parentSessionId: string;
    agent: string;
    prompt: string;
    context?: string;
    executionContext?: "perun-headless";
    /** Caller's mode — see dispatch.ts DispatchParallelInput.callerMode. */
    callerMode?: AgentInfo["mode"];
    /**
     * QA `sessionAgentRegistry`. When set, the background child is registered
     * (childSessionID → agent name) so it no longer reads as the coordinator in
     * the caller gate. `undefined` is a no-op (e.g. unit tests). Mirrors the
     * foreground path's `dispatch.ts` `options.sessionAgentRegistry?.register`.
     */
    sessionAgentRegistry?: SessionAgentRegistry;
}
interface StartBackgroundResult {
    id: string;
    agent: string;
    status: "running";
}
declare function startBackgroundTask(input: StartBackgroundInput): Promise<StartBackgroundResult>;
interface CollectBackgroundInput {
    store: BackgroundTaskStore;
    specialist: DispatchSpecialist;
    ids: string[];
    block: boolean;
    timeoutMs?: number;
    pollIntervalMs?: number;
    resultMaxBytes?: number;
    signal?: AbortSignal;
    /**
     * Legacy live-read scrubber applied to every collected result after the
     * untrusted-output neutraliser, before truncation. Receives
     * (text, parentSessionID). Used only when no `scrubberFactory` is provided —
     * the factory is the race-safe path and takes precedence.
     */
    scrubber?: (text: string, parentSessionID: string) => string;
    /**
     * Factory that pins a per-collect scrubber session. Called ONCE per
     * `collectBackground` call (i.e. per `poll_background` / `wait_background`),
     * BEFORE any task is collected; the returned `scrub(text)` is applied to
     * every result and `release()` is invoked in a `finally`. Takes precedence
     * over `scrubber`. This is the only path that routes background results
     * through the QA secret scrubber — the legacy `scrubber` field is permanently
     * `undefined` because the QA plugin registers only `scrubberFactory`.
     * Snapshotting per collect (rather than once at dispatch) keeps the redacted
     * view coherent with whatever bindings exist when the result is read, even
     * though the background turn itself injects no bindings.
     */
    scrubberFactory?: (parentSessionID: string) => {
        scrub: (text: string) => string;
        release: () => void;
    } | undefined;
    /**
     * The CALLER's session id (the poll_background / wait_background invoker),
     * threaded from `context.sessionID`. Serves two purposes:
     *   1. Pins the per-collect scrubber session (passed to `scrubberFactory`).
     *   2. Parent-session ownership gate in `collectOne`: a task is only
     *      collectable when `task.parentSessionId === parentSessionId`; a
     *      foreign task is reported as `not_found` (it is never read, and on the
     *      blocking path never removed). Caller identity is REQUIRED — when
     *      `undefined` the gate fails CLOSED (every task reads as foreign →
     *      `not_found`); see `collectOne`. Both production handlers always pass
     *      `context.sessionID`, so this is never `undefined` in production.
     */
    parentSessionId?: string;
    /**
     * TEST-ONLY escape hatch. When `true`, an absent `parentSessionId` skips the
     * ownership gate (the pre-fix fail-OPEN behaviour) so unit tests that don't
     * model a specific caller can still collect a seeded task. Production
     * handlers (`poll_background` / `wait_background`) MUST NEVER set this — they
     * always thread `context.sessionID`, so they have no reason to. Keeping the
     * fail-open path behind an explicit opt-in (rather than inferring it from a
     * missing id) means a real handler that forgets to pass an id fails closed,
     * not open.
     */
    allowUnscopedCollect?: boolean;
}
interface BackgroundCollectResult {
    id: string;
    agent: string;
    status: "running" | "success" | "timeout" | "aborted" | "error" | "not_found";
    result?: string;
    duration_ms?: number;
    error?: string;
}
declare function collectBackground(input: CollectBackgroundInput): Promise<BackgroundCollectResult[]>;

export { BACKGROUND_MAX_CONCURRENT, type BackgroundCollectResult, type CollectBackgroundInput, type StartBackgroundInput, type StartBackgroundResult, collectBackground, startBackgroundTask };
