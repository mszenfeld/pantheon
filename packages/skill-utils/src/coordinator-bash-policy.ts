/*
 * @deprecated Legacy copy for external package consumers.
 *
 * The canonical implementation lives in `src/modules/_shared/coordinator-bash-policy.ts`
 * (the harness-owned home); keep this file in sync with it. The duplication is
 * deliberate: the import boundary is frozen in BOTH directions (packages must not
 * import `src/`, and `src/modules/` must not import `packages/skill-utils` — see
 * AGENTS.md "skill-utils package boundary"), so a re-export facade in either
 * direction would violate doctrine. Delete this copy once `skill-registry` is
 * absorbed into `src/modules/` and no external consumer needs these exports.
 */

/** Parse `Bash(<prog>:*)` programs out of an agent's `allowed-tools` frontmatter line. */
export function parseAllowedBashPrograms(frontmatter: string): string[] {
  const out: string[] = []
  const re = /Bash\(([^:)]+):\*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(frontmatter)) !== null) {
    const prog = m[1]
    if (prog !== undefined) out.push(prog.trim())
  }
  return out
}

const COMPOUND =
  /(\|\||&&|;|\||&|[\r\n]|`|\$\(|<|>|(?<![\w./-])(?:bash|sh|eval)\b)/

/** True when a command contains a shell compound form or wrapper. */
export function isCompoundCommand(command: string): boolean {
  return COMPOUND.test(command.trim())
}

export interface BashClassification {
  allowed: boolean
  program: string | null
}

/** Decide whether a coordinator bash command is permitted by its allowlist. */
export function classifyCoordinatorBash(
  command: string,
  allowedPrograms: string[],
): BashClassification {
  const trimmed = command.trim()
  if (isCompoundCommand(trimmed)) return { allowed: false, program: null }
  const program = trimmed.split(/\s+/)[0] ?? ""
  return { allowed: allowedPrograms.includes(program), program }
}

export interface ViolationInfo {
  tool: string
  command?: string
  skill?: string
  reason: string
}

/** Build the coordinator-policy rejection error and its machine-readable marker. */
export function buildViolationError(info: ViolationInfo): Error {
  const payload = JSON.stringify({
    marker: "COORDINATOR_POLICY_VIOLATION",
    ...info,
  })
  const subject = info.command
    ? isCompoundCommand(info.command)
      ? "a compound command"
      : `\`${info.command.split(/\s+/)[0]}\``
    : info.skill
      ? `skill \`${info.skill}\``
      : "that"
  return new Error(
    `${payload}\nThe coordinator may not run ${subject}. ` +
      `Dispatch Veles (planning) or Triglav (exploration) to inspect the repository instead.`,
  )
}
