# Registered-Agents-Only Roster — Design

**Date:** 2026-06-08
**Status:** Approved & reviewed (sequential-thinking decomposition + 5-agent
mixture-of-agents review incorporated). Ready for implementation plan.

## Problem

OpenCode ships native built-in agents `build` and `plan`. They appear in the
user-facing agent picker (Tab cycle / `/agents`) alongside the Pantheon harness
agents we register (Perun, Veles, triglav, zmora, the developer agents, …). We
want the picker to show **only the agents our harness registers** — the native
built-ins (and any user-authored agents) must disappear from selection.

`oh-my-openagent` (OMO) solves the same problem. Its mechanism is the basis for
this design.

## How OpenCode actually models agents (verified)

Verified against the decompiled `opencode` 1.15.10 binary and the SDK types.
These facts are load-bearing — the original design rested on a wrong mental
model and was corrected here.

- **Native built-ins live in the runtime's INTERNAL agent map, NOT in
  `config.agent`.** The runtime seeds `build` (`mode:"primary"`), `plan`
  (`mode:"primary"`), `general` (`mode:"subagent"`), `explore`
  (`mode:"subagent"`), plus `compaction`/`title`/`summary` (`mode:"primary",
  hidden:true`) into an internal map. `config.agent` (what the plugin `config`
  hook sees) is populated **only** from user/project/global filesystem agents
  and the legacy `mode` block. **So `build`/`plan` are never present in
  `config.agent` at hook time** unless a user authored same-named agents.
- **The picker filter is `mode !== "subagent" && !hidden`.** Verified in the TUI
  code. Therefore:
  - `hidden: true` **alone** removes an agent from the picker, regardless of
    `mode` (proof: native `compaction` is `mode:"primary", hidden:true` and never
    appears).
  - `general`/`explore` are already excluded because they are `mode:"subagent"`.
  - `compaction`/`title`/`summary` are already excluded because they are
    `hidden:true`.
  - The only **visible-primary** natives are exactly **`build` and `plan`**.
- **Override-by-key wins.** The runtime merge loop does
  `s.mode = h.mode ?? s.mode; s.hidden = h.hidden ?? s.hidden` keyed by agent
  name, where `s` is the internal entry and `h` is the `config.agent[name]` the
  hook produced. So writing `config.agent.build = { hidden: true }` mutates the
  same keyed entry and hides the native `build`. **This override-by-key is the
  only mechanism that can hide a native built-in** (snapshot-diff cannot — see
  Architecture).
- **`config.agent[key]` is mutated in-place and honored** after the hook returns
  (same object consumed downstream; no clone).
- **The plugin `config` hook is invoked exactly once per process** on 1.15.10
  (single invocation site, memoized service, no config-reload path). Reentrancy
  is not a current risk — but the design hardens against it anyway because this
  is a binary-internal contract, not a documented API (see Idempotency).
- **`default_agent` resolution throws on a hidden/subagent target.** If
  `config.default_agent` points to a hidden or `subagent` agent, the runtime
  throws at startup; if unset, it picks the first `mode !== "subagent" &&
  !hidden` agent. Value is looked up as a **map key** in `config.agent` (the key
  IS the display name in this repo). Hence hiding `build` (the native default)
  requires repointing `default_agent` to a visible primary.

### How OMO does it (reference)

- OMO does **not** delete `build`. In its `config` hook it writes
  `build: { ...migratedBuild, mode:"subagent", hidden:true }` **last** in the
  spread (override-by-key), and keeps `RESERVED_HIDDEN_NATIVE_AGENTS =
  new Set(["build"])` — treating `build` as **non-removable, hide-only**.
- **OMO hides `plan` only conditionally** (`plannerEnabled && replace_plan`),
  because it substitutes its own planner (Prometheus). When it ships no planner
  it leaves `plan` visible. **We hide `plan` unconditionally** — a deliberate
  divergence, because we provide our own primaries (Perun/Veles) and want no
  native planner in the roster.
- OMO's demoted `plan` carries a full model config so Task-fallback to it works;
  it also keeps a dispatch guard (`RESERVED_HIDDEN_NATIVE_AGENTS`) that refuses
  to resolve `build` as a dispatch target. **We implement neither** — see the
  `HIDE` choice below, which sidesteps the need.

## Decisions (locked)

