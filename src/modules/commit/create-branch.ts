import { defaultGitRunner, type GitRunner } from "./controlled-commit.js"
import { findNonEnglishToken } from "./english-policy.js"

export const BRANCH_TYPES = [
  "feature",
  "fix",
  "hotfix",
  "release",
  "docs",
  "chore",
  "refactor",
] as const

export type BranchType = (typeof BRANCH_TYPES)[number]

export interface CreateBranchInput {
  type: string
  id?: string
  description: string
  checkout?: boolean
  cwd: string
  runGit?: GitRunner
}

export interface CreateBranchResult {
  name: string
  created: true
  checkedOut: boolean
  checkoutError?: string
}

/**
 * Normative §5.2 error template; the optional hint suffix carries the
 * english-publish-chain spec's §4 extended (S9) template.
 */
function segmentError(
  segment: string,
  ruleId: string,
  slug: string,
  value: string,
  hint = "",
): Error {
  return new Error(
    `create_branch: segment '${segment}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}${hint}`,
  )
}

const SEGMENT_CHARSET = /^[A-Za-z0-9._-]+$/

/**
 * §5.2.1 description normalization, in this exact order:
 * trim → collapse every whitespace run to a single "-" → strip edge dashes.
 * JS \s covers tab, newline, CR, VT, FF, NBSP (U+00A0), and the Unicode
 * space separators, so "fix\talert", "fix\nalert", "fix alert" all
 * normalize to "fix-alert"; "---" strips to "" (failing S2).
 */
function normalizeDescription(raw: string): string {
  return raw.trim().replace(/\s+/g, "-").replace(/^-+/, "").replace(/-+$/, "")
}

/**
 * §5.2.2 rules S3–S8 in listed order, first failure reported. S1 (type
 * enum) and S2 (non-empty description) are segment-specific and checked
 * by composeBranchName before this runs. S4 cannot fire for a normalized
 * description (edge dashes are stripped) — it binds `id` in practice.
 */
function validateSegmentRules(
  segment: "id" | "description",
  value: string,
): string {
  if (!SEGMENT_CHARSET.test(value))
    throw segmentError(segment, "S3", "invalid-characters", value)
  if (value.startsWith("-"))
    throw segmentError(segment, "S4", "leading-dash", value)
  if (value.startsWith("."))
    throw segmentError(segment, "S5", "leading-dot", value)
  if (value.includes("--"))
    throw segmentError(segment, "S6", "double-hyphen", value)
  if (value.includes(".."))
    throw segmentError(segment, "S7", "consecutive-dots", value)
  if (value.endsWith(".lock") || value.endsWith("."))
    throw segmentError(segment, "S8", "lock-suffix-or-trailing-dot", value)
  return value
}

/**
 * §5.2.4 composed-name validation, N1–N11 in listed order, first failure
 * thrown. Defense-in-depth over composition and the exported direct-test
 * contract. N3 is unreachable for any caller: a leading-dash name's type
 * part can never appear in BRANCH_TYPES, so N2's allow-list clause always
 * fires first regardless of expectedType — including a non-TypeScript
 * caller passing an arbitrary expectedType. N3 is retained solely for
 * spec §5.2.4 rule-ordering fidelity.
 */
