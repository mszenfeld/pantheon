/**
 * Single source of truth for per-agent model wiring.
 *
 * Before this helper, each agent-registering module (`coordinator`, `qa`,
 * `explore`, `plan`, `stribog`) hand-rolled the same three-line block:
 *
 *   const model = loadPantheonConfig().agents.<slug>?.model
 *   if (model !== undefined) config.agent[<key>].model = model
 *
 * That meant the slug↔agent-key relationship existed only as five copies, and
 * the slug→key mapping diverged in non-obvious ways (`plan`'s config slug is
 * `veles` but its agent key is the display name `Veles - Planner`; `qa`'s `zmora`
 * slug fans out to three `zmora-{fe,be,setup}` keys). Worse, a typo in
 * `pantheon.json` (`agents.strigob`, `agents."Veles - Planner"`) validated
 * cleanly, was consumed by nothing, and silently did nothing — no toast, no
 * stderr.
 *
 * `applyModelOverride` collapses the five copies into one call AND registers the
 * slug as "known", so the loader-diagnostic channel (`getUnknownAgentDiagnostics`
 * → coordinator's `getLoadErrors`→toast/stderr sink) can flag any `agents.<name>`
 * key in `pantheon.json` that no module ever claimed.
 *
 * The model value is pre-validated by `MODEL_REGEX` in
 * `src/modules/pantheon-config/schema.ts` (CWE-117), so an invalid value is
 * already absent from `loadPantheonConfig()` and falls through to `defaultModel`.
 */

import { loadPantheonConfig } from "../pantheon-config/index.js"

/** Structural view of the slice of OpenCode `config` this helper mutates. */
export interface ModelConfigLike {
  agent?: Record<string, { model?: string } | undefined>
}

/**
 * Process-wide registry of every config slug a module has claimed via
 * `applyModelOverride`. Populated in each module's `config` hook (which runs at
 * config-assembly time, BEFORE the first `session.created`), so the coordinator's
 * `session.created` diagnostic sink always sees the full set.
 *
 * A plain module-global `Set` is the right scope here: agent registration is a
 * one-shot, process-lifetime fact (the same five slugs every run), mirroring the
 * `agent-registry` SpecialistInfo registry.
 */
const knownSlugs = new Set<string>()

/** Register a config slug as known without wiring a model (rarely needed directly). */
export function registerKnownSlug(slug: string): void {
  knownSlugs.add(slug)
}

/** Snapshot of all registered slugs, sorted for stable diagnostics/tests. */
export function getKnownSlugs(): readonly string[] {
  return [...knownSlugs].sort()
}

/**
 * Wire the per-agent model onto one or more OpenCode agent keys following the
 * documented precedence (`docs/configuring-agents.md` → "Precedence vs.
 * opencode.json"), registering the slug as known.
 *
 * Per key, the effective model is resolved highest-wins:
 *   1. the user's `agent.<key>.model` from `opencode.json` (captured via
 *      `captureUserModels` BEFORE the module replaced the entry) — HIGHEST;
 *   2. the `pantheon.json` `agents.<slug>.model` override;
 *   3. the harness `defaultModel` (only Stribog pins one) — LOWEST.
 * If none apply the model is left unset (the agent inherits the session
 * default).
 *
 * @param config       The OpenCode config being assembled (mutated in place).
 * @param slug         The `pantheon.json` `agents.<slug>` key for this agent.
 * @param agentKeys    The `config.agent[...]` key(s) the slug maps to. A single
 *                     string or a list (QA's `zmora` slug fans out to three).
 * @param defaultModel Optional fallback applied when neither a user model nor a
 *                     pantheon override is present. Omit to leave the model
 *                     unset; pass a value to pin a default (Stribog).
 * @param userModels   Per-key user models snapshotted by `captureUserModels`
 *                     before the wholesale replace. Each key prefers its own
 *                     captured value, so a user setting only `agent.zmora-be`
 *                     keeps the override/default on `zmora-fe`/`zmora-setup`.
 */
