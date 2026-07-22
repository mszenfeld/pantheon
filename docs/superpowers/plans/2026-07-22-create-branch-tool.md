# `create_branch` Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give executor agents (Stribog, Svarog, `/commit` flow) a `create_branch` plugin tool that composes and validates a convention-conforming branch name from segmented arguments (`type`/`id`/`description`) in pure TypeScript, then creates (and by default switches to) the branch via argv-only git — while the bash `git checkout` denial stays untouched.

**Architecture:** One new module file `src/modules/commit/create-branch.ts` holds the layered validator (normalize → segment rules S1–S8 → compose → composed-name rules N1–N11) and the `createBranch` orchestrator over the existing injectable `GitRunner`. The tool registers in the commit plugin beside `av_commit`/`create_pr`, and each executor hook gains a one-line attribution-gated early-return past the `isImmutableDeny` floor — exactly the shipped `create_pr` carve-out pattern (live precedent at `src/modules/stribog/tool-budget-hook.ts:285` and `src/modules/svarog/tool-budget-hook.ts:181`).

**Tech Stack:** TypeScript strict ESM/NodeNext, `@opencode-ai/plugin` `tool()` registration, vitest, real-git integration fixtures via `mkdtemp`.

**Spec:** `docs/specs/create-branch-tool-2.md` (MoA-converged, commit `1493efc`). Section references (§…, FR-…, AC-…, S…/N… rules) below point into that file — read the referenced section before implementing a step when in doubt.

## Global Constraints

- **C-1:** No shell interpretation anywhere: `execFile("git", args, { cwd })` argv arrays only, through the reused `GitRunner`.
- **C-2:** `src/modules/_shared/mutating-git.ts` and both executor bash tripwires MUST NOT change behavior. The bash `git checkout` denial stays byte-identical.
- **C-3:** Reuse `GitRunner`/`GitResult`/`defaultGitRunner` from `./controlled-commit.js` — never duplicate the runner.
- **C-4:** Locked invariants that MUST keep passing unchanged: `tests/modules/stribog/metadata.test.ts:74` (pins `CORE_BUILTINS`) and `tests/modules/stribog/tools-sync.test.ts:33` (pins `STRIBOG_TOOLS` parity).
- **C-5:** ESM/NodeNext strict TS, root build (`bundle: false`); tests import from `src/` with `.js` suffixes and run via root `bun run test` after `bun run build:root`.
- **Error template (normative, byte-exact):** `create_branch: segment '<segment>' violates rule <ruleId> (<shortDescription>): <jsonEncodedValue>` where `<segment>` ∈ `type|id|description|name` and `<jsonEncodedValue>` is `JSON.stringify` of the post-normalization value for `description` failures, the trimmed value for `type`/`id`, the composed name for `name`.
- **Evaluation order (normative):** segments `type` → `id` → `description`; within a segment, rules in listed order (S1→S8); composed-name rules N1→N11; the first failing rule is the one reported.
- **Branch types (exact, case-sensitive):** `feature`, `fix`, `hotfix`, `release`, `docs`, `chore`, `refactor`.
- **Composed-name byte cap:** 240 bytes UTF-8 (`Buffer.byteLength(name, "utf8") <= 240`).
- **Commits:** Conventional Commits; every `git commit` MUST be prefixed `AV_COMMIT_SKILL=1` (repo pre-commit hook blocks direct commits otherwise); **NEVER append `Co-Authored-By` or any AI-attribution trailer** — after each commit run `git log -1 --format=%B` and `git commit --amend` (with `AV_COMMIT_SKILL=1`) if a harness added one.
- **Version bump:** deferred to the release flow per AGENTS.md — do NOT touch any `package.json` version.
- Branch: work on `feature/create-branch-tool` (already created, stacked on `feature/create-pr-tool`).

---

### Task 1: Validation core — normalization, segment rules, composition, composed-name validator

**Files:**
- Create: `src/modules/commit/create-branch.ts`
- Test: `tests/modules/commit/create-branch.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure TypeScript; no git).
- Produces (later tasks rely on these exact names):
  - `export const BRANCH_TYPES: readonly ["feature", "fix", "hotfix", "release", "docs", "chore", "refactor"]`
  - `export type BranchType = (typeof BRANCH_TYPES)[number]`
  - `export function composeBranchName(input: { type: string; id?: string; description: string }): string` — normalize → validate segments → compose → validate composed; returns the composed name or throws the normative template error.
  - `export function validateBranchName(name: string, expectedType: BranchType): string` — §5.2.4 N1–N11; returns `name` or throws on the first failed rule.

- [ ] **Step 1: Write the failing test**

Create `tests/modules/commit/create-branch.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  BRANCH_TYPES,
  composeBranchName,
  validateBranchName,
} from "../../../src/modules/commit/create-branch.js"

/** Byte-exact §5.2 normative template. */
function segmentMessage(
  segment: string,
  ruleId: string,
  slug: string,
  value: string,
): string {
  return `create_branch: segment '${segment}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}`
}

function captureMessage(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return (error as Error).message
  }
  return "<no throw>"
}

describe("BRANCH_TYPES", () => {
  it("pins the exact allow-list, in order", () => {
    expect(BRANCH_TYPES).toEqual([
      "feature",
      "fix",
      "hotfix",
      "release",
      "docs",
      "chore",
      "refactor",
    ])
  })
})

