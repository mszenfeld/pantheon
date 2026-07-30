import { CommitScopePolicy } from './perun-commit-policy.js';
import { CommitAuthorization } from './perun-commit-consent.js';
import './commit-audit.js';
import './git-scope-snapshot.js';

interface GitResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
interface GitRunner {
    (cwd: string, args: string[]): Promise<GitResult>;
}
interface ControlledCommitInput {
    cwd: string;
    message: string;
    files?: string[];
    taskId?: string;
    scopePolicy?: CommitScopePolicy;
    runGit?: GitRunner;
    pathExists?: (absolutePath: string) => boolean;
    authorization?: CommitAuthorization;
}
declare const defaultGitRunner: GitRunner;
declare function createControlledCommit(input: ControlledCommitInput): Promise<{
    commitMessage: string;
    status: string;
}>;

export { type ControlledCommitInput, type GitResult, type GitRunner, createControlledCommit, defaultGitRunner };
