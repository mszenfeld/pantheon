# QA Handler-Level Identity Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a registry-only caller gate the load-bearing security boundary for the four QA plugin tools, so privilege separation holds even though `config.agent[].tools` is inert on opencode 1.15.10.

**Architecture:** A new `makeCallerGate({ registry, setupAgentKey })` factory returns two synchronous predicates over the existing `SessionAgentRegistry`: `isSetupCaller` (registry maps the session to `"zmora-setup"`) gates `execute_recipe`; `isCoordinatorCaller` (registry miss → not a dispatched specialist → Perun) gates `record_input`/`parse_plan`/`preflight`. Each tool's `execute()` calls its predicate first and returns `JSON.stringify({status:"forbidden", reason})` on deny — the handler never runs, so no secret is minted. The handler result types are untouched (the forbidden status lives in the `execute()` wrapper).

**Tech Stack:** TypeScript (NodeNext ESM), Vitest, bun. Tests in `tests/modules/qa/` import from `src/` directly (no build needed for iteration). Spec: `docs/superpowers/specs/2026-06-11-qa-identity-gate-design.md`.

---

## File Structure

- **Create** `src/modules/qa/caller-gate.ts` — the gate factory + predicates. One responsibility: resolve caller role from the registry.
- **Create** `tests/modules/qa/caller-gate.test.ts` — pure predicate unit tests.
- **Create** `tests/modules/qa/caller-gate-wiring.test.ts` — execute()-wrapper gate tests (deny + allow paths through the real plugin).
- **Modify** `src/modules/qa/index.ts` — import + construct the gate; prepend a gate check to all four tool `execute()` bodies; `export` the `VARIANTS` constant; add the "declarative-only" one-liner to the tools-map comment.
- **Modify** `src/modules/qa/index.ts` comment block (lines ~175-183), `src/modules/plan/index.ts:23-26`, `src/modules/coordinator/index.ts:363-369`, `docs/plugins/qa.md:94,96`, **and** `AGENTS.md` — documentation reconciliation.
- **Rebuild** `dist/` (committed artifact) as the final step.

**Iteration test command** (fast, runs against `src/`):
`npx vitest run --config vitest.config.ts tests/modules/qa/<file>.test.ts`

---

## Task 1: The caller-gate module + unit tests

**Files:**
- Create: `src/modules/qa/caller-gate.ts`
- Test: `tests/modules/qa/caller-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/qa/caller-gate.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { SessionAgentRegistry } from "../../../src/modules/_shared/session-agent-registry.js"
import { makeCallerGate } from "../../../src/modules/qa/caller-gate.js"

const SETUP_KEY = "zmora-setup"

function gateWith(entries: Array<[string, string]>) {
  const registry = new SessionAgentRegistry()
  for (const [id, agent] of entries) registry.register(id, agent)
  return makeCallerGate({ registry, setupAgentKey: SETUP_KEY })
}

describe("makeCallerGate — isSetupCaller (execute_recipe minter gate)", () => {
  it("allows a session registered as zmora-setup", () => {
    const gate = gateWith([["setup-child", "zmora-setup"]])
    expect(gate.isSetupCaller("setup-child")).toBe(true)
  })
  it("denies zmora-fe and zmora-be", () => {
    const gate = gateWith([
      ["fe-child", "zmora-fe"],
      ["be-child", "zmora-be"],
    ])
    expect(gate.isSetupCaller("fe-child")).toBe(false)
    expect(gate.isSetupCaller("be-child")).toBe(false)
  })
  it("denies a registry miss (fail-closed — only positive zmora-setup passes)", () => {
    const gate = gateWith([])
    expect(gate.isSetupCaller("unknown-session")).toBe(false)
  })
})

describe("makeCallerGate — isCoordinatorCaller (Perun-only tools, registry-negative)", () => {
  it("allows a registry miss (Perun is never a dispatched child — incl. turn-1)", () => {
    const gate = gateWith([])
    expect(gate.isCoordinatorCaller("perun-session")).toBe(true)
  })
  it("denies any registered specialist", () => {
    const gate = gateWith([
      ["fe-child", "zmora-fe"],
      ["be-child", "zmora-be"],
      ["setup-child", "zmora-setup"],
      ["x-child", "some-other-specialist"],
    ])
    expect(gate.isCoordinatorCaller("fe-child")).toBe(false)
    expect(gate.isCoordinatorCaller("be-child")).toBe(false)
    expect(gate.isCoordinatorCaller("setup-child")).toBe(false)
    expect(gate.isCoordinatorCaller("x-child")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/modules/qa/caller-gate.test.ts`
