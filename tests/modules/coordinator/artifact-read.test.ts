import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { COORDINATOR_AGENT } from "../../../src/modules/agent-roster/index.js"
import { canonicalPlanningArtifactDigest } from "../../../src/modules/coordinator/artifact-digest.js"
import { readVerifiedPlanningArtifact } from "../../../src/modules/coordinator/artifact-read.js"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"

const temporaryDirectories: string[] = []

function createWorktree(): string {
  const worktree = mkdtempSync(path.join(tmpdir(), "artifact-read-"))
  mkdirSync(path.join(worktree, "docs/specs"), { recursive: true })
  mkdirSync(path.join(worktree, "docs/plans"), { recursive: true })
  mkdirSync(path.join(worktree, "docs/.veles-approvals"), { recursive: true })
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

function artifactContent(title: string): string {
  return `---\ntitle: ${title}\n---\n\n# Artifact\n`
}

function writeVerifiedArtifact(worktree: string, relativePath: string, content: string): void {
  writeFileSync(path.join(worktree, relativePath), content, "utf8")
  const sidecarName = createHash("sha256").update(relativePath, "utf8").digest("hex")
  writeFileSync(
    path.join(worktree, "docs/.veles-approvals", `${sidecarName}.json`),
    JSON.stringify({
      approvedAt: "2026-07-15T00:00:00.000Z",
      approvedBySession: "perun-session",
      canonicalDigest: canonicalPlanningArtifactDigest(content),
      path: relativePath,
    }),
    "utf8",
  )
}

afterEach((): void => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("readVerifiedPlanningArtifact", () => {
  it("returns content when the artifact digest matches its approval sidecar", () => {
    const worktree = createWorktree()
    const content = artifactContent("Verified plan")
    writeVerifiedArtifact(worktree, "docs/plans/verified.md", content)

    const result = withWorktree(worktree, () =>
      readVerifiedPlanningArtifact("docs/plans/verified.md"),
    )

    expect(result).toEqual({ status: "ok", content })
  })

  it("rejects an artifact changed after approval", () => {
    const worktree = createWorktree()
    const original = artifactContent("Approved plan")
    writeVerifiedArtifact(worktree, "docs/plans/tampered.md", original)
    writeFileSync(
      path.join(worktree, "docs/plans/tampered.md"),
      artifactContent("Tampered plan"),
      "utf8",
    )

    const result = withWorktree(worktree, () =>
      readVerifiedPlanningArtifact("docs/plans/tampered.md"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("rejects an artifact without an approval sidecar", () => {
    const worktree = createWorktree()
    writeFileSync(
      path.join(worktree, "docs/specs/unapproved.md"),
      artifactContent("Unapproved spec"),
      "utf8",
    )

    const result = withWorktree(worktree, () =>
      readVerifiedPlanningArtifact("docs/specs/unapproved.md"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("rejects traversal paths", () => {
    const worktree = createWorktree()
    const result = withWorktree(worktree, () =>
      readVerifiedPlanningArtifact("docs/plans/../plans/verified.md"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("denies direct Veles calls to the coordinator-only tool", async () => {
    const hooks = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const readTool = hooks.tool?.read_verified_planning_artifact
    if (readTool === undefined) throw new Error("verified artifact reader tool not registered")

    const result = await readTool.execute(
      { path: "docs/plans/verified.md" },
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
