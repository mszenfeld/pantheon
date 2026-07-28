import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { COORDINATOR_AGENT } from "../../../src/modules/agent-roster/index.js"
import { approvePlanningArtifact } from "../../../src/modules/coordinator/artifact-approval.js"
import { canonicalPlanningArtifactDigest } from "../../../src/modules/coordinator/artifact-digest.js"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"

const temporaryDirectories: string[] = []

function createWorktree(): string {
  const worktree = mkdtempSync(path.join(tmpdir(), "artifact-approval-"))
  mkdirSync(path.join(worktree, "docs/specs"), { recursive: true })
  mkdirSync(path.join(worktree, "docs/plans"), { recursive: true })
  temporaryDirectories.push(worktree)
  return worktree
}

async function withWorktree<T>(worktree: string, action: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd()
  process.chdir(worktree)
  try {
    return await action()
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

function digestArtifact(worktree: string, relativePath: string): string {
  return canonicalPlanningArtifactDigest(readFileSync(path.join(worktree, relativePath), "utf8"))
}

afterEach((): void => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("approvePlanningArtifact", () => {
  it("rejects traversal", async () => {
    const worktree = createWorktree()
    writeArtifact(worktree, "docs/specs/feature.md", "title: Feature")

    const result = await withWorktree(worktree, () =>
      approvePlanningArtifact("docs/specs/../specs/feature.md", "digest", "session-1"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("rejects files outside the approved directories", async () => {
    const worktree = createWorktree()
    writeFileSync(path.join(worktree, "outside.md"), "---\ntitle: Outside\n---\n", "utf8")

    const result = await withWorktree(worktree, () =>
      approvePlanningArtifact("outside.md", "digest", "session-1"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("rejects symlink escapes", async () => {
    const worktree = createWorktree()
    const outside = path.join(worktree, "outside.md")
    writeFileSync(outside, "---\ntitle: Escape\n---\n", "utf8")
    symlinkSync(outside, path.join(worktree, "docs/specs/escape.md"))

    const result = await withWorktree(worktree, () =>
      approvePlanningArtifact("docs/specs/escape.md", "digest", "session-1"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("rejects an artifact whose parent is swapped for a symlink before approval", async () => {
    const worktree = createWorktree()
    const outside = mkdtempSync(path.join(tmpdir(), "artifact-approval-outside-"))
    temporaryDirectories.push(outside)
    writeArtifact(worktree, "docs/specs/feature.md", "title: Feature")
    writeArtifact(outside, "feature.md", "title: Outside")
    renameSync(path.join(worktree, "docs/specs"), path.join(worktree, "docs/specs-original"))
    symlinkSync(outside, path.join(worktree, "docs/specs"))

    const result = await withWorktree(worktree, () =>
      approvePlanningArtifact("docs/specs/feature.md", digestArtifact(outside, "feature.md"), "session-1"),
    )

    expect(result).toMatchObject({ status: "error" })
    expect(readFileSync(path.join(outside, "feature.md"), "utf8")).not.toContain("approved: true")
  })

  it("rejects an approval directory symlink without writing a sidecar outside the worktree", async () => {
    const worktree = createWorktree()
    const outside = mkdtempSync(path.join(tmpdir(), "artifact-approval-sidecars-"))
    temporaryDirectories.push(outside)
    const artifactPath = "docs/specs/feature.md"
    writeArtifact(worktree, artifactPath, "title: Feature")
    symlinkSync(outside, path.join(worktree, "docs/.veles-approvals"))

    const result = await withWorktree(worktree, () =>
      approvePlanningArtifact(artifactPath, digestArtifact(worktree, artifactPath), "session-1"),
    )

    expect(result).toMatchObject({ status: "error" })
    expect(readdirSync(outside)).toEqual([])
  })

  it("rejects a stale approval digest", async () => {
    const worktree = createWorktree()
    writeArtifact(worktree, "docs/specs/feature.md", "title: Feature")

    const result = await withWorktree(worktree, () =>
      approvePlanningArtifact("docs/specs/feature.md", "0".repeat(64), "session-1"),
    )

    expect(result).toMatchObject({ status: "error" })
  })

  it("rejects malformed and duplicate frontmatter", async () => {
    const worktree = createWorktree()
    writeArtifact(worktree, "docs/specs/malformed.md", "title: One\ntitle: Two")
    writeFileSync(path.join(worktree, "docs/specs/no-frontmatter.md"), "# No frontmatter\n", "utf8")

    const results = await withWorktree(worktree, async () =>
      Promise.all([
        approvePlanningArtifact("docs/specs/malformed.md", "digest", "session-1"),
        approvePlanningArtifact("docs/specs/no-frontmatter.md", "digest", "session-1"),
      ]),
    )

    expect(results).toEqual([
      expect.objectContaining({ status: "error" }),
      expect.objectContaining({ status: "error" }),
    ])
  })

  it("writes approval metadata and an immutable sidecar", async () => {
    const worktree = createWorktree()
    const artifactPath = "docs/plans/feature.md"
    writeArtifact(worktree, artifactPath, "title: Feature")
    const digest = digestArtifact(worktree, artifactPath)

    const result = await withWorktree(worktree, () =>
      approvePlanningArtifact(artifactPath, digest, "session-1"),
    )

    expect(result).toMatchObject({ status: "ok", approvedFileDigest: digest })
    const artifact = readFileSync(path.join(worktree, artifactPath), "utf8")
    expect(artifact).toContain("approved: true")
    expect(artifact).toContain("approved_by_session: session-1")
    expect(artifact).toMatch(/approved_at: .+/)
    const approvalDirectory = path.join(worktree, "docs/.veles-approvals")
    const sidecars = readdirSync(approvalDirectory)
    expect(sidecars).toHaveLength(1)
    const sidecar = JSON.parse(readFileSync(path.join(approvalDirectory, sidecars[0] ?? ""), "utf8"))
    expect(sidecar).toMatchObject({
      approvedBySession: "session-1",
      canonicalDigest: digest,
      path: artifactPath,
    })
  })

  it("detects a tampered artifact through its sidecar digest", async () => {
    const worktree = createWorktree()
    const artifactPath = "docs/plans/feature.md"
    writeArtifact(worktree, artifactPath, "title: Feature")
    const digest = digestArtifact(worktree, artifactPath)

    await withWorktree(worktree, () => approvePlanningArtifact(artifactPath, digest, "session-1"))
    writeArtifact(worktree, artifactPath, "title: Tampered")

    const sidecarName = `${createHash("sha256").update(artifactPath, "utf8").digest("hex")}.json`
    const sidecar = JSON.parse(
      readFileSync(path.join(worktree, "docs/.veles-approvals", sidecarName), "utf8"),
    )
    expect(digestArtifact(worktree, artifactPath)).not.toBe(sidecar.canonicalDigest)
  })

  it("allows exactly one of concurrent duplicate approvals", async () => {
    const worktree = createWorktree()
    const artifactPath = "docs/specs/feature.md"
    writeArtifact(worktree, artifactPath, "title: Feature")
    const digest = digestArtifact(worktree, artifactPath)

    const results = await Promise.all(
      ["session-1", "session-2"].map(async (sessionId: string) =>
        withWorktree(worktree, () => approvePlanningArtifact(artifactPath, digest, sessionId)),
      ),
    )

    expect(results.filter((result) => result.status === "ok")).toHaveLength(1)
    expect(results.filter((result) => result.status === "error")).toHaveLength(1)
  })

  it("denies direct Veles calls to the coordinator-only tool", async () => {
    const hooks = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const approvalTool = hooks.tool?.approve_planning_artifact
    if (approvalTool === undefined) throw new Error("approval tool not registered")

    const result = await approvalTool.execute(
      { path: "docs/specs/feature.md", preApprovalDigest: "digest" },
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
