import { defaultGitRunner, type GitRunner } from "./controlled-commit.js"
import { findNonEnglishToken } from "./english-policy.js"
import {
  defaultGhRunner,
  githubPrProvider,
  type GhRunner,
} from "./github-pr-provider.js"
import { detectProvider, type PrProvider } from "./pr-provider.js"

export interface CreatePrInput {
  title: string
  body?: string
  base?: string
  draft?: boolean
  taskId?: string
  cwd: string
  runGit?: GitRunner
  runGh?: GhRunner
  provider?: PrProvider
}

export interface CreatePrResult {
  head: string
  base: string
  pushed: boolean
  prCreated: boolean
  draft: boolean
  url?: string
  prError?: string
}

/**
 * Normative §5.2 error template; the optional hint suffix carries the
 * english-publish-chain spec's §4 extended (T4) template.
 */
function ruleError(
  field: string,
  ruleId: string,
  slug: string,
  value: string,
  hint = "",
): Error {
  return new Error(
    `create_pr: field '${field}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}${hint}`,
  )
}

// TITLE_CONTROL: matches ANY C0/C1 control character
const TITLE_CONTROL = /[\x00-\x1F\x7F-\x9F]/
// Body allows \t (U+0009), \n (U+000A), \r (U+000D); bans all other C0/C1 controls.
const BODY_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/

function validateTitle(rawTitle: string): string {
  const title = rawTitle.trim()
  if (title.length === 0) throw ruleError("title", "T1", "empty-title", title)
  if ([...title].length > 256)
    throw ruleError("title", "T2", "max-length-256-chars", title)
  if (TITLE_CONTROL.test(title))
    throw ruleError("title", "T3", "control-characters", title)
  const nonEnglishToken = findNonEnglishToken(title)
  if (nonEnglishToken !== undefined)
    throw ruleError(
      "title",
      "T4",
      "non-english-token",
      nonEnglishToken,
      " — PR titles must be English; translate the title and retry.",
    )
  return title
}

function validateTaskId(rawTaskId: string | undefined): string | undefined {
  if (rawTaskId === undefined) return undefined
  const taskId = rawTaskId.trim()
  if (taskId.length === 0) return undefined
  if (!/^[A-Za-z0-9._-]+$/.test(taskId))
    throw ruleError("taskId", "K1", "invalid-characters", taskId)
  if (taskId.startsWith("-"))
    throw ruleError("taskId", "K2", "leading-dash", taskId)
  return taskId
}

/** §5.2 Normalization: body verbatim except the Refs footer append. */
function resolveBody(
  body: string | undefined,
  taskId: string | undefined,
): string {
  if (taskId === undefined) return body ?? ""
  if (body === undefined || body.trim() === "") return `Refs: ${taskId}`
  return `${body.trimEnd()}\n\nRefs: ${taskId}`
}

function validateBody(resolvedBody: string): string {
  if (Buffer.byteLength(resolvedBody, "utf8") > 64_000)
    throw ruleError("body", "B1", "max-length-64000-bytes", resolvedBody)
  if (BODY_CONTROL.test(resolvedBody))
    throw ruleError("body", "B2", "control-characters", resolvedBody)
  return resolvedBody
}

/** R1–R5, first failing rule reported; shared by provided-base and resolved-head checks. */
function validateRef(field: "base" | "head", rawValue: string): string {
  const value = rawValue.trim()
  if (value.length === 0 || !/^[A-Za-z0-9._/-]+$/.test(value))
    throw ruleError(field, "R1", "invalid-characters", value)
  if (value.startsWith("-")) throw ruleError(field, "R2", "leading-dash", value)
  if (value.includes("..")) throw ruleError(field, "R3", "dot-dot", value)
  const componentViolation =
    value.includes("//") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  if (componentViolation) throw ruleError(field, "R4", "component-rules", value)
  if (Buffer.byteLength(value, "utf8") > 240)
    throw ruleError(field, "R5", "max-length-240-bytes", value)
  return value
}

