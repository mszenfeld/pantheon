import { SessionAgentRegistry } from '../_shared/session-agent-registry.js';
import { PollerMessage } from './poller.js';

interface DispatchTask {
    name: string;
    prompt: string;
    context?: string;
}
interface DispatchResult {
    name: string;
    status: "success" | "error" | "timeout" | "aborted";
    result: string;
    duration_ms: number;
    error?: string;
}
interface DispatchSpecialist {
    /**
     * Start a foreground task: create the child session, then fire the turn via
     * `session.promptAsync` (returns immediately; the server runs the turn
     * autonomously). Resolves the child session id WITHOUT awaiting the turn —
     * completion is observed by `runTask`'s `pollUntilIdle`, so `taskTimeoutMs`
     * and the abort `signal` govern the ENTIRE turn rather than only a post-turn
     * confirmatory poll. `onSessionCreated`, if provided, fires with the child
     * session id AFTER the session is created but BEFORE the turn is fired — this
     * is the only point at which a caller can record the child→agent mapping in
     * time for the `shell.env` hook, which fires mid-turn server-side.
     */
    startTask(agentName: string, prompt: string, onSessionCreated?: (sessionId: string) => void): Promise<string>;
    fetchMessages(sessionId: string): Promise<PollerMessage[]>;
    /**
     * Authoritative "turn loop still running" probe for a child session
     * (`GET /session/status`; absence from the map means idle). Completion
     * detection needs BOTH signals: the server persists `finish` on the
     * assistant message after every step, so a terminal-looking transcript
     * observed while the session is still active is the inter-step (or
     * auto-compaction) race, not completion.
     *
     * Degraded-mode contract (two intentional layers, not a redundancy):
     *  - Producer SHOULD degrade to `false` on status-endpoint failure rather
     *    than propagate, so a flaky status call reads as "idle" and completion
     *    falls back to the message-only predicate instead of failing the dispatch.
     *  - Callers do NOT rely on that alone: every consumer routes this probe
     *    through the shared `probeSessionActive` primitive (`session-active.js`),
     *    which is the single authoritative consumer-side degraded-mode gate
     *    (rejection ⇒ inactive). That defence-in-depth means a future
     *    implementation that DOES throw cannot wedge or fail the poll — it
     *    degrades to message-only completion exactly as if it had returned `false`.
     */
    isSessionActive(sessionId: string): Promise<boolean>;
    /**
     * Cancel a previously-started session so the child stops doing work
     * server-side (no orphaned compute, no charges). Called on BOTH terminal
     * non-success paths: when `ToolContext.abort` fires, AND when the task times
     * out — in both cases the child's `promptAsync` turn is still running
     * autonomously and would otherwise run to completion as orphaned compute.
     * Implementations should treat this as best-effort: errors must not surface
     * to the caller (the abort/timeout path already returns its result).
     */
    abortTask(sessionId: string): Promise<void>;
    /**
     * Start a task in the background: create the child session, then fire it via
     * `session.promptAsync` (returns a 204 immediately; the server runs the LLM
     * turn autonomously). Resolves the child session id WITHOUT awaiting the turn.
     * Rejects if session creation or the async-prompt acknowledgement fails.
     */
    startBackground(agentName: string, prompt: string): Promise<string>;
}
interface AgentInfo {
    mode: "primary" | "subagent" | "all";
}
/**
 * Names of `mode: "all"` agents that MAY be dispatched — but ONLY by a
 * primary-mode caller. This is the single narrow relaxation of the otherwise
 * subagent-only rule: it lets the primary coordinator (Perun) dispatch the
 * planning agent (Veles, a `mode: "all"` agent that is also user-switchable)
 * while still blocking Veles→Veles, *→Perun, and any other `primary`/`all`
 * target. Keep this set MINIMAL — every entry widens the anti-recursion surface.
 */
declare const DISPATCHABLE_ALL_AGENTS: ReadonlySet<string>;
/**
 * Anti-recursion guard. Dispatchable targets:
 *   - any strict `subagent` (from any caller), OR
 *   - an allowlisted `all` agent (DISPATCHABLE_ALL_AGENTS) when the CALLER is
 *     `primary`.
 * Everything else throws: a `primary` target, a non-allowlisted `all` target,
 * or an allowlisted `all` target dispatched by a non-primary caller (this last
 * case blocks Veles→Veles self/nested recursion). `callerMode` is resolved by
 * the dispatch tool from `agentRegistry[context.agent].mode`; when omitted
 * (legacy callers / unit tests) the allowlisted-`all` path is closed, so the
 * default stays safe. Shared by `dispatchParallel` and the background path.
 */