describe("composeBranchName — valid vectors (§5.2.5 segment table)", () => {
  const valid: Array<{
    input: { type: string; id?: string; description: string }
    name: string
  }> = [
    {
      input: {
        type: "feature",
        id: "INC-212",
        description: "fix alert dialog slide animation",
      },
      name: "feature/INC-212-fix-alert-dialog-slide-animation",
    },
    {
      input: { type: "feature", description: "fix alert dialog" },
      name: "feature/fix-alert-dialog",
    },
    {
      input: { type: "fix", id: "PROD-42", description: "memory leak in auth" },
      name: "fix/PROD-42-memory-leak-in-auth",
    },
    // empty / whitespace-only id is omitted (FR-3)
    { input: { type: "feature", id: "", description: "x" }, name: "feature/x" },
    { input: { type: "feature", id: "  ", description: "x" }, name: "feature/x" },
    { input: { type: "docs", description: "readme update" }, name: "docs/readme-update" },
    // dots allowed; not `..`, not `.lock`, not trailing `.`
    { input: { type: "release", description: "2026.07.21" }, name: "release/2026.07.21" },
    {
      input: { type: "chore", description: "update dependencies" },
      name: "chore/update-dependencies",
    },
    {
      input: { type: "refactor", description: "simplify parser" },
      name: "refactor/simplify-parser",
    },
    // whitespace-run collapse
    {
      input: { type: "hotfix", description: "fix  alert   dialog" },
      name: "hotfix/fix-alert-dialog",
    },
    { input: { type: "feature", description: "fix\talert" }, name: "feature/fix-alert" },
    { input: { type: "feature", description: "fix\nalert" }, name: "feature/fix-alert" },
    // NBSP U+00A0 is Unicode whitespace: collapsed by \s+
    {
      input: { type: "feature", description: "fix\u00A0alert" },
      name: "feature/fix-alert",
    },
    { input: { type: "feature", description: "3rd retry" }, name: "feature/3rd-retry" },
    // type is trimmed before the S1 enum match
    {
      input: { type: "  fix  ", description: "auth login error" },
      name: "fix/auth-login-error",
    },
    // N11 boundary: "feature/" (8 bytes) + 232 a's = exactly 240 bytes
    {
      input: { type: "feature", description: "a".repeat(232) },
      name: `feature/${"a".repeat(232)}`,
    },
  ]

  it.each(valid)("composes %j", ({ input, name }) => {
    expect(composeBranchName(input)).toBe(name)
  })
})

describe("composeBranchName — invalid vectors (§5.2.5 segment table, exact template)", () => {
  const invalid: Array<{
    label: string
    input: { type: string; id?: string; description: string }
    message: string
  }> = [
    {
      label: "S1 empty type",
      input: { type: "", description: "x" },
      message: segmentMessage("type", "S1", "type-not-allowed", ""),
    },
    {
      label: "S1 whitespace type trims to empty",
      input: { type: "  ", description: "x" },
      message: segmentMessage("type", "S1", "type-not-allowed", ""),
    },
    {
      label: "S1 feat",
      input: { type: "feat", description: "x" },
      message: segmentMessage("type", "S1", "type-not-allowed", "feat"),
    },
    {
      label: "S1 case-sensitive",
      input: { type: "Feature", description: "x" },
      message: segmentMessage("type", "S1", "type-not-allowed", "Feature"),
    },
    {
      label: "S2 empty description",
      input: { type: "feature", description: "" },
      message: segmentMessage("description", "S2", "empty-description", ""),
    },
    {
      label: "S2 whitespace-only normalizes empty",
      input: { type: "feature", description: "   " },
      message: segmentMessage("description", "S2", "empty-description", ""),
    },
    {
      label: "S2 dashes strip to empty",
      input: { type: "feature", description: "---" },
      message: segmentMessage("description", "S2", "empty-description", ""),
    },
    {
      label: "S3 spaced id is never normalized (D9)",
      input: { type: "feature", id: "INC 212", description: "x" },
      message: segmentMessage("id", "S3", "invalid-characters", "INC 212"),
    },
    {
      label: "S3 non-ASCII description",
      input: { type: "feature", description: "café" },
      message: segmentMessage("description", "S3", "invalid-characters", "café"),
    },
    {
      label: "S3 NUL control byte",
      input: { type: "feature", description: "fix\u0000alert" },
      message: segmentMessage("description", "S3", "invalid-characters", "fix\u0000alert"),
    },
    {
      label: "S4 leading-dash id",
      input: { type: "feature", id: "-INC-1", description: "x" },
      message: segmentMessage("id", "S4", "leading-dash", "-INC-1"),
    },
    {
      label: "S5 leading-dot id",
      input: { type: "feature", id: ".INC", description: "x" },
      message: segmentMessage("id", "S5", "leading-dot", ".INC"),
    },
    {
      label: "S5 leading-dot description",
      input: { type: "feature", description: ".hidden" },
      message: segmentMessage("description", "S5", "leading-dot", ".hidden"),
    },
    {
      label: "S6 double hyphen",
      input: { type: "feature", description: "fix--alert" },
      message: segmentMessage("description", "S6", "double-hyphen", "fix--alert"),
    },
    {
      label: "S6 normalization-produced double hyphen (post-normalization value echoed)",
      input: { type: "feature", description: "fix - alert" },
      message: segmentMessage("description", "S6", "double-hyphen", "fix---alert"),
    },
    {
      label: "S6 double-hyphen id",
      input: { type: "feature", id: "INC--212", description: "x" },
      message: segmentMessage("id", "S6", "double-hyphen", "INC--212"),
    },
    {
      label: "S7 consecutive dots",
      input: { type: "feature", description: "x..y" },
      message: segmentMessage("description", "S7", "consecutive-dots", "x..y"),
    },
    {
      label: "S8 lock suffix",
      input: { type: "feature", description: "x.lock" },
      message: segmentMessage("description", "S8", "lock-suffix-or-trailing-dot", "x.lock"),
    },
    {
      label: "S8 trailing dot",
      input: { type: "feature", description: "x." },
      message: segmentMessage("description", "S8", "lock-suffix-or-trailing-dot", "x."),
    },
    {
      label: "composed N7 via id ending in dash (segments individually pass)",
      input: { type: "feature", id: "INC-", description: "x" },
      message: segmentMessage("name", "N7", "double-hyphen", "feature/INC--x"),
    },
    {
      label: "composed N11 over-limit (241 bytes)",
      input: { type: "feature", description: "a".repeat(233) },
      message: segmentMessage(
        "name",
        "N11",
        "max-length-240-bytes",
        `feature/${"a".repeat(233)}`,
      ),
    },
    // Evaluation order (§5.2.2 normative): type before id before description.
    {
      label: "order: bad type wins over bad id and bad description",
      input: { type: "feat", id: "-x", description: "" },
      message: segmentMessage("type", "S1", "type-not-allowed", "feat"),
    },
    {
      label: "order: bad id wins over bad description",
      input: { type: "feature", id: "INC 212", description: "" },
      message: segmentMessage("id", "S3", "invalid-characters", "INC 212"),
    },
  ]

  it.each(invalid)("$label", ({ input, message }) => {
    expect(captureMessage(() => composeBranchName(input))).toBe(message)
  })
})

