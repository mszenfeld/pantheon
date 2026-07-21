type FrontmatterValue = boolean | number | string | null;
interface PlanningArtifactFrontmatter {
    values: Map<string, FrontmatterValue>;
    body: string;
}
type PlanningArtifactDigestResult = {
    status: "ok";
    digest: string;
} | {
    status: "error";
    reason: string;
};
interface ValidatedArtifactPath {
    absolutePath: string;
    canonicalPath: string;
    relativePath: string;
}
/** Parses the leading, flat YAML frontmatter block used by planning artifacts. */
declare function parsePlanningArtifactFrontmatter(content: string): PlanningArtifactFrontmatter;
/** Serializes an artifact with sorted frontmatter keys and LF line endings. */
declare function serializePlanningArtifact(artifact: PlanningArtifactFrontmatter): string;
/** Produces the stable bytes hashed for artifact approval and verification. */
declare function canonicalizePlanningArtifact(artifact: PlanningArtifactFrontmatter): string;
/** Computes the SHA-256 digest of the canonical planning-artifact representation. */
declare function canonicalPlanningArtifactDigest(content: string): string;
declare function resolvePlanningArtifactPath(pathValue: string): ValidatedArtifactPath;
/** Reads, validates, canonicalizes, and hashes a planning artifact. */
declare function getPlanningArtifactDigest(pathValue: string): PlanningArtifactDigestResult;

export { type FrontmatterValue, type PlanningArtifactDigestResult, type PlanningArtifactFrontmatter, type ValidatedArtifactPath, canonicalPlanningArtifactDigest, canonicalizePlanningArtifact, getPlanningArtifactDigest, parsePlanningArtifactFrontmatter, resolvePlanningArtifactPath, serializePlanningArtifact };
