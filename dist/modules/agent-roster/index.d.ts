import { Plugin, Config } from '@opencode-ai/plugin';

/**
 * Visible-primary native built-in agents on opencode 1.15.10 — the ONLY natives
 * that appear in the picker. `general`/`explore` are `mode:"subagent"` (already
 * excluded by the picker filter `mode!=="subagent" && !hidden`), and
 * `compaction`/`title`/`summary` are already `hidden`. Natives live in the
 * runtime's INTERNAL agent map and are NEVER present in `config.agent`, so the
 * snapshot-diff cannot hide them — only the backstop (override-by-key) can.
 * Re-verify against the actual picker (NOT the SDK type enum) on opencode bumps.
 */
declare const NATIVE_BUILTINS: readonly ["build", "plan"];
/**
 * `default_agent` is honored by the opencode runtime but is absent from the v1
 * SDK `Config` type the plugin compiles against (it exists only in v2 types,
 * unused for `Config`). These accessors localize the cast. Re-check on the next
 * `@opencode-ai/plugin` bump — once the field is native, the cast is removable.
 */
declare function getDefaultAgent(config: Config): string | undefined;
declare function setDefaultAgent(config: Config, name: string): void;
declare const COORDINATOR_AGENT = "Perun - Coordinator";
/**
 * Make the harness own the agent roster: hide every `config.agent` key we did
 * not register. `preExisting` = keys present BEFORE the harness's per-module
 * config hooks ran (user/project agents). Deterministic — mutates `config` in place.
 *
 * Two complementary mechanisms (a union, not redundant):
 *  - snapshot-diff hides user/project agents (they appear in config.agent);
 *  - the NATIVE_BUILTINS backstop hides build/plan (natives are never in
 *    config.agent, so only override-by-key can reach them).
 */
declare function applyRosterPolicy(config: Config, preExisting: Set<string>): void;
/**
 * Shape of an entry from the runtime's `client.app.agents()` listing — the
 * AUTHORITATIVE agent map, including the native built-ins that never appear in
 * `config.agent` (so the snapshot-diff cannot see them). We only read the three
 * fields the picker filter cares about. `native`/`builtIn` are accepted as a
 * union because the flag's name differs across SDK type versions (`builtIn` in
 * the v1 listing type, `native` in v2); `hidden` is honored by the runtime but
 * is absent from the v1 listing type — same v1-SDK gap localized for
 * `default_agent` above, so we read it via a tolerant cast.
 */
interface RuntimeAgent {
    name?: string;
    mode?: string;
    native?: boolean;
    builtIn?: boolean;
    hidden?: boolean;
}
/**
 * Drift detector for the one manual touchpoint. `NATIVE_BUILTINS` is hand-pinned
 * to the natives the picker shows on the verified opencode build; a future bump
 * could introduce a NEW native visible-primary (e.g. `chat`) that silently
 * leaks into the picker, breaking "the harness owns the roster". This enumerates
 * the runtime agent map and returns any native whose `mode!=="subagent" &&
 * !hidden` is NOT covered by `NATIVE_BUILTINS` — i.e. would slip past the
 * backstop. Pure (no I/O); the caller decides how to surface the result.
 * Returns a sorted, de-duplicated list of uncovered native keys.
 */
declare function findUncoveredNatives(agents: readonly RuntimeAgent[]): string[];
/**
 * Human-readable warning describing the uncovered natives. Exported so the test
 * can assert the message without driving the whole event hook.
 */
declare function buildDriftWarning(uncovered: readonly string[]): string;
/**
 * Harness self-check plugin: on first `session.created`, enumerate the runtime's
 * actual agent map (`client.app.agents()`) and warn — toast + stderr — if a
 * native visible-primary key is not covered by `NATIVE_BUILTINS`. CONSERVATIVE
 * by design: it warns, it never mutates the roster or throws, so a missed native
 * surfaces loudly without breaking startup. Mirrors the explore/plan
 * degraded-mode toast wiring (one-shot, best-effort, `console.error` +
 * `client.tui.showToast`). The actual hiding still happens in
 * `applyRosterPolicy`; this only guards against `NATIVE_BUILTINS` going stale on
 * an opencode bump.
 */
declare const AppVerkAgentRosterPlugin: Plugin;

export { AppVerkAgentRosterPlugin, COORDINATOR_AGENT, NATIVE_BUILTINS, applyRosterPolicy, buildDriftWarning, AppVerkAgentRosterPlugin as default, findUncoveredNatives, getDefaultAgent, setDefaultAgent };
