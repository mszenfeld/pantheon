type ReadVerifiedPlanningArtifactResult = {
    status: "ok";
    content: string;
} | {
    status: "error";
    reason: string;
};
/** Reads an approved planning artifact only when its canonical digest still matches its sidecar. */
declare function readVerifiedPlanningArtifact(pathValue: string): ReadVerifiedPlanningArtifactResult;

export { type ReadVerifiedPlanningArtifactResult, readVerifiedPlanningArtifact };
