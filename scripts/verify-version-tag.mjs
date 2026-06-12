#!/usr/bin/env node
/**
 * Verifies that the current `package.json` version has a matching git tag
 * that is REACHABLE from the documented install remote.
 *
 * Why this exists: the README/AGENTS install command pins a tag
 * (`…av-opencode-plugins.git#vX.Y.Z`). Git-installs resolve that tag against a
 * remote; if the version was bumped without tagging — or the tag was created
 * locally but never pushed to the remote users actually install from — the
 * documented install command fails (or silently resolves to a stale tree).
 * This guard turns that "split-brain docs ↔ artifact" failure into a hard CI
 * error at release time.
 *
 * Behavior:
 *   - Reads `version` from the root package.json → expects tag `v<version>`.
 *   - Local check (default): the tag must exist locally AND be reachable from
 *     HEAD (i.e. the tagged commit is an ancestor of, or equal to, HEAD).
 *   - Remote check (--remote=<name>, or REMOTE env): the tag must also be
 *     present on that remote via `git ls-remote --tags`. Use this in release
 *     CI against the *canonical install remote* (see AGENTS.md → Versioning &
 *     Git Installation; mind the "origin redirect trap").
 *
 * Exit codes: 0 = ok, 1 = missing/unreachable tag or git failure.
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import process from "node:process"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim()
  } catch (err) {
    if (allowFail) return null
    console.error("git", args.join(" "), "failed:", String(err?.message ?? err))
    process.exit(1)
  }
}

function readVersion() {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    )
    if (typeof pkg.version !== "string" || pkg.version.length === 0) {
      console.error("❌ VERSION TAG CHECK FAILED")
      console.error('Root package.json has no usable "version" field.')
      process.exit(1)
    }
    return pkg.version
  } catch (err) {
    console.error("Failed to read package.json:", String(err?.message ?? err))
    process.exit(1)
  }
}

// Optional remote name: `--remote=<name>` or REMOTE=<name>.
function parseRemote() {
  const flag = process.argv.find((a) => a.startsWith("--remote="))
  if (flag) return flag.slice("--remote=".length) || null
  return process.env.REMOTE && process.env.REMOTE.length > 0
    ? process.env.REMOTE
    : null
}

const version = readVersion()
const tag = `v${version}`
const remote = parseRemote()

// 1) Tag must exist locally.
const localTags = git(["tag", "--list", tag])
if (!localTags) {
  console.error("\n❌ VERSION TAG CHECK FAILED")
  console.error(
    `package.json version is ${version} but no local tag ${tag} exists.`,
  )
  console.error(
    `Create it on the release commit:  git tag ${tag} && git push <canonical-remote> ${tag}`,
  )
  console.error(
    'See AGENTS.md → "Versioning & Git Installation" (mind the canonical-remote / origin-redirect note).',
  )
  process.exit(1)
}

// 2) Tag must be reachable from HEAD (tagged commit is an ancestor of HEAD).
const headSha = git(["rev-parse", "HEAD"])
const tagSha = git(["rev-list", "-n", "1", tag])
const reachable =
  git(["merge-base", "--is-ancestor", tagSha, headSha], { allowFail: true }) !==
  null
if (!reachable) {
  console.error("\n❌ VERSION TAG CHECK FAILED")
  console.error(
    `Tag ${tag} (${tagSha.slice(0, 9)}) is not reachable from HEAD (${headSha.slice(0, 9)}).`,
  )
  console.error(
    "The documented install tag points at a commit that is not an ancestor of this tree.",
  )
  console.error(
    `Re-tag the release commit:  git tag -f ${tag} && git push -f <canonical-remote> ${tag}`,
  )
  process.exit(1)
}

// 3) Optional: tag must be present on the canonical install remote.
if (remote) {
  const lsRemote = git(["ls-remote", "--tags", remote, `refs/tags/${tag}`])
  if (!lsRemote) {
    console.error("\n❌ VERSION TAG CHECK FAILED")
    console.error(`Tag ${tag} is not present on remote "${remote}".`)
    console.error(
      "git-installs from the documented URL will fail to resolve this tag.",
    )
    console.error(`Push it:  git push ${remote} ${tag}`)
    console.error(
      'Confirm "' +
        remote +
        '" is the canonical install remote (mind the origin-redirect trap).',
    )
    process.exit(1)
  }
  console.log(
    `✅ ${tag} matches package.json version and is present on remote "${remote}".`,
  )
} else {
  console.log(
    `✅ ${tag} matches package.json version and is reachable from HEAD.`,
  )
  console.log(
    "   (Run with --remote=<name> in release CI to also verify the tag is pushed to the canonical install remote.)",
  )
}
