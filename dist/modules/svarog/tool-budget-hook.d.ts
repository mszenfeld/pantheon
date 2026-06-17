interface SvarogToolHookDeps {
    /** Resolve a session's agent key. Returns undefined when unknown (-> fail-open). */
    resolveAgent: (sessionID: string) => Promise<string | undefined>;
    /** Best-effort recovery snapshot, invoked on the first mutating tool (edit/write/multiedit or a
     *  serena editor) and retried on the next one if it throws — so it runs at most once successfully
     *  per session. Failures are swallowed — the checkpoint is a recovery aid, never a gate. Omit in
     *  tests that do not exercise it. */
    createCheckpoint?: (sessionID: string) => void;
}
interface SvarogToolHookInput {
    tool: string;
    sessionID: string;
    callID: string;
}
interface SvarogToolHookOutput {
    args: {
        command?: unknown;
        filePath?: unknown;
    };
}
type SvarogToolHook = (input: SvarogToolHookInput, output: SvarogToolHookOutput) => Promise<void>;
interface SvarogToolHookHandle {
    /** The tool.execute.before handler (allow/deny gate + one-time recovery checkpoint). */
    hook: SvarogToolHook;
    /** Drop a session's "checkpoint created" marker. Called from the plugin's session.deleted. */
    clearSession: (sessionID: string) => void;
}
/**
 * Build the `tool.execute.before` handler for Svarog. Unlike Stribog this is ALLOW-by-default
 * with a DENY FLOOR and NO edit budget (Svarog is the multi-file executor). Order is load-bearing:
 *   (1) pre-filter read/glob/grep without attribution;
 *   (2) attribution gate — fail OPEN for non-svarog / unresolved sessions;
 *   (2a) auto-create the recovery checkpoint ONCE before the first mutating tool (best-effort);
 *   (2b) bash secret-generation tripwire -> SECRET_DENIED;
 *   (2c) serena-EDITOR carve-out (allowed BEFORE the floor, which would otherwise deny them);
 *   (3) explicit `question` deny (headless leaf -> ESCALATE; no isImmutableDeny pattern covers it);
 *   (4) the shared isImmutableDeny floor, REUSED UNCHANGED (shell / dispatch / recipe / DB-mutation /
 *       serena memory-write). The carve-out at (2c) is the only reason the legit serena editors pass;
 *   (5) everything else -> ALLOW (edit/write/multiedit, serena reads + diagnostics, skill, ...).
 * Fail-open on the attribution axis and on any internal error; only intended denials throw.
 */
declare function makeSvarogToolHook(deps: SvarogToolHookDeps): SvarogToolHookHandle;

export { type SvarogToolHook, type SvarogToolHookDeps, type SvarogToolHookHandle, type SvarogToolHookInput, type SvarogToolHookOutput, makeSvarogToolHook };
