# Stribog Light Executor — Implementation Plan (Phase 1: Agent Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `stribog`, a registered light-executor subagent with a real actuator tool-allowlist (Bash + Edit/Write), a Sisyphus-Junior-shaped prompt, and a test that locks the minter≠actuator secret separation — so Perun can dispatch it to bring up environments and make small mechanical changes.

**Architecture:** A new self-contained plugin module `src/modules/stribog/` cloned from the Triglav skeleton (`src/modules/explore/`): `allowed-tools.ts` (deny-by-default allowlist), `stribog.metadata.ts` (`SpecialistInfo`), `stribog.md` + `prompt.ts` (frontmatter + body), `index.ts` (registers metadata, injects `config.agent.stribog`, defaults the model). Wired into `src/index.ts`. No coordinator or QA-module changes in this phase.

**Tech Stack:** TypeScript, Bun, tsup (build + `copy-root-assets.mjs`), Vitest, the OpenCode plugin API (`@opencode-ai/plugin`), committed `dist/`.

---

## Decomposition (read first)

Per the spec (`docs/superpowers/specs/2026-06-09-stribog-light-executor-design.md`), Stribog splits into two independently-shippable plans:

- **Phase 1 — Agent Core (THIS plan).** The `stribog` module: actuator allowlist, prompt (incl. the result-contract + liveness behaviour the agent itself must emit), registration, model default, and the secret-gate-invariant lock. Produces working, testable software: Stribog exists, is dispatchable as a subagent, has exactly the right tools, and is provably excluded from QA secret injection. **No coordinator/Perun changes.**
- **Phase 2 — Orchestration & Safety Integration (separate follow-up plan,** `docs/superpowers/plans/2026-06-09-stribog-orchestration.md`, to be written). Scope is listed at the end of this document so spec coverage is traceable.

Phase 1 relies on one Phase-2-verified assumption: the coordinator-policy Bash gate is **coordinator-only** and does not fire for a subagent session, so Stribog's own allowlist is the operative boundary. Phase 2 adds the regression test for that; Phase 1 does not change the gate.

## Repo conventions this plan follows (verified against the codebase)

- **Module shape** mirrors `src/modules/explore/` exactly: `allowed-tools.ts`, `<agent>.metadata.ts`, `<agent>.md`, `prompt.ts`, `index.ts`.
- **Prompt building**: `prompt.ts` emits a `---` frontmatter block (`name`/`description`/`mode`/`allowed-tools`) then appends the `.md` body via `loadModuleAsset(import.meta.url, "stribog.md")` (`src/modules/explore/prompt.ts:1,17`).
- **Metadata registration**: `registerAgentMetadata(info)` in the factory body (`src/modules/agent-registry/index.ts:30`); idempotent for identical metadata.
- **Model config**: `loadPantheonConfig().agents.<key>?.model` reads a generic `{ [name]: { model } }` map (`src/modules/pantheon-config/schema.ts:11-13`) — **no schema change needed for `stribog`**. Override is pre-validated by `MODEL_REGEX`.
- **Tests** live under `tests/modules/<module>/` (not co-located). `clearAgentMetadataRegistry()` + `__resetCacheForTests()` in `beforeEach`/`afterEach` keep suites independent.
- **Commits**: a pre-commit hook blocks bare `git commit`. Prefix the commit command with `AV_COMMIT_SKILL=1`. Conventional Commits; **no `Co-Authored-By`** trailer.
- **Committed `dist/`**: `scripts/verify-dist-sync.mjs` enforces that `dist/` matches source. Rebuild `dist/` and commit it (a final `build:` commit, as in commit `54cbcc1`).
- **Single-file test command**: `bunx vitest run --config vitest.config.ts <path>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/modules/stribog/allowed-tools.ts` (create) | `STRIBOG_TOOLS` — the deny-by-default actuator allowlist (the security boundary). |
| `src/modules/stribog/stribog.metadata.ts` (create) | `STRIBOG_AGENT_KEY`, `DEFAULT_STRIBOG_MODEL`, `STRIBOG_DESCRIPTION`, `stribogSpecialistInfo`. |
| `src/modules/stribog/stribog.md` (create) | Prompt body: role, scope rubric, bring-up + liveness, editing limits, JSON result contract, style. |
| `src/modules/stribog/prompt.ts` (create) | `buildStribogPrompt()` — frontmatter (allow-list) + `.md` body. |
| `src/modules/stribog/index.ts` (create) | `AppVerkStribogPlugin` — registers metadata, injects `config.agent.stribog`, defaults the model. |
| `src/index.ts` (modify) | Import `AppVerkStribogPlugin`, add to `defaultPluginFactories`. |
| `scripts/copy-root-assets.mjs` (verify/modify) | Ensure `stribog.md` is copied into `dist/` (mirror `triglav.md`). |
| `tests/modules/stribog/allowed-tools.test.ts` (create) | Allowlist drift + isolation (incl. read-only git, no `rm`, no `execute_recipe`). |
| `tests/modules/stribog/metadata.test.ts` (create) | `SpecialistInfo` shape (cost `CHEAP`, category, avoid-when). |
| `tests/modules/stribog/prompt.test.ts` (create) | Frontmatter allow-list + body contains rubric / result-contract / bring-up markers. |
| `tests/modules/stribog/plugin.test.ts` (create) | Registers metadata; `config.agent.stribog` is a subagent with the allow-list in its prompt. |
| `tests/modules/stribog/stribog-model-injection.test.ts` (create) | Model defaults to Sonnet; override honoured; invalid override falls back to default. |
| `tests/modules/stribog/secret-gate-invariant.test.ts` (create) | The QA `shell.env` hook injects NO binding for a `stribog`-keyed session. |

