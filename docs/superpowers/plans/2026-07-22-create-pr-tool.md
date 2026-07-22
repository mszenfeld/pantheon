# `create_pr` Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `create_pr` plugin tool — push the session's current branch to `origin` and open a pull request via a provider-agnostic layer (GitHub/`gh` v1) — per the review-converged spec `docs/specs/create-pr-tool.md` (commit `00bd294`).

**Architecture:** Three new files in the commit module (`pr-provider.ts` detection + interface, `github-pr-provider.ts` gh runner + provider, `create-pr.ts` validation + guards + orchestration), registration beside `av_commit` in `index.ts`, and one named carve-out in each executor hook. All process invocation is argv-only `execFile` through injectable runners; validation and guards run before the single mutation (`push -u origin <head>`); PR failure after a successful push is a structured partial result, never a throw.

**Tech Stack:** TypeScript strict ESM/NodeNext, `@opencode-ai/plugin` `tool()`, vitest, `node:child_process.execFile`, real-git integration fixtures.

## Global Constraints

(Copied from spec §3 — every task implicitly includes these.)

- **C-1:** No shell interpretation anywhere: `execFile("git", …)` and `execFile("gh", …)` with argv arrays only.
- **C-2:** `src/modules/_shared/mutating-git.ts`, both executor bash tripwires, and the `classifyBashCommand` decisions MUST NOT change behavior; only the `block-push` error *message* gains redirect text (D6).
- **C-3:** Reuse `GitRunner`/`GitResult`/`defaultGitRunner` from `./controlled-commit.js`; do not duplicate the runner. The `gh` runner mirrors the same `(cwd, args) => Promise<GitResult>` shape (but NOT the lossy error handling — FR-9).
- **C-4:** `tests/modules/stribog/metadata.test.ts` and `tests/modules/stribog/tools-sync.test.ts` MUST keep passing unchanged (hook carve-out, never list edits).
- **C-5:** No credential handling anywhere in the plugin; `gh` owns its own auth.
- **C-6:** Never `--force`, never a refspec: the only push form is `push -u origin <current-branch>` with a validated branch name.
- **C-7:** ESM/NodeNext, TypeScript strict, root-build layout; tests import from `src/` and run via root `bun run test` after `bun run build:root`.
- Repo commit convention: Conventional Commits, **no AI co-authorship footers**; the pre-commit hook requires the `AV_COMMIT_SKILL=1` prefix on `git commit` commands.
- The spec (`docs/specs/create-pr-tool.md`) is normative. Where this plan and the spec disagree, the spec wins — stop and flag it.

---

### Task 1: Provider interface + `detectProvider`

**Files:**
- Create: `src/modules/commit/pr-provider.ts`
- Test: `tests/modules/commit/create-pr.test.ts` (new file; detection describe-block)

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `CreatePullRequestInput { cwd: string; head: string; base: string; title: string; body: string; draft: boolean }`, `PrProvider { name: string; createPullRequest(input: CreatePullRequestInput): Promise<{ url: string }> }`, `detectProvider(originUrl: string): "github" | undefined`. Tasks 2–4 import these exact names from `./pr-provider.js`.

- [ ] **Step 1: Write the failing detection tests** (spec §5.4 vectors + AC-2 as amended: the raw-trailing-newline string called *directly* returns `undefined`)

```ts
// tests/modules/commit/create-pr.test.ts
import { describe, expect, it } from "vitest"
import { detectProvider } from "../../../src/modules/commit/pr-provider.js"

describe("detectProvider (§5.4 normative vectors)", () => {
  it("recognizes github.com in all three URL shapes, case-insensitively", () => {
    expect(detectProvider("git@github.com:AppVerk/av-opencode-plugins.git")).toBe("github")
    expect(detectProvider("https://github.com/AppVerk/av-opencode-plugins")).toBe("github")
    expect(detectProvider("ssh://git@github.com/AppVerk/x.git")).toBe("github")
    expect(detectProvider("https://GITHUB.COM/a/b.git")).toBe("github")
  })

  it("returns undefined for every non-github / non-https / local shape", () => {
    expect(detectProvider("git@gitlab.com:a/b.git")).toBeUndefined()
    expect(detectProvider("https://github.enterprise.corp/a/b")).toBeUndefined()
    expect(detectProvider("file:///tmp/bare-remote.git")).toBeUndefined()
    expect(detectProvider("/tmp/bare-remote.git")).toBeUndefined()
    expect(detectProvider("http://github.com/a/b")).toBeUndefined()
  })

  it("does NOT trim: the raw-trailing-newline vector is a caller-path row (AC-2)", () => {
    expect(detectProvider("git@github.com:AppVerk/av-opencode-plugins.git\n")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- tests/modules/commit/create-pr.test.ts`
Expected: FAIL — cannot resolve `../../../src/modules/commit/pr-provider.js`.

- [ ] **Step 3: Implement `pr-provider.ts`**

```ts
// src/modules/commit/pr-provider.ts
export interface CreatePullRequestInput {
  cwd: string
  head: string
  base: string
  title: string
  body: string
  draft: boolean
}

export interface PrProvider {
  name: string
  createPullRequest(input: CreatePullRequestInput): Promise<{ url: string }>
}

/**
 * Pure origin-URL parsing (spec §5.4) — no I/O, no trimming (the FR-5 caller
 * trims runner stdout before calling this). Exactly three anchored shapes;
 * anything else (GHE hosts, gitlab, http, file://, local paths) → undefined.
 */
const URL_SHAPES: readonly RegExp[] = [
  /^git@([^:/]+):[^/]+\/[^/]+?(?:\.git)?$/i, // scp-like SSH
  /^ssh:\/\/git@([^:/]+)(?::\d+)?\/[^/]+\/[^/]+?(?:\.git)?$/i, // SSH URL
  /^https:\/\/([^:/]+)\/[^/]+\/[^/]+?(?:\.git)?$/i, // HTTPS
]

export function detectProvider(originUrl: string): "github" | undefined {
  for (const shape of URL_SHAPES) {
    const host = shape.exec(originUrl)?.[1]
    if (host?.toLowerCase() === "github.com") return "github"
  }
  return undefined
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- tests/modules/commit/create-pr.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/pr-provider.ts tests/modules/commit/create-pr.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): add PrProvider interface and origin-URL provider detection"
```

---

### Task 2: GitHub provider + `defaultGhRunner` (ENOENT-preserving)

**Files:**
- Create: `src/modules/commit/github-pr-provider.ts`
- Test: `tests/modules/commit/create-pr.test.ts` (append describe-block)

