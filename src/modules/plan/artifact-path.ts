import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import {
  PLANNING_ARTIFACT_DIRECTORIES,
  containsTraversalSegment,
  isWithin,
  verifiesNoFollowFileDescriptor,
} from "../_shared/artifact-path-safety.js"
import { VELES_AGENT_KEY } from "./veles.metadata.js"

export { VELES_AGENT_KEY }

const PROTECTED_DIRECTORIES = [...PLANNING_ARTIFACT_DIRECTORIES, "docs/.veles-approvals"]
const MAX_SUFFIX = 1000

export interface ReservePlanningPathArgs {
  directory: string
  baseName: string
  extension: string
}

export interface WritePlanningArtifactArgs {
  path: string
  content: string
}

export interface PlanningArtifactContext {
  sessionID: string
  worktree: string
}

export interface PlanningArtifactPathServiceDeps {
  resolveAgent: (sessionID: string) => Promise<string | undefined>
}

export interface VelesPlanningWriteGateDeps {
  resolveAgent: (sessionID: string) => Promise<string | undefined>
  worktree?: string
}

export interface VelesPlanningWriteGateInput {
  tool: string
  sessionID: string
}

export interface VelesPlanningWriteGateOutput {
  args: {
    filePath?: unknown
    path?: unknown
  }
}

type ArtifactPathResult =
  | { status: "ok"; path: string }
  | { status: "forbidden"; reason: string }
  | { status: "error"; reason: string }

type ArtifactWriteResult =
  | { status: "ok" }
  | { status: "forbidden"; reason: string }
  | { status: "error"; reason: string }

interface TrustedParentDirectory {
  descriptor: number
  canonicalPath: string
}

function normalizedRelativePath(worktree: string, absolutePath: string): string {
  return path.relative(worktree, absolutePath).split(path.sep).join("/")
}

function hasValidBaseName(baseName: string): boolean {
  return (
    baseName.length > 0 &&
    !baseName.startsWith(".") &&
    !baseName.includes("..") &&
    !/[\\/]/.test(baseName)
  )
}

function resolveAllowedPath(worktree: string, candidate: string): string | undefined {
  const absoluteWorktree = path.resolve(worktree)
  const absoluteCandidate = path.resolve(absoluteWorktree, candidate)

  for (const directory of PLANNING_ARTIFACT_DIRECTORIES) {
    const lexicalDirectory = path.resolve(absoluteWorktree, directory)
    if (!isWithin(lexicalDirectory, absoluteCandidate)) continue

    try {
      const canonicalDirectory = realpathSync(lexicalDirectory)
      const canonicalParent = realpathSync(path.dirname(absoluteCandidate))
      if (isWithin(canonicalDirectory, canonicalParent)) return absoluteCandidate
    } catch {
      return undefined
    }
  }

  return undefined
}

function openTrustedParentDirectory(
  worktree: string,
  absolutePath: string,
): TrustedParentDirectory | undefined {
  const absoluteWorktree = path.resolve(worktree)
  const lexicalDirectory = PLANNING_ARTIFACT_DIRECTORIES.map((directory: string): string =>
    path.resolve(absoluteWorktree, directory),
  ).find((directory: string): boolean => isWithin(directory, absolutePath))
  if (lexicalDirectory === undefined) return undefined

  try {
    const canonicalDirectory = realpathSync(lexicalDirectory)
    const parentPath = path.dirname(absolutePath)
    const descriptor = openSync(
      parentPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      const canonicalParent = realpathSync(parentPath)
      if (!fstatSync(descriptor).isDirectory() || !isWithin(canonicalDirectory, canonicalParent)) {
        closeSync(descriptor)
        return undefined
      }
      return { descriptor, canonicalPath: canonicalParent }
    } catch {
      closeSync(descriptor)
      return undefined
    }
  } catch {
    return undefined
  }
}

function resolveProtectedPath(worktree: string, candidate: string): boolean {
  const absoluteWorktree = path.resolve(worktree)
  const absoluteCandidate = path.resolve(absoluteWorktree, candidate)
  return PROTECTED_DIRECTORIES.some((directory) =>
    isWithin(path.resolve(absoluteWorktree, directory), absoluteCandidate),
  )
}

function forbiddenResult(agent: string | undefined): ArtifactPathResult | undefined {
  if (agent === VELES_AGENT_KEY) return undefined
  return {
    status: "forbidden",
    reason: "planning artifact tools are restricted to Veles - Planner",
  }
}

/**
 * Creates the session-scoped reservation service used by Veles's planning
 * artifact tools. A successful reservation is an empty file created with `wx`,
 * so concurrent planners cannot choose the same durable path.
 */
