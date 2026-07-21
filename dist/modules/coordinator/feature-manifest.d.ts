interface FeatureManifest {
    files_changed: string[];
    modules_affected: string[];
    new_surface_types: string[];
    risk_flags: string[];
    estimated_complexity: "mechanical" | "simple" | "complex";
}
interface GitRunner {
    revParse(ref: string): Promise<string>;
    mergeBase(base: string, head: string): Promise<string>;
    diffNameOnly(base: string): Promise<string[]>;
}
declare function isGitRunner(value: unknown): value is GitRunner;
interface ValidateAndClassifyOptions {
    gitRunner?: GitRunner;
    base?: string;
    userRequestedPlanning?: boolean;
}
type ValidateAndClassifyResult = {
    executor: "stribog" | "svarog" | "veles";
    reason: string;
} | {
    error: string;
};
/** Extract the first wrapped Triglav manifest after the stable output marker. */
declare function parseManifest(text: string): FeatureManifest | undefined;
/**
 * Apply the conservative routing table. A trusted changed-file list is required
 * for every direct executor route; malformed or uncertain input routes to Veles.
 */
declare function classifyManifest(manifest: FeatureManifest, changedFiles?: string[]): "stribog" | "svarog" | "veles";
declare function parseNulDelimitedPaths(chunks: readonly Buffer[]): string[];
/** Production git adapter. `diffNameOnly` uses NUL-delimited output for safe filenames. */
declare const execFileGitRunner: GitRunner;
/** Validate a Triglav result against Git's authoritative changed-file list. */
declare function validateAndClassify(text: string, options?: ValidateAndClassifyOptions): Promise<ValidateAndClassifyResult>;

export { type FeatureManifest, type GitRunner, type ValidateAndClassifyOptions, type ValidateAndClassifyResult, classifyManifest, execFileGitRunner, isGitRunner, parseManifest, parseNulDelimitedPaths, validateAndClassify };
