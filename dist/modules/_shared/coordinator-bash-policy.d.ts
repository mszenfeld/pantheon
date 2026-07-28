/** Parse `Bash(<prog>:*)` programs out of an agent's `allowed-tools` frontmatter line. */
declare function parseAllowedBashPrograms(frontmatter: string): string[];
/** True when a command contains a shell compound form or wrapper. */
declare function isCompoundCommand(command: string): boolean;
interface BashClassification {
    allowed: boolean;
    program: string | null;
}
/** Decide whether a coordinator bash command is permitted by its allowlist. */
declare function classifyCoordinatorBash(command: string, allowedPrograms: string[]): BashClassification;
interface ViolationInfo {
    tool: string;
    command?: string;
    skill?: string;
    reason: string;
}
/** Build the coordinator-policy rejection error and its machine-readable marker. */
declare function buildViolationError(info: ViolationInfo): Error;

export { type BashClassification, type ViolationInfo, buildViolationError, classifyCoordinatorBash, isCompoundCommand, parseAllowedBashPrograms };