declare function validateDispatchable(agentRegistry: Record<string, AgentInfo>, name: string, callerMode?: AgentInfo["mode"]): void;
interface DispatchParallelInput {
    tasks: DispatchTask[];
    agentRegistry: Record<string, AgentInfo>;
    specialist: DispatchSpecialist;
    pollIntervalMs?: number;
    taskTimeoutMs?: number;
    resultMaxBytes?: number;
    /**
     * Optional aggregate (whole-wave) byte budget for the SUCCESSFUL results of
     * this call, applied AFTER the per-task `resultMaxBytes` cap. Results are
     * walked in input order, summing UTF-8 body bytes against the budget; once it
     * is exhausted, each remaining successful body is truncated to fit (or to an
     * empty-but-marked pointer when nothing fits) with a marker pointing to the
     * child session. Defaults to `DEFAULT_AGGREGATE_MAX_BYTES`. See that constant
     * for the rationale (bounds a single tool-result's token footprint).
     */
    aggregateMaxBytes?: number;
    /**
     * Optional abort signal threaded through to every in-flight task. When the
     * signal aborts, each task whose poller is still running terminates within
     * one poll-interval with status `"aborted"`, and `abortTask(sessionId)` is
     * called best-effort so the child session is cancelled server-side.
     */
    signal?: AbortSignal;
    /**
     * Optional registry that records (childSessionID → task.name) at dispatch
     * time. Consumed by plugin hooks (e.g. shell.env) that need to know which
     * agent is running in a given session. Registration persists for the
     * OpenCode session lifetime; cleanup is the plugin's session.deleted
     * handler — not unregistered inside dispatch.
     */
    sessionAgentRegistry?: SessionAgentRegistry;
    /**
     * Optional log-scrubber applied to every task result after the untrusted-
     * output neutraliser, before truncation. Receives (text, parentSessionID)
     * and returns redacted text. Used by the QA bindings flow to redact known
     * secret values from Zmora results before they reach the report or TUI.
     *
     * If a `scrubberFactory` is also provided, the factory wins and this field
     * is ignored — the factory yields a pinned-snapshot scrubber, which is the
     * race-safe path.
     */
    scrubber?: (text: string, parentSessionID: string) => string;
    /**
     * Optional factory that produces a per-dispatch scrubber session. Called
     * ONCE at the start of `dispatchParallel`; the returned `scrub(text)` is
     * applied to every task result; `release()` is invoked in a `finally` after
     * all tasks complete (success, failure, or abort). Takes precedence over
     * `scrubber`. This is the only race-safe scrubber path for store-backed
     * implementations — see `DispatchScrubberFactory` for the contract.
     */
    scrubberFactory?: (parentSessionID: string) => {
        scrub: (text: string) => string;
        release: () => void;
    } | undefined;
    /**
     * Parent (Perun) session ID — passed to the scrubber/factory. Required if
     * either is set; ignored otherwise.
     */
    parentSessionID?: string;
    /**
     * Mode of the agent that invoked the dispatch tool (resolved from
     * `agentRegistry[context.agent]`). Passed to `validateDispatchable` so an
     * allowlisted `all` target (Veles) is dispatchable only from a `primary`
     * caller (Perun). Omitted ⇒ allowlisted-`all` dispatch is rejected.
     */
    callerMode?: AgentInfo["mode"];
    /**
     * Optional preflight hook fired ONCE per `dispatchParallel` call, before any
     * specialist session is spawned. The QA plugin uses this to lazily parse the
     * parent plan's `**Bindings:**` section into `QaRunState` so subsequent
     * `execute_recipe` calls can find recipes by name. Implementations must be
     * idempotent and must not throw — preflight errors are swallowed so they
     * cannot break unrelated dispatches.
     */
    preflight?: (input: {
        parentSessionID: string;
        taskNames: readonly string[];
    }) => Promise<void>;
}
declare const DEFAULT_POLL_INTERVAL_MS = 1000;
declare const DEFAULT_TASK_TIMEOUT_MS: number;
declare const DEFAULT_RESULT_MAX_BYTES: number;
declare const DEFAULT_AGGREGATE_MAX_BYTES: number;
declare const DISPATCH_MAX_TASKS = 4;
declare const DISPATCH_CONCURRENCY = 4;
declare function dispatchParallel(input: DispatchParallelInput): Promise<DispatchResult[]>;

export { type AgentInfo, DEFAULT_AGGREGATE_MAX_BYTES, DEFAULT_POLL_INTERVAL_MS, DEFAULT_RESULT_MAX_BYTES, DEFAULT_TASK_TIMEOUT_MS, DISPATCHABLE_ALL_AGENTS, DISPATCH_CONCURRENCY, DISPATCH_MAX_TASKS, type DispatchParallelInput, type DispatchResult, type DispatchSpecialist, type DispatchTask, dispatchParallel, validateDispatchable };
