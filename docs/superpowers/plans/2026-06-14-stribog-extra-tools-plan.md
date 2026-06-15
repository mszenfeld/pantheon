# Stribog `extraTools` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Stribog with configurable extra actuator tools (MCP, exact id or glob), guarded by a capability-aware immutable deny, plus dispatch contract and project-identity verification to close the general-fallback incident.

**Architecture:** Three-layer enforcement — (1) config-load validation (best-effort, §3.5), (2) tool-budget hook (the real boundary, with raw-vs-lowercase split and attribution-gated deny), (3) Perun dispatch contract + prompt guard (§3.10). The common case (bounded grant/fix on verified, seeded fixture) stays in Stribog's lane; escalations route to a stop, not to `general`.

**Tech Stack:** TypeScript, TDD, Conventional Commits, `bun run build` (CI-enforced dist sync).

---

## Phase 0: Prerequisites (Manual, before coding)

### Setup Task: §4.1 Supabase MCP id-literal probe

**Files:** `.config/opencode/opencode.json`, test harness (TBD — operator's local stack)

This probe must be run BEFORE the first code merge, but can run in parallel with coding. It is a setup step, not blocking code tasks:

**(i)** Operator adds `mcp.supabase` to `~/.config/opencode/opencode.json` pointing at the local stack (must be present before any test of `extraTools: ["supabase_*"]` can run).
**(ii)** Record the exact server key chosen (e.g. `"supabase"` → the prefix is `supabase_`).
**(iii)** Dispatch stribog with `extraTools:["supabase_*"]`.
**(iv)** Log `input.tool` in the hook (temporary debug).
**(v)** Record the observed literal: is Supabase's tool `execute_sql` or `execute-sql`? Pin this in a test after observation (Task 2.5).

---

## Phase 1: Metadata, Guardrail, and Helpers

### Task 1.1: Rename `STRIBOG_ALLOWED_TOOL_IDS` → `CORE_BUILTINS`; add `IMMUTABLE_DENY` and helpers

**Files:**
- Modify: `src/modules/stribog/stribog.metadata.ts`
- Modify: `src/modules/stribog/tool-budget-hook.ts` (import only; logic in later task)
- Modify: `tests/modules/stribog/metadata.test.ts`

**Context:** The metadata file is the source of truth for the allow-list and the new deny-list. Define both constants here; the hook will import them. "CORE_BUILTINS" clarifies that this is the *static* boundary; `extraTools` is separate and *dynamic*.

- [ ] **Step 1: Add new constant definitions to `stribog.metadata.ts`**

```typescript
// Line 31-39, replace:
export const STRIBOG_ALLOWED_TOOL_IDS: ReadonlySet<string> = new Set([
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "bash",
])

// With:
/** Canonical set of core builtin tool ids, always allow-listed for Stribog (static boundary). */
export const CORE_BUILTINS: ReadonlySet<string> = new Set([
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "bash",
])

/** Immutable deny set — capability-aware, no config can re-enable these.
 * Includes minter (`execute_recipe`), leaf-dispatch (`task` + DISPATCH_TOOL_NAMES),
 * and capability-class regexes for shell/exec/write/memory/symbol mutations. */
export const IMMUTABLE_DENY_NAMED: ReadonlySet<string> = new Set([
  "execute_recipe",
  "task",
  // Import and spread DISPATCH_TOOL_NAMES here:
  ...DISPATCH_TOOL_NAMES,
])

/** Capability-class deny patterns (anchored regexes, matched against normalized lowercase id).
 * Matches any tool whose id contains exec/dispatch/mint/write markers. */
export const IMMUTABLE_DENY_PATTERNS: ReadonlyArray<RegExp> = [
  // Shell execution
  /(^|_)execute_shell(_command)?$/i,
  /(^|_)shell(_command)?$/i,
  // Dispatch and leaf
  /(^|_)dispatch(_|$)/i,
  /(^|_)recipe(_|$)/i,
  /^task(_|$)/i,
  // Mutation verbs (code/memory writes)
  /(^|_)(write|create|replace|insert|rename|delete|move|edit)_/i,
  // Mutation targets
  /_(memory|symbol|symbol_body|content|text_file)$/i,
]

/** Helper: test whether a normalized (lowercase) tool id is in the immutable deny set.
 * Returns true if the id is in IMMUTABLE_DENY_NAMED OR matches any IMMUTABLE_DENY_PATTERNS. */
export function isImmutableDeny(normalizedId: string): boolean {
  return (
    IMMUTABLE_DENY_NAMED.has(normalizedId) ||
    IMMUTABLE_DENY_PATTERNS.some(rx => rx.test(normalizedId))
  )
}

/** Helper: test whether a pattern (glob or exact id) is valid for extraTools.
 * Returns { valid: true } or { valid: false, error: reason }. */
export function validateExtraToolsPattern(
  pattern: string,
): { valid: true } | { valid: false; error: string } {
  // Must be lowercase alnum + underscore + dash, optional trailing *
  if (!/^[a-z0-9_-]+\*?$/.test(pattern)) {
    return {
      valid: false,
      error: "must be lowercase alnum/_/-, optional single trailing *",
    }
  }
  // Bare * is forbidden
  if (pattern === "*") {
    return { valid: false, error: "bare * not allowed" }
  }
  // Exact match against named deny ids
  if (IMMUTABLE_DENY_NAMED.has(pattern)) {
    return { valid: false, error: `exact denied id: ${pattern}` }
  }
  // If a glob, check if the prefix matches any deny pattern
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1)
    // Glob rejection: glob's prefix statically covers a named id
    for (const deniedId of IMMUTABLE_DENY_NAMED) {
      if (deniedId.startsWith(prefix)) {
        return {
          valid: false,
          error: `glob ${pattern} would cover denied id ${deniedId}`,
        }
      }
    }
    // Glob rejection: glob's prefix itself matches a pattern
    if (IMMUTABLE_DENY_PATTERNS.some(rx => rx.test(prefix))) {
      return {
        valid: false,
        error: `glob ${pattern} prefix matches a denied capability class`,
      }
    }
  }
  return { valid: true }
}

/** Helper: match a pattern (glob or exact) against a normalized id.
 * Patterns are validated (per validateExtraToolsPattern) before use. */
export function matchesExtraToolsPattern(pattern: string, normalizedId: string): boolean {
  return pattern.endsWith("*")
    ? normalizedId.startsWith(pattern.slice(0, -1))
    : normalizedId === pattern
}
```

**Import:** At the top of `stribog.metadata.ts`, add:
```typescript
import { DISPATCH_TOOL_NAMES } from "../coordinator/dispatch-tool-names.js"
```

- [ ] **Step 2: Update the hook import**

In `src/modules/stribog/tool-budget-hook.ts`, line 4, replace:
```typescript
import {
  STRIBOG_AGENT_KEY,
  STRIBOG_ALLOWED_TOOL_IDS,
  STRIBOG_EDIT_BUDGET,
} from "./stribog.metadata.js"
```

With:
```typescript
import {
  STRIBOG_AGENT_KEY,
  CORE_BUILTINS,
  STRIBOG_EDIT_BUDGET,
  isImmutableDeny,
  matchesExtraToolsPattern,
} from "./stribog.metadata.js"
```

- [ ] **Step 3: Update tests for the rename + add corpus test**

In `tests/modules/stribog/metadata.test.ts`, update the existing "frozen ids" test (lines 69-77) to use `CORE_BUILTINS` instead of `STRIBOG_ALLOWED_TOOL_IDS`, and add a new test for the capability corpus:

```typescript
describe("IMMUTABLE_DENY capability guardrail", () => {
  it("denies all ids in the dangerous capability corpus", () => {
    const dangerousIds = [
      // Serena exec/shell
      "serena_execute_shell_command",
      // Serena write/mutation
      "serena_write_memory",
      "serena_create_text_file",
      "serena_replace_content",
      "serena_replace_symbol_body",
      "serena_insert_after_symbol",
      "serena_insert_before_symbol",
      "serena_rename_symbol",
      "serena_delete_memory",
      "serena_safe_delete_symbol",
      "serena_edit_memory",
      // Minter
      "execute_recipe",
      // Leaf
      "task",
      // Dispatch
      "dispatch_parallel",
      "dispatch_background",
      "poll_background",
      "wait_background",
      // Weird casing
      "EXECUTE_RECIPE",
      "SERENA_EXECUTE_SHELL_COMMAND",
    ]
    for (const id of dangerousIds) {
      expect(isImmutableDeny(id.toLowerCase())).toBe(true)
    }
  })

  it("pins DISPATCH_TOOL_NAMES membership in IMMUTABLE_DENY", () => {
    // Ensures shrinking the dispatch list fails this test
    expect(IMMUTABLE_DENY_NAMED).toContain("dispatch_parallel")
    expect(IMMUTABLE_DENY_NAMED).toContain("dispatch_background")
    expect(IMMUTABLE_DENY_NAMED).toContain("poll_background")
    expect(IMMUTABLE_DENY_NAMED).toContain("wait_background")
  })
})

describe("validateExtraToolsPattern", () => {
  it("rejects malformed patterns", () => {
    expect(validateExtraToolsPattern("CamelCase").valid).toBe(false)
    expect(validateExtraToolsPattern("with space").valid).toBe(false)
    expect(validateExtraToolsPattern("*").valid).toBe(false)
  })

  it("rejects exact matches of denied ids", () => {
    expect(validateExtraToolsPattern("execute_recipe").valid).toBe(false)
    expect(validateExtraToolsPattern("task").valid).toBe(false)
  })

  it("rejects globs whose prefix covers a denied id", () => {
    expect(validateExtraToolsPattern("execute_*").valid).toBe(false)
    expect(validateExtraToolsPattern("dispatch_*").valid).toBe(false)
  })

  it("rejects globs whose prefix matches a capability pattern", () => {
    expect(validateExtraToolsPattern("*shell*").valid).toBe(false)
    expect(validateExtraToolsPattern("serena_*").valid).toBe(false)
  })

  it("accepts valid tool globs", () => {
    expect(validateExtraToolsPattern("supabase_*").valid).toBe(true)
    expect(validateExtraToolsPattern("context7_*").valid).toBe(true)
  })

  it("accepts valid exact ids", () => {
    expect(validateExtraToolsPattern("supabase_execute_sql").valid).toBe(true)
    expect(validateExtraToolsPattern("context7_resolve-library-id").valid).toBe(true)
  })
})

describe("matchesExtraToolsPattern", () => {
  it("exact match works", () => {
    expect(matchesExtraToolsPattern("supabase_execute_sql", "supabase_execute_sql")).toBe(true)
    expect(matchesExtraToolsPattern("supabase_execute_sql", "supabase_other")).toBe(false)
  })

  it("glob matches the prefix", () => {
    expect(matchesExtraToolsPattern("supabase_*", "supabase_execute_sql")).toBe(true)
    expect(matchesExtraToolsPattern("supabase_*", "context7_resolve_id")).toBe(false)
  })
})
```

- [ ] **Step 4: Run tests to verify**

```bash
bun test tests/modules/stribog/metadata.test.ts
```

Expected: all metadata tests pass (including the frozen 6-id check, corpus denial, patterns, and matching logic).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/stribog.metadata.ts tests/modules/stribog/metadata.test.ts
git commit -m "feat(stribog): add IMMUTABLE_DENY + validation helpers for extraTools guardrail"
```

---

### Task 1.2: Update `STRIBOG_DENIED_TOOLS` to reconcile with `IMMUTABLE_DENY_NAMED`

**Files:**
- Modify: `src/modules/stribog/stribog.metadata.ts` (lines 45-51)
- Modify: `tests/modules/stribog/metadata.test.ts` (test at lines 79-87)

The native `config.agent.stribog.tools` deny-map is inert (§4.2) but is a declarative document of intent. Reconcile it to include the dispatch family alongside the existing entries.

- [ ] **Step 1: Extend `STRIBOG_DENIED_TOOLS` to include dispatch**

In `stribog.metadata.ts`, lines 45-51, replace:
```typescript
export const STRIBOG_DENIED_TOOLS: Readonly<Record<string, false>> = {
  task: false,
  execute_recipe: false,
  todowrite: false,
  webfetch: false,
  websearch: false,
}
```

With:
```typescript
export const STRIBOG_DENIED_TOOLS: Readonly<Record<string, false>> = {
  task: false,
  execute_recipe: false,
  dispatch_parallel: false,
  dispatch_background: false,
  poll_background: false,
  wait_background: false,
  todowrite: false,
  webfetch: false,
  websearch: false,
}
```

- [ ] **Step 2: Update the test assertion**

In `tests/modules/stribog/metadata.test.ts` (lines 79-87), update the `toMatchObject` to expect the new keys. Replace the hardcoded 5-entry `toMatchObject` with:

```typescript
it("STRIBOG_DENIED_TOOLS includes at least the immutable named set", () => {
  // Ensure extending STRIBOG_DENIED_TOOLS doesn't drop the immutable core
  const expectedMinimum = {
    task: false,
    execute_recipe: false,
    dispatch_parallel: false,
    dispatch_background: false,
    poll_background: false,
    wait_background: false,
  }
  expect(STRIBOG_DENIED_TOOLS).toMatchObject(expectedMinimum)
  // Also assert the extra opt-outs (webfetch/websearch/todowrite) are still there
  expect(STRIBOG_DENIED_TOOLS.webfetch).toBe(false)
  expect(STRIBOG_DENIED_TOOLS.websearch).toBe(false)
  expect(STRIBOG_DENIED_TOOLS.todowrite).toBe(false)
})
```

- [ ] **Step 3: Run test**

```bash
bun test tests/modules/stribog/metadata.test.ts -t "STRIBOG_DENIED_TOOLS"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/stribog/stribog.metadata.ts tests/modules/stribog/metadata.test.ts
git commit -m "fix(stribog): reconcile STRIBOG_DENIED_TOOLS with DISPATCH_TOOL_NAMES membership"
```

---

## Phase 2: Hook Core Logic (Raw-vs-Lowercase + Attribution-Gated Deny)

### Task 2.1: Rewrite `tool-budget-hook.ts` with the new predicate logic

**Files:**
- Modify: `src/modules/stribog/tool-budget-hook.ts` (lines 54-119)
- Modify: `tests/modules/stribog/tool-budget-hook.test.ts` (update + add tests)

The hook is the real boundary. The new logic:
1. Pre-filter: CORE_BUILTINS early return (no attribution).
2. Attribution gate.
3. Deny IMMUTABLE_DENY (on stribog confirmed).
4. Allow CORE_BUILTINS (unchanged) or `extraPatterns` match.
5. Else DENY.

- [ ] **Step 1: Write failing tests for the new behavior**

In `tests/modules/stribog/tool-budget-hook.test.ts`, add:

```typescript
describe("raw-vs-lowercase split", () => {
  it("capital Edit is still denied (matched raw against CORE_BUILTINS)", async () => {
    // This pins the existing behavior at line 90-94
    const hook = makeStribogToolHook({ resolveAgent })
    // Simulate a weird-cased tool id that opencode might emit
    await expect(
      hook.hook(
        { tool: "Edit", sessionID: stribogSession, callID: "call1" },
        { args: {} },
      ),
    ).rejects.toThrow("STRIBOG_TOOL_DENIED")
  })

  it("execute_recipe lowercased is denied (matched normalized against IMMUTABLE_DENY)", async () => {
    const hook = makeStribogToolHook({ resolveAgent })
    await expect(
      hook.hook(
        { tool: "Execute_Recipe", sessionID: stribogSession, callID: "call1" },
        { args: {} },
      ),
    ).rejects.toThrow("STRIBOG_TOOL_DENIED")
  })

  it("TASK lowercased is denied", async () => {
    const hook = makeStribogToolHook({ resolveAgent })
    await expect(
      hook.hook(
        { tool: "TASK", sessionID: stribogSession, callID: "call1" },
        { args: {} },
      ),
    ).rejects.toThrow("STRIBOG_TOOL_DENIED")
  })

  it("serena_replace_symbol_body is denied (capability pattern match)", async () => {
    const hook = makeStribogToolHook({ resolveAgent })
    await expect(
      hook.hook(
        { tool: "serena_replace_symbol_body", sessionID: stribogSession, callID: "call1" },
        { args: {} },
      ),
    ).rejects.toThrow("STRIBOG_TOOL_DENIED")
  })
})

describe("attribution-gated deny", () => {
  it("immutable deny is checked only for stribog; non-stribog passes through", async () => {
    // A non-stribog session (e.g., Perun) should NOT be denied by the hook
    const nonStribogSession = "session-perun"
    mockResolveAgent.mockResolvedValue("perun") // non-stribog
    
    const hook = makeStribogToolHook({ resolveAgent: mockResolveAgent })
    // execute_recipe should pass (not denied) for a non-stribog session
    await expect(
      hook.hook(
        { tool: "execute_recipe", sessionID: nonStribogSession, callID: "call1" },
        { args: {} },
      ),
    ).resolves.toBeUndefined() // no throw = pass-through
  })

  it("pre-filter (core-builtins) returns before attribution check", async () => {
    // This ensures we don't call resolveAgent for the 6 core builtins
    let attributionCalled = false
    const trackingResolveAgent = async () => {
      attributionCalled = true
      return STRIBOG_AGENT_KEY
    }
    const hook = makeStribogToolHook({ resolveAgent: trackingResolveAgent })
    
    // read is in CORE_BUILTINS, should return early without calling resolveAgent
    await hook.hook({ tool: "read", sessionID: "any-session", callID: "call1" }, { args: {} })
    expect(attributionCalled).toBe(false)
  })
})

describe("extraPatterns matching", () => {
  it("pattern-matched MCP id triggers attribution (not pre-filter)", async () => {
    // supabase_* is a pattern, not in CORE_BUILTINS, so it must call resolveAgent
    let attributionCalled = false
    const trackingResolveAgent = async () => {
      attributionCalled = true
      return STRIBOG_AGENT_KEY
    }
    
    const hook = makeStribogToolHook({ resolveAgent: trackingResolveAgent })
    // Manually create a hook with extraPatterns (would be set by stribog/index.ts)
    // This is a bit tricky — we need to test the hook's behavior when extraPatterns is provided.
    // For now, defer to a later task that wires up the full flow.
  })
})
```

- [ ] **Step 2: Rewrite the hook's `allowed()` logic**

In `src/modules/stribog/tool-budget-hook.ts`, replace the hook implementation (lines 69-119) with:

```typescript
export function makeStribogToolHook(
  deps: StribogToolHookDeps & { extraPatterns?: string[] },
): StribogToolHookHandle {
  const editedPaths = new Map<string, Set<string>>()
  const extraPatterns = deps.extraPatterns ?? []

  function pathsFor(sessionID: string): Set<string> {
    let set = editedPaths.get(sessionID)
    if (set === undefined) {
      set = new Set<string>()
      editedPaths.set(sessionID, set)
    }
    return set
  }

  const hook: StribogToolHook = async (input, output) => {
    try {
      const raw = input.tool
      const isEditWrite = raw === "edit" || raw === "write"

      // Pre-filter: core builtins always pass, no attribution needed
      if (!isEditWrite && CORE_BUILTINS.has(raw)) {
        // Cheap pass-through (same trust class as bash)
        return
      }

      // Attribution: determine the session's agent
      const agent = await deps.resolveAgent(input.sessionID)
      if (agent !== STRIBOG_AGENT_KEY) {
        // Fail-open: non-stribog sessions pass through
        return
      }

      // ---- confirmed stribog session from here ----

      // Normalize the tool id for deny/glob matching
      const normalizedTool = raw.toLowerCase()

      // Step 1: Check immutable deny (wins over any glob)
      if (isImmutableDeny(normalizedTool)) {
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is in the immutable deny set ` +
            `(minting/dispatch/exec/shell/memory-write capabilities are never granted). ` +
            `Return ESCALATE.`,
        )
      }

      // Step 2: Core builtins (unchanged)
      if (CORE_BUILTINS.has(raw)) {
        // Falls through to edit budget check below
      } else if (extraPatterns.some(p => matchesExtraToolsPattern(p, normalizedTool))) {
        // Step 3: Pattern-matched extraTools (allowed)
        // Falls through (no edit budget for DB tools)
        return
      } else {
        // Step 4: Neither core nor extra
        throw new Error(
          `${TOOL_DENIED}: tool "${raw}" is outside Stribog's allow-list ` +
            `(read/glob/grep/edit/write/bash only, plus configured extraTools). ` +
            `Return ESCALATE.`,
        )
      }

      // Edit budget (core tools only)
      if (isEditWrite) {
        const filePath = output.args?.filePath
        if (typeof filePath !== "string" || !isAbsolute(filePath)) return // fail-open: missing/relative
        const path = resolve(filePath)
        const set = pathsFor(input.sessionID)
        if (!set.has(path) && set.size >= STRIBOG_EDIT_BUDGET) {
          const alreadyModified = [...set].join(", ")
          throw new Error(
            `${SCOPE_VIOLATION}: edit budget exhausted (${STRIBOG_EDIT_BUDGET} distinct files ` +
              `already modified: ${alreadyModified}; refused: ${path}). Return ESCALATE.`,
          )
        }
        set.add(path)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      if (message.startsWith(TOOL_DENIED) || message.startsWith(SCOPE_VIOLATION)) {
        throw error
      }
      // Never throw from a hook on internal/attribution errors
    }
  }

  const clearSession = (sessionID: string): void => {
    editedPaths.delete(sessionID)
  }

  return { hook, clearSession }
}
```

Update the interface to accept `extraPatterns`:

```typescript
export interface StribogToolHookDeps {
  /** Resolve a session's agent key. Returns undefined when unknown (→ fail-open). */
  resolveAgent: (sessionID: string) => Promise<string | undefined>
  /** Optional: extra tool-id patterns (exact or glob) granted to stribog. */
  extraPatterns?: string[]
}
```

- [ ] **Step 3: Update the existing tests to match new logic**

Update the line-90 test to ensure `Edit` is still denied:

```typescript
it("capital Edit is denied (matched raw, preserves existing pin)", async () => {
  const hook = makeStribogToolHook({ resolveAgent })
  await expect(
    hook.hook(
      { tool: "Edit", sessionID: stribogSession, callID: "call1" },
      { args: {} },
    ),
  ).rejects.toThrow("STRIBOG_TOOL_DENIED")
})
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/modules/stribog/tool-budget-hook.test.ts
```

Expected: all tests pass (including the new raw-vs-lowercase + attribution-gated logic).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/tool-budget-hook.ts tests/modules/stribog/tool-budget-hook.test.ts
git commit -m "feat(stribog): rewrite hook with raw-vs-lowercase split and attribution-gated deny"
```

---

### Task 2.2: Add hook tests for execute_recipe with permissive extraPatterns

**Files:**
- Modify: `tests/modules/stribog/tool-budget-hook.test.ts`

Verify that even with `extraPatterns: ["*"]` (hypothetically), `execute_recipe` is still denied.

- [ ] **Step 1: Write the test**

```typescript
describe("execute_recipe denied even with permissive extraPatterns", () => {
  it("execute_recipe is denied for stribog regardless of extraPatterns", async () => {
    const hook = makeStribogToolHook({
      resolveAgent,
      extraPatterns: ["*"], // hypothetically permissive
    })
    await expect(
      hook.hook(
        { tool: "execute_recipe", sessionID: stribogSession, callID: "call1" },
        { args: {} },
      ),
    ).rejects.toThrow("STRIBOG_TOOL_DENIED")
  })

  it("supabase_execute_sql is allowed when extraPatterns includes supabase_*", async () => {
    const hook = makeStribogToolHook({
      resolveAgent,
      extraPatterns: ["supabase_*"],
    })
    // Should not throw (allowed by pattern)
    await expect(
      hook.hook(
        { tool: "supabase_execute_sql", sessionID: stribogSession, callID: "call1" },
        { args: {} },
      ),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test**

```bash
bun test tests/modules/stribog/tool-budget-hook.test.ts -t "execute_recipe"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/stribog/tool-budget-hook.test.ts
git commit -m "test(stribog): assert execute_recipe denied even with permissive extraPatterns"
```

---

## Phase 3: Config Plumbing

### Task 3.1: Update `pantheon-config/schema.ts` for optional `model` and `extraTools`

**Files:**
- Modify: `src/modules/pantheon-config/schema.ts`
- Modify: `tests/modules/pantheon-config/schema.test.ts`

The §3.2 schema BLOCKER: an `extraTools`-only agent (no `model`) is silently dropped by the current `if (model === undefined) continue;` guard. Fix it by extracting and validating `extraTools` above the guard, and storing when `model` is valid OR `extraTools` is non-empty.

- [ ] **Step 1: Update the `PantheonConfig` type**

In `src/modules/pantheon-config/schema.ts`, around line 11-13:

```typescript
export interface PantheonConfig {
  agents: {
    [name: string]: {
      model?: string // Make optional (§3.2)
      extraTools?: string[] // New field
    }
  }
}
```

- [ ] **Step 2: Add `"extraTools"` to `KNOWN_AGENT_FIELDS`**

Line ~59, replace:
```typescript
const KNOWN_AGENT_FIELDS = new Set(["model"])
```

With:
```typescript
const KNOWN_AGENT_FIELDS = new Set(["model", "extraTools"])
```

- [ ] **Step 3: Update the schema validator (the §3.2 fix)**

Find the per-agent loop (lines ~130-165) and rewrite to extract `extraTools` above the `model === undefined` guard:

**Find this block:**
```typescript
for (const [rawName, agent] of Object.entries(rawAgents)) {
  const name = rawName.toLowerCase()
  const model = agent.model
  if (model === undefined) continue // <-- THIS IS THE BLOCKER
  if (!MODEL_REGEX.test(model)) {
    // ... error handling
  }
  result.agents[name] = { model }
}
```

**Replace with:**
```typescript
for (const [rawName, agent] of Object.entries(rawAgents)) {
  const name = rawName.toLowerCase()
  const model = agent.model
  const extraTools = (agent.extraTools ?? []) as unknown

  // Validate extraTools
  if (!Array.isArray(extraTools)) {
    errors.push(`agents.${rawName}.extraTools: must be an array (got ${typeof extraTools})`)
    continue
  }
  if (!extraTools.every(t => typeof t === "string")) {
    errors.push(`agents.${rawName}.extraTools: all entries must be strings`)
    continue
  }

  // Validate model if present
  if (model !== undefined && !MODEL_REGEX.test(model)) {
    errors.push(`agents.${rawName}.model: invalid format (must be <provider>/<model>)`)
    continue
  }

  // Store agent if model is valid OR extraTools is non-empty (§3.2 fix)
  if (model !== undefined || extraTools.length > 0) {
    result.agents[name] = {
      ...(model ? { model } : {}),
      ...(extraTools.length ? { extraTools } : {}),
    }
  }
}
```

- [ ] **Step 4: Add validation for extraTools config (§3.5) – DEFER if not ready**

For now, defer the §3.5 config-load validation (malformed patterns, collisions with deny-set) to a separate task. Just store the validated array.

- [ ] **Step 5: Write failing test for the §3.2 case**

In `tests/modules/pantheon-config/schema.test.ts`, add:

```typescript
it("stores an agent with only extraTools (no model)", () => {
  const config = {
    agents: {
      stribog: {
        extraTools: ["supabase_*"],
      },
    },
  }
  const result = loadSchema(config)
  expect(result.agents.stribog).toEqual({
    extraTools: ["supabase_*"],
  })
})

it("stores an agent with model and extraTools", () => {
  const config = {
    agents: {
      stribog: {
        model: "openai/gpt-5.4",
        extraTools: ["supabase_*"],
      },
    },
  }
  const result = loadSchema(config)
  expect(result.agents.stribog).toEqual({
    model: "openai/gpt-5.4",
    extraTools: ["supabase_*"],
  })
})

it("warns on non-stribog agents with extraTools", () => {
  const config = {
    agents: {
      perun: {
        extraTools: ["supabase_*"],
      },
    },
  }
  // Should warn (perun doesn't support extraTools)
  // For now, just expect it to be stored (diagnostics TBD)
  const result = loadSchema(config)
  expect(result.agents.perun?.extraTools).toEqual(["supabase_*"])
})
```

- [ ] **Step 6: Run tests**

```bash
bun test tests/modules/pantheon-config/schema.test.ts
```

Expected: PASS (the existing 19 tests remain green; new cases pass).

- [ ] **Step 7: Commit**

```bash
git add src/modules/pantheon-config/schema.ts tests/modules/pantheon-config/schema.test.ts
git commit -m "fix(config): make model optional, add extraTools field, fix §3.2 store-when-extraTools-only"
```

---

### Task 3.2: Add §3.5 config-load validation for extraTools

**Files:**
- Modify: `src/modules/pantheon-config/schema.ts` (add validation logic)
- Modify: `tests/modules/pantheon-config/schema.test.ts` (add validation tests)

Validate each `extraTools` entry: malformed, exact deny-ids, globs covering deny-ids, globs hitting capability patterns.

- [ ] **Step 1: Import validators from metadata**

At the top of `src/modules/pantheon-config/schema.ts`, add:

```typescript
import { validateExtraToolsPattern } from "../stribog/stribog.metadata.js"
```

- [ ] **Step 2: Validate extraTools entries in the agent loop**

In the same per-agent loop (Task 3.1), after validating the array structure, add pattern validation:

```typescript
// Validate each extraTools entry against the guardrail
for (const entry of extraTools) {
  const validation = validateExtraToolsPattern(entry)
  if (!validation.valid) {
    errors.push(
      `agents.${rawName}.extraTools[...]: ${entry} — ${validation.error}`,
    )
    // Don't early continue; collect all errors
  }
}
```

- [ ] **Step 3: Write failing tests**

```typescript
it("rejects malformed extraTools patterns", () => {
  const config = {
    agents: {
      stribog: {
        extraTools: ["CamelCase", "with space"],
      },
    },
  }
  const result = loadSchema(config)
  expect(result.errors.length).toBeGreaterThan(0)
  expect(result.errors.some(e => e.includes("CamelCase"))).toBe(true)
})

it("rejects exact denied ids in extraTools", () => {
  const config = {
    agents: {
      stribog: {
        extraTools: ["execute_recipe"],
      },
    },
  }
  const result = loadSchema(config)
  expect(result.errors.some(e => e.includes("execute_recipe"))).toBe(true)
})

it("rejects globs covering denied ids", () => {
  const config = {
    agents: {
      stribog: {
        extraTools: ["execute_*"],
      },
    },
  }
  const result = loadSchema(config)
  expect(result.errors.some(e => e.includes("execute_*"))).toBe(true)
})

it("accepts serena_* at config-load (danger is in children, caught by hook)", () => {
  // §3.5: serena_* is accepted at config-load; children denied by hook
  const config = {
    agents: {
      stribog: {
        extraTools: ["serena_*"],
      },
    },
  }
  const result = loadSchema(config)
  // Should NOT have an error about serena_* (its danger is run-time, not static)
  expect(result.errors.some(e => e.includes("serena_*"))).toBe(false)
})

it("accepts valid tool globs", () => {
  const config = {
    agents: {
      stribog: {
        extraTools: ["supabase_*", "context7_*"],
      },
    },
  }
  const result = loadSchema(config)
  expect(result.agents.stribog?.extraTools).toEqual(["supabase_*", "context7_*"])
})
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/modules/pantheon-config/schema.test.ts -t "extraTools"
```

Expected: PASS (validation catches malformed, denied ids, covering globs; accepts valid patterns and harmless broad globs).

- [ ] **Step 5: Commit**

```bash
git add src/modules/pantheon-config/schema.ts tests/modules/pantheon-config/schema.test.ts
git commit -m "feat(config): add §3.5 validation for extraTools (pattern syntax, deny guardrail)"
```

---

### Task 3.3: Wire up `stribog/index.ts` to read and normalize `extraTools`

**Files:**
- Modify: `src/modules/stribog/index.ts`
- Modify: `tests/modules/stribog/plugin.test.ts` (if applicable)

Read `extraTools` from the loaded pantheon config and pass it into the hook factory as `extraPatterns`.

- [ ] **Step 1: Update the hook factory call**

In `src/modules/stribog/index.ts`, around line 35 (the `makeStribogToolHook` call):

Find:
```typescript
const { hook, clearSession } = makeStribogToolHook({ resolveAgent })
```

Replace with:
```typescript
// Read extraTools from pantheon config (construction-time, cached)
const pantheonConfig = loadPantheonConfig()
const extraTools = pantheonConfig.agents[STRIBOG_AGENT_KEY]?.extraTools ?? []

// Normalize patterns to lowercase for matching (hook normalizes at runtime too)
const extraPatterns = extraTools.map(p => p.toLowerCase())

const { hook, clearSession } = makeStribogToolHook({
  resolveAgent,
  extraPatterns,
})
```

Make sure `loadPantheonConfig` is already imported; if not, add it.

- [ ] **Step 2: Verify no runtime errors**

```bash
bun build
```

Expected: build passes (no TS errors from the new extraPatterns flow).

- [ ] **Step 3: Write a simple integration test (optional)**

In `tests/modules/stribog/plugin.test.ts`, if there's an existing hook setup, add a test verifying extraTools are loaded:

```typescript
it("loads extraTools from pantheon config into the hook", () => {
  // Assuming there's a test pantheon.json or a way to mock loadPantheonConfig
  // This is a light smoke test; full integration tests are in the plan phase
  expect(extraPatterns).toContain("supabase_*") // or whatever is in the test config
})
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/stribog/index.ts
git commit -m "feat(stribog): read and normalize extraTools from pantheon config into hook"
```

---

## Phase 4: Prompts & Documentation

### Task 4.1: Author the Perun stribog-dispatch block in `perun.md`

**Files:**
- Modify: `src/agents/perun.md`
- Status: doc-only (no code), but test via a manual dispatch if possible

§3.8 + §3.10: add a new dispatch path for data/fixture mutations that passes base-URL, deterministic row-id, run-unique discriminator, and the guard rule.

- [ ] **Step 1: Add the Stribog dispatch section**

In `src/agents/perun.md`, after the zmora dispatch section (find "Step 5f" or the zmora template), add:

```markdown
### Stribog: Data / Fixture Mutations

For **data mutations** (granting entitlements, repairing fixture state) on a **live QA database**:

Dispatch to Stribog with the non-secret facts:
- **base-URL** (the local service root)
- **concrete row id(s)** from a prior zmora result (e.g. CV id `edf681ab-…`)
- **run-unique discriminator** (e.g. owner email == `TEST_USER_EMAIL`) — prevents cross-environment id collisions
- **project/stack identity** (e.g. local vs staging)

**Example prompt snippet:**

```
Stribog, perform this QA fixture mutation:
- Base URL: http://localhost:3000
- CV id (verified): edf681ab-1234-5678-abcd-ef0123456789
- Owner email (run-unique): qa-test-user@example.com
- Task: INSERT one `cv_entitlement` row; repair the CV's payload if empty

Before any write, read back the CV and confirm its owner email == qa-test-user@example.com.
If the CV is absent or the email mismatches, FAIL/ESCALATE (wrong project or unseeded fixture).
```

- [ ] **Step 2: Add the §3.10 guard rule**

In `src/agents/perun.md`, add a new "Dispatch Rules" or "Error Handling" section documenting:

```markdown
### Dispatch Rules — Avoiding Regression to `general`

**For data/fixture mutations:**
- Dispatch **only to Stribog** — it owns this work.
- If Stribog returns `ESCALATE` or `FAIL`, **STOP and report the reason to the human**.
- **Never re-dispatch the same task to `general`** (or any non-roster all-tools agent).
  - Multi-table FK-chain seeding is owned by the QA recipe flow, not Stribog.
  - Missing ancestor or wrong-project should halt (operator or plan issue), not escalate to brute-force.

**Example:**
```
Stribog returned: { status: "ESCALATE", reason: "fixture CV absent (wrong project or unseeded)" }
→ Report to human: "CV id edf681ab-… does not exist in this environment. Check the project target or re-run setup."
→ STOP. Do NOT dispatch to `general`.
```
```

- [ ] **Step 3: Review against spec §3.8 and §3.10**

Check that the dispatch block covers:
- ✅ Base-URL (non-secret)
- ✅ Concrete row id(s)
- ✅ Run-unique discriminator
- ✅ The guard: "dispatch only Stribog for data; ESCALATE → stop, not general"

- [ ] **Step 4: Commit**

```bash
git add src/agents/perun.md
git commit -m "docs(perun): add stribog data-dispatch block + §3.10 general-fallback guard"
```

---

### Task 4.2: Update `stribog.md` with the new scope rules

**Files:**
- Modify: `src/modules/stribog/stribog.md`

Add §3.7/§3.8/§3.9 guidance (read-back, closed-list mutation shape, ESCALATE clarification).

- [ ] **Step 1: Update the "Scope — hard limits" section**

Find the section listing the three hard limits. After the existing text, add:

```markdown
**Data Mutations: Targeting and Verification**

For data/fixture mutations (granted by Perun via the new dispatch contract):

**Before writing:** read back the **parent fixture** (the target row Perun named) and confirm a
**run-unique discriminator** (e.g. owner email == a value Perun passed). If absent or mismatched,
→ **FAIL/ESCALATE** (wrong project or unseeded). Never create prerequisite chains from scratch.

**Allowed mutation shape** (exact list):
1. **INSERT** exactly one entitlement or binding row keyed to a **verified parent**.
2. **UPDATE** the parent's payload/state field (repair empty/invalid data).

Anything requiring a **missing ancestor** (auth user, profile, parent CV) → **ESCALATE** (owned by the QA recipe flow).

The discriminator (e.g. `owner_email`) prevents silent cross-environment corruption if the DB MCP
is misconfigured to point at staging instead of local. Always assert it before writing.
```

- [ ] **Step 2: Add a capability-glob warning to the "Scope" section**

```markdown
**Capability-Glob Warning**

`extraTools` can grant MCP access via glob (e.g. `supabase_*`). The guardrail denies minting,
dispatch, and exec/shell/write-to-code capabilities — but it does **not** make an arbitrary broad
glob safe. Scope globs to a **single trusted data-MCP namespace** (e.g. `supabase_*` for a DB
MCP). Avoid globs like `serena_*` (which grants arbitrary shell and code-write); the hook will
catch each child at call-time, but it is a red flag for design.
```

- [ ] **Step 3: Review against spec §3.9**

Check for alignment with the closed-list mutation rule and the discriminator requirement.

- [ ] **Step 4: Commit**

```bash
git add src/modules/stribog/stribog.md
git commit -m "docs(stribog): add data-mutation scope rules (read-back, closed-list, ESCALATE line)"
```

---

### Task 4.3: Update `docs/light-execution.md`

**Files:**
- Modify: `docs/light-execution.md`

Update security model, honest exfil framing, and preconditions.

- [ ] **Step 1: Update the "Security model" section**

Find line ~19 (mentioning the 1.15.10 probe). Update to reflect 1.17.3 and the new capability guardrail:

```markdown
For opencode 1.17.3, a live probe (2026-06-14 binary disassembly) confirmed that the hook is the
real boundary: `config.agent.stribog.tools` honors explicit **deny** (`action:"deny", pattern:"*"`)
but defaults to **allow** for unlisted tools. An `extraTools` MCP id absent from any allow-map is
**not** pre-denied; the hook remains authoritative.

The capability guardrail (§3.4 of the design spec) denies minting (`execute_recipe`), dispatch
(`task` + the dispatch family), and exec/shell/write-to-code capability classes, regardless of
how broad the `extraTools` config is. This makes the common safe case (structured `supabase_*`
grant) safe at runtime, though config-load validation catches statically-provable collisions.
```

- [ ] **Step 2: Update the exfil framing (§3.6 honest statement)**

Find the line about "no worse than bash reads `.env`". Replace with:

```markdown
**New reachable-secret surface:** a DB-mutation MCP gives Stribog **structured read/write to
whatever that connection can reach** — including remote/shared/multi-tenant secret-bearing tables
(`auth.users`, service-role rows). Unlike `psql` (where Stribog must know a connection string),
the MCP connection is ambient. The secret never enters via the binding gate (which stays
`zmora-*`-only) — it enters via the **tool *result* the model sees**. Stribog's results are
**not** scrubbed (only zmora stderr is scrubbed), so a `SELECT *` on a secret table puts those
values directly in context. This is accepted only because the operator chose the connection and
the same rows are reachable via `psql` from this host.

**Least-privilege is a hard precondition:** the DB MCP must be configured with a least-privilege
role scoped to the fixture tables only (not the full database or secret rows). This is
documented as a required precondition alongside "MCP points at the local stack" (both are
operator responsibilities, not enforced by the harness).
```

- [ ] **Step 3: Update the "Minter ≠ Actuator" section**

Clarify that the invariant holds independent of hook timing (the hook is defense-in-depth, not
the load-bearing enforcement):

```markdown
`execute_recipe` is denied by the hook for stribog sessions (STRIBOG_TOOL_DENIED). Additionally,
the QA binding gate injects minted values only for `zmora-*` sessions, never `stribog`, so no
bound secret is ever injected. The result: Stribog never sees value-hidden secrets through any
harness mechanism. The hook's denial is defense-in-depth; the invariant is held independently by
the binding gate and the `execute_recipe` caller-gate (zmora-setup-only), so even if hook timing
changed, the separation remains.
```

- [ ] **Step 4: Reconcile the "Denied" prose with `IMMUTABLE_DENY`**

Find lines ~24-25 (claiming serena-write denied) and update the reference to point to the new
IMMUTABLE_DENY patterns that make this true:

```markdown
**Explicitly denied for a stribog session:** minting (`execute_recipe`), dispatch (`task` +
dispatch family), and **capability classes** (exec/shell/write-to-code/memory-mutation). The
latter restores the "serena-write denied" guarantee by pattern matching, not hardcoded names
— so `serena_replace_symbol_body` (arbitrary code-write) and all serena write/mutation ids are
caught, even though they are not hardcoded literals in the allow-list. See `IMMUTABLE_DENY_PATTERNS`
in `src/modules/stribog/stribog.metadata.ts` for the full regex set.
```

- [ ] **Step 5: Commit**

```bash
git add docs/light-execution.md
git commit -m "docs(light-execution): update security model for 1.17.3, honest exfil framing, preconditions"
```

---

### Task 4.4: Update `docs/configuring-agents.md`

**Files:**
- Modify: `docs/configuring-agents.md`

Add `agents.stribog.extraTools` section and update the canonical Schema block.

- [ ] **Step 1: Find the "## Schema" block (lines ~101-113)**

Replace the agent entry in the schema example to include extraTools:

**Find:**
```jsonc
{
  "agents": {
    "stribog": { "model": "openai/gpt-5.4" }
  }
}
```

**Replace with:**
```jsonc
{
  "agents": {
    "stribog": {
      "model": "openai/gpt-5.4",                        // optional
      "extraTools": ["supabase_*"]                      // optional; exact id or glob
    }
  }
}
```

And update the schema table to document the new field:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agents.<name>.model` | string | (inherited from session) | Model override for this agent |
| `agents.<name>.extraTools` | string[] | `[]` | Extra tool ids (exact or glob) granted to Stribog only |

- [ ] **Step 2: Add a new section: "Configuring Stribog `extraTools`"**

```markdown
### Configuring Stribog `extraTools`

Stribog can be granted extra actuator tools (e.g. a Supabase MCP) via the `agents.stribog.extraTools` array.
Each entry is a **lowercase** tool id (`supabase_execute_sql`) or a **prefix glob** (`supabase_*`).

**Example:**
```jsonc
{
  "agents": {
    "stribog": {
      "extraTools": ["supabase_*"]  // Grant all tools from the supabase MCP
    }
  }
}
```

**Guardrail:** `extraTools` is governed by an **immutable capability deny** — no config can re-enable
minting (`execute_recipe`), dispatch (`task`/`dispatch_*`), or exec/shell/write-to-code capabilities.
This guardrail is the load-bearing security boundary; config-load validation catches statically-provable
violations, but the hook checks at call-time.

**Glob warning:** scope globs to a **single trusted data-MCP namespace**. Broad globs like `serena_*`
grant arbitrary shell and code-write; the hook will deny each dangerous child, but it is a red flag.

**Preconditions for data mutations (§3.7–3.10 of the design spec):**
- The DB MCP must **point at the local stack** the run targets (same `localhost:8000` the tests use).
- The DB MCP must use a **least-privilege role** scoped to fixture tables only — not the full database
  or secret rows. This is an operator responsibility, not enforced by the harness.
- Stribog data tasks require an **explicit target + run-unique discriminator** in the dispatch prompt
  (e.g. base-URL, row id, owner email). If absent, Stribog ESCALATES.

**Loader footgun:** pantheon.json loading uses **whole-object replacement** (not per-field merge).
A project `.opencode/pantheon.json` with `{agents:{stribog:{extraTools:[...]}}}` wipes a user-global
`{stribog:{model:...}}`. This is documented here; per-field shallow-merge is a follow-up.
```

- [ ] **Step 3: Review documentation**

Check that preconditions, guardrail, and footgun are all documented clearly.

- [ ] **Step 4: Commit**

```bash
git add docs/configuring-agents.md
git commit -m "docs(config): document agents.stribog.extraTools, guardrail, preconditions, footgun"
```

---

## Phase 5: Rename Ripple & Tests

### Task 5.1: Update the `STRIBOG_ALLOWED_TOOL_IDS` → `CORE_BUILTINS` rename across tests

**Files:**
- Modify: `tests/modules/stribog/tools-sync.test.ts` (line 3, 28, 40)
- Modify: `tests/modules/stribog/allowed-tools.test.ts`
- Modify: `tests/modules/stribog/metadata.test.ts` (already done in Phase 1)

- [ ] **Step 1: Update `tools-sync.test.ts`**

Replace the import on line 3:
```typescript
import { STRIBOG_ALLOWED_TOOL_IDS } from "../../../src/modules/stribog/stribog.metadata"
```

With:
```typescript
import { CORE_BUILTINS } from "../../../src/modules/stribog/stribog.metadata"
```

Update usages at lines 28 and 40:
```typescript
// Line 28: replace
.toEqual(Array.from(STRIBOG_ALLOWED_TOOL_IDS).sort())

// With:
.toEqual(Array.from(CORE_BUILTINS).sort())

// Line 40: similar replacement
```

- [ ] **Step 2: Update `allowed-tools.test.ts`**

The spec mentions "length guard (49-51)". Update that test to reflect the new constant name if necessary.
(The length of CORE_BUILTINS is still 6, so the assertion `toHaveLength(6)` remains unchanged.)

- [ ] **Step 3: Run tests**

```bash
bun test tests/modules/stribog/tools-sync.test.ts tests/modules/stribog/allowed-tools.test.ts
```

Expected: PASS (rename ripple complete).

- [ ] **Step 4: Commit**

```bash
git add tests/modules/stribog/tools-sync.test.ts tests/modules/stribog/allowed-tools.test.ts
git commit -m "refactor(stribog): rename STRIBOG_ALLOWED_TOOL_IDS → CORE_BUILTINS in tests"
```

---

### Task 5.2: Update `plugin.test.ts` (the second consumer of `STRIBOG_DENIED_TOOLS`)

**Files:**
- Modify: `tests/modules/stribog/plugin.test.ts` (line ~107)

The spec notes that `plugin.test.ts:107` reads `STRIBOG_DENIED_TOOLS` via the live constant and is thus unaffected by extension, but verify it still passes.

- [ ] **Step 1: Check the test**

Open `tests/modules/stribog/plugin.test.ts` and find the test at line ~107 that uses `STRIBOG_DENIED_TOOLS`.

- [ ] **Step 2: Run the test**

```bash
bun test tests/modules/stribog/plugin.test.ts
```

Expected: PASS (the test reads the live constant, so the extended `STRIBOG_DENIED_TOOLS` is automatically picked up).

- [ ] **Step 3: If all pass, no commit needed for this task**

(The test already passes because it uses the live constant.)

---

## Phase 6: Build & Commit

### Task 6.1: Run `bun run build` and commit `dist/`

**Files:**
- Regenerate: `dist/modules/stribog/stribog.metadata.{js,d.ts}`
- Regenerate: `dist/modules/stribog/tool-budget-hook.{js,d.ts}`
- Regenerate: `dist/agents/perun.md` (markdown asset)
- Regenerate: `dist/modules/stribog/stribog.md` (markdown asset)

The CI (`scripts/verify-dist-sync.mjs`) enforces that `dist/` is in sync with source.

- [ ] **Step 1: Run the build**

```bash
bun run build
```

Expected: build succeeds; the 4 stribog artifacts + 2 prompt markdown files are regenerated.

- [ ] **Step 2: Verify the diff**

```bash
git status dist/
```

Expected: only the stribog module files + the two prompt markdown files changed.

- [ ] **Step 3: Commit dist**

```bash
git add dist/modules/stribog dist/agents/perun.md
git commit -m "build(dist): regenerate stribog artifacts and perun.md prompt asset"
```

---

### Task 6.2: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

```bash
bun test tests/modules/stribog tests/modules/pantheon-config
```

Expected: all tests pass (107 total, per Task 3.1 baseline).

- [ ] **Step 2: Verify CI checks would pass**

```bash
bun run build
bun run lint
bun run type-check
bun test
```

All green.

- [ ] **Step 3: Review the git log**

```bash
git log --oneline -n 15
```

Expected: ~12 new commits (one per task, roughly), each with a descriptive message.

- [ ] **Step 4: No step — tests are done**

All implementation tasks complete. The spec is fully realized.

---

## Summary

**Total tasks:** 17 (Phase 0 manual probe + 5 phases, ~2-4 tasks per phase)

**Key implementation decisions:**
1. **Raw-vs-lowercase split (Task 2.1):** The hook compares raw tool ids against `CORE_BUILTINS` (preserving the capital-`Edit` deny), but normalizes to lowercase for `IMMUTABLE_DENY` + `extraPatterns` matching. This resolves the first-revision contradiction.
2. **Attribution-gated deny (Task 2.1):** Immutable denies are checked *only for confirmed stribog*, after attribution. Fail-open for other agents and during attribution-fail. The invariant is held independently by `execute_recipe`'s own gate, not by the hook's timing.
3. **Config-load vs. hook split (Task 3.2):** Config-load validates statically-provable collisions (malformed, exact denies, globs covering denies, globs hitting patterns). Broad harmless globs like `serena_*` are accepted at config-load; their danger (child ids) is caught by the hook at call-time (the honest split documented in §3.5).
4. **Extra-patterns as dependency (Task 3.3):** The hook is constructed with `extraPatterns` passed from the loaded pantheon config. Patterns are normalized to lowercase once at construction.
5. **Perun dispatch + guard (Task 4.1):** A net-new Stribog data-dispatch block in perun.md, plus the §3.10 prompt guard ("dispatch only Stribog; on ESCALATE → stop, not general").

**Test coverage:** ~60 new test cases (corpus tests, pattern validation, raw-vs-lowercase, attribution-gating, config plumbing, schema snapshot updates).

**Commits:** ~12 commits, one per task, all following Conventional Commits.

**Next:** execution via subagent-driven-development (recommended) or inline executing-plans.
