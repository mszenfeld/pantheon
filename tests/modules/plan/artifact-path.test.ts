import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  VELES_AGENT_KEY,
  createPlanningArtifactPathService,
  makeVelesPlanningWriteGate,
} from "../../../src/modules/plan/artifact-path.js"

const temporaryDirectories: string[] = []

function createWorktree(): string {
  const worktree = mkdtempSync(path.join(tmpdir(), "veles-artifact-path-"))
  mkdirSync(path.join(worktree, "docs/specs"), { recursive: true })
  mkdirSync(path.join(worktree, "docs/plans"), { recursive: true })
  temporaryDirectories.push(worktree)
  return worktree
}

function createService(agent: string = VELES_AGENT_KEY) {
  return createPlanningArtifactPathService({
    resolveAgent: async (): Promise<string> => agent,
  })
}

afterEach((): void => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("planning artifact path reservation", () => {
  it("reserves the base path when it is free", async () => {
    const worktree = createWorktree()
    const result = await createService().reserve(
      { directory: "docs/specs", baseName: "feature-spec", extension: ".md" },
      { sessionID: "veles-1", worktree },
    )

    expect(result).toEqual({ status: "ok", path: "docs/specs/feature-spec.md" })
  })

  it("uses a suffix after a collision and for concurrent reservations", async () => {
    const worktree = createWorktree()
    writeFileSync(path.join(worktree, "docs/plans/feature-plan.md"), "existing")
    const service = createService()

    const collision = await service.reserve(
      { directory: "docs/plans", baseName: "feature-plan", extension: ".md" },
      { sessionID: "veles-1", worktree },
    )
    const concurrent = await Promise.all(
      ["veles-2", "veles-3"].map((sessionID) =>
        service.reserve(
          { directory: "docs/plans", baseName: "parallel-plan", extension: ".md" },
          { sessionID, worktree },
        ),
      ),
    )

    expect(collision).toEqual({ status: "ok", path: "docs/plans/feature-plan-2.md" })
    const concurrentPaths = concurrent.map((result) => {
      if (result.status !== "ok") throw new Error("concurrent reservation failed")
      return result.path
    })
    expect(new Set(concurrentPaths)).toEqual(
      new Set(["docs/plans/parallel-plan.md", "docs/plans/parallel-plan-2.md"]),
    )
  })

  it("rejects invalid directories, traversal, filenames, extensions, and callers", async () => {
    const worktree = createWorktree()
    const service = createService()
    const validContext = { sessionID: "veles-1", worktree }

    await expect(
      service.reserve(
        { directory: "docs/other", baseName: "artifact", extension: ".md" },
        validContext,
      ),
    ).resolves.toMatchObject({ status: "error" })
    await expect(
      service.reserve(
        { directory: "docs/specs/../plans", baseName: "artifact", extension: ".md" },
        validContext,
      ),
    ).resolves.toMatchObject({ status: "error" })
    await expect(
      service.reserve(
        { directory: "docs/specs", baseName: "../artifact", extension: ".md" },
        validContext,
      ),
    ).resolves.toMatchObject({ status: "error" })
    await expect(
      service.reserve(
        { directory: "docs/specs", baseName: ".artifact", extension: ".md" },
        validContext,
      ),
    ).resolves.toMatchObject({ status: "error" })
    await expect(
      service.reserve(
        { directory: "docs/specs", baseName: "artifact", extension: ".txt" },
        validContext,
      ),
    ).resolves.toMatchObject({ status: "error" })
    await expect(
      createService("Perun - Coordinator").reserve(
        { directory: "docs/specs", baseName: "artifact", extension: ".md" },
        validContext,
      ),
    ).resolves.toMatchObject({ status: "forbidden" })
  })

  it("writes only the same session's empty reservation once", async () => {
    const worktree = createWorktree()
    const service = createService()
    const reservation = await service.reserve(
      { directory: "docs/specs", baseName: "feature-spec", extension: ".md" },
      { sessionID: "veles-1", worktree },
    )
    if (reservation.status !== "ok") throw new Error("reservation failed")

    await expect(
      service.write(
        { path: reservation.path, content: "# Feature spec\n" },
        { sessionID: "veles-1", worktree },
      ),
    ).resolves.toEqual({ status: "ok" })
    expect(readFileSync(path.join(worktree, reservation.path), "utf8")).toBe(
      "# Feature spec\n",
    )
    await expect(
      service.write(
        { path: reservation.path, content: "# Changed\n" },
        { sessionID: "veles-1", worktree },
      ),
    ).resolves.toMatchObject({ status: "error" })
  })

  it("rejects a reserved artifact after its parent directory is swapped for a symlink", async () => {
    const worktree = createWorktree()
    const outside = mkdtempSync(path.join(tmpdir(), "veles-artifact-outside-"))
    temporaryDirectories.push(outside)
    const service = createService()
    const reservation = await service.reserve(
      { directory: "docs/specs", baseName: "feature-spec", extension: ".md" },
      { sessionID: "veles-1", worktree },
    )
    if (reservation.status !== "ok") throw new Error("reservation failed")
    writeFileSync(path.join(outside, "feature-spec.md"), "outside")
    renameSync(path.join(worktree, "docs/specs"), path.join(worktree, "docs/specs-original"))
    symlinkSync(outside, path.join(worktree, "docs/specs"))

    await expect(
      service.write(
        { path: reservation.path, content: "# Must not escape\n" },
        { sessionID: "veles-1", worktree },
      ),
    ).resolves.toMatchObject({ status: "error" })
    expect(readFileSync(path.join(outside, "feature-spec.md"), "utf8")).toBe("outside")
  })

  it("rejects unreserved paths and paths reserved by another Veles session", async () => {
    const worktree = createWorktree()
    const service = createService()
    const reservation = await service.reserve(
      { directory: "docs/plans", baseName: "feature-plan", extension: ".md" },
      { sessionID: "veles-1", worktree },
    )
    if (reservation.status !== "ok") throw new Error("reservation failed")

    await expect(
      service.write(
        { path: "docs/plans/unreserved.md", content: "# Plan\n" },
        { sessionID: "veles-1", worktree },
      ),
    ).resolves.toMatchObject({ status: "error" })
    await expect(
      service.write(
        { path: reservation.path, content: "# Plan\n" },
        { sessionID: "veles-2", worktree },
      ),
    ).resolves.toMatchObject({ status: "error" })
  })

  it("rejects Veles direct Write calls to protected planning paths", async () => {
    const worktree = createWorktree()
    const gate = makeVelesPlanningWriteGate({
      resolveAgent: async (): Promise<string> => VELES_AGENT_KEY,
      worktree,
    })

    for (const protectedPath of [
      "docs/specs/direct.md",
      "docs/plans/direct.md",
      "docs/.veles-approvals/direct.json",
    ]) {
      await expect(
        gate(
          { tool: "Write", sessionID: "veles-1" },
          { args: { filePath: path.join(worktree, protectedPath) } },
        ),
      ).rejects.toThrow("veles_write_reserved_planning_artifact")
    }
    await expect(
      gate(
        { tool: "write", sessionID: "veles-1" },
        { args: { filePath: path.join(worktree, "README.md") } },
      ),
    ).resolves.toBeUndefined()
  })
})
