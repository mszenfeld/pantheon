# Registered-Agents-Only Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenCode agent picker show only Pantheon-registered agents by hiding the native `build`/`plan` built-ins and any user-authored agents.

**Architecture:** A new pure library module `src/modules/agent-roster/` exposes `applyRosterPolicy(config, preExisting)`. The merged `config` hook in `src/index.ts` snapshots `config.agent` keys *before* running per-module hooks (those keys are user/project agents — natives live in the runtime's internal map), then after the loop calls the policy, which (1) hides every pre-existing key, (2) hides native `build`/`plan` via override-by-key backstop, and (3) repoints `default_agent` to a visible primary. The coordinator sets `default_agent = "Perun - Coordinator"` when unset.

**Tech Stack:** TypeScript (strict, NodeNext ESM), `@opencode-ai/plugin`, Vitest, tsup, Bun.

---

## Background the implementer must know

- **Verified runtime facts (opencode 1.15.10):** native built-ins (`build`, `plan`, `general`, `explore`, `compaction`, `title`, `summary`) live in the runtime's INTERNAL agent map and are **never** present in the `config.agent` object the plugin `config` hook receives. The picker filter is `mode !== "subagent" && !hidden`, so `hidden: true` alone removes an agent from the picker regardless of `mode`. The only visible-primary natives are `build` and `plan`. Writing `config.agent.build = {...}` overrides the native by key. The `config` hook runs once per process.
- **`default_agent` typing gotcha:** the runtime honors `config.default_agent`, but the v1 SDK `Config` type the plugin compiles against has no `default_agent` field (it exists only in unused v2 types). We localize the cast in two accessors in the roster module.
- **Why hide and not `mode:"subagent"`:** flipping to `subagent` would make `build`/`plan` dispatchable (the dispatch preflight in `coordinator/dispatch.ts` rejects `primary` targets but accepts `subagent`), and our backstop writes them model-less. Keeping native `mode` blocks that. So `HIDE = { hidden: true }`.
- **Module conventions:** `agent-roster` is a `.ts`-only harness library (no plugin export, no `.md` asset), mirroring `src/modules/agent-registry/` and `src/modules/pantheon-config/`. The root `tsup` glob (`src/**/*.ts`) builds it to `dist/modules/agent-roster/` with no extra wiring; the bare `"dist"` entry in `package.json` `files` covers packaging.
- **Test execution:** unit tests import from `src/.../index.js` (Vitest resolves TS) — no build needed. `tests/root-plugin.test.ts` imports the built `dist/index.js` via `package.json` `main`, so those tasks must run `bun run build:root` first. The committed `dist/` tree must be rebuilt and committed at the end (`dist/` is published — see `.gitignore`/AGENTS.md).

## File Structure

- **Create** `src/modules/agent-roster/index.ts` — pure policy: `NATIVE_BUILTINS`, `HIDE`, `getDefaultAgent`, `setDefaultAgent`, `applyRosterPolicy`. One responsibility: roster visibility.
- **Create** `tests/modules/agent-roster/agent-roster.test.ts` — unit tests for the pure policy.
- **Modify** `src/index.ts` — merged `config` hook: snapshot + WeakSet one-shot guard + `applyRosterPolicy` call.
- **Modify** `src/modules/coordinator/index.ts` — set `default_agent` to Perun when unset.
- **Modify** `tests/root-plugin.test.ts` — orchestrator integration tests (hide build/plan/user, keep ours, snapshot-before-loop, double-invocation, default_agent).

---

## Task 1: Roster module scaffold — constants & `default_agent` accessors

**Files:**
- Create: `src/modules/agent-roster/index.ts`
- Test: `tests/modules/agent-roster/agent-roster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/agent-roster/agent-roster.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import {
  NATIVE_BUILTINS,
  getDefaultAgent,
  setDefaultAgent,
} from "../../../src/modules/agent-roster/index.js"

describe("agent-roster: constants & default_agent accessors", () => {
  it("lists the visible-primary native built-ins", () => {
    expect([...NATIVE_BUILTINS]).toEqual(["build", "plan"])
  })

  it("reads an unset default_agent as undefined", () => {
    const config = {} as Config
    expect(getDefaultAgent(config)).toBeUndefined()
  })

  it("round-trips default_agent through the typed accessors", () => {
    const config = {} as Config
    setDefaultAgent(config, "Perun - Coordinator")
    expect(getDefaultAgent(config)).toBe("Perun - Coordinator")
    expect((config as { default_agent?: string }).default_agent).toBe(
      "Perun - Coordinator",
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/modules/agent-roster/agent-roster.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/agent-roster/index.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/agent-roster/index.ts`:

```ts
import type { Config } from "@opencode-ai/plugin"

/**
 * Visible-primary native built-in agents on opencode 1.15.10 — the ONLY natives
 * that appear in the picker. `general`/`explore` are `mode:"subagent"` (already
 * excluded by the picker filter `mode!=="subagent" && !hidden`), and
 * `compaction`/`title`/`summary` are already `hidden`. Natives live in the
 * runtime's INTERNAL agent map and are NEVER present in `config.agent`, so the
 * snapshot-diff cannot hide them — only the backstop (override-by-key) can.
 * Re-verify against the actual picker (NOT the SDK type enum) on opencode bumps.
 */
export const NATIVE_BUILTINS = ["build", "plan"] as const

/**
 * `default_agent` is honored by the opencode runtime but is absent from the v1
 * SDK `Config` type the plugin compiles against (it exists only in v2 types,
 * unused for `Config`). These accessors localize the cast. Re-check on the next
 * `@opencode-ai/plugin` bump — once the field is native, the cast is removable.
 */
export function getDefaultAgent(config: Config): string | undefined {
  return (config as { default_agent?: string }).default_agent
}

export function setDefaultAgent(config: Config, name: string): void {
  ;(config as { default_agent?: string }).default_agent = name
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bunx vitest run tests/modules/agent-roster/agent-roster.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/agent-roster/index.ts tests/modules/agent-roster/agent-roster.test.ts && git commit -m "feat(roster): scaffold agent-roster module with default_agent accessors"
```

---

## Task 2: Implement `applyRosterPolicy`

**Files:**
- Modify: `src/modules/agent-roster/index.ts`
- Test: `tests/modules/agent-roster/agent-roster.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/modules/agent-roster/agent-roster.test.ts`:

```ts
import { applyRosterPolicy } from "../../../src/modules/agent-roster/index.js"

type Entry = { mode?: string; hidden?: boolean; model?: string; description?: string }

function cfg(
  agent: Record<string, Entry>,
  extra: Record<string, unknown> = {},
): Config {
  return { agent, ...extra } as unknown as Config
}

function entry(config: Config, key: string): Entry {
  return (config.agent as Record<string, Entry>)[key]
}

describe("agent-roster: applyRosterPolicy", () => {
  it("hides a pre-existing key, sets hidden:true, preserves other fields", () => {
    const config = cfg({ "user-agent": { mode: "primary", model: "x/y", description: "d" } })
    applyRosterPolicy(config, new Set(["user-agent"]))
    const e = entry(config, "user-agent")
    expect(e.hidden).toBe(true)
    expect(e.mode).toBe("primary")
    expect(e.model).toBe("x/y")
    expect(e.description).toBe("d")
  })

  it("does not touch a non-pre-existing (registered) agent", () => {
    const config = cfg({ "Perun - Coordinator": { mode: "primary" } })
    applyRosterPolicy(config, new Set())
    expect(entry(config, "Perun - Coordinator").hidden).toBeUndefined()
    expect(entry(config, "Perun - Coordinator").mode).toBe("primary")
  })

  it("backstop hides native build/plan even when absent from the map", () => {
    const config = cfg({})
    applyRosterPolicy(config, new Set())
    expect(entry(config, "build").hidden).toBe(true)
    expect(entry(config, "plan").hidden).toBe(true)
  })

  it("backstop preserves existing fields on a user-authored native", () => {
    const config = cfg({ build: { model: "x/y" } })
    applyRosterPolicy(config, new Set(["build"]))
    expect(entry(config, "build").hidden).toBe(true)
    expect(entry(config, "build").model).toBe("x/y")
  })

  it("hides a pre-existing mode:'all' user agent (keeps its mode)", () => {
    const config = cfg({ "user-all": { mode: "all" } })
    applyRosterPolicy(config, new Set(["user-all"]))
    expect(entry(config, "user-all").hidden).toBe(true)
    expect(entry(config, "user-all").mode).toBe("all")
  })

  it("skips a pre-existing key that is already hidden", () => {
    const config = cfg({ u: { mode: "subagent", hidden: true } })
    applyRosterPolicy(config, new Set(["u"]))
    expect(entry(config, "u").hidden).toBe(true)
    expect(entry(config, "u").mode).toBe("subagent")
  })

  it("repoints default_agent to Perun when unset", () => {
    const config = cfg({ "Perun - Coordinator": { mode: "primary" } })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBe("Perun - Coordinator")
  })

  it("leaves a valid (visible primary) default_agent unchanged", () => {
    const config = cfg(
      { "Perun - Coordinator": { mode: "primary" }, "frontend-developer": { mode: "primary" } },
      { default_agent: "frontend-developer" },
    )
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBe("frontend-developer")
  })

  it("repoints away from a now-hidden default_agent, preferring Perun", () => {
    const config = cfg(
      { "Perun - Coordinator": { mode: "primary" }, old: { mode: "primary" } },
      { default_agent: "old" },
    )
    applyRosterPolicy(config, new Set(["old"]))
    expect(getDefaultAgent(config)).toBe("Perun - Coordinator")
  })

  it("falls back to the sorted-first visible primary when Perun is absent", () => {
    const config = cfg({ zeta: { mode: "primary" }, alpha: { mode: "primary" } })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBe("alpha")
  })

  it("never picks a mode:undefined agent as the default", () => {
    const config = cfg({ "no-mode": {} })
    applyRosterPolicy(config, new Set())
    expect(getDefaultAgent(config)).toBeUndefined()
  })

  it("does not throw when config.agent is undefined and still applies the backstop", () => {
    const config = {} as Config
    applyRosterPolicy(config, new Set())
    expect(entry(config, "build").hidden).toBe(true)
  })

  it("is idempotent: a second call with the same preExisting changes nothing", () => {
    const config = cfg({ u: { mode: "primary", model: "m" } })
    applyRosterPolicy(config, new Set(["u"]))
    const snapshot = JSON.stringify(config)
    applyRosterPolicy(config, new Set(["u"]))
    expect(JSON.stringify(config)).toBe(snapshot)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run tests/modules/agent-roster/agent-roster.test.ts`
Expected: FAIL — `applyRosterPolicy is not a function` (not yet exported).

- [ ] **Step 3: Write the implementation**

Append to `src/modules/agent-roster/index.ts`:

```ts
const HIDE = { hidden: true } as const
const COORDINATOR_AGENT = "Perun - Coordinator"

type AgentMap = NonNullable<Config["agent"]>
type AgentEntry = AgentMap[string]

function isVisiblePrimary(entry: AgentEntry | undefined): boolean {
  if (entry === undefined) return false
  const e = entry as { mode?: string; hidden?: boolean }
  return e.mode === "primary" && e.hidden !== true
}

/**
 * Make the harness own the agent roster: hide every `config.agent` key we did
 * not register. `preExisting` = keys present BEFORE the harness's per-module
 * config hooks ran (user/project agents). Pure — mutates `config` in place.
 *
 * Two complementary mechanisms (a union, not redundant):
 *  - snapshot-diff hides user/project agents (they appear in config.agent);
 *  - the NATIVE_BUILTINS backstop hides build/plan (natives are never in
 *    config.agent, so only override-by-key can reach them).
 */
export function applyRosterPolicy(config: Config, preExisting: Set<string>): void {
  config.agent ??= {}
  const agents = config.agent as AgentMap

  // 1. snapshot-diff: hide user/project agents that pre-existed our hooks.
  for (const key of Object.keys(agents)) {
    if (!preExisting.has(key)) continue
    if ((agents[key] as { hidden?: boolean }).hidden === true) continue
    agents[key] = { ...agents[key], ...HIDE }
  }

  // 2. backstop: hide native visible-primary built-ins via override-by-key.
  for (const name of NATIVE_BUILTINS) {
    agents[name] = { ...(agents[name] ?? {}), ...HIDE }
  }

  // 3. default_agent guard: after hiding, the runtime throws if default_agent
  //    points to a hidden/subagent agent. Repoint to a visible primary,
  //    preferring Perun (named), else the first by sorted key order.
  const current = getDefaultAgent(config)
  if (current !== undefined && isVisiblePrimary(agents[current])) return
  if (isVisiblePrimary(agents[COORDINATOR_AGENT])) {
    setDefaultAgent(config, COORDINATOR_AGENT)
    return
  }
  const fallback = Object.keys(agents)
    .sort()
    .find((k) => isVisiblePrimary(agents[k]))
  if (fallback !== undefined) setDefaultAgent(config, fallback)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run tests/modules/agent-roster/agent-roster.test.ts`
Expected: PASS (all tests — the 3 from Task 1 plus the 13 new ones).

- [ ] **Step 5: Typecheck the source**

Run: `bunx tsc -p tsconfig.json --noEmit`
Expected: no errors. (If TS narrows `config.agent` complaints arise on the `??=` line, the `as AgentMap` cast on the next line resolves them.)

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/agent-roster/index.ts tests/modules/agent-roster/agent-roster.test.ts && git commit -m "feat(roster): implement applyRosterPolicy (snapshot-diff + native backstop + default_agent guard)"
```

---

## Task 3: Wire the policy into the orchestrator

**Files:**
- Modify: `src/index.ts` (import at top; merged `config` hook at lines 157-163)
- Test: `tests/root-plugin.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Append inside the `describe("AppVerkPlugins", ...)` block in `tests/root-plugin.test.ts` (before its closing `})` at line 294):

```ts
  it("hides native build/plan and pre-existing user agents, keeps registered agents", async () => {
    const { createAppVerkPlugins } = await loadRootModule()
    const plugin = createAppVerkPlugins([
      async () => ({
        config: async (config: { agent?: Record<string, unknown> }) => {
          config.agent ??= {}
          config.agent["Perun - Coordinator"] = { mode: "primary" }
        },
      }),
    ])
    const hooks = await plugin({} as never)
    const config = {
      agent: {
        build: { mode: "primary" },
        plan: { mode: "primary" },
        "user-agent": { mode: "primary" },
      },
    } as never

    await hooks.config?.(config)

    const agent = (config as { agent: Record<string, { mode?: string; hidden?: boolean }> }).agent
    // pre-existing (snapshotted before the loop) → hidden
    expect(agent.build.hidden).toBe(true)
    expect(agent.plan.hidden).toBe(true)
    expect(agent["user-agent"].hidden).toBe(true)
    // added during the loop → kept visible
    expect(agent["Perun - Coordinator"].hidden).toBeUndefined()
    expect(agent["Perun - Coordinator"].mode).toBe("primary")
    // sole visible primary becomes the default
    expect((config as { default_agent?: string }).default_agent).toBe("Perun - Coordinator")
  })

  it("survives a second invocation on the same config (does not hide its own agents)", async () => {
    const { createAppVerkPlugins } = await loadRootModule()
    const plugin = createAppVerkPlugins([
      async () => ({
        config: async (config: { agent?: Record<string, unknown> }) => {
          config.agent ??= {}
          config.agent["Perun - Coordinator"] = { mode: "primary" }
        },
      }),
    ])
    const hooks = await plugin({} as never)
    const config = { agent: { build: { mode: "primary" } } } as never

    await hooks.config?.(config)
    await hooks.config?.(config) // second pass on the SAME object

    const agent = (config as { agent: Record<string, { hidden?: boolean }> }).agent
    expect(agent["Perun - Coordinator"].hidden).toBeUndefined()
    expect(agent.build.hidden).toBe(true)
  })
```

- [ ] **Step 2: Build root and run the tests to verify they fail**

Run: `bun run build:root && bunx vitest run tests/root-plugin.test.ts`
Expected: FAIL — `build.hidden` is `undefined` (policy not wired yet); second-invocation test also fails.

- [ ] **Step 3: Add the import to `src/index.ts`**

After the existing import block at the top of `src/index.ts` (after the `AppVerkPantheonPlugin` import on line 13), add:

```ts
import { applyRosterPolicy } from "./modules/agent-roster/index.js"
```

- [ ] **Step 4: Replace the merged `config` hook**

In `src/index.ts`, replace this exact block (lines 157-163):

```ts
    if (plugins.some((plugin) => plugin.config)) {
      merged.config = async (config) => {
        for (const plugin of plugins) {
          await plugin.config?.(config)
        }
      }
    }
```

with:

```ts
    if (plugins.some((plugin) => plugin.config)) {
      // One-shot guard: the merged config hook is invoked once per process on
      // opencode 1.15.10, but correctness must not depend on that binary-internal
      // contract. If the SAME config object is passed twice, skip the snapshot +
      // roster policy on the second pass — otherwise the recomputed `preExisting`
      // would contain our own (now-persisted) agents and hide them.
      const processedConfigs = new WeakSet<object>()
      merged.config = async (config) => {
        const firstPass = !processedConfigs.has(config)
        // Snapshot agent keys BEFORE our module hooks run: these are the
        // user/project agents (natives live in the runtime's internal map, not
        // here). Anything our modules add during the loop is, by construction,
        // absent from this set and therefore kept visible by the policy.
        const preExisting = firstPass
          ? new Set(Object.keys(config.agent ?? {}))
          : new Set<string>()
        for (const plugin of plugins) {
          await plugin.config?.(config)
        }
        if (firstPass) {
          processedConfigs.add(config)
          applyRosterPolicy(config, preExisting)
        }
      }
    }
```

- [ ] **Step 5: Build root and run the tests to verify they pass**

Run: `bun run build:root && bunx vitest run tests/root-plugin.test.ts`
Expected: PASS — all existing root-plugin tests plus the two new ones.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/index.ts tests/root-plugin.test.ts && git commit -m "feat(roster): apply roster policy from the merged config hook with a one-shot guard"
```

---

## Task 4: Coordinator sets `default_agent` to Perun when unset

**Files:**
- Modify: `src/modules/coordinator/index.ts` (import + config hook, after line 377)
- Test: `tests/root-plugin.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("AppVerkPlugins", ...)` block in `tests/root-plugin.test.ts`:

```ts
  it("sets default_agent to Perun when the user has not set one", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = {} as never

    await plugin.config?.(config)

    expect((config as { default_agent?: string }).default_agent).toBe("Perun - Coordinator")
  })

  it("respects a user-provided default_agent that resolves to a visible primary", async () => {
    const { AppVerkPlugins } = await loadRootModule()
    const plugin = await AppVerkPlugins({} as never)
    const config = { default_agent: "frontend-developer" } as never

    await plugin.config?.(config)

    expect((config as { default_agent?: string }).default_agent).toBe("frontend-developer")
  })