1. **Scope:** general allowlist — *only agents we register are selectable*.
2. **Mechanism:** **hide via `{ hidden: true }`, preserving the agent's existing
   `mode`.** `hidden:true` alone removes from the picker (verified). We do **not**
   force `mode:"subagent"`: doing so would flip `build`/`plan` into dispatchable
   subagents (the dispatch preflight in `coordinator/dispatch.ts` rejects
   `primary` targets but accepts `subagent`), and our backstop writes them
   model-less, so a stray dispatch would error. Keeping their native `mode`
   (`primary`) means the dispatch preflight rejects them. `disable:true` is also
   rejected — OMO treats `build` as non-removable.
3. **Ownership model — Variant A:** the harness owns the **entire** roster. Every
   `config.agent` key we did not register is hidden — this covers user-authored
   agents (via snapshot-diff) and the native `build`/`plan` (via backstop).

## Architecture

Two locations, clean separation of concerns.

### a) `src/index.ts` (`createAppVerkPlugins`) — snapshot chokepoint

The merged `config` hook is the **only** place that observes state "before
plugin #1". Change the builder from:

```ts
merged.config = async (config) => {
  for (const plugin of plugins) await plugin.config?.(config)
}
```

to:

```ts
merged.config = async (config) => {
  const preExisting = new Set(Object.keys(config.agent ?? {})) // user/project agents only (see below)
  for (const plugin of plugins) await plugin.config?.(config)   // our modules add their keys
  applyRosterPolicy(config, preExisting)                        // pure policy from the new module
}
```

`index.ts` stays thin — snapshot + one call, no policy logic. It does not touch
the `_AssertHooksReturnVoid` guard (that governs only the generic `mergeHook`
path; the `config` hook is special-cased separately and is not a `HookKey`).

**Why the orchestrator is the only viable snapshot point:** each module's own
`config` hook runs inside the loop, by which point our keys are already merged
in. Only the orchestrator, wrapping the loop, can snapshot before it.

**What snapshot-diff actually covers (corrected):** because native built-ins are
**not** in `config.agent` (see "How OpenCode actually models agents"),
`preExisting` contains **only user/project-authored agents** (plus same-named
user overrides, if any). So:
- **snapshot-diff** hides user/project agents — fully general, zero name-list to
  maintain;
- **the explicit backstop** is the **sole** mechanism that hides the native
  `build`/`plan` (via override-by-key).

These are a **union**, not redundant. There is **no merge-order unknown** for
natives (they are never in `config.agent`, so only the backstop can touch them).

### b) New library module `src/modules/agent-roster/` — pure policy

No plugin export, no hook — a harness-resident library exactly like
`agent-registry` and `pantheon-config`. Exports the pure `applyRosterPolicy` and
two tiny typed `default_agent` accessors (see below). Tests in
`tests/modules/agent-roster/`. Built into `dist/modules/agent-roster/`
automatically by the root `tsup` glob (`src/**/*.ts`); the bare `"dist"` entry in
`package.json` `files` and `verify-dist-sync` covers it — no extra wiring.

