import { defaultGitRunner, type GitRunner } from "./controlled-commit.js"
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

/** Normative §5.2 error template. */
function ruleError(field: string, ruleId: string, slug: string, value: string): Error {
  return new Error(
    `create_pr: field '${field}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}`,
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
  return title
}

function validateTaskId(rawTaskId: string | undefined): string | undefined {
  if (rawTaskId === undefined) return undefined
  const taskId = rawTaskId.trim()
  if (taskId.length === 0) return undefined
  if (!/^[A-Za-z0-9._-]+$/.test(taskId))
    throw ruleError("taskId", "K1", "invalid-characters", taskId)
  if (taskId.startsWith("-")) throw ruleError("taskId", "K2", "leading-dash", taskId)
  return taskId
}

/** §5.2 Normalization: body verbatim except the Refs footer append. */
function resolveBody(body: string | undefined, taskId: string | undefined): string {
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
    value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  if (componentViolation) throw ruleError(field, "R4", "component-rules", value)
  if (Buffer.byteLength(value, "utf8") > 240)
    throw ruleError(field, "R5", "max-length-240-bytes", value)
  return value
}

export async function createPr(input: CreatePrInput): Promise<CreatePrResult> {
  // §5.2 — evaluation order (normative): title → taskId → body (resolved) → base.
  // Pure TypeScript; zero process spawns on any violation (FR-4/NFR-2).
  const title = validateTitle(input.title)
  const taskId = validateTaskId(input.taskId)
  const body = validateBody(resolveBody(input.body, taskId))
  // FR-3: base counts as omitted iff undefined or empty after trim (whitespace-only).
  const baseProvided = input.base !== undefined && input.base.trim() !== ""
  const providedBase = baseProvided ? validateRef("base", input.base as string) : undefined
  void title
  void body
  void providedBase
  throw new Error("create_pr: guards not implemented")
}