```

- [ ] **Step 2: Build root and run the tests to verify they fail**

Run: `bun run build:root && bunx vitest run tests/root-plugin.test.ts`
Expected: FAIL — `default_agent` is `undefined` in the first test (coordinator does not set it yet).

- [ ] **Step 3: Add the import to `src/modules/coordinator/index.ts`**

After the existing import of `getDispatchExtensions` (line 32, `import { getDispatchExtensions } from "../_shared/dispatch-extensions.js"`), add:

```ts
import { getDefaultAgent, setDefaultAgent } from "../agent-roster/index.js"
```

- [ ] **Step 4: Set `default_agent` in the coordinator config hook**

In `src/modules/coordinator/index.ts`, inside the `config:` hook, insert the following immediately after the Perun-model injection block (after line 377, the closing `}` of `if (perunModel !== undefined) {...}`, and before the hook's closing `},`):

```ts
      // Make Perun the session-open default. The roster policy hides the native
      // `build` (opencode's default primary), so default_agent must point to a
      // visible primary or the runtime throws at startup. Only set when unset so
      // a user's explicit default_agent wins. `setDefaultAgent` localizes the cast
      // for a field the runtime honors but the v1 SDK Config type omits.
      if (getDefaultAgent(config) === undefined) {
        setDefaultAgent(config, "Perun - Coordinator")
      }
