import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { GitResult, GitRunner } from "./controlled-commit.js"
import type { PrProvider } from "./pr-provider.js"

const execFileAsync = promisify(execFile)

/** Same (cwd, args) => Promise<GitResult> shape as GitRunner, spawning `gh` (C-3). */
export type GhRunner = GitRunner

export const GH_MISSING_MESSAGE =
  "GitHub CLI (gh) is not installed — install it (`brew install gh` or your platform's " +
  "equivalent), then authenticate with `gh auth login`."

export const defaultGhRunner: GhRunner = async (cwd, args) => {
  try {
    const result = await execFileAsync("gh", args, { cwd })
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }
  } catch (error) {
    const failure = error as Error & {
      stdout?: string
      stderr?: string
      code?: number | string
    }
    // FR-9: a spawn-time ENOENT means the gh binary is missing — surface it distinctly
    // instead of flattening it into a lossy exitCode (Number("ENOENT") === NaN).
    if (failure.code === "ENOENT") throw failure
    return {
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
      exitCode: typeof failure.code === "number" ? failure.code : 1,
    }
  }
}

const PR_URL_LINE = /^https:\/\/\S+$/

export function githubPrProvider(runGh: GhRunner = defaultGhRunner): PrProvider {
  return {
    name: "github",
    async createPullRequest(input) {
      const args = [
        "pr",
        "create",
        `--title=${input.title}`,
        `--body=${input.body}`,
        `--base=${input.base}`,
        `--head=${input.head}`,
      ]
      if (input.draft) args.push("--draft")

      let result: GitResult
      try {
        result = await runGh(input.cwd, args)
      } catch (error) {
        const failure = error as Error & { code?: unknown }
        if (failure.code === "ENOENT") throw new Error(GH_MISSING_MESSAGE)
        throw failure
      }

      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr.trim() || result.stdout.trim() || "gh pr create failed.",
        )
      }

      // FR-7: the last stdout line matching the URL pattern — scan every line, keep the last match.
      const url = result.stdout
        .split("\n")
        .filter((line) => PR_URL_LINE.test(line))
        .at(-1)
      if (url === undefined) {
        throw new Error(
          `gh pr create returned no PR URL.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
        )
      }
      return { url }
    },
  }
}
