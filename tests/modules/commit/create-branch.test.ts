import { describe, expect, it } from "vitest"
import {
  BRANCH_TYPES,
  composeBranchName,
  validateBranchName,
  createBranch,
} from "../../../src/modules/commit/create-branch.js"
import type { GitResult, GitRunner } from "../../../src/modules/commit/controlled-commit.js"

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
    // N3 is unreachable for any caller: a leading-dash name's type part can never be in
    // BRANCH_TYPES, so N2's allow-list clause always fires first regardless of expectedType
    // (even for a JS caller passing an arbitrary value). The row asserts N2; N3 is retained
    // solely for spec §5.2.4 rule-ordering fidelity.
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