export function applyModelOverride(
  config: ModelConfigLike,
  slug: string,
  agentKeys: string | readonly string[],
  defaultModel?: string,
  userModels?: ReadonlyMap<string, string>,
): void {
  registerKnownSlug(slug)

  const keys = typeof agentKeys === "string" ? [agentKeys] : agentKeys
  const override = loadPantheonConfig().agents[slug]?.model

  const agents = config.agent
  if (agents === undefined) return
  for (const key of keys) {
    const agent = agents[key]
    // Structurally impossible in practice — the caller sets the key just before
    // calling this — but the guard keeps the helper total for malformed input.
    if (agent === undefined) continue
    // opencode.json (user) > pantheon.json (override) > harness default.
    const model = userModels?.get(key) ?? override ?? defaultModel
    if (model === undefined) continue
    agent.model = model
  }
}

/**
 * Compute diagnostics for `agents.<name>` keys present in `pantheon.json` that
 * no module ever claimed via `applyModelOverride`. Each entry is a ready-to-emit
 * `[pantheon] unknown agent "<name>" — known: …` line.
 *
 * Read at `session.created` by the coordinator, AFTER every module's `config`
 * hook has run and registered its slug. Returns `[]` when every configured
 * agent name is known (the common case), so it costs nothing on clean configs.
 *
 * The `<name>` token is interpolated raw here; the coordinator passes every
 * load-error line (this included) through `neutralizeUntrustedOutput` before the
 * toast/stderr sinks see it (CWE-117), matching how the rest of `getLoadErrors`
 * is handled.
 */
export function getUnknownAgentDiagnostics(): string[] {
  const configured = Object.keys(loadPantheonConfig().agents)
  if (configured.length === 0) return []

  const known = getKnownSlugs()
  const knownSet = new Set(known)
  const diagnostics: string[] = []
  for (const name of configured) {
    if (knownSet.has(name)) continue
    const knownList = known.length > 0 ? known.join(", ") : "(none registered)"
    diagnostics.push(`[pantheon] unknown agent "${name}" — known: ${knownList}`)
  }
  return diagnostics
}

/**
 * Snapshot the `.model` already present on each agent key BEFORE a module's
 * `config` hook wholesale-replaces `config.agent[key]`.
 *
 * The documented precedence (`docs/configuring-agents.md` → "Precedence vs.
 * opencode.json") puts a user's `agent.<name>.model` from `opencode.json`
 * ABOVE `pantheon.json`. But every harness module assigns `config.agent[key] =
 * { … }` wholesale — dropping any pre-existing user entry, model included —
 * before it calls `applyModelOverride`. By the time the override runs the user
 * value is already gone, so `pantheon.json` (or, for Stribog, the harness
 * default) silently wins — the inverse of the documented contract.
 *
 * The fix is to capture the user's model here, at the top of the hook, then
 * thread the result back into `applyModelOverride` (via `userModels`) so it can
 * restore the user's choice at the top of the precedence chain. The merged
 * `config` hook in `src/index.ts` snapshots user/project agent keys at the same
 * point (`preExisting`), confirming a user `agent.<name>.model` IS present in
 * `config.agent` before any module hook runs.
 *
 * @param config    The OpenCode config being assembled (read-only here).
 * @param agentKeys The `config.agent[...]` key(s) the slug maps to.
 * @returns A map of agent key → pre-existing `.model` for keys that had one.
 *          Keys without a user model are omitted, so the map is empty in the
 *          common (no-opencode.json-override) case.
 */
export function captureUserModels(
  config: ModelConfigLike,
  agentKeys: string | readonly string[],
): Map<string, string> {
  const keys = typeof agentKeys === "string" ? [agentKeys] : agentKeys
  const captured = new Map<string, string>()
  const agents = config.agent
  if (agents === undefined) return captured
  for (const key of keys) {
    const model = agents[key]?.model
    if (typeof model === "string" && model.length > 0) captured.set(key, model)
  }
  return captured
}

/** Test-only: clear the slug registry between tests. Do not call in production. */
export function __resetKnownSlugsForTests(): void {
  knownSlugs.clear()
}
