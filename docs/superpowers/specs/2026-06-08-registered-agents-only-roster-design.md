# Registered-Agents-Only Roster — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review → implementation plan)

## Problem

OpenCode ships native built-in agents `build` and `plan`. They appear in the
user-facing agent picker (Tab cycle / `/agents`) alongside the Pantheon harness
agents we register (Perun, Veles, triglav, zmora, …). We want the picker to show
**only the agents our harness registers** — the native built-ins (and anything
else we did not register) must disappear from selection.

`oh-my-openagent` (OMO) solves the same problem. The mechanism it uses is the
basis for this design.

## How OMO does it (reference)

- In OpenCode, `build`/`plan` are native agents with a visible mode
  (`primary`/`all`); the picker lists agents whose `mode` is `primary`/`all` and
  that are **not** `hidden`.
- The native `AgentConfig` (OpenCode SDK) exposes `mode: "subagent" | "primary"
  | "all"`, `disable?: boolean`, and — via its index signature — `hidden?:
  boolean`.
- OMO does **not** delete `build`. In its `config` hook it rebuilds the whole
  `config.agent` map and, at the end, writes:
  - `build: { ...migratedBuild, mode: "subagent", hidden: true }`
  - `plan: { mode: "subagent", hidden: true, ...modelSettings }` (when its own
    planner replaces plan)
- OMO even keeps a constant `RESERVED_HIDDEN_NATIVE_AGENTS = new Set(["build"])`
  — it treats `build` as **non-removable natively, hide-only**.

Lesson encoded: hide via `mode:"subagent" + hidden:true` (override-by-key), do
**not** rely on `disable:true` for `build`.

## Decisions (locked)

1. **Scope:** general allowlist — *only agents we register are selectable*
   (not a hardcoded `build`/`plan` list as the primary mechanism).
2. **Mechanism:** demote + hide (`mode:"subagent"`, `hidden:true`). `disable:true`
   rejected for built-ins (OMO treats `build` as reserved/non-removable).
3. **Ownership model — Variant A:** the harness owns the **entire** roster. The
   final hook hides every `config.agent` key we did not register — this covers
   `build`, `plan`, any future native built-in, **and** end-user-authored agents.
   Fully general, zero name-list to maintain for our own agents.

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
  const preExisting = new Set(Object.keys(config.agent ?? {})) // native + user
  for (const plugin of plugins) await plugin.config?.(config)   // our modules add their keys
  applyRosterPolicy(config, preExisting)                        // pure policy from the new module
}
```

`index.ts` stays thin — snapshot + one call, no policy logic. This respects the
file's current character (a generic merger with compile-time guards).

**Why not a last-position plugin / why not `agent-registry`:** a plugin running
at the end of the loop cannot tell "native" from "ours" — by its turn the map
already contains every one of our keys. The snapshot must be taken before plugin
#1, so only the orchestrator can do it. `agent-registry` is left untouched: it
tracks `SpecialistInfo` for Perun's dispatch table, a different concept from
`config.agent` visibility; the two are not conflated.

### b) New library module `src/modules/agent-roster/` — pure policy

No plugin export, no hook — a harness-resident library exactly like
`agent-registry` and `pantheon-config`. Exports the pure `applyRosterPolicy`.
Tests in `tests/modules/agent-roster/`. Built into `dist/modules/agent-roster/`.

## Policy function

```ts
const NATIVE_BUILTINS = ["build", "plan"] as const // explicit backstop
const HIDE = { mode: "subagent", hidden: true } as const

function applyRosterPolicy(config, preExisting: Set<string>): void
```

Behavior:

1. `config.agent ??= {}`.
2. **Snapshot-diff:** for every key currently in `config.agent` that is in
   `preExisting` → `config.agent[key] = { ...config.agent[key], ...HIDE }`.
   Other fields (model, description) are preserved; only `mode` and `hidden` are
   forced.
3. **Backstop:** for every name in `NATIVE_BUILTINS` →
   `config.agent[name] = { ...(config.agent[name] ?? {}), ...HIDE }`, **even if
   the name was absent** from `preExisting` and from the map. Guarantees
   `build`/`plan` are hidden regardless of OpenCode's merge order.
4. Idempotent and pure (mutates the passed `config`, no I/O, no globals).

"Ours" (Perun, Veles, triglav, zmora, …) were added **during** the loop, so they
are **not** in `preExisting` → step 2 skips them, step 3 does not name them →
they stay visible. No name-list to maintain for our own agents.

## `default_agent`

Hiding `build` (the native default primary) means OpenCode must not open a
session on a hidden agent.

- **Coordinator** (owner of Perun) sets `config.default_agent = "Perun -
  Coordinator"` in its `config` hook, **only when the user has not set one**
  (user override respected).