describe("validateBranchName — direct composed-name vectors (§5.2.5 second table)", () => {
  it("returns the name on success", () => {
    expect(
      validateBranchName("feature/INC-212-fix-alert-dialog-slide-animation", "feature"),
    ).toBe("feature/INC-212-fix-alert-dialog-slide-animation")
    expect(validateBranchName("feature/fix-alert-dialog-slide-animation", "feature")).toBe(
      "feature/fix-alert-dialog-slide-animation",
    )
    expect(validateBranchName("release/2026.07.21", "release")).toBe("release/2026.07.21")
    // N11 boundary: exactly 240 bytes
    expect(validateBranchName(`feature/${"a".repeat(232)}`, "feature")).toBe(
      `feature/${"a".repeat(232)}`,
    )
  })

  const invalid: Array<{
    name: string
    expectedType: "feature" | "fix"
    ruleId: string
    slug: string
  }> = [
    { name: "feature/", expectedType: "feature", ruleId: "N4", slug: "empty-description-part" },
    { name: "feature/INC 212", expectedType: "feature", ruleId: "N5", slug: "invalid-characters" },
    { name: "feature/INC--212", expectedType: "feature", ruleId: "N7", slug: "double-hyphen" },
    { name: "feat/INC-212", expectedType: "feature", ruleId: "N2", slug: "type-mismatch" },
    { name: "fix/INC-212", expectedType: "feature", ruleId: "N2", slug: "type-mismatch" },
    { name: "feature/INC-212", expectedType: "fix", ruleId: "N2", slug: "type-mismatch" },
    { name: "feature/INC-212/", expectedType: "feature", ruleId: "N1", slug: "single-slash" },
    { name: "feature/../main", expectedType: "feature", ruleId: "N1", slug: "single-slash" },
    // N3 is unreachable as a FIRST failure for any valid expectedType: a leading-dash name
    // always fails N2 first ("-feature" is never the expected type). The row asserts N2.
    { name: "-feature/INC-212", expectedType: "feature", ruleId: "N2", slug: "type-mismatch" },
    { name: "feature/.hidden", expectedType: "feature", ruleId: "N6", slug: "leading-dash-or-dot" },
    { name: "feature/x..y", expectedType: "feature", ruleId: "N8", slug: "consecutive-dots" },
    { name: "feature/x.lock", expectedType: "feature", ruleId: "N9", slug: "lock-suffix" },
    { name: "feature/x.", expectedType: "feature", ruleId: "N10", slug: "trailing-dot" },
    {
      name: `feature/${"a".repeat(233)}`,
      expectedType: "feature",
      ruleId: "N11",
      slug: "max-length-240-bytes",
    },
  ]

  it.each(invalid)("$name → $ruleId", ({ name, expectedType, ruleId, slug }) => {
    expect(captureMessage(() => validateBranchName(name, expectedType))).toBe(
      segmentMessage("name", ruleId, slug, name),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run tests/modules/commit/create-branch.test.ts`
Expected: FAIL — `Cannot find module '../../../src/modules/commit/create-branch.js'`.

(If root `vitest` isn't wired that way, use the repo's standard: `bun run test -- tests/modules/commit/create-branch.test.ts`. Match whatever the existing `tests/modules/commit/create-pr.test.ts` runs with.)

- [ ] **Step 3: Write the implementation**

Create `src/modules/commit/create-branch.ts`:

```ts
import { defaultGitRunner, type GitRunner } from "./controlled-commit.js"

export const BRANCH_TYPES = [
  "feature",
  "fix",
  "hotfix",
  "release",
  "docs",
  "chore",
  "refactor",
] as const

export type BranchType = (typeof BRANCH_TYPES)[number]

export interface CreateBranchInput {
  type: string
  id?: string
  description: string
  checkout?: boolean
  cwd: string
  runGit?: GitRunner
}

export interface CreateBranchResult {
  name: string
  created: true
  checkedOut: boolean
  checkoutError?: string
}

/** Normative §5.2 error template. */
function segmentError(
  segment: string,
  ruleId: string,
  slug: string,
  value: string,
): Error {
  return new Error(
    `create_branch: segment '${segment}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}`,
  )
}

const SEGMENT_CHARSET = /^[A-Za-z0-9._-]+$/

/**
 * §5.2.1 description normalization, in this exact order:
 * trim → collapse every whitespace run to a single "-" → strip edge dashes.
 * JS \s covers tab, newline, CR, VT, FF, NBSP (U+00A0), and the Unicode
 * space separators, so "fix\talert", "fix\nalert", "fix\u00A0alert" all
 * normalize to "fix-alert"; "---" strips to "" (failing S2).
 */
function normalizeDescription(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

/**
 * §5.2.2 rules S3–S8 in listed order, first failure reported. S1 (type
 * enum) and S2 (non-empty description) are segment-specific and checked
 * by composeBranchName before this runs. S4 cannot fire for a normalized
 * description (edge dashes are stripped) — it binds `id` in practice.
 */
function validateSegmentRules(segment: "id" | "description", value: string): string {
  if (!SEGMENT_CHARSET.test(value))
    throw segmentError(segment, "S3", "invalid-characters", value)
  if (value.startsWith("-")) throw segmentError(segment, "S4", "leading-dash", value)
  if (value.startsWith(".")) throw segmentError(segment, "S5", "leading-dot", value)
  if (value.includes("--")) throw segmentError(segment, "S6", "double-hyphen", value)
  if (value.includes("..")) throw segmentError(segment, "S7", "consecutive-dots", value)
  if (value.endsWith(".lock") || value.endsWith("."))
    throw segmentError(segment, "S8", "lock-suffix-or-trailing-dot", value)
  return value
}

/**
 * §5.2.4 composed-name validation, N1–N11 in listed order, first failure
 * thrown. Defense-in-depth over composition and the exported direct-test
 * contract. N3 is unreachable as a first failure whenever expectedType is
 * a valid BranchType (a leading-dash name always fails N2 first); it is
 * kept for non-TypeScript callers and ordering fidelity.
 */
export function validateBranchName(name: string, expectedType: BranchType): string {
  if (name.split("/").length - 1 !== 1)
    throw segmentError("name", "N1", "single-slash", name)
  const slashIndex = name.indexOf("/")
  const typePart = name.slice(0, slashIndex)
  const descriptionPart = name.slice(slashIndex + 1)
  if (
    typePart !== expectedType ||
    !(BRANCH_TYPES as readonly string[]).includes(typePart)
  )
    throw segmentError("name", "N2", "type-mismatch", name)
  if (name.startsWith("-")) throw segmentError("name", "N3", "leading-dash", name)
  if (descriptionPart === "")
    throw segmentError("name", "N4", "empty-description-part", name)
  if (!SEGMENT_CHARSET.test(descriptionPart))
    throw segmentError("name", "N5", "invalid-characters", name)
  if (descriptionPart.startsWith("-") || descriptionPart.startsWith("."))
    throw segmentError("name", "N6", "leading-dash-or-dot", name)
  if (descriptionPart.includes("--"))
    throw segmentError("name", "N7", "double-hyphen", name)
  if (descriptionPart.includes(".."))
    throw segmentError("name", "N8", "consecutive-dots", name)
  if (descriptionPart.endsWith(".lock"))
    throw segmentError("name", "N9", "lock-suffix", name)
  if (descriptionPart.endsWith("."))
    throw segmentError("name", "N10", "trailing-dot", name)
  if (Buffer.byteLength(name, "utf8") > 240)
    throw segmentError("name", "N11", "max-length-240-bytes", name)
  return name
}

/**
 * §5.2 layered validation + §5.2.3 composition. Evaluation order
 * (normative): type → id → description, each segment's rules in listed
 * order, first failing rule reported. Pure TypeScript — zero git.
 */
export function composeBranchName(input: {
  type: string
  id?: string
  description: string
}): string {
  const type = input.type.trim()
  if (!(BRANCH_TYPES as readonly string[]).includes(type))
    throw segmentError("type", "S1", "type-not-allowed", type)

  // An id that is omitted, "", or trims to empty is treated as omitted (FR-3, D9:
  // never normalized beyond trimming).
  const id = input.id?.trim() ?? ""
  if (id !== "") validateSegmentRules("id", id)

  const description = normalizeDescription(input.description)
  if (description === "")
    throw segmentError("description", "S2", "empty-description", description)
  validateSegmentRules("description", description)

  const name = id !== "" ? `${type}/${id}-${description}` : `${type}/${description}`
  return validateBranchName(name, type as BranchType)
}
```

(`CreateBranchInput`/`CreateBranchResult`/`defaultGitRunner` import are used by Task 2's `createBranch` in this same file; TypeScript will flag the unused import until then — acceptable staging ONLY if the repo lint permits; if `bun run check` fails on the unused import, defer the `import { defaultGitRunner, … }` line and the two interfaces to Task 2 and import nothing here yet — `composeBranchName`/`validateBranchName` need no git.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run tests/modules/commit/create-branch.test.ts`
Expected: PASS — all vector rows green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/create-branch.ts tests/modules/commit/create-branch.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): add create_branch validation core (segments, composition, composed-name rules)"
git log -1 --format=%B   # verify: no Co-Authored-By / attribution trailer; amend if present
```

---

### Task 2: `createBranch` orchestration — git invocation contract + partial success

**Files:**
- Modify: `src/modules/commit/create-branch.ts` (append `createBranch`; add the `CreateBranchInput`/`CreateBranchResult` interfaces and the `controlled-commit.js` import if Task 1 deferred them)
- Test: `tests/modules/commit/create-branch.test.ts` (append)

**Interfaces:**
- Consumes: `composeBranchName` (Task 1), `GitRunner`/`GitResult`/`defaultGitRunner` from `./controlled-commit.js` (C-3).
- Produces: `export async function createBranch(input: CreateBranchInput): Promise<CreateBranchResult>` — Task 4's wrapper and Task 3's integration suite call exactly this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/modules/commit/create-branch.test.ts` (extend the import line with `createBranch` and add `import type { GitResult, GitRunner } from "../../../src/modules/commit/controlled-commit.js"`):

```ts
function recordingRunner(results: GitResult[]): {
  calls: string[][]
  runGit: GitRunner
} {
  const calls: string[][] = []
  const queue = [...results]
  return {
    calls,
    runGit: async (_cwd, args) => {
      calls.push(args)
      return queue.shift() ?? { stdout: "", stderr: "", exitCode: 0 }
    },
  }
}

const ok: GitResult = { stdout: "", stderr: "", exitCode: 0 }

describe("createBranch — orchestration (§5.3, FR-4..FR-7)", () => {
  it("AC-2: happy path, default checkout — branch then checkout, exact result", async () => {
    const { calls, runGit } = recordingRunner([ok, ok])
    const result = await createBranch({
      cwd: "/repo",
      type: "feature",
      id: "INC-212",
      description: "fix alert dialog",
      runGit,
    })
    expect(calls).toEqual([
      ["branch", "feature/INC-212-fix-alert-dialog"],
      ["checkout", "feature/INC-212-fix-alert-dialog"],
    ])
    // toEqual pins the exact shape: no checkoutError key on success
    expect(result).toEqual({
      name: "feature/INC-212-fix-alert-dialog",
      created: true,
      checkedOut: true,
    })
  })

  it("AC-3: id omitted, empty, and whitespace-only all compose the same name", async () => {
    for (const id of [undefined, "", "  "]) {
      const { runGit } = recordingRunner([ok, ok])
      const result = await createBranch({
        cwd: "/repo",
        type: "feature",
        id,
        description: "fix alert dialog",
        runGit,
      })
      expect(result.name).toBe("feature/fix-alert-dialog")
      expect(result.checkedOut).toBe(true)
    }
  })

  it("AC-4: checkout:false makes only the branch call; checkedOut always emitted", async () => {
    const { calls, runGit } = recordingRunner([ok])
    const result = await createBranch({
      cwd: "/repo",
      type: "feature",
      description: "x",
      checkout: false,
      runGit,
    })
    expect(calls).toEqual([["branch", "feature/x"]])
    expect(result).toEqual({ name: "feature/x", created: true, checkedOut: false })
  })

  it("AC-5: create failure rejects with git stderr; no checkout follows", async () => {
    const { calls, runGit } = recordingRunner([
      {
        stdout: "",
        stderr: "fatal: a branch named 'feature/x' already exists.\n",
        exitCode: 128,
      },
    ])
    await expect(
      createBranch({ cwd: "/repo", type: "feature", description: "x", runGit }),
    ).rejects.toThrow("fatal: a branch named 'feature/x' already exists.")
    expect(calls).toEqual([["branch", "feature/x"]])
  })

  it("AC-6: checkout failure returns the partial result — never a throw, never a delete", async () => {
    const { calls, runGit } = recordingRunner([
      ok,
      { stdout: "", stderr: "error: you need to resolve your current index first\n", exitCode: 1 },
    ])
    const result = await createBranch({
      cwd: "/repo",
      type: "feature",
      description: "x",
      runGit,
    })
    expect(result).toEqual({
      name: "feature/x",
      created: true,
      checkedOut: false,
      checkoutError: "error: you need to resolve your current index first",
    })
    expect(calls).toHaveLength(2) // no delete / third call
  })

  it("AC-6 (FR-7 capture rule): empty stderr falls back to stdout, then to the fixed string", async () => {
    const stdoutOnly = recordingRunner([
      ok,
      { stdout: "detail on stdout\n", stderr: "", exitCode: 1 },
    ])
    const withStdout = await createBranch({
      cwd: "/repo",
      type: "feature",
      description: "x",
      runGit: stdoutOnly.runGit,
    })
    expect(withStdout.checkoutError).toBe("detail on stdout")

    const silent = recordingRunner([ok, { stdout: "", stderr: "", exitCode: 1 }])
    const bothEmpty = await createBranch({
      cwd: "/repo",
      type: "feature",
      description: "x",
      runGit: silent.runGit,
    })
    expect(bothEmpty.checkoutError).toBe("git checkout failed.")
  })

  it("AC-1 (zero-git property): invalid input records zero runner calls", async () => {
    const vectors: Array<{ type: string; id?: string; description: string }> = [
      { type: "feat", description: "x" },
      { type: "feature", description: "" },
      { type: "feature", id: "-INC-1", description: "x" },
      { type: "feature", description: "a".repeat(233) },
    ]
    for (const vector of vectors) {
      const { calls, runGit } = recordingRunner([])
      await expect(
        createBranch({ cwd: "/repo", ...vector, runGit }),
      ).rejects.toThrow("create_branch: segment ")
      expect(calls).toHaveLength(0)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun run vitest run tests/modules/commit/create-branch.test.ts`
Expected: FAIL — `createBranch` is not exported.

- [ ] **Step 3: Implement `createBranch`**

Append to `src/modules/commit/create-branch.ts` (the interfaces and the `controlled-commit.js` import from Task 1 Step 3 must now exist):

```ts
/**
 * §5.3 git invocation contract: at most two argv invocations through the
 * injected runner — ["branch", name], then ["checkout", name] when
 * checkout resolves true. No existence pre-check (git is the single
 * source of truth; a pre-check would be TOCTOU anyway). FR-4: create
 * failure throws stderr (or stdout when stderr is empty), mirroring
 * controlled-commit.ts. FR-7/D3: checkout failure is a partial-success
 * result — the branch is never auto-deleted.
 */
export async function createBranch(
  input: CreateBranchInput,
): Promise<CreateBranchResult> {
  const name = composeBranchName(input) // FR-2: throws before any git on invalid input
  const runGit = input.runGit ?? defaultGitRunner
  const checkout = input.checkout ?? true

  const createResult = await runGit(input.cwd, ["branch", name])
  if (createResult.exitCode !== 0) {
    throw new Error(
      createResult.stderr.trim() ||
        createResult.stdout.trim() ||
        "git branch failed.",
    )
  }

  if (!checkout) {
    return { name, created: true, checkedOut: false }
  }

  const checkoutResult = await runGit(input.cwd, ["checkout", name])
  if (checkoutResult.exitCode !== 0) {
    return {
      name,
      created: true,
      checkedOut: false,
      // FR-7 capture rule: stderr → stdout → fixed string; never empty on
      // this path, so checkedOut:false + checkoutError stays distinguishable
      // from the checkout:false path (FR-6).
      checkoutError:
        checkoutResult.stderr.trim() ||
        checkoutResult.stdout.trim() ||
        "git checkout failed.",
    }
  }

  return { name, created: true, checkedOut: true }
}
```

- [ ] **Step 4: Run the full file to verify it passes**

Run: `bun run vitest run tests/modules/commit/create-branch.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/create-branch.ts tests/modules/commit/create-branch.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): add createBranch orchestration with partial-success checkout contract"
git log -1 --format=%B   # verify: no attribution trailer
```

---

### Task 3: Real-repo integration suite

**Files:**
- Create: `tests/modules/commit/create-branch.integration.test.ts`

**Interfaces:**
- Consumes: `createBranch` (Task 2). Real `git` binary via the default runner.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing tests**

Create `tests/modules/commit/create-branch.integration.test.ts`:

```ts
import { execFile } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { createBranch } from "../../../src/modules/commit/create-branch.js"

const execFileAsync = promisify(execFile)

/**
 * §7.2 mandatory fixture: init + user config + an INITIAL COMMIT (git
 * branch fails on an unborn HEAD) + the CAPTURED symbolic HEAD (the
 * default branch name is configurable — never hardcode master/main).
 */
async function createRepoWithCommit(): Promise<{ cwd: string; initialHead: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), "av-opencode-create-branch-"))
  await execFileAsync("git", ["init"], { cwd })
  await execFileAsync("git", ["config", "user.email", "dev@example.com"], { cwd })
  await execFileAsync("git", ["config", "user.name", "Dev User"], { cwd })
  await writeFile(path.join(cwd, "README.md"), "seed\n")
  await execFileAsync("git", ["add", "README.md"], { cwd })
  await execFileAsync("git", ["commit", "-m", "chore: seed"], { cwd })
  const head = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd })
  return { cwd, initialHead: head.stdout.trim() }
}

async function currentHead(cwd: string): Promise<string> {
  const head = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], { cwd })
  return head.stdout.trim()
}

async function branchList(cwd: string, pattern: string): Promise<string> {
  const list = await execFileAsync("git", ["branch", "--list", pattern], { cwd })
  return list.stdout.trim()
}

describe("createBranch integration (real git)", () => {
  it("AC-7: creates and switches to the composed branch", async () => {
    const { cwd } = await createRepoWithCommit()
    const result = await createBranch({
      cwd,
      type: "feature",
      description: "inc 1 demo",
    })
    expect(result).toEqual({
      name: "feature/inc-1-demo",
      created: true,
      checkedOut: true,
    })
    expect(await branchList(cwd, "feature/inc-1-demo")).not.toBe("")
    expect(await currentHead(cwd)).toBe("feature/inc-1-demo")
  })

  it("AC-8: checkout:false creates the branch and leaves HEAD untouched", async () => {
    const { cwd, initialHead } = await createRepoWithCommit()
    const result = await createBranch({
      cwd,
      type: "fix",
      description: "stay put",
      checkout: false,
    })
    expect(result.checkedOut).toBe(false)
    expect(await branchList(cwd, "fix/stay-put")).not.toBe("")
    expect(await currentHead(cwd)).toBe(initialHead)
  })

  it("AC-9: a second call with the same segments rejects with git's already-exists error", async () => {
    const { cwd } = await createRepoWithCommit()
    await createBranch({ cwd, type: "feature", description: "dup", checkout: false })
    await expect(
      createBranch({ cwd, type: "feature", description: "dup", checkout: false }),
    ).rejects.toThrow(/already exists/)
  })

  it("AC-10: invalid input creates nothing", async () => {
    const { cwd } = await createRepoWithCommit()
    await expect(
      createBranch({ cwd, type: "feat", description: "x" }),
    ).rejects.toThrow("create_branch: segment 'type' violates rule S1")
    expect(await branchList(cwd, "feat/*")).toBe("")
    expect(await branchList(cwd, "*x*")).toBe("")
  })
})
```

- [ ] **Step 2: Run to verify current behavior**

Run: `bun run vitest run tests/modules/commit/create-branch.integration.test.ts`
Expected: PASS immediately if Tasks 1–2 are correct (the suite is new but the implementation exists). If anything fails, the implementation — not the test — is wrong: debug `createBranch` against the failing AC before touching assertions.

- [ ] **Step 3: Commit**

```bash
git add tests/modules/commit/create-branch.integration.test.ts
AV_COMMIT_SKILL=1 git commit -m "test(commit): add create_branch real-git integration suite"
git log -1 --format=%B   # verify: no attribution trailer
```

---

### Task 4: Plugin registration + wrapper contract tests

**Files:**
- Modify: `src/modules/commit/index.ts` (add the `create_branch` tool beside `av_commit`/`create_pr`)
- Test: `tests/modules/commit/create-branch-wrapper.test.ts` (create)

**Interfaces:**
- Consumes: `createBranch`, `CreateBranchInput` (Task 2).
- Produces: registered plugin tool id `create_branch` with agent-visible args exactly `type`, `id`, `description`, `checkout` — Task 5's hooks and Task 6's docs reference this id verbatim.

- [ ] **Step 1: Write the failing test**

Create `tests/modules/commit/create-branch-wrapper.test.ts` (mirrors `create-pr-wrapper.test.ts`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { CreateBranchInput } from "../../../src/modules/commit/create-branch.js"

const createBranchMock = vi.fn(async (input: CreateBranchInput) => ({
  name: "feature/x",
  created: true as const,
  checkedOut: input.checkout ?? true,
}))

vi.mock("../../../src/modules/commit/create-branch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/modules/commit/create-branch.js")>()),
  createBranch: (input: CreateBranchInput) => createBranchMock(input),
}))

const { AppVerkCommitPlugin } = await import("../../../src/modules/commit/index.js")

type SchemaLike = { safeParse: (value: unknown) => { success: boolean } }

describe("create_branch wrapper registration (AC-13)", () => {
  beforeEach(() => {
    createBranchMock.mockClear()
  })

  it("exposes exactly type/id/description/checkout — no cwd/runGit leakage", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const toolDef = plugin.tool?.create_branch as
      | { args: Record<string, unknown> }
      | undefined
    expect(toolDef).toBeDefined()
    expect(Object.keys(toolDef?.args ?? {}).sort()).toEqual([
      "checkout",
      "description",
      "id",
      "type",
    ])
  })

  it("type is a plain string schema, not a schema-level enum (FR-1/NFR-4)", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const toolDef = plugin.tool?.create_branch as { args: Record<string, SchemaLike> }
    // An out-of-enum value must PASS the schema so it reaches the S1
    // TypeScript error (the normative template) instead of a schema reject.
    expect(toolDef.args.type.safeParse("feat").success).toBe(true)
  })

  it("resolves cwd as worktree ?? directory, defaults checkout to true, returns pretty JSON", async () => {
    const plugin = await AppVerkCommitPlugin({} as never)
    const toolDef = plugin.tool?.create_branch as {
      execute: (args: object, context: object) => Promise<string>
    }

    const withWorktree = await toolDef.execute(
      { type: "feature", description: "x" },
      { worktree: "/wt", directory: "/dir" },
    )
    expect(createBranchMock.mock.calls[0]?.[0]?.cwd).toBe("/wt")
    expect(createBranchMock.mock.calls[0]?.[0]?.checkout).toBe(true)
    expect(JSON.parse(withWorktree)).toMatchObject({ created: true })
    expect(withWorktree).toBe(
      JSON.stringify(await createBranchMock.mock.results[0]?.value, null, 2),
    )

    await toolDef.execute(
      { type: "feature", description: "x" },
      { directory: "/dir" },
    )
    expect(createBranchMock.mock.calls[1]?.[0]?.cwd).toBe("/dir")

    await toolDef.execute(
      { type: "feature", description: "x", checkout: false },
      { directory: "/dir" },
    )
    expect(createBranchMock.mock.calls[2]?.[0]?.checkout).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run tests/modules/commit/create-branch-wrapper.test.ts`
Expected: FAIL — `plugin.tool?.create_branch` is undefined.

- [ ] **Step 3: Register the tool**

In `src/modules/commit/index.ts`: add the import beside the existing ones —

```ts
import { createBranch } from "./create-branch.js"
```

— and add this entry to the `tool: {}` map after `create_pr` (before the map's closing brace):

```ts
      create_branch: tool({
        description:
          "Create (and by default switch to) a convention-validated git branch from type/id/description segments",
        args: {
          type: tool.schema
            .string()
            .describe(
              "Branch type — one of: feature, fix, hotfix, release, docs, chore, refactor (validated in-tool)",
            ),
          id: tool.schema
            .string()
            .optional()
            .describe("Optional task/ticket id, e.g. INC-212 (never rewritten)"),
          description: tool.schema
            .string()
            .describe(
              "Short plain-English or kebab-case description; whitespace becomes dashes",
            ),
          checkout: tool.schema
            .boolean()
            .optional()
            .describe("Switch to the new branch after creating it (default: true)"),
        },
        async execute(args, context) {
          const result = await createBranch({
            cwd: context.worktree ?? context.directory,
            type: args.type,
            id: args.id,
            description: args.description,
            checkout: args.checkout ?? true,
          })
          return JSON.stringify(result, null, 2)
        },
      }),
```

- [ ] **Step 4: Run wrapper + full commit-module tests to verify pass**

Run: `bun run vitest run tests/modules/commit/`
Expected: PASS — new wrapper suite green, existing `av_commit`/`create_pr` suites untouched.

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/index.ts tests/modules/commit/create-branch-wrapper.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): register create_branch plugin tool with plain-string type schema"
git log -1 --format=%B   # verify: no attribution trailer
```

---

### Task 5: Executor hook carve-outs (Stribog + Svarog) + hook tests + allowed-tools notes

**Files:**
- Modify: `src/modules/stribog/tool-budget-hook.ts` (one early-return beside the `create_pr` one, currently line 285)
- Modify: `src/modules/svarog/tool-budget-hook.ts` (one early-return beside the `create_pr` one, currently line 181)
- Modify: `src/modules/stribog/allowed-tools.ts` (comment-only note beside the existing `create_pr` note)
- Modify: `src/modules/svarog/allowed-tools.ts` (comment-only note beside the existing `create_pr` note, currently line 8)
- Test: `tests/modules/stribog/tool-budget-hook.test.ts`, `tests/modules/svarog/tool-budget-hook.test.ts` (append one case each)

**Interfaces:**
- Consumes: tool id `create_branch` (Task 4). The hooks' existing `norm` normalized id.
- Produces: attribution-gated allow for `create_branch` in both hooks (FR-9/FR-10).

**Hard constraints for this task:** C-2 (no behavior change to bash tripwires) and C-4 (do NOT touch `CORE_BUILTINS`, `STRIBOG_TOOLS`, `SVAROG_TOOLS` arrays — the notes are comments only). The D8 `GIT_DENIED` message redirect is explicitly deferred — do NOT edit any denial message in this task.

- [ ] **Step 1: Write the failing hook tests**

In `tests/modules/stribog/tool-budget-hook.test.ts`, directly after the existing `create_pr` carve-out test (`it("allows create_pr for a confirmed stribog session (publish-path carve-out)", …)`, currently line 358), add — reusing that file's existing `hook`, `STRIBOG`, `input`, `out` helpers exactly as the neighboring test does:

```ts
  it("allows create_branch for a confirmed stribog session (branch-path carve-out)", async () => {
    await expect(hook(STRIBOG)(input("create_branch"), out())).resolves.toBeUndefined()
    // case/hyphen normalization must not bypass the carve-out
    await expect(hook(STRIBOG)(input("Create-Branch"), out())).resolves.toBeUndefined()
    // floor regression guard: dispatch family stays denied
    await expect(hook(STRIBOG)(input("execute_recipe"), out())).rejects.toThrow(
      "STRIBOG_TOOL_DENIED",
    )
  })
```

In `tests/modules/svarog/tool-budget-hook.test.ts`, directly after the existing `create_pr` test (currently line 172), add — reusing that file's `allows`/`denies` helpers:

```ts
  it("allows create_branch — the sanctioned branch path — past the immutable floor", async () => {
    await allows("create_branch")
    await allows("Create-Branch") // normalization must not bypass the carve-out
    await denies("execute_recipe") // floor regression guard
  })
```

- [ ] **Step 2: Run both hook suites to verify the new cases fail**

Run: `bun run vitest run tests/modules/stribog/tool-budget-hook.test.ts tests/modules/svarog/tool-budget-hook.test.ts`
Expected: the two new cases FAIL (create_branch currently hits the `isImmutableDeny` floor → the hooks throw); every pre-existing case PASSES.

- [ ] **Step 3: Add the carve-outs**

In `src/modules/stribog/tool-budget-hook.ts`, immediately AFTER the existing `if (norm === "create_pr") return` (line 285) and BEFORE the `const denyKey = raw.toLowerCase()` line (287), insert:

```ts
      // create_branch — the sanctioned branch path (convention-validated, argv-only, no
      // shell; same-commit checkout — docs/specs/create-branch-tool-2.md §5.3). The bash
      // mutating-git tripwire (git checkout denial) is unchanged; this early-return only
      // lets the plugin tool through the `create_` verb of the isImmutableDeny floor
      // (step 3). Unbudgeted: not an edit/write tool.
      if (norm === "create_branch") return
```

In `src/modules/svarog/tool-budget-hook.ts`, immediately AFTER the existing `if (norm === "create_pr") return` (line 181) and BEFORE the step-4 floor (`if (isImmutableDeny(norm))`, line 186), insert:

```ts
      // create_branch — the sanctioned branch path (convention-validated, argv-only, no
      // shell; same-commit checkout — docs/specs/create-branch-tool-2.md §5.3). The bash
      // mutating-git tripwire is unchanged; this early-return only lets the plugin tool
      // through the `create_` verb of the isImmutableDeny floor (step 4).
      if (norm === "create_branch") return
```

In `src/modules/svarog/allowed-tools.ts`, directly below the existing line
`// create_pr is HOOK-allowed (publish-path carve-out in tool-budget-hook.ts), not listed here.` add:

```ts
// create_branch is HOOK-allowed (branch-path carve-out in tool-budget-hook.ts), not listed here.
```

In `src/modules/stribog/allowed-tools.ts`, find the analogous `create_pr` HOOK-allowed comment note (grep `create_pr`) and add the same one-line `create_branch` note directly below it.

- [ ] **Step 4: Run both hook suites + the locked invariants to verify pass**

Run: `bun run vitest run tests/modules/stribog/ tests/modules/svarog/`
Expected: PASS — including `metadata.test.ts` and `tools-sync.test.ts` unchanged (C-4/AC-14 evidence). Known environmental exception: the stribog `plugin.test.ts` opencode-go toast test fails on machines with opencode-go installed (pre-existing, unrelated — do not fix, mention it in your report if it fires).

- [ ] **Step 5: Commit**

```bash
git add src/modules/stribog/tool-budget-hook.ts src/modules/svarog/tool-budget-hook.ts \
        src/modules/stribog/allowed-tools.ts src/modules/svarog/allowed-tools.ts \
        tests/modules/stribog/tool-budget-hook.test.ts tests/modules/svarog/tool-budget-hook.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(hooks): allow create_branch past the immutable floor for attributed executors"
git log -1 --format=%B   # verify: no attribution trailer
```

---

### Task 6: Documentation + dist regeneration + full gate

**Files:**
- Modify: `src/commands/commit.md` (new section after `## Publishing: the create_pr tool`)
- Verify only (NO edit): `src/modules/stribog/stribog.md:10` and `src/modules/svarog/svarog.md:16` — the publish-path bullets ALREADY route branch creation/switching to `create_branch`; confirm both lines exist and leave them untouched.
- Regenerate: `dist/` (committed per repo convention)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–5.
- Produces: FR-11 docs; a green `bun run check` gate (AC-14).

- [ ] **Step 1: Add the commit.md section**

Append to `src/commands/commit.md` after the existing `## Publishing: the create_pr tool` section:

```markdown
## Branching: the `create_branch` tool

Create (and by default switch to) a convention-valid branch with the `create_branch` tool —
never with bash `git checkout -b` (blocked for executors) or hand-typed `git branch` names.

- Arguments: `type` (required — one of `feature`, `fix`, `hotfix`, `release`, `docs`,
  `chore`, `refactor`, case-sensitive), `id` (optional ticket id, e.g. `INC-212` — never
  rewritten), `description` (required — plain English is fine), `checkout` (optional,
  default `true`).
- The tool composes the name itself: `<type>/<id>-<description>` (or `<type>/<description>`
  without an id), collapsing description whitespace to dashes. `fix alert dialog` becomes
  `feature/INC-212-fix-alert-dialog` with `type: "feature", id: "INC-212"`.
- Validation is layered and fail-fast (zero git runs on invalid input): per-segment rules
  (charset `A–Z a–z 0–9 . _ -`, no leading dash/dot, no `--`, no `..`, no `.lock`/trailing-dot
  suffix), then whole-name rules including a single `/` and a 240-byte cap. Errors name the
  violated rule (`S1`–`S8`, `N1`–`N11`) so you can self-correct.
- Valid: `feature/INC-212-fix-alert-dialog`, `release/2026.07.21`, `chore/update-dependencies`.
  Invalid: `feat/x` (type not in list), `feature/fix--alert` (double hyphen),
  `feature/.hidden` (leading dot), an `id` with spaces (`INC 212` — pass `INC-212`).
- A failed checkout after a successful create returns `checkedOut: false` plus
  `checkoutError` — the branch exists; resolve the blocker and check out manually. Re-running
  the tool with the same segments fails with git's `already exists`.
```

- [ ] **Step 2: Verify the executor prompt bullets (no edit)**

Run: `grep -n "create_branch" src/modules/stribog/stribog.md src/modules/svarog/svarog.md`
Expected: one hit in each file (the existing publish-path bullet). If either is missing, STOP and report — do not author new prompt copy in this task.

- [ ] **Step 3: Regenerate dist and run the full gate**

```bash
bun run build:root
bun run check
```

Expected: build succeeds; typecheck + tests + build green. Known environmental exception: the stribog opencode-go toast test may fail on machines with opencode-go installed (pre-existing — report, don't fix).

- [ ] **Step 4: Commit docs + dist**

```bash
git add src/commands/commit.md dist/
AV_COMMIT_SKILL=1 git commit -m "docs(commit): document create_branch segmented usage and naming convention; sync dist"
git log -1 --format=%B   # verify: no attribution trailer
```

---

## Out of scope (do not implement)

- D8's `GIT_DENIED` denial-message redirect text (explicitly deferrable SHOULD; a follow-up).
- Version bump + tag (release flow per AGENTS.md).
- Branch deletion/renaming/remote ops, upstream tracking, QA/coordinator/pantheon.json changes.
- Any edit to `src/modules/_shared/mutating-git.ts` or the bash tripwires (C-2).

## Final verification (after Task 6)

- `bun run build:root && bun run check` green (modulo the known environmental stribog toast failure).
- `tests/modules/stribog/metadata.test.ts` and `tests/modules/stribog/tools-sync.test.ts` pass byte-unchanged (AC-14).
- Spec AC map: AC-1 (Task 1 vectors + Task 2 zero-git) · AC-2..AC-6 (Task 2) · AC-7..AC-10 (Task 3) · AC-11/AC-12 (Task 5) · AC-13 (Task 4) · AC-14 (Task 5 Step 4 + Task 6 Step 3).
