import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { VELES_AGENT_KEY } from "./veles.metadata.js";
const ALLOWED_DIRECTORIES = ["docs/specs", "docs/plans"];
const PROTECTED_DIRECTORIES = [...ALLOWED_DIRECTORIES, "docs/.veles-approvals"];
const MAX_SUFFIX = 1e3;
function isWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === "" || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function normalizedRelativePath(worktree, absolutePath) {
  return path.relative(worktree, absolutePath).split(path.sep).join("/");
}
function hasTraversalSegment(value) {
  return value.split(/[\\/]/).some((segment) => segment === "." || segment === "..");
}
function hasValidBaseName(baseName) {
  return baseName.length > 0 && !baseName.startsWith(".") && !baseName.includes("..") && !/[\\/]/.test(baseName);
}
function resolveAllowedPath(worktree, candidate) {
  const absoluteWorktree = path.resolve(worktree);
  const absoluteCandidate = path.resolve(absoluteWorktree, candidate);
  for (const directory of ALLOWED_DIRECTORIES) {
    const lexicalDirectory = path.resolve(absoluteWorktree, directory);
    if (!isWithin(lexicalDirectory, absoluteCandidate)) continue;
    try {
      const canonicalDirectory = realpathSync(lexicalDirectory);
      const canonicalParent = realpathSync(path.dirname(absoluteCandidate));
      if (isWithin(canonicalDirectory, canonicalParent)) return absoluteCandidate;
    } catch {
      return void 0;
    }
  }
  return void 0;
}
function openTrustedParentDirectory(worktree, absolutePath) {
  const absoluteWorktree = path.resolve(worktree);
  const lexicalDirectory = ALLOWED_DIRECTORIES.map(
    (directory) => path.resolve(absoluteWorktree, directory)
  ).find((directory) => isWithin(directory, absolutePath));
  if (lexicalDirectory === void 0) return void 0;
  try {
    const canonicalDirectory = realpathSync(lexicalDirectory);
    const parentPath = path.dirname(absolutePath);
    const descriptor = openSync(
      parentPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      const canonicalParent = realpathSync(parentPath);
      if (!fstatSync(descriptor).isDirectory() || !isWithin(canonicalDirectory, canonicalParent)) {
        closeSync(descriptor);
        return void 0;
      }
      return { descriptor, canonicalPath: canonicalParent };
    } catch {
      closeSync(descriptor);
      return void 0;
    }
  } catch {
    return void 0;
  }
}
function verifiesNoFollowFileDescriptor(descriptor, absolutePath, canonicalParent) {
  try {
    const opened = fstatSync(descriptor);
    const named = lstatSync(absolutePath);
    return opened.isFile() && !named.isSymbolicLink() && opened.dev === named.dev && opened.ino === named.ino && realpathSync(path.dirname(absolutePath)) === canonicalParent;
  } catch {
    return false;
  }
}
function resolveProtectedPath(worktree, candidate) {
  const absoluteWorktree = path.resolve(worktree);
  const absoluteCandidate = path.resolve(absoluteWorktree, candidate);
  return PROTECTED_DIRECTORIES.some(
    (directory) => isWithin(path.resolve(absoluteWorktree, directory), absoluteCandidate)
  );
}
function forbiddenResult(agent) {
  if (agent === VELES_AGENT_KEY) return void 0;
  return {
    status: "forbidden",
    reason: "planning artifact tools are restricted to Veles - Planner"
  };
}
function createPlanningArtifactPathService(deps) {
  const reservations = /* @__PURE__ */ new Map();
  function reservationsFor(sessionID) {
    let sessionReservations = reservations.get(sessionID);
    if (sessionReservations === void 0) {
      sessionReservations = /* @__PURE__ */ new Set();
      reservations.set(sessionID, sessionReservations);
    }
    return sessionReservations;
  }
  return {
    async reserve(args, context) {
      const forbidden = forbiddenResult(await deps.resolveAgent(context.sessionID));
      if (forbidden !== void 0) return forbidden;
      if (!hasValidBaseName(args.baseName)) {
        return { status: "error", reason: "baseName must be one safe filename segment" };
      }
      if (args.extension !== ".md") {
        return { status: "error", reason: "extension must be .md" };
      }
      if (hasTraversalSegment(args.directory)) {
        return { status: "error", reason: "directory must not contain traversal segments" };
      }
      for (let suffix = 1; suffix <= MAX_SUFFIX; suffix += 1) {
        const name = suffix === 1 ? args.baseName : `${args.baseName}-${suffix}`;
        const candidate = path.join(args.directory, `${name}${args.extension}`);
        const absolutePath = resolveAllowedPath(context.worktree, candidate);
        if (absolutePath === void 0) {
          return {
            status: "error",
            reason: "planning artifacts must be under docs/specs or docs/plans"
          };
        }
        const trustedParent = openTrustedParentDirectory(context.worktree, absolutePath);
        if (trustedParent === void 0) {
          return {
            status: "error",
            reason: "planning artifacts must be under docs/specs or docs/plans"
          };
        }
        try {
          const descriptor = openSync(
            absolutePath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
          );
          try {
            if (!verifiesNoFollowFileDescriptor(descriptor, absolutePath, trustedParent.canonicalPath)) {
              return { status: "error", reason: "could not reserve planning artifact path" };
            }
          } finally {
            closeSync(descriptor);
          }
          reservationsFor(context.sessionID).add(absolutePath);
          return {
            status: "ok",
            path: normalizedRelativePath(context.worktree, absolutePath)
          };
        } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            continue;
          }
          return { status: "error", reason: "could not reserve planning artifact path" };
        } finally {
          closeSync(trustedParent.descriptor);
        }
      }
      return { status: "error", reason: "no planning artifact suffix is available" };
    },
    async write(args, context) {
      const forbidden = forbiddenResult(await deps.resolveAgent(context.sessionID));
      if (forbidden !== void 0) return forbidden;
      const absolutePath = resolveAllowedPath(context.worktree, args.path);
      if (absolutePath === void 0) {
        return {
          status: "error",
          reason: "planning artifacts must be under docs/specs or docs/plans"
        };
      }
      const sessionReservations = reservations.get(context.sessionID);
      if (!sessionReservations?.has(absolutePath)) {
        return { status: "error", reason: "path is not reserved by this Veles session" };
      }
      const trustedParent = openTrustedParentDirectory(context.worktree, absolutePath);
      if (trustedParent === void 0) {
        return { status: "error", reason: "could not write reserved planning artifact" };
      }
      try {
        const descriptor = openSync(absolutePath, constants.O_RDWR | constants.O_NOFOLLOW);
        try {
          if (!verifiesNoFollowFileDescriptor(descriptor, absolutePath, trustedParent.canonicalPath) || fstatSync(descriptor).size !== 0) {
            return { status: "error", reason: "reserved path is no longer empty" };
          }
          writeFileSync(descriptor, args.content, "utf8");
        } finally {
          closeSync(descriptor);
        }
        sessionReservations.delete(absolutePath);
        if (sessionReservations.size === 0) reservations.delete(context.sessionID);
        return { status: "ok" };
      } catch {
        return { status: "error", reason: "could not write reserved planning artifact" };
      } finally {
        closeSync(trustedParent.descriptor);
      }
    }
  };
}
function makeVelesPlanningWriteGate(deps) {
  const worktree = deps.worktree ?? process.cwd();
  return async (input, output) => {
    if (input.tool.toLowerCase() !== "write") return;
    if (await deps.resolveAgent(input.sessionID) !== VELES_AGENT_KEY) return;
    const filePath = output.args.filePath ?? output.args.path;
    if (typeof filePath !== "string" || !resolveProtectedPath(worktree, filePath)) return;
    throw new Error(
      "Veles must write planning artifacts with veles_write_reserved_planning_artifact, not direct Write."
    );
  };
}
export {
  VELES_AGENT_KEY,
  createPlanningArtifactPathService,
  makeVelesPlanningWriteGate
};