```

- [ ] **Step 5: Build root and run the tests to verify they pass**

Run: `bun run build:root && bunx vitest run tests/root-plugin.test.ts`
Expected: PASS — both new tests plus all prior ones.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/index.ts tests/root-plugin.test.ts && git commit -m "feat(coordinator): default to Perun so the picker never opens on a hidden agent"
```

---

## Task 5: Full validation and commit the rebuilt `dist/`

**Files:**
- Modify (generated): `dist/**` (committed build output)

- [ ] **Step 1: Run the full check**

Run: `bun run check`
Expected: PASS — typecheck (root + all workspaces), full test suite (root + workspaces), and build all succeed.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: no errors. (If ESLint flags the deliberate cast in the accessors, it is intentional — the `default_agent` field is absent from the v1 type; keep the cast and, only if a rule blocks it, add a scoped `// eslint-disable-next-line` with a one-line rationale.)

- [ ] **Step 3: Verify the committed dist is in sync**

Run: `bun run verify-dist`
Expected: PASS — `dist/` matches the rebuilt output (Step 1 already rebuilt it).

- [ ] **Step 4: Commit the rebuilt dist**

```bash
AV_COMMIT_SKILL=1 git add dist && git commit -m "build(roster): rebuild committed dist for the registered-agents-only roster"
```