/** Strips a `refs/heads/` and/or leading `origin/` prefix so both base paths compare alike. */
function normalizeBaseRef(value: string): string {
  return value.replace(/^refs\/heads\//, "").replace(/^origin\//, "")
}

export async function createPr(input: CreatePrInput): Promise<CreatePrResult> {
  // §5.2 — evaluation order (normative): title → taskId → body (resolved) → base.
  // Pure TypeScript; zero process spawns on any violation (FR-4/NFR-2).
  const title = validateTitle(input.title)
  const taskId = validateTaskId(input.taskId)
  const body = validateBody(resolveBody(input.body, taskId))
  // FR-3: base counts as omitted iff undefined or empty after trim (whitespace-only).
  // The provided base is normalized exactly like the auto-resolved one (below): a
  // remote-tracking or full-ref spelling of the same branch (`origin/master`,
  // `refs/heads/master`) must not slip past the G2 head≠base guard — or reach `gh --base=`,
  // which wants the plain branch name.
  // Re-validated AFTER normalization: stripping a prefix can expose a value the R-rules would
  // have rejected outright (`origin/-x` → `-x`, which violates R2).
  const providedBase =
    input.base !== undefined && input.base.trim() !== ""
      ? validateRef("base", normalizeBaseRef(validateRef("base", input.base)))
      : undefined

  const runGit = input.runGit ?? defaultGitRunner
  const draft = input.draft ?? false

  // G1 — head resolution (FR-2): defaultGitRunner returns stdout untrimmed by contract.
  const headResult = await runGit(input.cwd, ["branch", "--show-current"])
  if (headResult.exitCode !== 0) {
    throw new Error(
      headResult.stderr.trim() ||
        headResult.stdout.trim() ||
        "git branch --show-current failed.",
    )
  }
  const head = headResult.stdout.trim()
  if (head === "") {
    throw new Error(
      "create_pr: HEAD is detached — check out a branch first (use create_branch).",
    )
  }

  // G5 — base auto-resolution (FR-3) when omitted / empty after trim.
  let base: string
  if (providedBase !== undefined) {
    base = providedBase
  } else {
    const baseResult = await runGit(input.cwd, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ])
    if (baseResult.exitCode !== 0) {
      throw new Error(
        "create_pr: cannot resolve the default branch of 'origin' — pass 'base' " +
          "explicitly or run: git remote set-head origin --auto",
      )
    }
    base = normalizeBaseRef(baseResult.stdout.trim())
  }

  // G2 — head defense-in-depth re-validation (§5.2, field 'head'), then never publish from base.
  validateRef("head", head)
  if (head === base) {
    throw new Error(
      `create_pr: refusing to push and open a PR from the base branch '${base}' — ` +
        "create a feature branch first (use create_branch).",
    )
  }

  // G3/G4 — provider detection (FR-5); skipped entirely when a provider is injected (test seam).
  let provider = input.provider
  if (provider === undefined) {
    const originResult = await runGit(input.cwd, [
      "remote",
      "get-url",
      "origin",
    ])
    if (originResult.exitCode !== 0) {
      throw new Error("create_pr: no 'origin' remote is configured.")
    }
    const originUrl = originResult.stdout.trim()
    if (detectProvider(originUrl) !== "github") {
      // C-5/NFR-3: the raw get-url output may embed credentials (PAT-in-URL remotes, which
      // always fail detection), so URL userinfo is redacted before the echo reaches the
      // transcript. scp-like `git@host:` forms have no `://` and pass through unchanged.
      const redactedUrl = originUrl.replace(
        /^(\w+:\/\/)[^@/]+@/,
        "$1<redacted>@",
      )
      throw new Error(
        "create_pr: unsupported git host for PR creation (supported: github.com). " +
          `origin: ${JSON.stringify(redactedUrl)}`,
      )
    }
    provider = githubPrProvider(input.runGh ?? defaultGhRunner)
  }

  // FR-6 — the first and only mutation. Never --force, never a refspec (C-6).
  const pushResult = await runGit(input.cwd, ["push", "-u", "origin", head])
  if (pushResult.exitCode !== 0) {
    throw new Error(
      pushResult.stderr.trim() ||
        pushResult.stdout.trim() ||
        "git push failed.",
    )
  }

  // FR-7/FR-8 — PR creation; failure after the durable push is a partial result, never a throw.
  try {
    const { url } = await provider.createPullRequest({
      cwd: input.cwd,
      head,
      base,
      title,
      body,
      draft,
    })
    return { head, base, pushed: true, prCreated: true, draft, url }
  } catch (error) {
    const prError = error instanceof Error ? error.message : String(error)
    return { head, base, pushed: true, prCreated: false, draft, prError }
  }
}
