import { GitRunner } from './controlled-commit.js';
import { GhRunner } from './github-pr-provider.js';
import { PrProvider } from './pr-provider.js';

interface CreatePrInput {
    title: string;
    body?: string;
    base?: string;
    draft?: boolean;
    taskId?: string;
    cwd: string;
    runGit?: GitRunner;
    runGh?: GhRunner;
    provider?: PrProvider;
}
interface CreatePrResult {
    head: string;
    base: string;
    pushed: boolean;
    prCreated: boolean;
    draft: boolean;
    url?: string;
    prError?: string;
}
declare function createPr(input: CreatePrInput): Promise<CreatePrResult>;

export { type CreatePrInput, type CreatePrResult, createPr };
