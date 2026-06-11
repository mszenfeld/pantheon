/**
 * Structural view of the slice of the OpenCode plugin `client` this notifier
 * uses. Mirrors the `ConfigLike` pattern in `serena-detect.ts`: we model only
 * the one method we call so the helper stays decoupled from the exact SDK type
 * and is trivial to fake in tests. The parameter is optional and the `variant`
 * is the SDK's literal union so a real `OpencodeClient` is assignable here
 * (contravariant arg position — a stricter/required arg would reject it).
 */
interface ToastClientLike {
    tui: {
        showToast: (input?: {
            body: {
                variant: "success" | "error" | "warning" | "info";
                title: string;
                message: string;
            };
        }) => Promise<unknown>;
    };
}
/** Structural view of the OpenCode `event` payload this notifier inspects. */
interface EventLike {
    event: {
        type: string;
    };
}
interface SerenaDegradedNotifier {
    /**
     * Record whether serena is missing. Call from the `config` hook (which runs
     * at config-assembly time, BEFORE the first `session.created`). Passing
     * `false` re-arms the "serena present" path; the toast only fires when this
     * was last called with `true`.
     */
    markSerenaMissing(missing: boolean): void;
    /**
     * `event`-hook handler. Fires the degraded-mode toast at most once, and only
     * when serena was marked missing. Best-effort: headless / non-TUI
     * invocations (where `showToast` throws) must not crash the session.
     */
    onEvent(input: EventLike): Promise<void>;
}
/**
 * Build the shared serena degraded-mode notifier. `message` is the agent's
 * distinct warning string (Triglav talks about exploration, Veles about
 * planning); everything else — the once-only latch, the stderr mirror, the
 * headless-safe try/catch — is shared.
 */
declare function makeSerenaDegradedNotifier(client: ToastClientLike, message: string): SerenaDegradedNotifier;

export { type EventLike, type SerenaDegradedNotifier, type ToastClientLike, makeSerenaDegradedNotifier };
