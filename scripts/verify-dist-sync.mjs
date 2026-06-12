#!/usr/bin/env node
/**
 * Verifies that committed dist/ artifacts are in sync with src/.
 *
 * Two guarantees, both derived from a single source of truth (the
 * `workspaces` glob in package.json) so they cannot silently drift:
 *
 *  1. Manifest coverage. Every workspace package (discovered from the glob)
 *     must be wired into all four hand-maintained enumeration sites:
 *       - package.json `files[]` (ships in the published tarball),
 *       - `.gitignore` un-ignore rules (committed dist is intentional),
 *       - the `build:skill-utils` / `build:dependents` scripts (so the dist
 *         is actually rebuilt — `bun --filter` neither topo-orders nor honours
 *         `!` negation in the pinned version, so this split is enumerated),
 *       - the CI "Assert no dist drift" `git diff` backstop (when present).
 *     This replaces the old "remember to update all four places" convention
 *     with an enforced invariant: adding a workspace package without wiring it
 *     into every site fails this step loudly instead of silently dropping the
 *     package from the build / publish / CI path.
 *
 *  2. Build freshness. Runs `bun run build`, then fails if any tracked dist
 *     path has uncommitted changes — i.e. the committed artifacts no longer
 *     match what `src/` produces.
 *
 * The set of tracked dist paths is computed from the workspace membership
 * below, never hardcoded, so it stays correct as packages are added or
 * removed. Wired into CI as the `verify-dist` step of
 * `.github/workflows/ci.yml` (also runnable locally via `bun run
 * verify-dist`).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import path from "node:path"
import process from "node:process"

const repoRoot = process.cwd()

/** Read and parse package.json. */
function readPackageJson() {
  try {
    return JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"))
  } catch (err) {
    console.error(
      "Failed to read/parse package.json:",
      String(err?.message ?? err),
    )
    process.exit(1)
  }
}

/**
 * Resolve the `workspaces` globs (e.g. `packages/*`) into the workspace
 * packages — the single source of truth for the rest of this script. Each
 * entry carries the package's directory (relative to the repo root) and its
 * `name` from its own package.json. Only `<dir>/*` style globs are supported
 * (the only form used here); anything else fails loudly rather than guessing.
 */
function discoverWorkspaces(pkg) {
  const globs = pkg.workspaces ?? []
  if (!Array.isArray(globs) || globs.length === 0) {
    console.error(
      "package.json has no `workspaces` array; cannot derive dist paths.",
    )
    process.exit(1)
  }
  const workspaces = []
  for (const glob of globs) {
    const match = /^(.+)\/\*$/.exec(glob)
    if (!match) {
      console.error(
        `Unsupported workspace glob '${glob}'. Only '<dir>/*' is supported.`,
      )
      process.exit(1)
    }
    const base = match[1]
    let entries
    try {
      entries = readdirSync(path.join(repoRoot, base), { withFileTypes: true })
    } catch (err) {
      console.error(
        `Failed to read workspace base '${base}':`,
        String(err?.message ?? err),
      )
      process.exit(1)
    }
    for (const entry of entries) {
      const dir = `${base}/${entry.name}`
      const manifestPath = path.join(repoRoot, dir, "package.json")
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue
      let name
      try {
        name = JSON.parse(readFileSync(manifestPath, "utf8")).name
      } catch (err) {
        console.error(
          `Failed to read/parse ${dir}/package.json:`,
          String(err?.message ?? err),
        )
        process.exit(1)
      }
      if (typeof name !== "string" || name.length === 0) {
        console.error(`${dir}/package.json is missing a "name" field.`)
        process.exit(1)
      }
      workspaces.push({ dir, name })
    }
  }
  workspaces.sort((a, b) => a.dir.localeCompare(b.dir))
  return workspaces
}

const pkg = readPackageJson()
const workspaces = discoverWorkspaces(pkg)
const workspaceDirs = workspaces.map((ws) => ws.dir)

// Tracked dist paths = root dist + every workspace package's dist. Derived,
// never hardcoded, so it tracks workspace membership automatically.
//
// Root `dist/` covers everything the root tsup config emits under
// `dist/modules/*`, `dist/agents/`, `dist/commands/`, `dist/skills/`, and
// `dist/hooks/` — listing it once captures all of them, so no per-module
// enumeration here can drift out of date.
const trackedDistPaths = ["dist", ...workspaceDirs.map((dir) => `${dir}/dist`)]

// --- Guarantee 1: manifest + ignore coverage --------------------------------

const coverageErrors = []

// Every tracked dist path must be declared in `files[]` (so it ships in the
// published tarball).
const filesEntries = new Set(Array.isArray(pkg.files) ? pkg.files : [])
for (const distPath of trackedDistPaths) {
  if (!filesEntries.has(distPath)) {
    coverageErrors.push(`package.json "files" is missing "${distPath}"`)
  }
}