- **`applyRosterPolicy` adds a light guard:** after hiding, if
  `config.default_agent` is empty or points to a hidden/absent agent, it repoints
  to the first **visible** `mode:"primary"` agent (deterministic by key order).
  Since Perun is the only primary, it lands on Perun without the policy
  hardcoding the name.

## Testing

### Unit — `applyRosterPolicy` (`tests/modules/agent-roster/`)

- hides a `preExisting` key (`mode→"subagent"`, `hidden→true`) **preserving other
  fields** (e.g. `model`, `description`);
- **does not touch** a non-`preExisting` key (our loop-added agent stays intact,
  e.g. `primary` Perun stays `primary`/visible);
- **backstop:** `build`/`plan` hidden even when absent from `preExisting` and the
  input map;
- **idempotent:** a second call changes nothing;
- `config.agent === undefined` on input → no throw;
- **`default_agent` guard:** repoints when pointing to a hidden/absent agent;
  unchanged when pointing to a visible primary; stays `undefined` when no primary.

### Integration — orchestrator (`tests/`, alongside existing `createAppVerkPlugins` tests)

- fake plugins that add their own keys + a `config.agent` pre-seeded with
  `build`/`plan` (+ a dummy "user" agent) → after the merged `config` hook:
  `build`/`plan`/"user" hidden, ours visible, snapshot taken **before** the loop;
- regression: call order — `applyRosterPolicy` runs **after** all
  `plugin.config?.()`.

### Coordinator sync

- `default_agent` set to `"Perun - Coordinator"` only when previously unset.

All logic is deterministic and I/O-free → 80%+ coverage via pure tests, without
running OpenCode.

## Edge cases & empirical verification

- **OpenCode merge order (the only real unknown).** If OpenCode injects
  `build`/`plan` into `config.agent` **before** plugin hooks → snapshot-diff
  catches them. If **after** → the backstop catches them (override-by-key, the
  pattern proven in OMO). Either way the two known natives are covered.
  **Verification step (implementation phase):** a one-off runtime probe (e.g.
  `console.error(Object.keys(config.agent))` at the merged-hook entry in a real
  `opencode` run) confirms the actual order and whether a third native built-in
  (e.g. `general`) appears in the map. The result decides whether
  `NATIVE_BUILTINS` needs extending. The probe is temporary — it does not land in
  the repo.
- **Future native built-in injected *after* hooks** — if OpenCode later adds a
  built-in and injects it after plugins, snapshot-diff will not see it and its
  name must be added to `NATIVE_BUILTINS`. This is the only scenario requiring a
  manual update; documented in a comment on the constant. (The probe above
  establishes whether this scenario occurs on the current version.)
- **User-authored agents are hidden** — per Variant A (harness owns the roster).
  A deliberate choice, not a bug.
- **Hidden agents remain dispatchable via Task** — `hidden+subagent` removes them
  from the picker but they stay technically reachable. Acceptable (our harness
  does not dispatch to `build`/`plan`); the same trade-off OMO makes.
- **`disable:true` deliberately rejected** for built-ins — OMO treats `build` as
  non-removable (`RESERVED_HIDDEN_NATIVE_AGENTS`), so `hidden` is safer than
  risking that OpenCode internally depends on `build` existing.
- **Kill-switch in `pantheon.json`** (e.g. `{ "roster": { "owned_only": false }
  }`) — **YAGNI for v1**, the policy is always on; easy to add later via the
  existing `pantheon-config` if a need arises.

## Out of scope

- Rebuilding the whole `config.agent` map from filesystem sources the way OMO
  does (user/project/opencode/global discovery). We only need snapshot-diff +
  backstop; our modules already register their agents via their own `config`
  hooks.
- Changing how `agent-registry` / Perun dispatch works.
- Per-user configuration of the roster (deferred; see kill-switch above).