**Why a separate module, not folded into `agent-registry`:** `agent-registry`
holds `SpecialistInfo` for *our* agents only (Perun's dispatch/prompt table). It
**structurally cannot** answer the policy's question — it never mirrors native or
user `config.agent` keys, so it cannot distinguish "native to hide" from
"absent". The pre-loop snapshot is orthogonal information the registry lacks.
Keeping `agent-roster` separate preserves both modules' single responsibility.

## Policy function

```ts
// On opencode 1.15.10 the only VISIBLE-PRIMARY natives are build and plan.
// general/explore are mode:"subagent" (already excluded by the picker filter
// `mode!=="subagent" && !hidden`); compaction/title/summary are already hidden.
// This is the visible-primary native set, NOT "all natives". Re-verify on
// opencode version bumps (check the picker, not the SDK type enum).
const NATIVE_BUILTINS = ["build", "plan"] as const
const HIDE = { hidden: true } as const

function applyRosterPolicy(config, preExisting: Set<string>): void
```

Behavior:
1. `config.agent ??= {}`.
2. **Snapshot-diff (user/project agents):** for every key currently in
   `config.agent` that is in `preExisting`, set
   `config.agent[key] = { ...config.agent[key], ...HIDE }` (preserves `mode`,
   `model`, `description`; forces `hidden:true`). Skip keys already
   `hidden:true` (idempotency hardening — see below).
3. **Backstop (natives):** for every name in `NATIVE_BUILTINS`, set
   `config.agent[name] = { ...(config.agent[name] ?? {}), ...HIDE }` — even if the
   name was absent. This is the only thing that hides native `build`/`plan`.
4. **`default_agent` guard** (see next section).
5. Idempotent and pure (mutates the passed `config`, no I/O, no globals).

"Ours" (Perun, Veles, triglav, zmora, the developer agents) were added **during**
the loop, so they are **not** in `preExisting` → step 2 skips them, step 3 names
only `build`/`plan` → they stay visible. Verified: all 21 harness agents register
via `config.agent[key] = {...}` inside a `config` hook (mechanism M1); none are
filename-discovered.

### Idempotency hardening (M4)

The merged `config` hook is invoked once per process on 1.15.10, so reentrancy is
not a current risk. But correctness must not depend on a binary-internal
contract. Two cheap guards make the policy survive a hypothetical second call on
a mutated `config`:
- step 2 skips keys already `{ hidden: true }` (so re-snapshotting our own
  now-persisted agents would not blank the roster — though they would be in a
  recomputed `preExisting`, they are not yet `hidden`, so this alone is
  insufficient); **and**
- a one-shot `WeakSet` keyed on the `config` object in the orchestrator: if this
  `config` was already processed, skip the policy. This is the robust guard;
  step-2's skip-hidden is a secondary defense.

## `default_agent`

> **New work.** No `default_agent` assignment exists in the repo today; this
> design adds it.

Hiding `build` (the native default primary) means OpenCode must not open a
session on a hidden agent (it throws otherwise).

- **Coordinator** (owner of Perun) sets `default_agent = "Perun - Coordinator"`
  in its `config` hook, **only when unset** (user override respected). This is the
  explicit, correct named target.
- **`applyRosterPolicy` adds a safety-net guard:** after hiding, if
  `default_agent` is empty or points to a hidden/absent agent, repoint —
  **preferring `"Perun - Coordinator"` if it is a visible primary**, else the
  **first visible primary by sorted key order** (deterministic tie-break).

**Why a named preference, not "first visible primary by key order":** there are
**four** visible `mode:"primary"` agents after the policy runs — `Perun -
Coordinator`, `python-developer`, `frontend-developer`, `swift-developer` (the
developer agents default to `mode:"primary"`). Relying on insertion order would
land the default on `python-developer` (registered 3rd), not Perun. The named
preference + sorted fallback removes that dependence on plugin-array order.

**Typing escape hatch (BLOCKER fix):** the v1 SDK `Config` type the plugin
compiles against has **no `default_agent` field** (it exists only in v2 types,
unused for `Config`), yet the runtime honors it. The roster module exports two
narrow accessors that localize the cast:
```ts
const getDefaultAgent = (c: Config): string | undefined =>
  (c as { default_agent?: string }).default_agent
const setDefaultAgent = (c: Config, name: string): void => {
  ;(c as { default_agent?: string }).default_agent = name
}
```
Documented inline that runtime honors the field and only the v1 type omits it;
re-check on the next `@opencode-ai/plugin` SDK bump (a compile guard can flag the
day the field becomes native, making the cast removable).

**Predicate definitions:** "visible primary" = `mode === "primary" && hidden !==
true`. `mode` is optional in the SDK type; `mode === undefined` is **not**
"primary" and is therefore never a fallback target.

## Testing

### Unit — `applyRosterPolicy` (`tests/modules/agent-roster/`)

- hides a `preExisting` key (`hidden→true`) **preserving other fields** (`mode`,
  `model`, `description`);
- **does not touch** a non-`preExisting` key (our loop-added agent stays intact;
  `primary` Perun stays `primary`/visible);
- **backstop:** `build`/`plan` hidden even when absent from `preExisting` and the
  input map;
- a `preExisting` user agent with `mode:"all"` → hidden, and **not** eligible as
  the `default_agent` repoint target (guard targets `primary` only);
- a `preExisting` key with `mode:"primary"` already `hidden:true` → excluded from
  the visible-primary scan;
- a `preExisting` key absent from the final map (a plugin deleted it) → step 2
  must not resurrect it;
- collision: a key both in `preExisting` AND re-added by a module during the loop
  → define & assert precedence;
- `config.agent` present but empty `{}` → backstop still injects hidden
  `build`/`plan`;
- a `NATIVE_BUILTINS` name that is also one of our agents → backstop hides it
  unconditionally (documented footgun; assert + comment);
- **`default_agent` guard:** repoints when pointing to a hidden/absent agent;
  lands on `"Perun - Coordinator"` when present; falls back to sorted-first
  visible primary when Perun absent; unchanged when already a visible primary;
  stays `undefined` when no primary; `mode===undefined` agent never chosen;
- `config.agent === undefined` on input → no throw;
- **idempotency:** second call with the same `preExisting` changes nothing.

### Integration — orchestrator (`tests/root-plugin.test.ts`)

Use the existing injectable harness: `createAppVerkPlugins(pluginFactories)`
accepts fake factories (precedent at `tests/root-plugin.test.ts:248`), driving
the merged hooks on a plain `config` object.

- fake plugins add their own keys + a `config.agent` pre-seeded with `build`/
  `plan` (+ a dummy "user" agent) → after the merged `config` hook: `build`/
  `plan`/"user" hidden, ours visible, snapshot taken **before** the loop;
- regression: `applyRosterPolicy` runs **after** all `plugin.config?.()`;
- **double-invocation:** run the merged `config` hook **twice on the same mutated
  `config`** → our agents survive (exercises the recomputed-snapshot hazard the
  WeakSet guard defends; the fixed-`preExisting` unit test alone would give false
  confidence here);
- update the packed-file expectations in `tests/root-plugin.test.ts` for the new
  module (auto-covered by the bare `"dist"` `files` entry, but assert it).

### Coordinator

- `default_agent` set to `"Perun - Coordinator"` only when previously unset.

All logic is deterministic and I/O-free → 80%+ coverage via pure tests, without
running OpenCode.

## Edge cases & invariants

- **Load-path invariant (safety precondition).** The whole design's correctness
  rests on "all our agents are added during the loop; none arrive via filename
  auto-discovery." This holds today only because the harness is loaded as a
  plugin (`main: ./dist/index.js`) and ships **zero** OpenCode agent-scan
  directories. If a future change ships `.opencode/agent/*.md` (or any
  natively-discovered agent file), that agent would land in `preExisting` and be
  **wrongly hidden** — a design-breaking change. Documented here so it is caught.
- **Picker honors `hidden`: VERIFIED** (TUI filter `mode!=="subagent" &&
  !hidden`, decompiled). No runtime probe needed for this — it was the design's
  one core unverified assumption and is now closed.
- **User-authored agents are hidden** — per Variant A (harness owns the roster).
  A deliberate choice. If a user had `default_agent` set to one of their (now
  hidden) agents, the guard repoints it (otherwise the runtime throws at
  startup).
- **`disable:true` deliberately rejected** for built-ins — OMO treats `build` as
  non-removable; hiding is safer than risking that OpenCode internally depends on
  `build` existing.
- **Dispatch surface:** by keeping native `mode` (not flipping to `subagent`),
  `build`/`plan` stay `mode:"primary"` and the dispatch preflight
  (`coordinator/dispatch.ts`) rejects them — so they do not become dispatchable
  via `dispatch_parallel`. This is why the `{ hidden: true }` choice is safer than
  OMO's `mode:"subagent"` (OMO compensates with a dispatch guard we do not need).
- **`NATIVE_BUILTINS` maintenance.** This list is the only manual touch-point: a
  future opencode version that adds a new **visible-primary** native built-in
  would leak into the picker until its name is added. snapshot-diff cannot catch
  it (natives are never in `config.agent`). Documented on the constant; re-verify
  the picker on version bumps.
- **Kill-switch in `pantheon.json`** (e.g. `{ "roster": { "owned_only": false }
  }`) — **YAGNI for v1**, the policy is always on; easy to add later via the
  existing `pantheon-config`.

## Out of scope (OMO steps deliberately omitted, with rationale)

- Rebuilding `config.agent` from filesystem sources (user/project/opencode
  global+project discovery) — our modules self-register via their own `config`
  hooks.
- `filterProtectedAgentOverrides` / `createProtectedAgentNameSet` — Variant A
  hides all non-registered agents anyway, so collision-override protection is
  moot.
- `remapAgentKeysToDisplayNames` / `reorderAgentsByPriority` / `registerAgentName`
  — display/sort machinery tied to OMO's separate config-key namespace; our
  agents are keyed by their final display names already.
- `migrateAgentConfig` — no legacy/foreign agent-config ingestion.
- OMO's `RESERVED_HIDDEN_NATIVE_AGENTS` dispatch guard — unneeded: keeping native
  `mode` already blocks dispatch to `build`/`plan`.
- Per-user roster configuration (deferred; see kill-switch).
- Changing how `agent-registry` / Perun dispatch works.