export function validateBranchName(
  name: string,
  expectedType: BranchType,
): string {
  if (name.split("/").length - 1 !== 1)
    throw segmentError("name", "N1", "single-slash", name)
  const slashIndex = name.indexOf("/")
  const typePart = name.slice(0, slashIndex)
  const descriptionPart = name.slice(slashIndex + 1)
  if (
    typePart !== expectedType ||
    !(BRANCH_TYPES as readonly string[]).includes(typePart)
  )
    throw segmentError("name", "N2", "type-mismatch", name)
  if (name.startsWith("-"))
    throw segmentError("name", "N3", "leading-dash", name)
  if (descriptionPart === "")
    throw segmentError("name", "N4", "empty-description-part", name)
  if (!SEGMENT_CHARSET.test(descriptionPart))
    throw segmentError("name", "N5", "invalid-characters", name)
  if (descriptionPart.startsWith("-") || descriptionPart.startsWith("."))
    throw segmentError("name", "N6", "leading-dash-or-dot", name)
  if (descriptionPart.includes("--"))
    throw segmentError("name", "N7", "double-hyphen", name)
  if (descriptionPart.includes(".."))
    throw segmentError("name", "N8", "consecutive-dots", name)
  if (descriptionPart.endsWith(".lock"))
    throw segmentError("name", "N9", "lock-suffix", name)
  if (descriptionPart.endsWith("."))
    throw segmentError("name", "N10", "trailing-dot", name)
  if (Buffer.byteLength(name, "utf8") > 240)
    throw segmentError("name", "N11", "max-length-240-bytes", name)
  return name
}

/**
 * §5.2 layered validation + §5.2.3 composition. Evaluation order
 * (normative): type → id → description, each segment's rules in listed
 * order, first failing rule reported. Pure TypeScript — zero git.
 */
export function composeBranchName(input: {
  type: string
  id?: string
  description: string
}): string {
  const type = input.type.trim()
  if (!(BRANCH_TYPES as readonly string[]).includes(type))
    throw segmentError("type", "S1", "type-not-allowed", type)

  // An id that is omitted, "", or trims to empty is treated as omitted (FR-3, D9:
  // never normalized beyond trimming).
  const id = input.id?.trim() ?? ""
  if (id !== "") validateSegmentRules("id", id)

  const description = normalizeDescription(input.description)
  if (description === "")
    throw segmentError("description", "S2", "empty-description", description)
  validateSegmentRules("description", description)

  // english-publish-chain spec §4 S9: after S3–S8, on the normalized description
  // only — never `id` (its §1: ticket identifiers are never language-checked).
  const nonEnglishToken = findNonEnglishToken(description)
  if (nonEnglishToken !== undefined)
    throw segmentError(
      "description",
      "S9",
      "non-english-token",
      nonEnglishToken,
      " — branch names must be English; translate the description and retry.",
    )

  const name =
    id !== "" ? `${type}/${id}-${description}` : `${type}/${description}`
  return validateBranchName(name, type as BranchType)
}

/**
 * §5.3 git invocation contract: at most two argv invocations through the
 * injected runner — ["branch", name], then ["checkout", name] when
 * checkout resolves true. No existence pre-check (git is the single
 * source of truth; a pre-check would be TOCTOU anyway). FR-4: create
 * failure throws stderr (or stdout when stderr is empty), mirroring
 * controlled-commit.ts. FR-7/D3: checkout failure is a partial-success
 * result — the branch is never auto-deleted.
 */
export async function createBranch(
  input: CreateBranchInput,
): Promise<CreateBranchResult> {
  const name = composeBranchName(input) // FR-2: throws before any git on invalid input
  const runGit = input.runGit ?? defaultGitRunner
  const checkout = input.checkout ?? true

  const createResult = await runGit(input.cwd, ["branch", name])
  if (createResult.exitCode !== 0) {
    throw new Error(
      createResult.stderr.trim() ||
        createResult.stdout.trim() ||
        "git branch failed.",
    )
  }

  if (!checkout) {
    return { name, created: true, checkedOut: false }
  }

  const checkoutResult = await runGit(input.cwd, ["checkout", name])
  if (checkoutResult.exitCode !== 0) {
    return {
      name,
      created: true,
      checkedOut: false,
      // FR-7 capture rule: stderr → stdout → fixed string; never empty on
      // this path, so checkedOut:false + checkoutError stays distinguishable
      // from the checkout:false path (FR-6).
      checkoutError:
        checkoutResult.stderr.trim() ||
        checkoutResult.stdout.trim() ||
        "git checkout failed.",
    }
  }

  return { name, created: true, checkedOut: true }
}