---

## Task 1: Tool allowlist (`allowed-tools.ts`)

**Files:**
- Create: `src/modules/stribog/allowed-tools.ts`
- Test: `tests/modules/stribog/allowed-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/stribog/allowed-tools.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { STRIBOG_TOOLS } from "../../../src/modules/stribog/allowed-tools.js"

describe("STRIBOG_TOOLS", () => {
  it("grants the structured read + edit/write tools", () => {
    expect(STRIBOG_TOOLS).toEqual(
      expect.arrayContaining(["Read", "Glob", "Grep", "Edit", "Write"]),
    )
  })

  it("grants the actuator Bash verbs (docker / make / package managers / curl)", () => {
    for (const t of [
      "Bash(docker:*)",
      "Bash(docker compose:*)",
      "Bash(make:*)",
      "Bash(npm:*)",
      "Bash(pnpm:*)",
      "Bash(bun:*)",
      "Bash(uv:*)",
      "Bash(curl:*)",
    ]) {
      expect(STRIBOG_TOOLS).toContain(t)
    }
  })

  it("scopes git to read-only verbs only (no mutating git)", () => {
    const gitTools = STRIBOG_TOOLS.filter((t) => t.includes("git"))
    expect(gitTools.length).toBeGreaterThan(0)
    for (const t of gitTools) {
      expect(t).toMatch(/git --no-pager (log|blame|status|diff)/)
    }
    const MUTATING_GIT = /git[^)]*\b(revert|reset|push|checkout|clean|commit|rm)\b/
    expect(STRIBOG_TOOLS.filter((t) => MUTATING_GIT.test(t))).toEqual([])
  })

  it("excludes minting, fan-out, interactive, and rm (separation + scope)", () => {
    for (const t of ["execute_recipe", "interactive_bash", "dispatch_parallel", "Task", "Bash(rm:*)"]) {
      expect(STRIBOG_TOOLS).not.toContain(t)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/allowed-tools.test.ts`
Expected: FAIL — cannot resolve `../../../src/modules/stribog/allowed-tools.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/stribog/allowed-tools.ts`:

