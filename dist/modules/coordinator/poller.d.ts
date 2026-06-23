interface PollerMessage {
    role: string;
    content: string;
    /**
     * TERMINAL finish reason, or null/undefined while the turn is still in
     * flight. The SDK adapter (`toPollerMessage`) maps the server's
     * non-terminal step finishes (`"tool-calls"`, `"unknown"`, or any finish on
     * a message that still carries client-executed tool calls) to null —
     * mirroring the OpenCode turn loop's own exit predicate — so a truthy value
     * here means "this step will not be followed by another".
     */
    finish_reason?: string | null | undefined;
}
interface PollUntilIdleOptions {
    fetchMessages: () => Promise<PollerMessage[]>;
    timeoutMs: number;
    pollIntervalMs: number;
    /**
     * Optional abort signal. When the signal aborts during polling (or during
     * the inter-poll sleep), `pollUntilIdle` throws `PollerAbortError` within
     * one poll-interval. This is how the coordinator surfaces
     * `ToolContext.abort` to in-flight child sessions.
     */
    signal?: AbortSignal;
    /**
     * Optional byte-level cap on the polled assistant content (UTF-8 bytes).
     * When set, `pollUntilIdle` truncates the LAST message's content using a
     * UTF-8-safe slice before returning it as the result. Together with the
     * adapter's projection in `createSDKSpecialist.fetchMessages` (which
     * returns at most a single message — the latest one), this provides a true
     * per-poll memory bound: each poll allocates O(maxBytes) rather than
     * O(transcript-length).
     */
    maxBytes?: number;
    /**
     * Optional session-status probe — the authoritative "turn loop still
     * running" signal. A terminal-looking message is necessary but NOT
     * sufficient: the OpenCode server persists `finish` after EVERY step, so
     * between two LLM steps (and during auto-compaction) the last message can
     * carry a terminal finish while the turn is still in flight. When provided,
     * `pollUntilIdle` only resolves once the message looks terminal AND this
     * probe reports inactive. For the COMPLETION gate it is consulted ONLY after
     * the message predicate passes (no extra HTTP per ordinary poll); a rejection
     * is treated as inactive so a broken status endpoint degrades to message-only
     * completion instead of wedging the task until `timeoutMs`. When
     * `idleTimeoutMs` is set it is ALSO consulted as a liveness fallback, but only
     * on a poll where the visible content did not grow (see `idleTimeoutMs`).
     */
    isSessionActive?: () => Promise<boolean>;
    /**
     * Optional INACTIVITY window (ms) — a heartbeat timeout layered under the
     * absolute `timeoutMs` backstop. When set, the loop tracks the wall-clock of
     * the last observed sign of life and throws `PollerTimeoutError(reason:
     * "idle")` once `idleTimeoutMs` elapses with NO progress. "Progress" is:
     *   1. the last assistant message's content grew (UTF-8 bytes changed since
     *      the previous poll — a streaming/generating turn), OR
     *   2. on a poll where content did NOT change, `isSessionActive()` reports the
     *      turn loop still busy (a long SILENT step — a multi-minute tool call or
     *      pre-emit reasoning where the visible message is static).
     * The status probe in (2) fires only on a static poll, so a steadily
     * streaming turn never pays the extra HTTP call. This lets a healthy but slow
     * child run for as long as it keeps working, while a genuinely wedged child
     * (no new output AND not busy) is caught within `idleTimeoutMs` rather than
     * burning the full `timeoutMs`. Omitted ⇒ pure wall-clock (`timeoutMs` only),
     * the historical behavior — so callers that do not opt in are unaffected.
     */
    idleTimeoutMs?: number;
}
/** Which of the two bounds tripped — surfaced in the error message and on the
 * `reason` field so a dispatch result distinguishes "slow/wedged with no
 * progress" (`idle`) from "hit the absolute ceiling" (`wall-clock`). */
type PollerTimeoutReason = "wall-clock" | "idle";
declare class PollerTimeoutError extends Error {
    readonly kind: "timeout";
    readonly elapsedMs: number;
    readonly reason: PollerTimeoutReason;
    constructor(elapsedMs: number, reason?: PollerTimeoutReason);
}
declare class PollerAbortError extends Error {
    readonly kind: "abort";
    readonly elapsedMs: number;
    constructor(elapsedMs: number);
}
declare function pollUntilIdle(options: PollUntilIdleOptions): Promise<string>;

export { type PollUntilIdleOptions, PollerAbortError, type PollerMessage, PollerTimeoutError, type PollerTimeoutReason, pollUntilIdle };
