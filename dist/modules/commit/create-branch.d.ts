import { GitRunner } from './controlled-commit.js';

declare const BRANCH_TYPES: readonly ["feature", "fix", "hotfix", "release", "docs", "chore", "refactor"];
type BranchType = (typeof BRANCH_TYPES)[number];
interface CreateBranchInput {
    type: string;
    id?: string;
    description: string;
    checkout?: boolean;
    cwd: string;
    runGit?: GitRunner;
}
interface CreateBranchResult {
    name: string;
    created: true;
    checkedOut: boolean;
    checkoutError?: string;
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
declare function validateBranchName(name: string, expectedType: BranchType): string;
/**
 * §5.2 layered validation + §5.2.3 composition. Evaluation order
 * (normative): type → id → description, each segment's rules in listed
 * order, first failing rule reported. Pure TypeScript — zero git.
 */
declare function composeBranchName(input: {
    type: string;
    id?: string;
    description: string;
}): string;
/**
 * §5.3 git invocation contract: at most two argv invocations through the
 * injected runner — ["branch", name], then ["checkout", name] when
 * checkout resolves true. No existence pre-check (git is the single
 * source of truth; a pre-check would be TOCTOU anyway). FR-4: create
 * failure throws stderr (or stdout when stderr is empty), mirroring
 * controlled-commit.ts. FR-7/D3: checkout failure is a partial-success
 * result — the branch is never auto-deleted.
 */
declare function createBranch(input: CreateBranchInput): Promise<CreateBranchResult>;

export { BRANCH_TYPES, type BranchType, type CreateBranchInput, type CreateBranchResult, composeBranchName, createBranch, validateBranchName };