// Every tracked dist path must be un-ignored in .gitignore (committed dist is
// intentional; the global `dist/` ignore is overridden per path with a `!`
// negation + a `!.../dist/**` recursive negation).
let gitignore = ""
try {
  gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8")
} catch (err) {
  console.error("Failed to read .gitignore:", String(err?.message ?? err))
  process.exit(1)
}
const ignoreLines = new Set(
  gitignore
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
)
// Root `dist/` is un-ignored by the `!dist/` + `!dist/**` pair; the per-package
// paths each need their own negation pair.
for (const distPath of trackedDistPaths) {
  const negation = `!${distPath}/`
  const recursiveNegation = `!${distPath}/**`
  if (!ignoreLines.has(negation) || !ignoreLines.has(recursiveNegation)) {
    coverageErrors.push(
      `.gitignore is missing un-ignore rules for "${distPath}" (expected both "${negation}" and "${recursiveNegation}")`,
    )
  }
}

// Every workspace package must actually get built. `bun --filter` does not
// guarantee topological ordering across workspace deps in the pinned Bun
// version, and `--filter '!…'` negation is not honoured either — so the build
// is split into `build:skill-utils` (the shared dependency, built first) and
// `build:dependents` (everyone else, enumerated). That enumeration is the last
// place a package can be silently dropped: omit it and the package's dist is
// never rebuilt, so this asserts `build:dependents` lists every workspace
// package except the explicitly-first `build:skill-utils` one.
const SKILL_UTILS_NAME = "@appverk/opencode-skill-utils"
const scripts = pkg.scripts ?? {}
const buildSkillUtils = scripts["build:skill-utils"] ?? ""
const buildDependents = scripts["build:dependents"] ?? ""
for (const ws of workspaces) {
  const builtFirst = buildSkillUtils.includes(`--filter ${ws.name}`)
  const builtAsDependent = buildDependents.includes(`--filter ${ws.name}`)
  if (ws.name === SKILL_UTILS_NAME) {
    if (!builtFirst) {
      coverageErrors.push(
        `package.json "build:skill-utils" no longer builds "${ws.name}" (expected a "--filter ${ws.name}")`,
      )
    }
  } else if (!builtAsDependent) {
    coverageErrors.push(
      `package.json "build:dependents" is missing "--filter ${ws.name}" — its dist would never be rebuilt`,
    )
  }
}

// The CI "Assert no dist drift" backstop hardcodes the tracked dist paths in a
// `git diff --exit-code` (it runs on its own, decoupled from this script's
// derived list). Assert that list stays complete so a new package cannot pass
// CI while its dist goes unchecked. The workflow file is optional locally; only
// validate it when present.
const ciWorkflowPath = path.join(repoRoot, ".github/workflows/ci.yml")
if (existsSync(ciWorkflowPath)) {
  let ciWorkflow = ""
  try {
    ciWorkflow = readFileSync(ciWorkflowPath, "utf8")
  } catch (err) {
    console.error(
      "Failed to read .github/workflows/ci.yml:",
      String(err?.message ?? err),
    )
    process.exit(1)
  }
  // Match each path as a whole line token so `dist` does not match
  // `packages/<x>/dist` and produce a false positive.
  const ciTokens = new Set(
    ciWorkflow
      .split("\n")
      .map((line) => line.trim().replace(/\\$/, "").trim())
      .filter(Boolean),
  )
  for (const distPath of trackedDistPaths) {
    if (!ciTokens.has(distPath)) {
      coverageErrors.push(
        `.github/workflows/ci.yml "Assert no dist drift" step is missing "${distPath}"`,
      )
    }
  }
}

if (coverageErrors.length > 0) {
  console.error("\n❌ DIST MANIFEST COVERAGE FAILED")
  console.error(
    "A workspace package's dist/ is not fully wired into the publish manifest / ignore rules:",
  )
  for (const err of coverageErrors) console.error(`  - ${err}`)
  console.error(
    "\nAdd the missing entries so the shipped tarball matches the reviewed workspace set.",
  )
  process.exit(1)
}

// --- Guarantee 2: build freshness -------------------------------------------

console.log("Running bun run build...")
try {
  execFileSync("bun", ["run", "build"], { stdio: "inherit" })
} catch (err) {
  console.error(
    "Build failed (exit",
    err.status ?? err.signal ?? "unknown",
    "). Fix build errors before checking dist sync.",
  )
  process.exit(1)
}

// Check for uncommitted changes in tracked dist paths
let changedFiles

try {
  const output = execFileSync(
    "git",
    ["status", "--short", "--", ...trackedDistPaths],
    { encoding: "utf8" },
  )
  changedFiles = output.trim()
} catch (err) {
  console.error("Failed to run git status:", String(err?.message ?? err))
  console.error("Ensure this is a git repository.")
  process.exit(1)
}

if (changedFiles) {
  console.error("\n❌ DIST SYNC FAILED")
  console.error("The following built artifacts are out of sync with src/:")
  console.error(changedFiles)
  console.error(
    "\nRun 'bun run build' locally and commit the updated dist/ files.",
  )
  process.exit(1)
}

console.log(
  "✅ dist/ is in sync with src/ (across",
  trackedDistPaths.length,
  "tracked paths)",
)
