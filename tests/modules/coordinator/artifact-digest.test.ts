import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  AppVerkCoordinatorPlugin,
} from "../../../src/modules/coordinator/index.js"
import { COORDINATOR_AGENT } from "../../../src/modules/agent-roster/index.js"
import { getPlanningArtifactDigest } from "../../../src/modules/coordinator/artifact-digest.js"

const temporaryDirectories: string[] = []

function createWorktree(): string {
  const worktree = mkdtempSync(path.join(tmpdir(), "artifact-digest-"))
  mkdirSync(path.join(worktree, "docs/specs"), { recursive: true })
  mkdirSync(path.join(worktree, "docs/plans"), { recursive: true })
  temporaryDirectories.push(worktree)
  return worktree
}

function withWorktree<T>(worktree: string, action: () => T): T {
  const originalCwd = process.cwd()
  process.chdir(worktree)
  try {
    return action()
  } finally {
    process.chdir(originalCwd)
  }
}

function writeArtifact(worktree: string, relativePath: string, frontmatter: string): void {
  writeFileSync(
    path.join(worktree, relativePath),
    `---\n${frontmatter}\n---\n\n# Artifact\n`,
    "utf8",
  )
}

afterEach((): void => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("getPlanningArtifactDigest", () => {
  it("returns a SHA-256 digest for a planning artifact", () => {
    const worktree = createWorktree()
    writeArtifact(worktree, "docs/specs/feature.md", "title: Feature")

    const result = withWorktree(worktree, () =>
      getPlanningArtifactDigest("docs/specs/feature.md"),
    )

    expect(result).toMatchObject({ status: "ok" })
    if (result.status === "ok") expect(result.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects traversal outside planning artifact directories", () => {
    const worktree = createWorktree()
    writeArtifact(worktree, "docs/specs/feature.md", "title: Feature")

    const result = withWorktree(worktree, () =>
      getPlanningArtifactDigest("docs/specs/../specs/feature.md"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("rejects symlink escapes", () => {
    const worktree = createWorktree()
    const outside = path.join(worktree, "outside.md")
    writeFileSync(outside, "---\ntitle: Escape\n---\n", "utf8")
    symlinkSync(outside, path.join(worktree, "docs/specs/escape.md"))

    const result = withWorktree(worktree, () =>
      getPlanningArtifactDigest("docs/specs/escape.md"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("ignores approved_file_digest when canonicalizing", () => {
    const worktree = createWorktree()
    writeArtifact(
      worktree,
      "docs/plans/one.md",
      [
        "approved: false",
        "approved_at: first",
        "approved_by_session: first-session",
        "approved_file_digest: first",
        "title: Plan",
      ].join("\n"),
    )
    writeArtifact(
      worktree,
      "docs/plans/two.md",
      [
        "title: Plan",
        "approved_file_digest: second",
        "approved_by_session: second-session",
        "approved_at: second",
        "approved: true",
      ].join("\n"),
    )

    const [first, second] = withWorktree(worktree, () => [
      getPlanningArtifactDigest("docs/plans/one.md"),
      getPlanningArtifactDigest("docs/plans/two.md"),
    ])

    expect(first).toMatchObject({ status: "ok" })
    expect(second).toMatchObject({ status: "ok" })
    if (first.status === "ok" && second.status === "ok") {
      expect(first.digest).toBe(second.digest)
    }
  })

  it("rejects duplicate frontmatter keys", () => {
    const worktree = createWorktree()
    writeArtifact(worktree, "docs/specs/duplicate.md", "title: One\ntitle: Two")

    const result = withWorktree(worktree, () =>
      getPlanningArtifactDigest("docs/specs/duplicate.md"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("rejects malformed frontmatter delimiters", () => {
    const worktree = createWorktree()
    writeFileSync(
      path.join(worktree, "docs/specs/malformed.md"),
      "---\ntitle: Feature\n...\n\n# Artifact\n",
      "utf8",
    )

    const result = withWorktree(worktree, () =>
      getPlanningArtifactDigest("docs/specs/malformed.md"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("denies direct Veles calls to the coordinator-only tool", async () => {
    const hooks = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const digestTool = hooks.tool?.get_planning_artifact_digest
    if (digestTool === undefined) throw new Error("digest tool not registered")

    const result = await digestTool.execute(
      { path: "docs/specs/feature.md" },
      {
        agent: "Veles - Planner",
        sessionID: "veles-session",
        messageID: "message-1",
        directory: "/tmp",
        worktree: "/tmp",
        abort: new AbortController().signal,
        metadata: (): void => undefined,
        ask: async (): Promise<void> => undefined,
      },
    )

    const output = typeof result === "string" ? result : result.output
    expect(JSON.parse(output)).toMatchObject({ status: "forbidden" })
    expect(COORDINATOR_AGENT).toBe("Perun - Coordinator")
  })
})