(If `git add dist` stages nothing, the build produced no diff — skip this commit.)

---

## Self-Review (completed by plan author)

**Spec coverage:**
- "snapshot-diff hides user agents" → Task 2 (tests) + Task 3 (orchestrator snapshot). ✓
- "backstop hides native build/plan via override-by-key" → Task 2 (`NATIVE_BUILTINS` loop + tests). ✓
- "`HIDE = { hidden: true }`, preserve mode" → Task 2 implementation + the mode-preservation/`mode:'all'` tests. ✓
- "default_agent typed escape hatch" → Task 1 accessors. ✓
- "coordinator sets Perun when unset; user override respected" → Task 4 + both tests. ✓
- "default_agent guard prefers Perun, sorted fallback, mode===undefined excluded" → Task 2 guard tests. ✓
- "WeakSet one-shot idempotency + double-invocation test" → Task 3. ✓
- "new module auto-built, dist committed" → Task 5. ✓
- "agent inventory safe (all M1)" → no code needed; verified during review (documented in spec). ✓
- "load-path invariant" → documented in spec; no code task (it is a guardrail, not behavior). ✓

**Placeholder scan:** none — every code/test step contains complete content.

**Type consistency:** `applyRosterPolicy(config, preExisting)`, `getDefaultAgent`/`setDefaultAgent`, `NATIVE_BUILTINS`, `HIDE`, `isVisiblePrimary`, `AgentMap`/`AgentEntry` are used identically across Tasks 1-4. Import specifiers use `.js` (NodeNext ESM) consistently.