**Interfaces:**
- Consumes: `GitResult`, `GitRunner` from `./controlled-commit.js`; `PrProvider`, `CreatePullRequestInput` from `./pr-provider.js` (Task 1).
- Produces: `type GhRunner = GitRunner`, `defaultGhRunner: GhRunner`, `GH_MISSING_MESSAGE: string`, `githubPrProvider(runGh?: GhRunner): PrProvider`. Task 4 imports `githubPrProvider`, `defaultGhRunner`, `GhRunner`; tests import `GH_MISSING_MESSAGE`.

- [ ] **Step 1: Write the failing provider tests** (AC-8 message, AC-9 argv contract, AC-10 draft flag, FR-7 URL extraction)

Append to `tests/modules/commit/create-pr.test.ts`:

```ts
import {
  GH_MISSING_MESSAGE,
  githubPrProvider,
} from "../../../src/modules/commit/github-pr-provider.js"
import type { GitResult, GitRunner } from "../../../src/modules/commit/controlled-commit.js"

interface FakeCall {
  cwd: string
  args: string[]
}

function fakeGhRunner(result: GitResult): { runGh: GitRunner; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const runGh: GitRunner = async (cwd, args) => {
    calls.push({ cwd, args: [...args] })
    return result
  }
  return { runGh, calls }
}

const PR_INPUT = {
  cwd: "/tmp/fake",
  head: "feature/INC-212-x",
  base: "master",
  title: "feat: x",
  body: "line one\n\nRefs: INC-212",
  draft: false,
}

describe("githubPrProvider (gh argv contract, AC-9/AC-10)", () => {
  it("invokes gh once with --flag=value tokens and extracts the last matching URL line", async () => {
    const { runGh, calls } = fakeGhRunner({
      stdout: "Creating pull request…\nhttps://github.com/AppVerk/x/pull/7\n",
      stderr: "",
      exitCode: 0,
    })
    const { url } = await githubPrProvider(runGh).createPullRequest(PR_INPUT)
    expect(url).toBe("https://github.com/AppVerk/x/pull/7")
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual([
      "pr",
      "create",
      "--title=feat: x",
      "--body=line one\n\nRefs: INC-212",
      "--base=master",
      "--head=feature/INC-212-x",
    ])
  })

  it("appends --draft iff draft is true", async () => {
    const { runGh, calls } = fakeGhRunner({
      stdout: "https://github.com/AppVerk/x/pull/8\n",
      stderr: "",
      exitCode: 0,
    })
    await githubPrProvider(runGh).createPullRequest({ ...PR_INPUT, draft: true })
    expect(calls[0]?.args.at(-1)).toBe("--draft")
  })

  it("keeps the last URL when several lines match (scan all lines, keep last match)", async () => {
    const { runGh } = fakeGhRunner({
      stdout: "https://github.com/first\nsome text\nhttps://github.com/AppVerk/x/pull/9\ntrailing note\n",
      stderr: "",
      exitCode: 0,
    })
    const { url } = await githubPrProvider(runGh).createPullRequest(PR_INPUT)
    expect(url).toBe("https://github.com/AppVerk/x/pull/9")
  })

  it("treats a no-URL stdout as a provider failure (FR-7 → FR-8 path)", async () => {
    const { runGh } = fakeGhRunner({ stdout: "done\n", stderr: "", exitCode: 0 })
    await expect(githubPrProvider(runGh).createPullRequest(PR_INPUT)).rejects.toThrow(
      /returned no PR URL/,
    )
  })

  it("propagates gh's stderr on non-zero exit", async () => {
    const { runGh } = fakeGhRunner({
      stdout: "",
      stderr: "a pull request for branch already exists: https://github.com/AppVerk/x/pull/7\n",
      exitCode: 1,
    })
    await expect(githubPrProvider(runGh).createPullRequest(PR_INPUT)).rejects.toThrow(
      /already exists/,
    )
  })

  it("maps a thrown spawn ENOENT to the FR-9 install message (AC-8)", async () => {
    const enoent = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })
    const runGh: GitRunner = async () => {
      throw enoent
    }
    await expect(githubPrProvider(runGh).createPullRequest(PR_INPUT)).rejects.toThrow(
      GH_MISSING_MESSAGE,
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- tests/modules/commit/create-pr.test.ts`
Expected: FAIL — cannot resolve `github-pr-provider.js`.

- [ ] **Step 3: Implement `github-pr-provider.ts`**

FR-9 (normative): `defaultGhRunner` MUST NOT copy `defaultGitRunner`'s `Number(failure.code ?? 1)` conversion — that turns a spawn ENOENT (`error.code === "ENOENT"`, a string) into `exitCode: NaN` with empty stderr and destroys the signal. It re-throws ENOENT; the provider's catch maps it.

```ts
// src/modules/commit/github-pr-provider.ts
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { GitResult, GitRunner } from "./controlled-commit.js"
import type { PrProvider } from "./pr-provider.js"

const execFileAsync = promisify(execFile)

/** Same (cwd, args) => Promise<GitResult> shape as GitRunner, spawning `gh` (C-3). */
export type GhRunner = GitRunner

export const GH_MISSING_MESSAGE =
  "GitHub CLI (gh) is not installed — install it (`brew install gh` or your platform's " +
  "equivalent), then authenticate with `gh auth login`."

export const defaultGhRunner: GhRunner = async (cwd, args) => {
  try {
    const result = await execFileAsync("gh", args, { cwd })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    const failure = error as Error & {
      stdout?: string
      stderr?: string
      code?: number | string
    }
    // FR-9: a spawn-time ENOENT means the gh binary is missing — surface it distinctly
    // instead of flattening it into a lossy exitCode (Number("ENOENT") === NaN).
    if (failure.code === "ENOENT") throw failure
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    }
  }
}

const PR_URL_LINE = /^https:\/\/\S+$/

export function githubPrProvider(runGh: GhRunner = defaultGhRunner): PrProvider {
  return {
    name: "github",
    async createPullRequest(input) {
      const args = [
        "pr",
        "create",
        `--title=${input.title}`,
        `--body=${input.body}`,
        `--base=${input.base}`,
        `--head=${input.head}`,
      ]
      if (input.draft) args.push("--draft")

      let result: GitResult
      try {
        result = await runGh(input.cwd, args)
      } catch (error) {
        const failure = error as Error & { code?: unknown }
        if (failure.code === "ENOENT") throw new Error(GH_MISSING_MESSAGE)
        throw failure
      }

      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr.trim() || result.stdout.trim() || "gh pr create failed.",
        )
      }

      // FR-7: the last stdout line matching the URL pattern — scan every line, keep the last match.
      const url = result.stdout
        .split("\n")
        .filter((line) => PR_URL_LINE.test(line))
        .at(-1)
      if (url === undefined) {
        throw new Error(
          `gh pr create returned no PR URL.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
        )
      }
      return { url }
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- tests/modules/commit/create-pr.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/github-pr-provider.ts tests/modules/commit/create-pr.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): add gh-backed GitHub PR provider with ENOENT-preserving runner"
```

---

### Task 3: `createPr` parameter validation (zero spawns on invalid input)

**Files:**
- Create: `src/modules/commit/create-pr.ts`
- Test: `tests/modules/commit/create-pr.test.ts` (append describe-block)

**Interfaces:**
- Consumes: `GitRunner`, `defaultGitRunner` from `./controlled-commit.js`; `PrProvider`, `detectProvider` from `./pr-provider.js`; `GhRunner`, `defaultGhRunner`, `githubPrProvider` from `./github-pr-provider.js`.
- Produces: `CreatePrInput { title: string; body?: string; base?: string; draft?: boolean; taskId?: string; cwd: string; runGit?: GitRunner; runGh?: GhRunner; provider?: PrProvider }`, `CreatePrResult { head: string; base: string; pushed: boolean; prCreated: boolean; draft: boolean; url?: string; prError?: string }`, `createPr(input: CreatePrInput): Promise<CreatePrResult>`. Tasks 4–7 rely on these exact names.

In this task `createPr` implements the full §5.2 validation phase and then throws `create_pr: guards not implemented` — every test in this task uses an invalid vector, so execution never reaches that line. Task 4 replaces it with the guard/push/provider flow.

- [ ] **Step 1: Write the failing validation-matrix tests** (AC-1: every §5.2 rule has a rejecting vector; the normative error template; recording runner sees **zero** calls)

Append to `tests/modules/commit/create-pr.test.ts`:

```ts
import { createPr } from "../../../src/modules/commit/create-pr.js"