Expected: FAIL — `Failed to resolve import ".../caller-gate.js"` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/qa/caller-gate.ts`:

```typescript
import type { SessionAgentRegistry } from "../_shared/session-agent-registry.js"

export interface CallerGateDeps {
  registry: SessionAgentRegistry
  /** The agent key permitted to mint via execute_recipe. Always "zmora-setup". */
  setupAgentKey: string
}

export interface CallerGate {
  /**
   * True iff the session is the dispatched zmora-setup child — the only secret
   * minter. Registry-positive, fail-closed: a miss (e.g. server restart lost the
   * in-memory registry) denies, which loses nothing since the run's BindingsStore
   * is equally gone on restart.
   *
   * NOTE: this is STRICTER than the shell.env hook, which allows any `zmora-*`
   * (shell-env-hook.ts). execute_recipe is zmora-setup ONLY — keep the two
   * policies from silently converging as new zmora variants are added.
   */
  isSetupCaller: (sessionID: string) => boolean
  /**
   * True iff the session is NOT a dispatched specialist — the registry-negative
   * proxy for "is the coordinator (Perun)". Perun is never placed in the registry
   * (the only writer is the coordinator dispatch path, which registers children),
   * so a miss means Perun — including on Perun's turn-1, with no transcript fetch.
   *
   * Residual (accepted, see spec §1): background-dispatched subagents (triglav)
   * are not registered either, so they also read as coordinator for these three
   * lower-risk tools. The minter (isSetupCaller) is unaffected — it needs a
   * positive "zmora-setup".
   */
  isCoordinatorCaller: (sessionID: string) => boolean
}

