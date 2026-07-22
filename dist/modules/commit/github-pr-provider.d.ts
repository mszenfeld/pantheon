import { GitRunner } from './controlled-commit.js';
import { PrProvider } from './pr-provider.js';

/** Same (cwd, args) => Promise<GitResult> shape as GitRunner, spawning `gh` (C-3). */
type GhRunner = GitRunner;
declare const GH_MISSING_MESSAGE: string;
declare const defaultGhRunner: GhRunner;
declare function githubPrProvider(runGh?: GhRunner): PrProvider;

export { GH_MISSING_MESSAGE, type GhRunner, defaultGhRunner, githubPrProvider };