```typescript
// Allow-list for the Stribog light-execution agent. This is the REAL security
// boundary: OpenCode's allow-list is deny-by-default, so anything not listed is
// not callable. Notable EXCLUSIONS (load-bearing):
//   - no `execute_recipe` / serena-write  → Stribog cannot value-hide-mint
//     secrets (minter != actuator; that stays with zmora-setup).
//   - no `interactive_bash`               → not ported in v1; long-running
//     services run detached via plain Bash (`docker compose up -d`, `<cmd> &`).
//   - no dispatch/`Task`                  → Stribog is a leaf; it never fans out.
//   - `git` is read-only and `rm` is absent → edit recovery is the Perun
//     scratch-ref snapshot (Phase 2), NOT `git revert`/`reset`.
// Per AGENTS.md, Bash token-matching is defense-in-depth, not a sandbox: it
// cannot inspect flag values, and make/npm/docker run repo-controlled code with
// the operator's env. That trust boundary is accepted and documented in the spec.

const STRUCTURED_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"]

const ACTUATOR_BASH_TOOLS = [
  "Bash(docker:*)",
  "Bash(docker compose:*)",
  "Bash(make:*)",
  "Bash(npm:*)",
  "Bash(pnpm:*)",
  "Bash(bun:*)",
  "Bash(uv:*)",
  "Bash(curl:*)",
]

const READONLY_GIT_TOOLS = [
  "Bash(git --no-pager log:*)",
  "Bash(git --no-pager blame:*)",
  "Bash(git --no-pager status:*)",
  "Bash(git --no-pager diff:*)",
]

export const STRIBOG_TOOLS: string[] = [
  ...STRUCTURED_TOOLS,
  ...ACTUATOR_BASH_TOOLS,
  ...READONLY_GIT_TOOLS,
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/allowed-tools.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/allowed-tools.ts tests/modules/stribog/allowed-tools.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(stribog): add deny-by-default actuator tool allowlist"
```

---

## Task 2: Specialist metadata (`stribog.metadata.ts`)

**Files:**
- Create: `src/modules/stribog/stribog.metadata.ts`
- Test: `tests/modules/stribog/metadata.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/stribog/metadata.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import {
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
  stribogSpecialistInfo,
} from "../../../src/modules/stribog/stribog.metadata.js"

describe("stribogSpecialistInfo", () => {
  it("uses the bare 'stribog' key and subagent mode", () => {
    expect(STRIBOG_AGENT_KEY).toBe("stribog")
    expect(stribogSpecialistInfo.name).toBe("stribog")
    expect(stribogSpecialistInfo.mode).toBe("subagent")
  })

  it("is a CHEAP specialist", () => {
    expect(stribogSpecialistInfo.metadata.category).toBe("specialist")
    expect(stribogSpecialistInfo.metadata.cost).toBe("CHEAP")
  })

  it("routes AWAY from secrets and feature work (avoid-when)", () => {
    const avoid = stribogSpecialistInfo.metadata.avoidWhen?.join(" ").toLowerCase() ?? ""
    expect(avoid).toContain("secret")
    expect(avoid).toMatch(/feature|main executor/)
  })

  it("defaults to a valid <provider>/<model> identifier", () => {
    expect(DEFAULT_STRIBOG_MODEL).toMatch(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/metadata.test.ts`
Expected: FAIL — cannot resolve `stribog.metadata.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/stribog/stribog.metadata.ts`:

```typescript
import type { SpecialistInfo } from "../agent-registry/agent-metadata.js"

/** Canonical agent key — centralised so the literal "stribog" is not duplicated
 *  across registration, config injection, tests, and docs (mirrors TRIGLAV_AGENT_KEY). */
export const STRIBOG_AGENT_KEY = "stribog" as const

/** Default model. Stribog is a doer, so it pins a Sonnet-class default (unlike
 *  Triglav, which inherits the session default). Overridable via
 *  `agents.stribog.model`. NOT a security control — see spec decision #7.
 *  Must satisfy MODEL_REGEX in src/modules/pantheon-config/schema.ts. */
export const DEFAULT_STRIBOG_MODEL = "anthropic/claude-sonnet-4-6"

export const STRIBOG_DESCRIPTION =
  "Light execution specialist: performs ONE small, mechanical task with real side effects — bring up/fix a service, restart, read logs, or a 1–2 file config/value change — then verifies and returns a structured result. NOT for secrets (use zmora-setup) or feature work (main executor)."

export const stribogSpecialistInfo: SpecialistInfo = {
  name: STRIBOG_AGENT_KEY,
  mode: "subagent",
  description: STRIBOG_DESCRIPTION,
  metadata: {
    category: "specialist",
    cost: "CHEAP",
    keyTrigger: "Environment down, or a tiny mechanical change needed → dispatch `stribog`",
    useWhen: [
      "Bring up / fix a downed environment for QA (docker compose / make / start a service)",
      "A small mechanical change (add a config field, change a value)",
      "Light debugging (read logs, restart, diagnose)",
    ],
    avoidWhen: [
      "Producing or refreshing a secret/credential value (use zmora-setup)",
      "Feature development or any multi-file / architectural change (main executor)",
      "Anything requiring a design decision",
    ],
    triggers: [
      {
        domain: "Environment ops",
        trigger: "Bring up, restart, or fix a service/environment so QA can run against it",
      },
      {
        domain: "Small mechanical change",
        trigger: "Apply a narrow, deterministic edit (config field/value) and verify it",
      },
    ],
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/metadata.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/stribog.metadata.ts tests/modules/stribog/metadata.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(stribog): add SpecialistInfo metadata and model default"
```

---

## Task 3: Prompt body + builder (`stribog.md`, `prompt.ts`)

**Files:**
- Create: `src/modules/stribog/stribog.md`
- Create: `src/modules/stribog/prompt.ts`
- Test: `tests/modules/stribog/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/stribog/prompt.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { buildStribogPrompt } from "../../../src/modules/stribog/prompt.js"
import { STRIBOG_TOOLS } from "../../../src/modules/stribog/allowed-tools.js"

describe("buildStribogPrompt", () => {
  const prompt = buildStribogPrompt()

  it("emits frontmatter with the exact allow-list and subagent mode", () => {
    expect(prompt).toContain(`allowed-tools: ${STRIBOG_TOOLS.join(", ")}`)
    expect(prompt).toContain("mode: subagent")
    expect(prompt).toContain("name: stribog")
  })

  it("documents the JSON result contract (status enum + baseUrl)", () => {
    expect(prompt).toContain('"status"')
    expect(prompt).toContain("READY")
    expect(prompt).toContain("FAIL")
    expect(prompt).toContain("ESCALATE")
    expect(prompt).toContain("baseUrl")
  })

  it("instructs detached bring-up + liveness verification", () => {
    expect(prompt).toContain("docker compose up -d")
    expect(prompt.toLowerCase()).toContain("curl")
  })

  it("is cached (stable across calls)", () => {
    expect(buildStribogPrompt()).toBe(prompt)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/prompt.test.ts`
Expected: FAIL — cannot resolve `prompt.js`.

- [ ] **Step 3a: Create the prompt body `src/modules/stribog/stribog.md`**

```markdown
# Stribog — Light Execution Specialist

You are **Stribog**, a light execution specialist for the Perun coordinator. Perun hands you ONE small, mechanical task; you perform it with real side effects, verify it, return a structured result, and stop. You are a leaf — you never delegate or spawn other agents.

## Scope — accept the task only if ALL hold
1. It touches a narrow, known set of files (order of 1–2), not a sprawling change.
2. It is local and mechanical — bring up / restart a service, read logs, add a config field/entry, change a value — with NO new abstractions, modules, or architectural decisions.
3. Verification is deterministic and fast (build/lint passes, or the service answers).

If a task fails any check, or turns out non-trivial mid-way (it spreads across subsystems, or needs a design decision), STOP and return `ESCALATE` — do not press on. Producing or refreshing a SECRET / credential value is NOT your job (that is `zmora-setup`); never mint, read for output, or echo secrets.

## Bringing an environment up
Detect the run command from `package.json` scripts, a `Makefile`, or `docker-compose.yml` (if none is discoverable, return `ESCALATE`). Start services DETACHED so they survive your turn: `docker compose up -d`, or `<run-command> &`. Then VERIFY liveness — do NOT trust that the start command returned 0:

- Poll the service with `curl` in a bounded loop (a few attempts, a short fixed interval, a hard timeout).
- For a `&`-backgrounded process, also confirm its PID is still alive.
- A build failure, a dead PID, or no healthy response within the budget ⇒ `FAIL`.

## Editing
Use `Edit`/`Write` only for small, mechanical changes (e.g. add a Settings field). Keep changes to the 1–2 files the task names; if you find yourself touching more, that is the escalation signal — stop and `ESCALATE`. Never modify source you were not asked to.

## Result — ALWAYS end with exactly one JSON object
End your turn with EXACTLY one fenced ```json block and nothing after it:

```json
{
  "status": "READY",
  "reason": "<one line; required for FAIL and ESCALATE>",
  "baseUrl": "<scheme://host:port; only on READY when you brought a service up>",
  "started": ["<service or process you started and left running>"]
}
```

- `READY` — the task is done / the service is live. Include `baseUrl` and `started` when you brought something up.
- `FAIL` — you tried and it did not work (build failed, won't start, port already taken). Put the reason (with the distinct cause) in `reason`.
- `ESCALATE` — out of your scope (too complex, needs a decision, or would touch source you should not). If you already wrote partial edits, list the touched files in `reason`.

## Style
Dense and operational. No preamble, no acknowledgements, no emojis. Do the thing, verify it, emit the JSON, stop.
```

- [ ] **Step 3b: Create the builder `src/modules/stribog/prompt.ts`**

```typescript
import { loadModuleAsset } from "../_shared/load-asset.js"
import { STRIBOG_TOOLS } from "./allowed-tools.js"
import { stribogSpecialistInfo } from "./stribog.metadata.js"

let cached: string | undefined

export function buildStribogPrompt(): string {
  if (cached === undefined) {
    const frontmatter = [
      "---",
      `name: ${stribogSpecialistInfo.name}`,
      `description: ${stribogSpecialistInfo.description}`,
      `mode: ${stribogSpecialistInfo.mode}`,
      `allowed-tools: ${STRIBOG_TOOLS.join(", ")}`,
      "---",
    ].join("\n")
    const body = loadModuleAsset(import.meta.url, "stribog.md")
    cached = `${frontmatter}\n\n${body}`
  }
  return cached
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/prompt.test.ts`
Expected: PASS (4 tests). (Vitest runs against `src/`, so `loadModuleAsset` resolves `stribog.md` from the module dir — no build needed for this test.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/stribog.md src/modules/stribog/prompt.ts tests/modules/stribog/prompt.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(stribog): add prompt body and frontmatter builder"
```

---

## Task 4: Plugin + root registration (`index.ts`, `src/index.ts`)

**Files:**
- Create: `src/modules/stribog/index.ts`
- Modify: `src/index.ts:8` (import) and `src/index.ts:22-35` (`defaultPluginFactories`)
- Test: `tests/modules/stribog/plugin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/stribog/plugin.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest"
import { AppVerkStribogPlugin } from "../../../src/modules/stribog/index.js"
import { STRIBOG_TOOLS } from "../../../src/modules/stribog/allowed-tools.js"
import { STRIBOG_AGENT_KEY } from "../../../src/modules/stribog/stribog.metadata.js"
import {
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
} from "../../../src/modules/agent-registry/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

function fakeInput() {
  return {} as never
}

describe("AppVerkStribogPlugin", () => {
  beforeEach(() => {
    clearAgentMetadataRegistry()
    __resetCacheForTests()
  })

  it("registers stribog metadata in the factory body", async () => {
    await AppVerkStribogPlugin(fakeInput())
    expect(getAgentMetadataRegistry().map((a) => a.name)).toContain(STRIBOG_AGENT_KEY)
  })

  it("registers stribog as a subagent with its allow-list in the prompt", async () => {
    const hooks = await AppVerkStribogPlugin(fakeInput())
    const config: { agent?: Record<string, { mode?: string; prompt?: string; description?: string }> } = {}
    await hooks.config?.(config as never)
    const agent = config.agent?.[STRIBOG_AGENT_KEY]
    expect(agent?.mode).toBe("subagent")
    expect(agent?.description).toContain("Light execution specialist")
    expect(agent?.prompt).toContain(`allowed-tools: ${STRIBOG_TOOLS.join(", ")}`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/plugin.test.ts`
Expected: FAIL — cannot resolve `src/modules/stribog/index.js`.

- [ ] **Step 3a: Create `src/modules/stribog/index.ts`** (registration only — model is added in Task 5)

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { registerAgentMetadata } from "../agent-registry/index.js"
import { STRIBOG_AGENT_KEY, stribogSpecialistInfo } from "./stribog.metadata.js"
import { buildStribogPrompt } from "./prompt.js"

export const AppVerkStribogPlugin: Plugin = async () => {
  registerAgentMetadata(stribogSpecialistInfo)

  return {
    config: async (config) => {
      config.agent ??= {}
      config.agent[STRIBOG_AGENT_KEY] = {
        description: stribogSpecialistInfo.description,
        mode: "subagent",
        get prompt() {
          return buildStribogPrompt()
        },
      }
    },
  }
}

export default AppVerkStribogPlugin
```

- [ ] **Step 3b: Wire into `src/index.ts`**

Add the import after line 8 (`AppVerkExplorePlugin`):

```typescript
import { AppVerkStribogPlugin } from "./modules/stribog/index.js"
```

Add `AppVerkStribogPlugin` to `defaultPluginFactories` (after `AppVerkExplorePlugin`):

```typescript
  AppVerkExplorePlugin,
  AppVerkStribogPlugin,
  AppVerkPlanPlugin,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/plugin.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/index.ts src/index.ts tests/modules/stribog/plugin.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(stribog): register the stribog subagent plugin"
```

---

## Task 5: Model default + override (`index.ts`)

**Files:**
- Modify: `src/modules/stribog/index.ts`
- Test: `tests/modules/stribog/stribog-model-injection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/modules/stribog/stribog-model-injection.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkStribogPlugin } from "../../../src/modules/stribog/index.js"
import {
  STRIBOG_AGENT_KEY,
  DEFAULT_STRIBOG_MODEL,
} from "../../../src/modules/stribog/stribog.metadata.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"
import { clearAgentMetadataRegistry } from "../../../src/modules/agent-registry/index.js"

describe("AppVerkStribogPlugin model injection", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    clearAgentMetadataRegistry()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-stribog-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
    clearAgentMetadataRegistry()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  async function runConfig(): Promise<Config> {
    const plugin = await AppVerkStribogPlugin({} as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    return config
  }

  it("defaults to the Sonnet-class model when no pantheon.json exists", async () => {
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })

  it("honours a valid agents.stribog.model override", async () => {
    writeUserGlobal(`{ "agents": { "stribog": { "model": "opencode/claude-haiku-4-5" } } }`)
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe("opencode/claude-haiku-4-5")
  })

  it("falls back to the default when the stribog key is absent", async () => {
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })

  it("falls back to the default when the override is invalid (schema strips it)", async () => {
    writeUserGlobal(`{ "agents": { "stribog": { "model": "bad model\\u001b[31m" } } }`)
    const config = await runConfig()
    expect(config.agent![STRIBOG_AGENT_KEY]!.model).toBe(DEFAULT_STRIBOG_MODEL)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/stribog-model-injection.test.ts`
Expected: FAIL — `config.agent.stribog.model` is `undefined` (Task 4 set no model).

- [ ] **Step 3: Add the model injection to `src/modules/stribog/index.ts`**

Add the import:

```typescript
import { loadPantheonConfig } from "../pantheon-config/index.js"
import { STRIBOG_AGENT_KEY, DEFAULT_STRIBOG_MODEL, stribogSpecialistInfo } from "./stribog.metadata.js"
```

(replace the existing `stribog.metadata.js` import line with the one above), then inside the `config` hook, after the `config.agent[STRIBOG_AGENT_KEY] = { … }` assignment, add:

```typescript
      // Stribog pins a Sonnet-class default (it is a doer, not cheap retrieval),
      // overridable via `agents.stribog.model`. The override is pre-validated by
      // MODEL_REGEX (CWE-117) — see src/modules/pantheon-config/schema.ts — so an
      // invalid value is already absent here and falls through to the default.
      const override = loadPantheonConfig().agents[STRIBOG_AGENT_KEY]?.model
      config.agent[STRIBOG_AGENT_KEY].model = override ?? DEFAULT_STRIBOG_MODEL
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/stribog-model-injection.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/index.ts tests/modules/stribog/stribog-model-injection.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(stribog): default to a Sonnet-class model, overridable via config"
```

---

## Task 6: Secret-gate invariant lock (guard test)

This test asserts an EXISTING property — the QA `shell.env` hook (`src/modules/qa/shell-env-hook.ts:32`) only injects bindings for agents whose key starts with `zmora-`, so a `stribog` session never receives a minted secret. It passes immediately; its job is to LOCK the minter≠actuator separation against future prefix-logic drift.

**Files:**
- Test: `tests/modules/stribog/secret-gate-invariant.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/modules/stribog/secret-gate-invariant.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { SessionAgentRegistry, makeShellEnvHook } from "../../../src/modules/qa/shell-env-hook.js"
import { STRIBOG_AGENT_KEY } from "../../../src/modules/stribog/stribog.metadata.js"

describe("Stribog secret-gate invariant (minter != actuator)", () => {
  it("the QA shell.env hook injects NO binding into a stribog session", async () => {
    const store = new BindingsStore()
    store.writeBinding("perun1", "QA_BIND_TOKEN", "eyJ...", "secret", "minted-recipe")

    const registry = new SessionAgentRegistry()
    registry.register("stribog-child", STRIBOG_AGENT_KEY)

    const hook = makeShellEnvHook({
      store,
      registry,
      resolveParentID: async () => "perun1",
    })

    const env: Record<string, string> = {}
    await hook({ sessionID: "stribog-child", cwd: "/" }, { env })
    expect(env.QA_BIND_TOKEN).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it passes (guard test)**

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog/secret-gate-invariant.test.ts`
Expected: PASS — `STRIBOG_AGENT_KEY` ("stribog") does not start with `zmora-`, so the hook returns no bindings. If this ever FAILS, the separation has regressed.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/stribog/secret-gate-invariant.test.ts
AV_COMMIT_SKILL=1 git commit -m "test(stribog): lock the minter != actuator secret-gate invariant"
```

---

## Task 7: Asset copy, dist rebuild, full verification

**Files:**
- Verify/modify: `scripts/copy-root-assets.mjs`
- Rebuild + commit: `dist/`

- [ ] **Step 1: Ensure `stribog.md` is copied into `dist/`**

Open `scripts/copy-root-assets.mjs`. Determine how it copies module `.md` assets:
- If it copies via a **glob** (e.g. all `src/**/*.md`), no change is needed.
- If it copies via an **explicit list** that names `triglav.md` / QA prompt sections, add `src/modules/stribog/stribog.md → dist/modules/stribog/stribog.md` mirroring the `triglav.md` entry.

- [ ] **Step 2: Build and confirm the asset landed**

Run: `bun run build:root`
Then confirm: `ls dist/modules/stribog/stribog.md` and `ls dist/modules/stribog/index.js`
Expected: both files exist.

- [ ] **Step 3: Typecheck, lint, full test suite**

Run: `bun run typecheck`
Expected: PASS (no type errors; the `_AssertHooksReturnVoid` guard in `src/index.ts` still holds — Stribog adds no value-returning hook).

Run: `bun run lint`
Expected: PASS.

Run: `bunx vitest run --config vitest.config.ts tests/modules/stribog`
Expected: PASS (all Stribog suites). Then run the full suite: `bun run test` — Expected: PASS (no regressions; existing explore/qa/agent-registry suites unaffected).

- [ ] **Step 4: Verify committed dist is in sync**

Run: `bun run verify-dist`
Expected: PASS (dist matches source). If it reports drift, the rebuilt `dist/` must be committed in the next step.

- [ ] **Step 5: Commit the rebuilt dist**

```bash
git add dist scripts/copy-root-assets.mjs
AV_COMMIT_SKILL=1 git commit -m "build(stribog): rebuild committed dist with the stribog module"
```

---

## Self-Review (against the spec)

**Spec coverage (Phase 1 scope):**
- Decision #1 (dedicated narrow leaf), #3 (one undivided agent, no variants) → Tasks 1–4 (single module, no variant split). ✅
- Decision #2 (no `execute_recipe` / no binding minting; separation) → Task 1 (excludes `execute_recipe`) + Task 6 (gate invariant locked). ✅
- Decision #4 (tools = Read/Glob/Grep + Bash + Edit/Write; complexity boundary in prompt) → Task 1 + Task 3 (rubric in `stribog.md`). ✅
- Decision #7 (Sonnet default, overridable, not a pin) → Task 5. ✅
- Result contract (status enum + baseUrl), liveness/false-READY guard, detached bring-up, escalation → Task 3 (the agent emits/obeys these; Perun-side parsing is Phase 2). ✅
- `interactive_bash` descoped → Task 1 (excluded) + Task 3 (Bash-backgrounding instructions). ✅
- Naming / key `stribog`, registration via `registerAgentMetadata` + `SPECIALISTS_TABLE` → Tasks 2 & 4. ✅
- Read-only git, no `rm`, recovery deferred to scratch-ref → Task 1 (locked by test). ✅

**Deferred to Phase 2 (NOT covered here, by design — see below):** non-interactive-env hook; the Bash command-allowlist as a *runtime classification hook* (Phase 1 ships only the static `allowed-tools` entries); Perun scratch-ref snapshot; Perun auto-dispatch routing rule + result-contract parsing + `Base URL:` threading; concurrency/orphan enforcement; the "coordinator gate does not fire for Stribog" + "Perun stays docker/make/build-banned" regression tests.

**Placeholder scan:** none — every step has concrete code/commands. The only conditional is Task 7 Step 1 (glob vs explicit list in `copy-root-assets.mjs`), which gives the exact decision and both outcomes.

**Type consistency:** `STRIBOG_AGENT_KEY`, `DEFAULT_STRIBOG_MODEL`, `STRIBOG_DESCRIPTION`, `stribogSpecialistInfo`, `STRIBOG_TOOLS`, `buildStribogPrompt`, `AppVerkStribogPlugin` are used identically across tasks. `SpecialistInfo` matches `src/modules/agent-registry/agent-metadata.ts`. The `config` hook shape matches Triglav's.

---

## Phase 2 — Orchestration & Safety Integration (follow-up plan, not yet written)

To be written to `docs/superpowers/plans/2026-06-09-stribog-orchestration.md`. Scope (each item gets bite-sized TDD tasks there, grounded in `src/modules/coordinator/` + `src/agents/perun.md`):

1. **Non-interactive-env hook** — a `tool.execute.before` hook (merged via `mergeToolExecuteBefore`, `src/index.ts:53`) that, for a Stribog session (resolved via the shared `SessionAgentRegistry`), injects `CI`/`GIT_TERMINAL_PROMPT=0`/`PAGER=cat`/`DEBIAN_FRONTEND`/`npm_config_yes` onto Bash. Test it injects only for `stribog` and stands alone (no other bash before-hook fires for a subagent session).
2. **Perun scratch-ref snapshot** — snapshot a git scratch ref before each Stribog dispatch so tracked-file edits are revertable (the edit-recovery net; reverts edits, not started services).
3. **Perun routing rule + result contract** — on `NEED_INFO kind=service` (or explicit ops delegation) dispatch Stribog; parse Stribog's JSON `status`; on `READY`, re-dispatch the blocked Zmora wave threading `baseUrl` into the existing `Base URL:` prompt line (`src/agents/perun.md:163,169,407`). Concurrency: once-per-run, same-target not parallelised; port collision surfaces as a distinct `FAIL`.
4. **Regression tests** — Perun stays `docker`/`make`/`build`-banned (independent assertion); the coordinator-policy Bash gate does NOT fire for a Stribog session.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-09-stribog-light-executor.md`.** This is Phase 1 (Agent Core); Phase 2 (Orchestration) is scoped above and needs its own plan before its tasks can run.

Two execution options for **Phase 1**:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach (and do you want me to draft the Phase 2 plan first, or after Phase 1 lands)?