export function makeCallerGate(deps: CallerGateDeps): CallerGate {
  return {
    isSetupCaller: (sessionID) => deps.registry.lookup(sessionID) === deps.setupAgentKey,
    isCoordinatorCaller: (sessionID) => deps.registry.lookup(sessionID) === undefined,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/modules/qa/caller-gate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/caller-gate.ts tests/modules/qa/caller-gate.test.ts
AV_COMMIT_SKILL=1 git commit -m "security(qa): add registry-only caller-gate predicates

Refs: only"
```

---

## Task 2: Wire the gate into the four tool execute() bodies

**Files:**
- Modify: `src/modules/qa/index.ts` (import; construct gate after `index.ts:66`; prepend gate check to each of the four `execute()` bodies)
- Test: `tests/modules/qa/caller-gate-wiring.test.ts` (new)

- [ ] **Step 1: Write the failing wiring test**

Create `tests/modules/qa/caller-gate-wiring.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import {
  getDispatchExtensions,
  clearDispatchExtensions,
} from "../../../src/modules/_shared/dispatch-extensions.js"

// Minimal fake client: resolveParentID returns undefined (handlers fall back to
// ctx.sessionID); the gate itself never touches the client.
const fakeInput = {
  client: {
    session: {
      get: async () => ({ data: { parentID: undefined } }),
    },
  },
} as never

function ctx(sessionID: string) {
  return {
    sessionID,
    messageID: "",
    agent: "",
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: async () => undefined,
  } as never
}

describe("QA tool execute() gate wiring", () => {
  it("denies execute_recipe from a zmora-fe session with status forbidden", async () => {
    clearDispatchExtensions()
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("fe-child", "zmora-fe")
    const out = await plugin.tool!.execute_recipe.execute({ binding_name: "QA_BIND_X" }, ctx("fe-child"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("denies execute_recipe from a zmora-be session", async () => {
    clearDispatchExtensions()
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("be-child", "zmora-be")
    const out = await plugin.tool!.execute_recipe.execute({ binding_name: "QA_BIND_X" }, ctx("be-child"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("denies execute_recipe from an unregistered (Perun/unknown) session — minter is fail-closed", async () => {
    clearDispatchExtensions()
    const plugin = await AppVerkQAPlugin(fakeInput)
    const out = await plugin.tool!.execute_recipe.execute({ binding_name: "QA_BIND_X" }, ctx("perun-session"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("allows execute_recipe from a zmora-setup session (reaches the handler)", async () => {
    clearDispatchExtensions()
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("setup-child", "zmora-setup")
    const out = await plugin.tool!.execute_recipe.execute({ binding_name: "QA_BIND_X" }, ctx("setup-child"))
    // No plan parsed, so the handler returns unknown_binding — NOT forbidden.
    // That proves the gate let the call through to the handler.
    expect(JSON.parse(out).status).toBe("unknown_binding")
  })

  it("denies parse_plan from a registered specialist (zmora-fe)", async () => {
    clearDispatchExtensions()
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("fe-child", "zmora-fe")
    const out = await plugin.tool!.parse_plan.execute({ plan: "## Setup" }, ctx("fe-child"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("allows parse_plan from an unregistered (Perun, incl. turn-1) session", async () => {
    clearDispatchExtensions()
    const plugin = await AppVerkQAPlugin(fakeInput)
    // Empty plan parses to ok with no bindings — proves the gate allowed it.
    const out = await plugin.tool!.parse_plan.execute({ plan: "no setup section here" }, ctx("perun-session"))
    expect(JSON.parse(out).status).toBe("ok")
  })

  it("denies record_input from a registered specialist (zmora-be)", async () => {
    clearDispatchExtensions()
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("be-child", "zmora-be")
    const out = await plugin.tool!.record_input.execute(
      { name: "TEST_USER_EMAIL", value: "a@b.com" },
      ctx("be-child"),
    )
    expect(JSON.parse(out).status).toBe("forbidden")
  })

  it("denies preflight from a registered specialist (zmora-fe)", async () => {
    clearDispatchExtensions()
    const plugin = await AppVerkQAPlugin(fakeInput)
    getDispatchExtensions().sessionAgentRegistry!.register("fe-child", "zmora-fe")
    const out = await plugin.tool!.preflight.execute({ env: [] }, ctx("fe-child"))
    expect(JSON.parse(out).status).toBe("forbidden")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/modules/qa/caller-gate-wiring.test.ts`
Expected: FAIL — the deny tests fail (no gate yet, so `execute_recipe` from `fe-child` returns `unknown_binding`, not `forbidden`).

- [ ] **Step 3: Add the import for `makeCallerGate`**

In `src/modules/qa/index.ts`, add to the import block near the other `./` imports (after the `makeRunBash` import at line 16):

```typescript
import { makeCallerGate } from "./caller-gate.js"
```

- [ ] **Step 4: Construct the gate once in the plugin body**

In `src/modules/qa/index.ts`, immediately after this existing line (`index.ts:66`):

```typescript
  const registry = new SessionAgentRegistry()
```

add:

```typescript
  // Load-bearing security boundary. The per-agent config.agent[].tools map is
  // declarative-only / inert for plugin tools on opencode 1.15.10 (see
  // AGENTS.md "Plugin-tool enforcement model"), so the real gate is here:
  // execute_recipe → zmora-setup only; record_input/parse_plan/preflight → the
  // coordinator (a registry miss; Perun is never a dispatched child).
  const gate = makeCallerGate({ registry, setupAgentKey: "zmora-setup" })
```

- [ ] **Step 5: Gate `execute_recipe`**

In `src/modules/qa/index.ts`, replace the `execute_recipe` tool's `execute` body:

```typescript
        async execute(args, ctx) {
          const result = await executeRecipeHandler(
            { binding_name: args.binding_name },
            { sessionID: ctx.sessionID },
          )
          return JSON.stringify(result)
        },
```

with:

```typescript
        async execute(args, ctx) {
          if (!gate.isSetupCaller(ctx.sessionID)) {
            return JSON.stringify({
              status: "forbidden",
              reason: "execute_recipe is restricted to the dispatched zmora-setup variant",
            })
          }
          const result = await executeRecipeHandler(
            { binding_name: args.binding_name },
            { sessionID: ctx.sessionID },
          )
          return JSON.stringify(result)
        },
```

- [ ] **Step 6: Gate `parse_plan`**

Replace the `parse_plan` tool's `execute` body's FIRST line — insert the guard at the top, before `const parentID = ...`:

```typescript
        async execute(args, ctx) {
          if (!gate.isCoordinatorCaller(ctx.sessionID)) {
            return JSON.stringify({
              status: "forbidden",
              reason: "parse_plan is restricted to the coordinator (Perun)",
            })
          }
          const parentID = (await resolveParentID(ctx.sessionID)) ?? ctx.sessionID
```

(Leave the rest of the `parse_plan` body unchanged.)

- [ ] **Step 7: Gate `record_input`**

Replace the `record_input` tool's `execute` body:

```typescript
        async execute(args, ctx) {
          const result = await recordInputHandler(
            { name: args.name, value: args.value },
            { sessionID: ctx.sessionID },
          )
          return JSON.stringify(result)
        },
```

with:

```typescript
        async execute(args, ctx) {
          if (!gate.isCoordinatorCaller(ctx.sessionID)) {
            return JSON.stringify({
              status: "forbidden",
              reason: "record_input is restricted to the coordinator (Perun)",
            })
          }
          const result = await recordInputHandler(
            { name: args.name, value: args.value },
            { sessionID: ctx.sessionID },
          )
          return JSON.stringify(result)
        },
```

- [ ] **Step 8: Gate `preflight`**

Replace the `preflight` tool's `execute` body:

```typescript
        async execute(args, ctx) {
          const result = await preflightHandler({ env: args.env }, { sessionID: ctx.sessionID })
          return JSON.stringify(result)
        },
```

with:

```typescript
        async execute(args, ctx) {
          if (!gate.isCoordinatorCaller(ctx.sessionID)) {
            return JSON.stringify({
              status: "forbidden",
              reason: "preflight is restricted to the coordinator (Perun)",
            })
          }
          const result = await preflightHandler({ env: args.env }, { sessionID: ctx.sessionID })
          return JSON.stringify(result)
        },
```

- [ ] **Step 9: Run the wiring test — verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/modules/qa/caller-gate-wiring.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 10: Run the FULL QA suite — verify no regression**

Run: `npx vitest run --config vitest.config.ts tests/modules/qa/`
Expected: PASS — all existing QA tests stay green (existing `record_input`/`parse_plan` execute()-level calls use unregistered `"perun-…"` sessions → `isCoordinatorCaller` true → allowed; no existing test drives `execute_recipe` through the wrapper).

- [ ] **Step 11: Run the full root suite — verify no cross-module regression**

Run: `npx vitest run --config vitest.config.ts`
Expected: PASS (all root module tests).

- [ ] **Step 12: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/index.ts tests/modules/qa/caller-gate-wiring.test.ts
AV_COMMIT_SKILL=1 git commit -m "security(qa): gate the four QA tools at execute() on caller identity

execute_recipe requires a dispatched zmora-setup caller; record_input,
parse_plan and preflight require the coordinator (a registry miss). Deny
returns a forbidden status so the handler never runs, closing the
minter-vs-actuator hole that the inert config.agent[].tools map left open.

Refs: only"
```

---

## Task 3: Drift-guard sync test (export VARIANTS, pin the setup key)

**Files:**
- Modify: `src/modules/qa/index.ts:25` (export `VARIANTS`)
- Test: `tests/modules/qa/caller-gate.test.ts` (append a drift-guard block)

- [ ] **Step 1: Write the failing drift-guard test**

Append to `tests/modules/qa/caller-gate.test.ts`:

```typescript
import { VARIANTS } from "../../../src/modules/qa/index.js"

describe("drift guard — setupAgentKey ↔ VARIANTS", () => {
  it("the setup variant is still named 'setup' (a rename must break this)", () => {
    expect(VARIANTS).toContain("setup")
  })
  it("the gate's setup key equals the zmora-prefixed setup variant", () => {
    // index.ts builds config.agent keys as `zmora-${stack}` and constructs the
    // gate with setupAgentKey "zmora-setup". If the variant is renamed/reordered,
    // this catches the gate silently pointing at a non-existent agent key.
    expect("zmora-setup").toBe(`zmora-${VARIANTS.find((v) => v === "setup")}`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.config.ts tests/modules/qa/caller-gate.test.ts`
Expected: FAIL — `VARIANTS` is not an export of `index.ts` (import resolves to `undefined`; `expect(undefined).toContain` throws).

- [ ] **Step 3: Export VARIANTS**

In `src/modules/qa/index.ts:25`, change:

```typescript
const VARIANTS = ["fe", "be", "setup"] as const
```

to:

```typescript
export const VARIANTS = ["fe", "be", "setup"] as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vitest.config.ts tests/modules/qa/caller-gate.test.ts`
Expected: PASS (7 tests total — 5 predicate + 2 drift-guard).

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/index.ts tests/modules/qa/caller-gate.test.ts
AV_COMMIT_SKILL=1 git commit -m "test(qa): pin caller-gate setup key against VARIANTS to prevent drift

Refs: only"
```

---

## Task 4: Documentation reconciliation

No tests. After all edits, run `bun run typecheck` to confirm no code comment edit broke a `.ts` file, then commit. Each edit points the reader at one canonical AGENTS.md section.

- [ ] **Step 1: Add the canonical section to `AGENTS.md`**

In `AGENTS.md`, add this new section immediately BEFORE the `## Common Pitfalls` section (near the end of the file):

```markdown
## Plugin-tool enforcement model

Per-agent `config.agent[<name>].tools` has TWO distinct meanings; do not conflate them:

- **Plugin tools** (registered by a plugin's `tool: {...}`, e.g. `execute_recipe`,
  `load_appverk_skill`): the `config.agent[].tools` deny-map is **declarative-only /
  INERT** on opencode 1.15.10 — a 2026-06-10 live probe found a denied plugin tool
  still executes. The markdown frontmatter `allowed-tools` *allowlist* direction was
  **not** probed and must be treated as asserted-not-enforced for plugin tools.
- **Native tools** (e.g. `skill`): `config.agent[].tools` DOES enforce, via opencode's
  string-keyed PermissionV2 engine. The coordinator's `skill: false`
  (`src/modules/coordinator/index.ts:369`) is a real backstop on this path.

**Load-bearing enforcement for plugin tools is in code, not the map:**
- QA's four tools are gated by `src/modules/qa/caller-gate.ts` at each tool's
  `execute()` (registry-only: `execute_recipe` → `zmora-setup`;
  `record_input`/`parse_plan`/`preflight` → the coordinator via registry-negative).
- stribog's tool allow-list + edit budget are enforced by a `tool.execute.before`
  hook (`src/modules/stribog/tool-budget-hook.ts`).

Keep the (inert) maps in place as declarative defense-in-depth — they become free
enforcement if a future opencode honors them. **On every opencode bump, re-verify
BOTH the plugin deny-map AND the markdown allowlist behavior for plugin tools**
(alongside the `NATIVE_BUILTINS` re-verify note).

### Residual gaps (tracked)

- The registry-negative coordinator gate does NOT deny background-dispatched
  subagents (`triglav` is not registered in `SessionAgentRegistry`; see
  `src/modules/coordinator/background.ts:54-62`) or non-dispatched custom agents.
  Accepted: those tools are in no agent's frontmatter except Perun's, and `triglav`
  is read-only. The minter (`execute_recipe`) is unaffected — it requires a positive
  `zmora-setup`.
- `load_appverk_skill: false` on the coordinator is plugin-map-only (inert). Truly
  preventing Perun from loading skills needs a handler/hook gate in `skill-registry`
  — tracked follow-up, not done here.
```

- [ ] **Step 2: Rewrite the misleading comment in `src/modules/qa/index.ts`**

Replace the existing comment above the `tools:` map (currently at `index.ts:175-177`):

```typescript
          // Plugin-provided tools are opt-in per agent. Only zmora-setup may
          // execute recipes; record_input and parse_plan are Perun-only
          // (registered in Perun's frontmatter, not in any zmora variant).
```

with:

```typescript
          // DECLARATIVE-ONLY defense-in-depth. This plugin-tool map is INERT on
          // opencode 1.15.10 (see AGENTS.md "Plugin-tool enforcement model") — the
          // load-bearing gate is caller-gate.ts at each tool's execute(). Kept so
          // it becomes free enforcement if a future opencode honors the map.
```

- [ ] **Step 3: Add a caveat to `src/modules/plan/index.ts`**

Replace the comment at `plan/index.ts:23-26`:

```typescript
        // Plugin tools are opt-in per agent. Veles orchestrates read-only
        // helpers (triglav now), so it needs the dispatch tools. These are
        // the coordinator's process-wide tools — enabling here, not in the
        // markdown allow-list (which is a no-op for plugin tools).
```

with:

```typescript
        // Plugin tools are opt-in per agent. Veles orchestrates read-only
        // helpers (triglav now), so it needs the dispatch tools. These are
        // the coordinator's process-wide tools — enabling here, not in the
        // markdown allow-list (which is a no-op for plugin tools).
        // NOTE: the enable direction of this map is also asserted-not-probed for
        // plugin tools on opencode 1.15.10 — see AGENTS.md "Plugin-tool
        // enforcement model". Do not treat it as a security boundary.
```

- [ ] **Step 4: Clarify the coordinator comment in `src/modules/coordinator/index.ts`**

Replace the comment at `coordinator/index.ts:363-368`:

```typescript
        // `skill: false` is a REAL backstop for the NATIVE `skill` tool on the
        // installed opencode 1.15.x runtime (verified in Task 1a): the runtime's
        // permission engine is string-keyed/PermissionV2, so the v1-SDK type
        // lacking a `skill` key is cosmetic — `skill: false` filters the tool out
        // of the toolset AND denies it at execute time. `load_appverk_skill: false`
        // gates the separate plugin skill-loader.
```

with:

```typescript
        // `skill: false` is a REAL backstop for the NATIVE `skill` tool on the
        // installed opencode 1.15.x runtime (verified in Task 1a): the runtime's
        // permission engine is string-keyed/PermissionV2, so the v1-SDK type
        // lacking a `skill` key is cosmetic — `skill: false` filters the tool out
        // of the toolset AND denies it at execute time.
        // `load_appverk_skill` is a PLUGIN tool, NOT native — its deny here is on
        // the INERT plugin-tool-map path (see AGENTS.md "Plugin-tool enforcement
        // model"), so this line does not actually prevent Perun loading skills.
        // Tracked follow-up: enforce it in skill-registry. Kept as declarative
        // defense-in-depth.
```

- [ ] **Step 5: Correct the legacy doc `docs/plugins/qa.md`**

In `docs/plugins/qa.md`, find the sentence at line ~96:

```
The tool-availability matrix is enforced per-variant in `AgentConfig.tools`: `execute_recipe` is enabled only on `zmora-setup`; `record_input` and `parse_plan` are disabled on every zmora variant and enabled only in Perun's frontmatter.
```

replace with:

```
The tool-availability *intent* is declared per-variant in `AgentConfig.tools`, but that plugin-tool map is INERT on opencode 1.15.10 (see `AGENTS.md` → "Plugin-tool enforcement model"). The load-bearing gate is `src/modules/qa/caller-gate.ts`, applied at each tool's `execute()`: `execute_recipe` requires the dispatched `zmora-setup` variant; `record_input`/`parse_plan`/`preflight` require the coordinator (Perun). `execute_recipe` is a `zmora-setup` tool (in `SETUP_TOOLS`), not a Perun-frontmatter tool.
```

Also soften the related claim at line ~94 (`fails at the allowlist check, not at a prompt-level guard`) — append after that sentence: ` (Note: the markdown allowlist enforcement for plugin tools is asserted-not-probed on opencode 1.15.10 — the runtime gate is the caller-gate, see AGENTS.md.)`

(This tree is legacy and slated for removal; these are minimal corrections, not a polish pass.)

- [ ] **Step 6: Verify typecheck still passes**

Run: `bun run typecheck`
Expected: PASS (comment-only edits to `.ts`; `export const VARIANTS` already landed in Task 3).

- [ ] **Step 7: Commit**

```bash
AV_COMMIT_SKILL=1 git add AGENTS.md src/modules/qa/index.ts src/modules/plan/index.ts src/modules/coordinator/index.ts docs/plugins/qa.md
AV_COMMIT_SKILL=1 git commit -m "docs: reconcile plugin-tool enforcement model across modules

Canonical AGENTS.md section: the config.agent[].tools plugin-tool map is
inert on opencode 1.15.10; native tools (skill) enforce via PermissionV2;
caller-gate.ts + stribog's hook are the load-bearing gates. Rewrite the QA
comment (declarative-only), add a caveat to plan, clarify that the
coordinator's load_appverk_skill deny is on the inert path (tracked
follow-up), and correct the legacy docs/plugins/qa.md enforcement claims.

Refs: only"
```

---

## Task 5: Final verification + rebuild committed dist

**Files:**
- Modify: `dist/` (rebuilt from `src/`)

- [ ] **Step 1: Rebuild the committed dist tree**

Run: `bun run build:root`
Expected: completes; `dist/modules/qa/index.js` now contains the gate wiring and `dist/modules/qa/caller-gate.js` exists.

- [ ] **Step 2: Run the full test + build gate**

Run: `bun run test`
Expected: PASS across root + all workspace packages.

- [ ] **Step 3: Verify dist is in sync with src**

Run: `bun run verify-dist`
Expected: `✅ dist/ is in sync with src/`.

- [ ] **Step 4: Confirm the gate landed in the shipped artifact**

Run: `grep -c "isSetupCaller\|isCoordinatorCaller" dist/modules/qa/index.js`
Expected: a non-zero count (the gate calls are present in the built output).

- [ ] **Step 5: Commit the rebuilt dist**

```bash
AV_COMMIT_SKILL=1 git add dist
AV_COMMIT_SKILL=1 git commit -m "build(qa): rebuild dist with the caller-gate wiring

Refs: only"
```

---

## Done criteria

- `caller-gate.ts` exists with two synchronous registry-only predicates, unit-tested.
- All four QA tools deny on caller identity at `execute()` with a `forbidden` status; `execute_recipe` is fail-closed for any non-`zmora-setup` caller.
- Drift-guard test pins the setup key to `VARIANTS`.
- AGENTS.md carries the canonical enforcement-model note; the four divergent comments + legacy qa.md point at it; `load_appverk_skill` and background-dispatch residuals are tracked.
- `bun run test` + `bun run verify-dist` green; committed `dist/` rebuilt.
