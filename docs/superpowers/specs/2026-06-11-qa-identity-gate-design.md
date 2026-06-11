# Design: handler-level identity gates for QA plugin tools

**Date:** 2026-06-11
**Status:** approved (brainstorming) — pending implementation plan
**Scope:** `src/modules/qa/` (+ doc reconciliation in `AGENTS.md`, `src/modules/plan/`, `src/modules/coordinator/`, `src/modules/stribog/`)
**Origin:** review findings H1/H2/M8 (`docs/reviews/2026-06-10-master-2.md`) — verified by sequential-thinking + a 4-lens mixture-of-agents pass (run `wf_5c9f47cd-ec6`).

## Problem

The QA plugin enforces two privilege boundaries through the per-agent
`config.agent[<name>].tools` map:

- `execute_recipe` (the secret **minter** — runs plan-authored bash with
  user-pasted secrets in env) is gated to `zmora-setup` only via
  `tools: { execute_recipe: stack === "setup" }` (`src/modules/qa/index.ts:178-183`).
- `record_input`, `parse_plan`, `preflight` are gated to Perun only via
  `tools: { record_input: false, parse_plan: false, preflight: false }` on
  every zmora variant.

stribog's 2026-06-10 live probe documented that this **plugin-tool** map is
**INERT on opencode 1.15.10** — a denied plugin tool still executes
(`src/modules/stribog/stribog.metadata.ts:34-38`). The QA handlers perform **no
caller-identity check** today (`src/modules/qa/execute-recipe.ts:37-109`,
`record-input.ts`, and the inline `parse_plan`/`preflight` bodies in
`index.ts`). So if the map is inert, a prompt-injection-steered `zmora-fe` /
`zmora-be` session can call `execute_recipe`, minting secrets and running recipe
bash — collapsing the minter≠actuator separation the design treats as
load-bearing.

Three modules also carry divergent claims about the map's semantics, leaving
maintainers unable to tell which mechanism is real.

## Goal

Make a **handler-level caller gate** the load-bearing security boundary for the
four QA tools, so the property holds **regardless** of whether
`config.agent[].tools` enforces. Keep the (possibly inert) map in place as
declarative defense-in-depth. Reconcile the contradictory documentation into one
canonical statement.

