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
- **Tool ownership (precise):** `execute_recipe` is a **zmora-setup-only** tool —
  it lives in `SETUP_TOOLS` (`src/modules/qa/allowed-tools.ts:66`) and is **not**
  in Perun's frontmatter (`src/agents/perun.md:5` lists `preflight, record_input,
  parse_plan` but not `execute_recipe`). `record_input`/`parse_plan`/`preflight`
  are **Perun-only**. Neither set appears in any *other* agent's frontmatter.
- **Two different maps, only one probed.** stribog's 2026-06-10 probe found the
  `config.agent[].tools` deny-map INERT; it did **not** test the markdown
  frontmatter `allowed-tools` *allowlist*. `plan/index.ts:23-26` asserts the
  markdown allowlist is a no-op for plugin tools, but that is **asserted, not
  probed**. Since `execute_recipe` is in `zmora-setup`'s markdown allowlist but
  not `zmora-fe`/`zmora-be`'s, the "`zmora-fe` calls `execute_recipe`" threat is
  only live if the markdown allowlist is *also* inert for plugin tools. The
  caller gate is load-bearing regardless — unprobed enforcement cannot be relied
  on — but the AGENTS.md note must list **both** directions as "re-verify on
  opencode bump."

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

**Residual (documented, not fixed here):** the registry-negative check allows
any caller that is not a *foreground-dispatched* specialist. Two concrete
pass-through cases:
1. A **background-dispatched** subagent — `background.ts:54-62` deliberately does
   NOT register background children (today only the read-only `triglav`) in the
   `SessionAgentRegistry`, so `registry.lookup` returns `undefined` and the
   session reads as the coordinator for `record_input`/`parse_plan`/`preflight`.
   It still fails **closed** for `execute_recipe` (`undefined !== "zmora-setup"`),
   so the minter is unaffected.
2. A user's own custom primary agent (not dispatched at all).

Both are acceptable for this change: `record_input`/`parse_plan`/`preflight`
appear in no agent's frontmatter except Perun's, `triglav` is read-only with no
workflow that calls them, and a non-dispatched caller writes only to its own
session's keyed state. Recorded in the AGENTS.md canonical note and as a tracked
follow-up (same treatment as the `load_appverk_skill` follow-up in §6) so it is
not silently forgotten — a future tightening could pass an allowlist of
coordinator-eligible session shapes.

The check is **registry-negative rather than a positive "is Perun" match** for a
structural reason: Perun is *never* placed in the registry (the only writer is
`dispatch.ts:422`, which registers dispatched children, and the anti-recursion
guard at `dispatch.ts:221` blocks Perun from being dispatched at all), so
"not a registered specialist" is a sound, turn-1-safe proxy for "is the
coordinator" — whereas a positive transcript match mis-resolves children to the
parent's agent (see Key code facts).

### 2. Gate location — per-`execute()` guard, not a hook

A single factory `makeCallerGate({ registry, setupAgentKey })` is constructed
**once** in the plugin body, immediately after `const registry = new
SessionAgentRegistry()` (`index.ts:66`). `setupAgentKey` is `"zmora-setup"` — the
only variant permitted to mint via `execute_recipe` — supplied at construction
and pinned by the drift-guard test (Testing). The factory returns two
**synchronous** predicates (`registry.lookup` is a plain `Map.get`, so no
`async`/`await` and no transcript fetch):

- `isSetupCaller(sessionID): boolean` → `registry.lookup(sessionID) === setupAgentKey`
- `isCoordinatorCaller(sessionID): boolean` → `registry.lookup(sessionID) === undefined`

Each tool's `execute()` calls the relevant predicate first and refuses on deny.
QA owns its tool definitions, so it guards them directly in `execute()`; stribog
needs a `tool.execute.before` hook only because it intercepts **native** tools it
does not define. New module: `src/modules/qa/caller-gate.ts` (+ its unit test).

The gate holds **no per-session state** (it only reads the registry, whose
lifecycle `session.deleted` already manages at `index.ts:354`), so it needs no
cleanup wiring.

### 3. Deny mechanism — uniform JSON `forbidden`

All four tools return `JSON.stringify({ status: "forbidden", reason })` on deny.

This **changed from** an earlier asymmetric "throw a marker-error for the
minter" plan. The spec-review pass found the cited mirror is mechanically
different: stribog's `tool-budget-hook.ts:69-73` throws inside a
`tool.execute.before` **hook**, re-thrown past an internal-error guard so it
surfaces as a tool-error part — *not* a throw from a tool's own `execute()` body,
for which the codebase has **no evidence** of graceful handling (it could crash
the turn). A JSON `forbidden` status is equally un-bypassable for security: on
deny the handler never runs, so no secret is minted regardless of how the model
reacts. Uniform JSON removes the only unverified binary in the design at zero
security cost; the anti-retry argument for throwing was weak (the handler is
unreachable either way).

Add a `forbidden` status to all four result shapes: `ExecuteRecipeResult`
(`execute-recipe.ts:25-29`), `RecordInputResult` (`record-input.ts`), and the
inline `parse_plan`/`preflight` result objects in `index.ts` (parse_plan's shape
is an **unnamed inline literal** at `index.ts:266-269` — extend it inline; no
named alias required). The `reason` is developer-facing, e.g.
`"execute_recipe is restricted to the dispatched zmora-setup variant"` /
`"<tool> is restricted to the coordinator (Perun)"`.

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
4. Re-verify **both** the plugin deny-map (`config.agent[].tools`) **and** the
   markdown `allowed-tools` allowlist behavior for plugin tools on every opencode
   bump (alongside the `NATIVE_BUILTINS` re-verify note) — only the deny-map was
   probed on 1.15.10; the allowlist direction is asserted-not-probed.

A short **§5.1 (residual gaps)** under the same note records: (a) the
registry-negative coordinator gate does not deny background-dispatched
subagents (`triglav`) or non-dispatched custom agents — accepted, tracked; (b)
`load_appverk_skill` disable for Perun is plugin-map-only/inert — tracked
follow-up (§6).

Then, pointing at that section:
- **Rewrite** `src/modules/qa/index.ts:175-183` (drop "opt-in per agent" implying
  enforcement; state the map is declarative and `caller-gate.ts` is the gate).
- **Add a caveat** to `src/modules/plan/index.ts:23-26` (currently silent that
  the plugin-tool map is inert in the enable direction).
- **Clarify** `src/modules/coordinator/index.ts:363-369`: keep the accurate
  `skill: false` (native, real) claim; note that `load_appverk_skill: false`
  (plugin) is on the inert map path and is a tracked follow-up. **Do not** flatten
  the native-skill claim into "contradictory" — that would be a factual error.
- **Correct the legacy doc** `docs/plugins/qa.md:94,96` — it carries the strongest
  form of the misconception this change kills ("The tool-availability matrix is
  enforced per-variant in `AgentConfig.tools`"; "fails at the allowlist check, not
  at a prompt-level guard") and mislabels `execute_recipe` as a "Perun-only tool".
  That tree is **legacy** (slated for removal per AGENTS.md), so the minimal fix
  is to correct the two enforcement claims (or accelerate the file's removal) and
  point at the canonical note — do not invest in polishing it.

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

**New `tests/modules/qa/caller-gate.test.ts`** (pure predicate tests over a
fake `SessionAgentRegistry`):
- `isSetupCaller`: true when registry maps the session to `"zmora-setup"`;
  false for `"zmora-fe"`, `"zmora-be"`, and a registry miss (fail-closed).
- `isCoordinatorCaller`: true for a registry miss (Perun, incl. turn-1); false
  for any registered specialist (`"zmora-fe"`, `"zmora-be"`, `"zmora-setup"`,
  a non-zmora dispatched name).

**New execute()-wrapper gate coverage — `execute_recipe` has ZERO execute()-level
tests today** (existing coverage is the bare handler via `makeExecuteRecipeHandler`
at `execute-recipe.test.ts:23` and `integration.test.ts:48`, which bypass the
gate). So this is **added**, not updated. Drive the registered `execute_recipe`
tool's `.execute()` with each identity:
- registered `"zmora-setup"` → reaches the handler (assert via a fake handler /
  observed side effect).
- registered `"zmora-fe"` → returns `{status:"forbidden"}`, handler never runs.
- registered `"zmora-be"` → `{status:"forbidden"}`, handler never runs.
- registry-miss (Perun / unregistered) → `{status:"forbidden"}` (only
  `"zmora-setup"` is allowed; everything else is denied for the minter).

**Coordinator-gate coverage** (mostly already exercised by existing allow-path
tests — see below; add the deny path):
- registry-miss session (Perun, incl. **turn-1**) calling `parse_plan` →
  **allowed** — guards against re-introducing a fail-closed turn-1 regression.
- registered `"zmora-fe"`/`"zmora-be"` calling `record_input`/`parse_plan`/
  `preflight` → `{status:"forbidden"}`.

**Drift-guard sync test** — *prerequisite:* export `VARIANTS` from `index.ts`
(change `const VARIANTS` at `index.ts:25` to `export const VARIANTS`). Then
assert `VARIANTS[2] === "setup"` **and** the gate's `setupAgentKey ===
` `` `zmora-${VARIANTS[2]}` `` so a renamed/reordered variant fails the test
(closes the typo-silently-disables-the-gate hole).

**Existing tests — precise impact (verified):**
- *Stay green, no change:* the bare-handler unit tests
  (`execute-recipe.test.ts`, `record-input.test.ts`, `preflight.test.ts`)
  construct handlers directly and **intentionally bypass** the gate (it lives in
  the `execute()` wrapper) — documented in `caller-gate.ts`. The existing
  execute()-level coordinator-tool calls also stay green **because the gate is
  registry-negative**: `integration.test.ts:345` (`record_input`) and the
  `parse_plan` calls at `integration.test.ts:283/385/415` /
  `plugin.test.ts:271/292/341` run on **unregistered** ("perun-…") sessions →
  `registry.lookup === undefined` → coordinator → allowed. No `execute_recipe`
  test goes through the wrapper, so nothing breaks there either.
- *Need registry setup:* **only NEW deny-path cases** (a registered specialist
  calling a Perun-only tool, or a non-setup specialist calling `execute_recipe`)
  must `registry.register(sessionID, "<variant>")` before driving `.execute()`.
  No existing test requires modification — a strict improvement over the prior
  draft's "update the few existing tests" instruction.

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