export function createPlanningArtifactPathService(
  deps: PlanningArtifactPathServiceDeps,
): {
  reserve: (
    args: ReservePlanningPathArgs,
    context: PlanningArtifactContext,
  ) => Promise<ArtifactPathResult>
  write: (
    args: WritePlanningArtifactArgs,
    context: PlanningArtifactContext,
  ) => Promise<ArtifactWriteResult>
} {
  const reservations = new Map<string, Set<string>>()

  function reservationsFor(sessionID: string): Set<string> {
    let sessionReservations = reservations.get(sessionID)
    if (sessionReservations === undefined) {
      sessionReservations = new Set<string>()
      reservations.set(sessionID, sessionReservations)
    }
    return sessionReservations
  }

  return {
    async reserve(
      args: ReservePlanningPathArgs,
      context: PlanningArtifactContext,
    ): Promise<ArtifactPathResult> {
      const forbidden = forbiddenResult(await deps.resolveAgent(context.sessionID))
      if (forbidden !== undefined) return forbidden

      if (!hasValidBaseName(args.baseName)) {
        return { status: "error", reason: "baseName must be one safe filename segment" }
      }
      if (args.extension !== ".md") {
        return { status: "error", reason: "extension must be .md" }
      }
      const directory = args.directory.replace(/[\\/]+$/, "")
      if (containsTraversalSegment(directory)) {
        return { status: "error", reason: "directory must not contain traversal segments" }
      }

      for (let suffix = 1; suffix <= MAX_SUFFIX; suffix += 1) {
        const name = suffix === 1 ? args.baseName : `${args.baseName}-${suffix}`
        const candidate = path.join(directory, `${name}${args.extension}`)
        const absolutePath = resolveAllowedPath(context.worktree, candidate)
        if (absolutePath === undefined) {
          return {
            status: "error",
            reason: "planning artifacts must be under docs/specs or docs/plans",
          }
        }

        const trustedParent = openTrustedParentDirectory(context.worktree, absolutePath)
        if (trustedParent === undefined) {
          return {
            status: "error",
            reason: "planning artifacts must be under docs/specs or docs/plans",
          }
        }
        try {
          const descriptor = openSync(
            absolutePath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          )
          try {
            if (!verifiesNoFollowFileDescriptor(descriptor, absolutePath, trustedParent.canonicalPath)) {
              return { status: "error", reason: "could not reserve planning artifact path" }
            }
          } finally {
            closeSync(descriptor)
          }
          reservationsFor(context.sessionID).add(absolutePath)
          return {
            status: "ok",
            path: normalizedRelativePath(context.worktree, absolutePath),
          }
        } catch (error: unknown) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            continue
          }
          return { status: "error", reason: "could not reserve planning artifact path" }
        } finally {
          closeSync(trustedParent.descriptor)
        }
      }

      return { status: "error", reason: "no planning artifact suffix is available" }
    },

    async write(
      args: WritePlanningArtifactArgs,
      context: PlanningArtifactContext,
    ): Promise<ArtifactWriteResult> {
      const forbidden = forbiddenResult(await deps.resolveAgent(context.sessionID))
      if (forbidden !== undefined) return forbidden

      const absolutePath = resolveAllowedPath(context.worktree, args.path)
      if (absolutePath === undefined) {
        return {
          status: "error",
          reason: "planning artifacts must be under docs/specs or docs/plans",
        }
      }
      const sessionReservations = reservations.get(context.sessionID)
      if (!sessionReservations?.has(absolutePath)) {
        return { status: "error", reason: "path is not reserved by this Veles session" }
      }

      const trustedParent = openTrustedParentDirectory(context.worktree, absolutePath)
      if (trustedParent === undefined) {
        return { status: "error", reason: "could not write reserved planning artifact" }
      }
      try {
        const descriptor = openSync(absolutePath, constants.O_RDWR | constants.O_NOFOLLOW)
        try {
          if (
            !verifiesNoFollowFileDescriptor(descriptor, absolutePath, trustedParent.canonicalPath) ||
            fstatSync(descriptor).size !== 0
          ) {
            return { status: "error", reason: "reserved path is no longer empty" }
          }
          writeFileSync(descriptor, args.content, "utf8")
        } finally {
          closeSync(descriptor)
        }
        sessionReservations.delete(absolutePath)
        if (sessionReservations.size === 0) reservations.delete(context.sessionID)
        return { status: "ok" }
      } catch {
        return { status: "error", reason: "could not write reserved planning artifact" }
      } finally {
        closeSync(trustedParent.descriptor)
      }
    },
  }
}

/** Defense-in-depth gate for native Write calls Veles must route through the reservation tool. */
export function makeVelesPlanningWriteGate(
  deps: VelesPlanningWriteGateDeps,
): (
  input: VelesPlanningWriteGateInput,
  output: VelesPlanningWriteGateOutput,
) => Promise<void> {
  const worktree = deps.worktree ?? process.cwd()

  return async (input: VelesPlanningWriteGateInput, output: VelesPlanningWriteGateOutput): Promise<void> => {
    if (input.tool.toLowerCase() !== "write") return
    if ((await deps.resolveAgent(input.sessionID)) !== VELES_AGENT_KEY) return

    const filePath = output.args.filePath ?? output.args.path
    if (typeof filePath !== "string" || !resolveProtectedPath(worktree, filePath)) return

    throw new Error(
      "Veles must write planning artifacts with veles_write_reserved_planning_artifact, not direct Write.",
    )
  }
}