function recordingGitRunner(
  responses: Partial<Record<string, GitResult>> = {},
): { runGit: GitRunner; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const runGit: GitRunner = async (cwd, args) => {
    calls.push({ cwd, args: [...args] })
    return responses[args[0] ?? ""] ?? { stdout: "", stderr: "", exitCode: 0 }
  }
  return { runGit, calls }
}

describe("createPr parameter validation (AC-1: zero spawns, normative template)", () => {
  async function rejectsWith(
    args: Partial<Parameters<typeof createPr>[0]>,
    pattern: RegExp,
  ) {
    const { runGit, calls } = recordingGitRunner()
    await expect(
      createPr({ cwd: "/tmp/fake", title: "ok", runGit, ...args }),
    ).rejects.toThrow(pattern)
    expect(calls).toHaveLength(0)
  }

  it("rejects every rule with the exact template (field, ruleId, slug, JSON value)", async () => {
    await rejectsWith({ title: "   " }, /^create_pr: field 'title' violates rule T1 \(empty-title\): ""$/)
    await rejectsWith({ title: "a".repeat(257) }, /rule T2 \(max-length-256-chars\)/)
    await rejectsWith({ title: "two\nlines" }, /rule T3 \(control-characters\)/)
    await rejectsWith({ taskId: "INC 212" }, /field 'taskId' violates rule K1 \(invalid-characters\): "INC 212"/)
    await rejectsWith({ taskId: "-x" }, /field 'taskId' violates rule K2 \(leading-dash\): "-x"/)
    await rejectsWith({ body: "x".repeat(64_001) }, /field 'body' violates rule B1 \(max-length-64000-bytes\)/)
    await rejectsWith({ body: "nul byte" }, /field 'body' violates rule B2 \(control-characters\)/)
    await rejectsWith({ body: "escbyte" }, /rule B2 \(control-characters\)/)
    await rejectsWith({ base: "a b" }, /field 'base' violates rule R1 \(invalid-characters\): "a b"/)
    await rejectsWith({ base: "-d" }, /field 'base' violates rule R2 \(leading-dash\): "-d"/)
    await rejectsWith({ base: "a..b" }, /field 'base' violates rule R3 \(dot-dot\): "a\.\.b"/)
    await rejectsWith({ base: "a//b" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "/a" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "a/" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "a/.h" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "x.lock" }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "x." }, /rule R4 \(component-rules\)/)
    await rejectsWith({ base: "a".repeat(241) }, /rule R5 \(max-length-240-bytes\)/)
  })

  it("evaluation order is title → taskId → body → base; first failing rule reported", async () => {
    // multi-violation input: bad title AND bad base — title wins
    await rejectsWith({ title: "", base: "a b" }, /field 'title' violates rule T1/)
    // bad taskId AND bad body — taskId wins (B1 validates the resolved body, taskId first)
    await rejectsWith({ taskId: "bad id", body: "x".repeat(64_001) }, /field 'taskId' violates rule K1/)
  })

  it("accepts the boundary vectors without a validation throw", async () => {
    // These stop at the not-yet-implemented guard phase, NOT at validation:
    const { runGit } = recordingGitRunner()
    await expect(
      createPr({ cwd: "/t", title: "a".repeat(256), runGit }),
    ).rejects.toThrow(/guards not implemented/)
    await expect(
      createPr({ cwd: "/t", title: "ok", body: "x".repeat(64_000), runGit }),
    ).rejects.toThrow(/guards not implemented/)
    await expect(
      createPr({ cwd: "/t", title: "ok", base: "a".repeat(240), runGit }),
    ).rejects.toThrow(/guards not implemented/)
    await expect(
      createPr({ cwd: "/t", title: "ok", base: "release/2026.07", runGit }),
    ).rejects.toThrow(/guards not implemented/)
  })

  it("resolves the Refs footer per §5.2 Normalization", async () => {
    // Whitespace-only body + taskId → "Refs: <id>" (no leading blank lines): B1/B2 must
    // validate that resolved value, so an oversized taskId-only body still trips B1.
    await rejectsWith(
      { body: "   ", taskId: "A".repeat(64_001) },
      /field 'taskId' violates rule K1|field 'body' violates rule B1/,
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- tests/modules/commit/create-pr.test.ts`
Expected: FAIL — cannot resolve `create-pr.js`.

- [ ] **Step 3: Implement the validation phase of `create-pr.ts`**

```ts
// src/modules/commit/create-pr.ts
import { defaultGitRunner, type GitRunner } from "./controlled-commit.js"
import {
  defaultGhRunner,
  githubPrProvider,
  type GhRunner,
} from "./github-pr-provider.js"
import { detectProvider, type PrProvider } from "./pr-provider.js"

export interface CreatePrInput {
  title: string
  body?: string
  base?: string
  draft?: boolean
  taskId?: string
  cwd: string
  runGit?: GitRunner
  runGh?: GhRunner
  provider?: PrProvider
}

export interface CreatePrResult {
  head: string
  base: string
  pushed: boolean
  prCreated: boolean
  draft: boolean
  url?: string
  prError?: string
}

/** Normative §5.2 error template. */
function ruleError(field: string, ruleId: string, slug: string, value: string): Error {
  return new Error(
    `create_pr: field '${field}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}`,
  )
}

const TITLE_CONTROL = /[ --]/
// Body allows \t (U+0009), \n (U+000A), \r (U+000D); bans all other C0/C1 controls.
const BODY_CONTROL = /[ ---]/

function validateTitle(rawTitle: string): string {
  const title = rawTitle.trim()
  if (title.length === 0) throw ruleError("title", "T1", "empty-title", title)
  if ([...title].length > 256)
    throw ruleError("title", "T2", "max-length-256-chars", title)
  if (TITLE_CONTROL.test(title))
    throw ruleError("title", "T3", "control-characters", title)
  return title
}

function validateTaskId(rawTaskId: string | undefined): string | undefined {
  if (rawTaskId === undefined) return undefined
  const taskId = rawTaskId.trim()
  if (taskId.length === 0) return undefined
  if (!/^[A-Za-z0-9._-]+$/.test(taskId))
    throw ruleError("taskId", "K1", "invalid-characters", taskId)
  if (taskId.startsWith("-")) throw ruleError("taskId", "K2", "leading-dash", taskId)
  return taskId
}

/** §5.2 Normalization: body verbatim except the Refs footer append. */
function resolveBody(body: string | undefined, taskId: string | undefined): string {
  if (taskId === undefined) return body ?? ""
  if (body === undefined || body.trim() === "") return `Refs: ${taskId}`
  return `${body.trimEnd()}\n\nRefs: ${taskId}`
}

function validateBody(resolvedBody: string): string {
  if (Buffer.byteLength(resolvedBody, "utf8") > 64_000)
    throw ruleError("body", "B1", "max-length-64000-bytes", resolvedBody)
  if (BODY_CONTROL.test(resolvedBody))
    throw ruleError("body", "B2", "control-characters", resolvedBody)
  return resolvedBody
}

/** R1–R5, first failing rule reported; shared by provided-base and resolved-head checks. */
function validateRef(field: "base" | "head", rawValue: string): string {
  const value = rawValue.trim()
  if (value.length === 0 || !/^[A-Za-z0-9._/-]+$/.test(value))
    throw ruleError(field, "R1", "invalid-characters", value)
  if (value.startsWith("-")) throw ruleError(field, "R2", "leading-dash", value)
  if (value.includes("..")) throw ruleError(field, "R3", "dot-dot", value)
  const componentViolation =
    value.includes("//") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  if (componentViolation) throw ruleError(field, "R4", "component-rules", value)
  if (Buffer.byteLength(value, "utf8") > 240)
    throw ruleError(field, "R5", "max-length-240-bytes", value)
  return value
}

export async function createPr(input: CreatePrInput): Promise<CreatePrResult> {
  // §5.2 — evaluation order (normative): title → taskId → body (resolved) → base.
  // Pure TypeScript; zero process spawns on any violation (FR-4/NFR-2).
  const title = validateTitle(input.title)
  const taskId = validateTaskId(input.taskId)
  const body = validateBody(resolveBody(input.body, taskId))
  // FR-3: base counts as omitted iff undefined or empty after trim (whitespace-only).
  const baseProvided = input.base !== undefined && input.base.trim() !== ""
  const providedBase = baseProvided ? validateRef("base", input.base as string) : undefined
  void title
  void body
  void providedBase
  throw new Error("create_pr: guards not implemented")
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun run test -- tests/modules/commit/create-pr.test.ts`
Expected: PASS (all Task 1–3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/create-pr.ts tests/modules/commit/create-pr.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): add create_pr parameter validation with normative rule template"
```

---

### Task 4: `createPr` guards, push, and PR orchestration

**Files:**
- Modify: `src/modules/commit/create-pr.ts` (replace the `guards not implemented` tail of `createPr`)
- Test: `tests/modules/commit/create-pr.test.ts` (append describe-block)

**Interfaces:**
- Consumes: everything produced by Tasks 1–3 (exact signatures above).
- Produces: the final `createPr` behavior contract (G1–G5 guard messages, FR-6 push, FR-7/FR-8 result shapes) that Tasks 5 and 7 build on.

- [ ] **Step 1: Write the failing orchestration tests** (AC-3–AC-7 + FR-9 end-to-end)

Append to `tests/modules/commit/create-pr.test.ts`:

```ts
const HAPPY_GIT: Partial<Record<string, GitResult>> = {
  branch: { stdout: "feature/INC-212-x\n", stderr: "", exitCode: 0 },
  "symbolic-ref": { stdout: "origin/master\n", stderr: "", exitCode: 0 },
  remote: {
    stdout: "git@github.com:AppVerk/av-opencode-plugins.git\n", // trailing newline: FR-5 trims
    stderr: "",
    exitCode: 0,
  },
  push: { stdout: "", stderr: "", exitCode: 0 },
}

function happyGhRunner(): { runGh: GitRunner; calls: FakeCall[] } {
  return fakeGhRunner({
    stdout: "https://github.com/AppVerk/x/pull/7\n",
    stderr: "",
    exitCode: 0,
  })
}

describe("createPr orchestration (AC-3…AC-7)", () => {
  it("AC-3: happy path — detection exercised, exact git sequence, exact result", async () => {
    const { runGit, calls } = recordingGitRunner(HAPPY_GIT)
    const { runGh } = happyGhRunner()
    const result = await createPr({ cwd: "/repo", title: "feat: x", runGit, runGh })
    expect(calls.map((c) => c.args)).toEqual([
      ["branch", "--show-current"],
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      ["remote", "get-url", "origin"],
      ["push", "-u", "origin", "feature/INC-212-x"],
    ])
    expect(result).toEqual({
      head: "feature/INC-212-x",
      base: "master",
      pushed: true,
      prCreated: true,
      draft: false,
      url: "https://github.com/AppVerk/x/pull/7",
    })
  })

  it("AC-4: explicit base skips symbolic-ref; whitespace-only base is treated as omitted", async () => {
    const explicit = recordingGitRunner(HAPPY_GIT)
    await createPr({
      cwd: "/repo",
      title: "t",
      base: "develop",
      runGit: explicit.runGit,
      runGh: happyGhRunner().runGh,
    })
    expect(explicit.calls.map((c) => c.args[0])).toEqual(["branch", "remote", "push"])

    const whitespace = recordingGitRunner(HAPPY_GIT)
    const result = await createPr({
      cwd: "/repo",
      title: "t",
      base: "   ",
      runGit: whitespace.runGit,
      runGh: happyGhRunner().runGh,
    })
    expect(whitespace.calls.map((c) => c.args[0])).toContain("symbolic-ref")
    expect(result.base).toBe("master")
  })

  it("AC-5: every guard throws its message and no push is ever recorded", async () => {
    const cases: Array<{
      responses: Partial<Record<string, GitResult>>
      pattern: RegExp
      base?: string
    }> = [
      {
        responses: { ...HAPPY_GIT, branch: { stdout: "\n", stderr: "", exitCode: 0 } },
        pattern: /HEAD is detached — check out a branch first \(use create_branch\)/,
      },
      {
        responses: HAPPY_GIT,
        base: "feature/INC-212-x", // equals head
        pattern: /refusing to push and open a PR from the base branch 'feature\/INC-212-x'/,
      },
      {
        responses: { ...HAPPY_GIT, remote: { stdout: "", stderr: "no origin", exitCode: 2 } },
        pattern: /no 'origin' remote is configured/,
      },
      {
        responses: {
          ...HAPPY_GIT,
          remote: { stdout: "git@gitlab.com:a/b.git\n", stderr: "", exitCode: 0 },
        },
        pattern: /unsupported git host for PR creation \(supported: github\.com\)/,
      },
      {
        responses: {
          ...HAPPY_GIT,
          "symbolic-ref": { stdout: "", stderr: "fatal", exitCode: 1 },
        },
        pattern: /cannot resolve the default branch of 'origin' — pass 'base' explicitly or run: git remote set-head origin --auto/,
      },
    ]
    for (const testCase of cases) {
      const { runGit, calls } = recordingGitRunner(testCase.responses)
      await expect(
        createPr({ cwd: "/repo", title: "t", base: testCase.base, runGit }),
      ).rejects.toThrow(testCase.pattern)
      expect(calls.map((c) => c.args[0])).not.toContain("push")
    }
  })

  it("AC-6: push failure propagates git stderr and the provider is never invoked", async () => {
    const { runGit } = recordingGitRunner({
      ...HAPPY_GIT,
      push: { stdout: "", stderr: "remote: permission denied\n", exitCode: 128 },
    })
    const gh = happyGhRunner()
    await expect(
      createPr({ cwd: "/repo", title: "t", runGit, runGh: gh.runGh }),
    ).rejects.toThrow(/permission denied/)
    expect(gh.calls).toHaveLength(0)
  })

  it("AC-7: provider failure after a successful push resolves to a partial result", async () => {
    const { runGit, calls } = recordingGitRunner(HAPPY_GIT)
    const failingProvider: PrProvider = {
      name: "fake",
      async createPullRequest() {
        throw new Error("a pull request already exists: https://github.com/AppVerk/x/pull/7")
      },
    }
    const result = await createPr({
      cwd: "/repo",
      title: "t",
      runGit,
      provider: failingProvider,
    })
    expect(result).toEqual({
      head: "feature/INC-212-x",
      base: "master",
      pushed: true,
      prCreated: false,
      draft: false,
      prError: "a pull request already exists: https://github.com/AppVerk/x/pull/7",
    })
    expect(calls.filter((c) => c.args[0] === "push")).toHaveLength(1)
    // FR-5 injection rule: detection (remote get-url) is skipped entirely
    expect(calls.map((c) => c.args[0])).not.toContain("remote")
  })

  it("FR-9 end-to-end: missing gh binary yields the install-message partial result", async () => {
    const { runGit } = recordingGitRunner(HAPPY_GIT)
    const enoentRunGh: GitRunner = async () => {
      throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })
    }
    const result = await createPr({ cwd: "/repo", title: "t", runGit, runGh: enoentRunGh })
    expect(result.pushed).toBe(true)
    expect(result.prCreated).toBe(false)
    expect(result.prError).toBe(GH_MISSING_MESSAGE)
  })

  it("AC-10: draft echoes through the result and the gh argv", async () => {
    const { runGit } = recordingGitRunner(HAPPY_GIT)
    const gh = happyGhRunner()
    const result = await createPr({
      cwd: "/repo",
      title: "t",
      draft: true,
      runGit,
      runGh: gh.runGh,
    })
    expect(result.draft).toBe(true)
    expect(gh.calls[0]?.args.at(-1)).toBe("--draft")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- tests/modules/commit/create-pr.test.ts`
Expected: FAIL — every new test hits `create_pr: guards not implemented`.

- [ ] **Step 3: Replace the `createPr` tail with the guard/push/provider flow**

Replace from `void title` through the final `throw` with:

```ts
  const runGit = input.runGit ?? defaultGitRunner
  const draft = input.draft ?? false

  // G1 — head resolution (FR-2): defaultGitRunner returns stdout untrimmed by contract.
  const headResult = await runGit(input.cwd, ["branch", "--show-current"])
  if (headResult.exitCode !== 0) {
    throw new Error(
      headResult.stderr.trim() ||
        headResult.stdout.trim() ||
        "git branch --show-current failed.",
    )
  }
  const head = headResult.stdout.trim()
  if (head === "") {
    throw new Error(
      "create_pr: HEAD is detached — check out a branch first (use create_branch).",
    )
  }

  // G5 — base auto-resolution (FR-3) when omitted / empty after trim.
  let base: string
  if (providedBase !== undefined) {
    base = providedBase
  } else {
    const baseResult = await runGit(input.cwd, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ])
    if (baseResult.exitCode !== 0) {
      throw new Error(
        "create_pr: cannot resolve the default branch of 'origin' — pass 'base' " +
          "explicitly or run: git remote set-head origin --auto",
      )
    }
    base = baseResult.stdout.trim().replace(/^origin\//, "")
  }

  // G2 — head defense-in-depth re-validation (§5.2, field 'head'), then never publish from base.
  validateRef("head", head)
  if (head === base) {
    throw new Error(
      `create_pr: refusing to push and open a PR from the base branch '${base}' — ` +
        "create a feature branch first (use create_branch).",
    )
  }

  // G3/G4 — provider detection (FR-5); skipped entirely when a provider is injected (test seam).
  let provider = input.provider
  if (provider === undefined) {
    const originResult = await runGit(input.cwd, ["remote", "get-url", "origin"])
    if (originResult.exitCode !== 0) {
      throw new Error("create_pr: no 'origin' remote is configured.")
    }
    const originUrl = originResult.stdout.trim()
    if (detectProvider(originUrl) !== "github") {
      throw new Error(
        "create_pr: unsupported git host for PR creation (supported: github.com). " +
          `origin: ${JSON.stringify(originUrl)}`,
      )
    }
    provider = githubPrProvider(input.runGh ?? defaultGhRunner)
  }

  // FR-6 — the first and only mutation. Never --force, never a refspec (C-6).
  const pushResult = await runGit(input.cwd, ["push", "-u", "origin", head])
  if (pushResult.exitCode !== 0) {
    throw new Error(
      pushResult.stderr.trim() || pushResult.stdout.trim() || "git push failed.",
    )
  }

  // FR-7/FR-8 — PR creation; failure after the durable push is a partial result, never a throw.
  try {
    const { url } = await provider.createPullRequest({
      cwd: input.cwd,
      head,
      base,
      title,
      body,
      draft,
    })
    return { head, base, pushed: true, prCreated: true, draft, url }
  } catch (error) {
    const prError = error instanceof Error ? error.message : String(error)
    return { head, base, pushed: true, prCreated: false, draft, prError }
  }
```

Also delete the now-unused `void title` / `void body` / `void providedBase` lines. Update the Task 3 boundary-vector test: replace its four `rejects.toThrow(/guards not implemented/)` assertions — those inputs now proceed to G1 with an empty recording runner (head `""` → G1). Change each to `rejects.toThrow(/HEAD is detached/)`.

- [ ] **Step 4: Run the full commit-module suite**

Run: `bun run test -- tests/modules/commit/`
Expected: PASS (create-pr tests + all pre-existing commit-module suites unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/create-pr.ts tests/modules/commit/create-pr.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): implement create_pr guards, push, and PR orchestration"
```

---

### Task 5: Plugin registration + `block-push` redirect (D6)

**Files:**
- Modify: `src/modules/commit/index.ts` (register `create_pr`; extend the block-push message)
- Modify: `tests/modules/commit/plugin.test.ts` (block-push message assertion)
- Test: Create `tests/modules/commit/create-pr-wrapper.test.ts`

**Interfaces:**
- Consumes: `createPr`, `CreatePrInput`, `CreatePrResult` from `./create-pr.js` (Task 3/4 signatures).
- Produces: the registered tool id `create_pr` with agent-visible args exactly `title`, `body`, `base`, `draft`, `taskId` (AC-16) — the id Tasks 6 and 8 reference.

- [ ] **Step 1: Write the failing wrapper tests (AC-16)**

```ts
// tests/modules/commit/create-pr-wrapper.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CreatePrInput } from "../../../src/modules/commit/create-pr.js"

const createPrMock = vi.fn(async (input: CreatePrInput) => ({
  head: "feature/x",
  base: "master",
  pushed: true,
  prCreated: true,
  draft: input.draft ?? false,
  url: "https://github.com/AppVerk/x/pull/1",
}))

vi.mock("../../../src/modules/commit/create-pr.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/modules/commit/create-pr.js")>()),
  createPr: (input: CreatePrInput) => createPrMock(input),
}))

const { AppVerkCommitPlugin } = await import("../../../src/modules/commit/index.js")

describe("create_pr wrapper registration (AC-16)", () => {
  beforeEach(() => {
    createPrMock.mockClear()
  })

  it("exposes exactly title/body/base/draft/taskId — no cwd/runGit/runGh/provider leakage", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.create_pr as { args: Record<string, unknown> } | undefined
    expect(tool).toBeDefined()
    expect(Object.keys(tool?.args ?? {}).sort()).toEqual([
      "base",
      "body",
      "draft",
      "taskId",
      "title",
    ])
  })

  it("resolves cwd as worktree ?? directory and returns pretty JSON", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.create_pr as {
      execute: (args: object, context: object) => Promise<string>
    }

    const withWorktree = await tool.execute(
      { title: "t" },
      { worktree: "/wt", directory: "/dir" },
    )
    expect(createPrMock.mock.calls[0]?.[0]?.cwd).toBe("/wt")
    expect(JSON.parse(withWorktree)).toMatchObject({ prCreated: true })
    expect(withWorktree).toBe(
      JSON.stringify(await createPrMock.mock.results[0]?.value, null, 2),
    )

    await tool.execute({ title: "t" }, { directory: "/dir" })
    expect(createPrMock.mock.calls[1]?.[0]?.cwd).toBe("/dir")
  })

  it("defaults draft to false when omitted", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const tool = plugin.tool?.create_pr as {
      execute: (args: object, context: object) => Promise<string>
    }
    await tool.execute({ title: "t" }, { directory: "/dir" })
    expect(createPrMock.mock.calls[0]?.[0]?.draft).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- tests/modules/commit/create-pr-wrapper.test.ts`
Expected: FAIL — `plugin.tool?.create_pr` undefined.

- [ ] **Step 3: Register `create_pr` in `index.ts` and extend the block-push message**

In `src/modules/commit/index.ts`: add the import and the tool entry after `av_commit` (inside the existing `tool: { … }` map):

```ts
import { createPr } from "./create-pr.js"
```

```ts
      create_pr: tool({
        description:
          "Push the current branch to origin and open a pull request through the AppVerk workflow",
        args: {
          title: tool.schema.string().describe("Pull request title"),
          body: tool.schema
            .string()
            .optional()
            .describe("Pull request description (markdown)"),
          base: tool.schema
            .string()
            .optional()
            .describe("Base branch; defaults to the origin default branch"),
          draft: tool.schema
            .boolean()
            .optional()
            .describe("Create the PR as a draft (default: ready for review)"),
          taskId: tool.schema
            .string()
            .optional()
            .describe("Optional task ID appended to the body as a Refs footer"),
        },
        async execute(args, context) {
          const result = await createPr({
            cwd: context.worktree ?? context.directory,
            title: args.title,
            body: args.body,
            base: args.base,
            draft: args.draft ?? false,
            taskId: args.taskId,
          })
          return JSON.stringify(result, null, 2)
        },
      }),
```

And change the block-push throw (D6 — message only, behavior unchanged, C-2):

```ts
      if (decision === "block-push") {
        throw new Error(
          "git push is blocked by the AppVerk commit plugin. Use the `create_pr` tool to " +
            "publish the current branch and open a pull request.",
        )
      }
```

In `tests/modules/commit/plugin.test.ts`, extend the existing `"blocks git push bash commands"` assertion to pin the redirect:

```ts
    ).rejects.toThrow(/git push is blocked.*create_pr/is)
```

- [ ] **Step 4: Run the module suite**

Run: `bun run test -- tests/modules/commit/`
Expected: PASS (wrapper tests + updated plugin.test.ts + everything prior).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/index.ts tests/modules/commit/create-pr-wrapper.test.ts tests/modules/commit/plugin.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): register create_pr tool and add block-push redirect guidance"
```

---

### Task 6: Executor hook carve-outs (Stribog + Svarog)

**Files:**
- Modify: `src/modules/stribog/tool-budget-hook.ts` (after the serena block — the `return // serena read / navigation / memory — allowed, unbudgeted` line — and before `const denyKey`)
- Modify: `src/modules/svarog/tool-budget-hook.ts` (after the webfetch/websearch deny block, before the `// (4) shared immutable floor` comment)
- Test: `tests/modules/stribog/tool-budget-hook.test.ts`, `tests/modules/svarog/tool-budget-hook.test.ts` (append one test each)

**Interfaces:**
- Consumes: the tool id `create_pr` (Task 5); each hook's existing `norm` local (lowercased, `-`→`_` normalized id).
- Produces: attribution-gated allow for `create_pr` in both hooks (AC-14/AC-15).

- [ ] **Step 1: Write the failing hook tests**

Append inside the existing `describe` in `tests/modules/svarog/tool-budget-hook.test.ts` (uses the file's `allows`/`denies` helpers):

```ts
  it("allows create_pr — the sanctioned publish path — past the immutable floor", async () => {
    await allows("create_pr")
    await allows("Create-PR") // case/hyphen normalization must not bypass the carve-out
    await denies("execute_recipe") // floor regression guard (AC-15)
  })
```

Append inside the existing `describe` in `tests/modules/stribog/tool-budget-hook.test.ts` (uses the file's `hook`/`input`/`out` helpers and `STRIBOG` const):

```ts
  it("allows create_pr for a confirmed stribog session (publish-path carve-out)", async () => {
    await expect(hook(STRIBOG)(input("create_pr"), out())).resolves.toBeUndefined()
    // floor regression guard (AC-14): dispatch family stays denied
    await expect(hook(STRIBOG)(input("execute_recipe"), out())).rejects.toThrow(
      "STRIBOG_TOOL_DENIED",
    )
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- tests/modules/stribog/tool-budget-hook.test.ts tests/modules/svarog/tool-budget-hook.test.ts`
Expected: FAIL — both `create_pr` calls throw the immutable-floor denial (the `create_` verb matches `isImmutableDeny`).

- [ ] **Step 3: Add the two carve-outs**

`src/modules/stribog/tool-budget-hook.ts` — insert between the serena block's final `return` and the `const denyKey` line:

```ts
      // create_pr — the sanctioned publish path (validated, argv-only, never force; push + PR
      // in one audited plugin tool — docs/specs/create-pr-tool.md). The bash mutating-git
      // tripwire and the commit plugin's block-push gate are unchanged; this early-return only
      // lets the tool through the `create_` verb of the isImmutableDeny floor (step 3).
      // Unbudgeted: not an edit/write tool.
      if (norm === "create_pr") return
```

`src/modules/svarog/tool-budget-hook.ts` — insert between the webfetch/websearch deny block and the `// (4) shared immutable floor` comment:

```ts
      // create_pr — the sanctioned publish path (validated, argv-only, never force;
      // docs/specs/create-pr-tool.md). The bash mutating-git tripwire is unchanged; this
      // early-return only lets the plugin tool through the `create_` verb of the
      // isImmutableDeny floor (step 4).
      if (norm === "create_pr") return
```

- [ ] **Step 4: Run the hook suites plus the locked invariants (C-4)**

Run: `bun run test -- tests/modules/stribog/ tests/modules/svarog/`
Expected: PASS — including `metadata.test.ts` and `tools-sync.test.ts` unchanged (AC-17).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/tool-budget-hook.ts src/modules/svarog/tool-budget-hook.ts tests/modules/stribog/tool-budget-hook.test.ts tests/modules/svarog/tool-budget-hook.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(executors): allow create_pr publish path past the immutable-deny floor"
```

---

### Task 7: Real-git integration tests (bare origin + injected provider)

**Files:**
- Test: Create `tests/modules/commit/create-pr.integration.test.ts`

**Interfaces:**
- Consumes: `createPr` (Task 4), `PrProvider`, `CreatePullRequestInput` (Task 1). The injected provider skips G3/G4 per the FR-5 injection rule — required here because the local bare-remote path would fail detection.

- [ ] **Step 1: Write the integration tests (AC-11, AC-12, AC-13)**

```ts
// tests/modules/commit/create-pr.integration.test.ts
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createPr } from "../../../src/modules/commit/create-pr.js"
import type {
  CreatePullRequestInput,
  PrProvider,
} from "../../../src/modules/commit/pr-provider.js"

const run = promisify(execFile)

function fakeProvider(): { provider: PrProvider; calls: CreatePullRequestInput[] } {
  const calls: CreatePullRequestInput[] = []
  return {
    calls,
    provider: {
      name: "fake",
      async createPullRequest(input) {
        calls.push(input)
        return { url: "https://example.invalid/pr/1" }
      },
    },
  }
}

describe("createPr (integration: real git, bare origin, injected provider)", () => {
  let work: string
  let bare: string
  let defaultBranch: string

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "create-pr-work-"))
    bare = await mkdtemp(path.join(tmpdir(), "create-pr-origin-"))
    await run("git", ["init", "--bare"], { cwd: bare })
    await run("git", ["init"], { cwd: work })
    await run("git", ["config", "user.email", "test@example.com"], { cwd: work })
    await run("git", ["config", "user.name", "Test User"], { cwd: work })
    await writeFile(path.join(work, "README.md"), "hello\n")
    await run("git", ["add", "README.md"], { cwd: work })
    await run("git", ["commit", "-m", "chore: init"], { cwd: work })
    // Never hardcode master/main — init.defaultBranch is configurable (spec §7.2 fixture rule).
    const { stdout } = await run("git", ["branch", "--show-current"], { cwd: work })
    defaultBranch = stdout.trim()
    await run("git", ["remote", "add", "origin", bare], { cwd: work })
    await run("git", ["push", "-u", "origin", defaultBranch], { cwd: work })
    await run("git", ["remote", "set-head", "origin", "--auto"], { cwd: work })
  })

  afterEach(async () => {
    await rm(work, { recursive: true, force: true })
    await rm(bare, { recursive: true, force: true })
  })

  it("AC-11: pushes the current branch and hands the resolved default base to the provider", async () => {
    await run("git", ["checkout", "-b", "feature/inc-1"], { cwd: work })
    const { provider, calls } = fakeProvider()

    const result = await createPr({ cwd: work, title: "feat: inc-1", provider })

    expect(result).toEqual({
      head: "feature/inc-1",
      base: defaultBranch,
      pushed: true,
      prCreated: true,
      draft: false,
      url: "https://example.invalid/pr/1",
    })
    const remoteBranches = await run("git", ["branch", "--list", "feature/inc-1"], {
      cwd: bare,
    })
    expect(remoteBranches.stdout).toContain("feature/inc-1")
    const upstream = await run(
      "git",
      ["rev-parse", "--abbrev-ref", "feature/inc-1@{upstream}"],
      { cwd: work },
    )
    expect(upstream.stdout.trim()).toBe("origin/feature/inc-1")
    expect(calls[0]?.base).toBe(defaultBranch)
    expect(calls[0]?.head).toBe("feature/inc-1")
  })

  it("AC-12: an idempotent re-run pushes as a no-op and invokes the provider again", async () => {
    await run("git", ["checkout", "-b", "feature/inc-2"], { cwd: work })
    const { provider, calls } = fakeProvider()

    const first = await createPr({ cwd: work, title: "feat: inc-2", provider })
    const second = await createPr({ cwd: work, title: "feat: inc-2", provider })

    expect(first.pushed).toBe(true)
    expect(second.pushed).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it("AC-13: refuses to publish from the base branch; the bare repo gains no branch", async () => {
    const { provider } = fakeProvider()

    await expect(
      createPr({ cwd: work, title: "feat: nope", provider }),
    ).rejects.toThrow(/refusing to push and open a PR from the base branch/)

    const remoteBranches = await run("git", ["branch", "-a"], { cwd: bare })
    expect(remoteBranches.stdout.trim().split("\n")).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the integration tests**

Run: `bun run test -- tests/modules/commit/create-pr.integration.test.ts`
Expected: PASS (3 tests). If AC-11 fails on `base`, debug the FR-3 `origin/` prefix strip before touching the fixture.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/commit/create-pr.integration.test.ts
AV_COMMIT_SKILL=1 git commit -m "test(commit): add create_pr real-git integration suite with bare origin"
```

---

### Task 8: Documentation, prompt notes, and full verification

**Files:**
- Modify: `src/commands/commit.md` (new `create_pr` section)
- Modify: `src/modules/stribog/stribog.md`, `src/modules/svarog/svarog.md` (one line each)
- Modify: `src/modules/stribog/allowed-tools.ts`, `src/modules/svarog/allowed-tools.ts` (comment-only notes)

**Interfaces:**
- Consumes: the shipped tool contract (Tasks 1–7). No code changes in this task beyond comments.

- [ ] **Step 1: Document the tool in `src/commands/commit.md`**

Append a section (match the file's existing heading style):

```markdown
## Publishing: the `create_pr` tool

After committing with `av_commit`, publish the branch and open a pull request with the
`create_pr` tool — never with bash `git push` (blocked) or `gh pr create` directly.

- Arguments: `title` (required), `body` (optional markdown), `base` (optional; defaults to
  the origin default branch — an empty or whitespace-only value counts as omitted),
  `draft` (optional, default `false` — the PR opens ready for review), `taskId` (optional;
  appended to the body as a `Refs: <taskId>` footer).
- The tool always pushes the **current** branch (`git push -u origin <branch>`, never
  force) and never pushes from the base branch (create one with `create_branch` first).
- Partial success: if the push lands but PR creation fails, the result carries
  `pushed: true, prCreated: false` and a `prError` explaining what to fix (e.g. `gh` not
  installed / not authenticated). Re-running the same call is safe — the push becomes a
  no-op; if the PR already exists, its URL appears in `prError`.
- Requirements on the host: GitHub origin, `gh` installed and authenticated
  (`gh auth login`). Fork workflows: set the target once with `gh repo set-default`.
- The existing prohibitions are unchanged: never push via bash, never `git commit` via
  bash, Conventional Commits, no AI co-authorship.
```

- [ ] **Step 2: Add the one-line prompt notes (FR-13)**

`src/modules/stribog/stribog.md` and `src/modules/svarog/svarog.md` — in each file's tool-guidance section add:

```markdown
- Publishing: push + pull request go through the `create_pr` tool (never bash `git push` / `gh`); branch creation/switching goes through `create_branch`.
```

`src/modules/stribog/allowed-tools.ts` and `src/modules/svarog/allowed-tools.ts` — extend the existing "HOOK-allowed, not listed" comment block (comment only, lists unchanged — C-4):

```ts
// create_pr is HOOK-allowed (publish-path carve-out in tool-budget-hook.ts), not listed here.
```

- [ ] **Step 3: Full verification (spec §1 success criterion)**

Run: `bun run build:root && bun run check`
Expected: typecheck + full test suite + build all PASS, including the untouched `metadata.test.ts` / `tools-sync.test.ts` invariants (AC-17). Regenerate and stage the root `dist/` tree if the repo convention produces changes.

- [ ] **Step 4: Commit**

```bash
git add src/commands/commit.md src/modules/stribog/stribog.md src/modules/svarog/svarog.md src/modules/stribog/allowed-tools.ts src/modules/svarog/allowed-tools.ts dist
AV_COMMIT_SKILL=1 git commit -m "docs(commit): document create_pr publish path and executor prompt notes"
```

- [ ] **Step 5: Release-flow reminder (deferred by design)**

Version bump + tag happen in the release flow per AGENTS.md "Versioning & Git Installation" (spec §8) — not in this plan. Flag it in the PR/handoff notes.

---

## Plan Self-Review (performed)

- **Spec coverage:** FR-1→T5, FR-2/FR-3→T4, FR-4→T3, FR-5→T1/T4, FR-6/FR-7/FR-8→T2/T4, FR-9→T2 (+T4 e2e), FR-10/FR-11→T5, FR-12→T6, FR-13→T8; NFR-1..6 embedded in T1–T5 designs; AC-1→T3, AC-2→T1, AC-3..AC-7/AC-10→T4, AC-8/AC-9→T2, AC-11..13→T7, AC-14/15→T6, AC-16→T5, AC-17→T6/T8. D6→T5; §5.5 carve-outs→T6. No uncovered requirement found.
- **Placeholder scan:** no TBD/TODO; every code step carries the actual code; the single deferral (version bump) mirrors the spec's own §8 deferral and is labeled as such.
- **Type consistency:** `CreatePullRequestInput`/`PrProvider`/`detectProvider` (T1) match their uses in T2/T4/T7; `GhRunner = GitRunner` shape used consistently; `CreatePrInput`/`CreatePrResult` fields identical across T3/T4/T5/T7; guard messages in T4 match the test regexes in T4/T7.