Non-goal: resolving the empirical question of whether the plugin-tool map
enforces. The gate is correct either way, so the question is moot for security
(still worth documenting for the map's other uses).

## Key code facts (verified)

- **`ctx.sessionID` inside a tool's `execute()` is the CHILD (dispatched)
  session id**, not the parent. For a dispatched `zmora-setup` task,
  `ctx.sessionID` is the `zmora-setup` child session.
- **The coordinator registers `childSessionID → task.name` BEFORE the child's
  turn runs** (`src/modules/coordinator/dispatch.ts:411-422`), and `task.name`
  is exactly the variant string (`"zmora-setup"`, `"zmora-fe"`, `"zmora-be"`).
  So `registry.lookup(ctx.sessionID)` reliably returns `"zmora-setup"` for a
  legitimately dispatched setup child by the time it calls `execute_recipe`.
- **`registry.lookup` is synchronous** (a `Map.get`), used the same way by the
  existing `shell.env` hook (`src/modules/qa/shell-env-hook.ts:31`).
- **`getSessionAgent` reads the FIRST user message's `info.agent`**
  (`packages/skill-utils/src/session-identity.ts:18`). For a dispatched child,
  the first user message is the parent's prompt, so it resolves a child to the
  **parent's** agent (`"Perun - Coordinator"`), and returns `undefined` on the
  coordinator's own turn-1 (deliberately not cached). It therefore **cannot**
  distinguish a `zmora-setup` child from any other child of Perun, and cannot
  positively identify Perun on turn-1. → **Not usable** as the identity source
  here.
- **Perun (the coordinator) is never a dispatched child**, so it is never in the
  `SessionAgentRegistry`.
- `skill: false` on the coordinator (`src/modules/coordinator/index.ts:369`)
  disables the **native** `skill` tool via opencode's PermissionV2 engine —
  this is a **real** backstop (verified Task 1a) and is **not** the inert
  plugin-tool path. `load_appverk_skill: false` on the same line is a **plugin**
  tool and **is** on the inert path.

## Design

### 1. Identity model — registry-only, synchronous

The gate resolves caller role exclusively from the `SessionAgentRegistry` QA
already owns. No transcript reads, no `skill-utils` import, no `client`.

- **`execute_recipe` → requires `zmora-setup`:**
  allowed iff `registry.lookup(ctx.sessionID) === "zmora-setup"`. Otherwise
  **deny (fail-closed)**. On a registry miss (e.g. server restart lost the
  in-memory registry), deny — the run's `BindingsStore`/`QaRunState` are also
  in-memory and already gone on restart, so fail-closed loses nothing a resume
  hadn't already lost.

- **`record_input` / `parse_plan` / `preflight` → require coordinator
  (registry-NEGATIVE):** allowed iff `registry.lookup(ctx.sessionID) === undefined`
  (the session is **not** a dispatched specialist). Perun is never registered,
  so it always passes — including turn-1, with no transcript fetch. Any
  registered specialist (`zmora-*`, and any other dispatched subagent) is denied.

This negative check is what makes the coordinator gate both correct on Perun's
turn-1 (no false deny) and tight against the real threat (a dispatched
specialist calling a Perun-only tool), where a positive `getSessionAgent` match
would be both too strict (turn-1) and too loose (children inherit the parent's
first-message agent).

**Residual (documented, not fixed here):** a session that is neither Perun nor a
dispatched specialist (e.g. a user's own custom primary agent) is not denied by
the registry-negative check. This is acceptable: the Perun-only tools are in no
other agent's frontmatter, the realistic injection threat is a dispatched
specialist (covered), and a non-dispatched caller writes only to its own
session's state.

### 2. Gate location — per-`execute()` guard, not a hook

A single factory `makeCallerGate({ registry, setupAgentKey })` is constructed
**once** in the plugin body (alongside `store`/`state`/`registry` at
`index.ts:64-66`) and returns predicates:

- `isSetupCaller(sessionID): boolean` → `registry.lookup(sessionID) === setupAgentKey`
- `isCoordinatorCaller(sessionID): boolean` → `registry.lookup(sessionID) === undefined`

Each tool's `execute()` calls the relevant predicate first and refuses on deny.
QA owns its tool definitions, so it guards them directly in `execute()`; stribog
needs a `tool.execute.before` hook only because it intercepts **native** tools it
does not define. New module: `src/modules/qa/caller-gate.ts` (+ its unit test).

The gate holds **no per-session state** (it only reads the registry, whose
lifecycle `session.deleted` already manages at `index.ts:354`), so it needs no
cleanup wiring.

### 3. Deny mechanism — asymmetric

- **`execute_recipe` (minter): throw a marker-error** (mirroring stribog's
  `tool-budget-hook.ts:69-73`) so a jailbroken retry loop cannot ignore a JSON
  status and re-call. The throw surfaces as a tool-error part.
  *Implementation checkpoint:* confirm opencode treats a thrown error from a
  tool `execute()` as a tool-error (hard block), not a host crash. If it does
  not, fall back to the JSON-`forbidden` form for this tool too.
- **`record_input` / `parse_plan` / `preflight`: return
  `JSON.stringify({ status: "forbidden", reason })`.** Add `forbidden` to the
  relevant result unions (`ExecuteRecipeResult` stays unaffected since the
  minter throws; `RecordInputResult` and the inline `parse_plan`/`preflight`
  shapes gain the `forbidden` status).

### 4. Keep the inert maps as declarative defense-in-depth

Leave the `config.agent[].tools` maps in place (they become free enforcement if
a future opencode honors them). Add a one-line comment at `index.ts:178` noting
the plugin-tool map is **declarative-only** and the **caller gate is
load-bearing**, so the map does not read as the security boundary.

### 5. Documentation reconciliation (M8)

One canonical section in `AGENTS.md` — **"Plugin-tool enforcement model"** —
stating:
1. `config.agent[<name>].tools` for **plugin** tools is declarative-only / INERT
   on opencode 1.15.10.
2. **Native** tools (e.g. `skill`) DO enforce via opencode's PermissionV2 engine
   — a separate, real path. Do not conflate.
3. Load-bearing enforcement for plugin tools = handler-wrapper caller gates
   (`src/modules/qa/caller-gate.ts`) + `tool.execute.before` hooks (stribog).
4. Re-verify the plugin-map's actual runtime behavior on every opencode bump
   (alongside the `NATIVE_BUILTINS` re-verify note).

Then, pointing at that section:
- **Rewrite** `src/modules/qa/index.ts:175-183` (drop "opt-in per agent" implying
  enforcement; state the map is declarative and `caller-gate.ts` is the gate).
- **Add a caveat** to `src/modules/plan/index.ts:23-26` (currently silent that
  the plugin-tool map is inert in the enable direction).
- **Clarify** `src/modules/coordinator/index.ts:363-369`: keep the accurate
  `skill: false` (native, real) claim; note that `load_appverk_skill: false`
  (plugin) is on the inert map path and is a tracked follow-up. **Do not** flatten
  the native-skill claim into "contradictory" — that would be a factual error.

### 6. Out of scope — tracked follow-up

Enforcing Perun's `load_appverk_skill` disable (a `skill-registry` plugin tool,
currently map-only/inert at `src/modules/coordinator/index.ts:369`) is a separate
change in a different module. File it as a tracked follow-up referencing that
line so it is not silently forgotten; the canonical AGENTS.md note states the
current state honestly rather than implying the disable is enforced.

Also out of scope (Perun's responsibility, not the gate's): a jailbroken Perun
dispatching `zmora-setup` for a non-setup scenario. The gate stops *other*
variants from stealing `execute_recipe`; it cannot stop Perun from dispatching
the wrong variant. Mitigate with a line in Perun's prompt that `zmora-setup` is
dispatched only for the `## Setup` block.

## Testing (TDD)

New `tests/modules/qa/caller-gate.test.ts`:
- `isSetupCaller`: true when registry maps the session to `"zmora-setup"`;
  false for `"zmora-fe"`, `"zmora-be"`, and a registry miss (fail-closed).
- `isCoordinatorCaller`: true for a registry miss (Perun, incl. turn-1); false
  for any registered specialist (`"zmora-fe"`, `"zmora-be"`, `"zmora-setup"`,
  a non-zmora dispatched name).

Plugin/integration coverage:
- A session registered as `zmora-fe` calling `execute_recipe` is denied
  (throws / never reaches the handler); same for `zmora-be`.
- A session registered as `zmora-setup` reaches the `execute_recipe` handler.
- A registry-miss session (Perun, incl. **turn-1**) calling `parse_plan` is
  **allowed** — guards against re-introducing a fail-closed turn-1 regression.
- A `zmora-*` session calling `record_input`/`parse_plan`/`preflight` gets
  `forbidden`.

Sync test (drift guard):
- Pin `setupAgentKey === "zmora-setup"` against the `VARIANTS` constant /
  `config.agent` keys in `index.ts`, so a `task.name` typo or a renamed variant
  cannot silently break the gate.

Unchanged: the bare-handler unit tests (`execute-recipe.test.ts`,
`record-input.test.ts`, `preflight.test.ts`) construct handlers directly and
**intentionally bypass** the gate (the gate lives in the `execute()` wrapper) —
documented in `caller-gate.ts`. Update only the few existing **execute()-level**
tests (`plugin.test.ts`, `integration.test.ts`) that drive the registered tool
to register the expected identity in the registry first.

## Verification

`bun run build:root` → `bun run test` (full suite) → `bun run verify-dist`.
Ship as a `security(qa)` commit (code + tests + rebuilt dist) and a `docs`
commit (AGENTS.md + the three comment edits), per the no-issue-ID and
co-authorship rules in `AGENTS.md`.

## What this design deliberately avoids

- **No `skill-utils` / `getSessionAgentCached` import** — the registry-only model
  needs none, so it does not widen the H4 undeclared-bare-specifier blast radius
  to `dist/modules/qa`, and does not entangle tests with skill-utils' module-level
  identity cache.
- **No `tool.execute.before` hook** — unnecessary because QA owns its tools.
- **No transcript reads** — `getSessionAgent`'s first-message semantics cannot
  distinguish parent from child, so it is the wrong primitive here.
