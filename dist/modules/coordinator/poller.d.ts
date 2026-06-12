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
     * probe reports inactive. It is consulted ONLY after the message predicate
     * passes (no extra HTTP per ordinary poll), and a rejection is treated as
     * inactive so a broken status endpoint degrades to message-only completion
     * instead of wedging the task until `timeoutMs`.
     */
    isSessionActive?: () => Promise<boolean>;
}
declare class PollerTimeoutError extends Error {
    readonly kind: "timeout";
    readonly elapsedMs: number;
    constructor(elapsedMs: number);
}
declare class PollerAbortError extends Error {
    readonly kind: "abort";
    readonly elapsedMs: number;
    constructor(elapsedMs: number);
}
declare function pollUntilIdle(options: PollUntilIdleOptions): Promise<string>;

export { type PollUntilIdleOptions, PollerAbortError, type PollerMessage, PollerTimeoutError, pollUntilIdle };
