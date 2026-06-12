#!/usr/bin/env node
/**
 * Verifies that per-review code-review issue IDs do NOT leak into source or
 * test files. See AGENTS.md → "Code Review Artefacts".
 *
 * IDs like SEC-NNN, MAINT-NNN, PERF-NNN, ARCH-NNN, COMP-NNN, COMPOSITE-N are
 * generated per-review by the `/review` workflow and live in docs/reviews/*.md.
 * They are context-bound to a single report and become noise — and a live
 * collision risk — the moment that report is regenerated or deleted. The
 * technical rationale belongs in the code; the which-report belongs in git
 * history.
 *
 * Standardised external identifiers (CWE-117, CVE-2023-…, OWASP A03:2025) are
 * stable cross-project references and are NOT matched by this guard.
 *
 * Runnable locally via `bun run verify-no-review-ids`; intended for CI.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import process from "node:process"

// Per-review ID prefixes emitted by the `/review` workflow. CWE/CVE/OWASP are
// deliberately absent — those are load-bearing external identifiers.
const REVIEW_ID =
  /\b(?:SEC|MAINT|PERF|ARCH|COMP|COMPOSITE|REL|OPS|DOC|TEST|BUG)-\d+/

// Exceptions from AGENTS.md — these IDs are *system documentation*, not review
// residue. Paths are matched as suffixes against the repo-relative path.
const EXCEPTED_PATHS = [
  "docs/plugins/code-review.md",
  "README.md",
  "tests/modules/coordinator/assign-issue-ids.test.ts",
  "src/skills/qa/report-format/SKILL.md",
]

// Only source/test files carry the no-ID rule. dist/ is generated and mirrors
// src/, so it is covered transitively; we skip it to avoid double-reporting.
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"]

function isExcepted(path) {
  return EXCEPTED_PATHS.some(
    (excepted) => path === excepted || path.endsWith(`/${excepted}`),
  )
}

function isScanned(path) {
  if (path.includes("/dist/") || path.startsWith("dist/")) return false
  if (path.includes("/node_modules/")) return false
  return SCANNED_EXTENSIONS.some((ext) => path.endsWith(ext))
}

let trackedFiles
try {
  const output = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  trackedFiles = output.split("\n").filter(Boolean)
} catch (err) {
  console.error("Failed to list tracked files:", String(err?.message ?? err))
  console.error("Ensure this is a git repository.")
  process.exit(1)
}

const violations = []
for (const path of trackedFiles) {
  if (!isScanned(path) || isExcepted(path)) continue

  let contents
  try {
    contents = readFileSync(path, "utf8")
  } catch {
    continue
  }

  contents.split("\n").forEach((line, index) => {
    const match = REVIEW_ID.exec(line)
    if (match) {
      violations.push({
        path,
        line: index + 1,
        id: match[0],
        text: line.trim(),
      })
    }
  })
}

if (violations.length > 0) {
  console.error("\n❌ PER-REVIEW ISSUE IDs FOUND IN SOURCE/TEST")
  console.error(
    "AGENTS.md → Code Review Artefacts: never write code-review issue IDs into source or test files.",
  )
  console.error(
    "Keep the technical rationale; drop the per-review ID (it lives in git history + docs/reviews/).\n",
  )
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line}  [${v.id}]  ${v.text}`)
  }
  console.error(
    "\nIf an ID is genuinely system documentation, add it to EXCEPTED_PATHS in scripts/verify-no-review-ids.mjs.",
  )
  process.exit(1)
}

console.log("✅ no per-review issue IDs in source/test files")
