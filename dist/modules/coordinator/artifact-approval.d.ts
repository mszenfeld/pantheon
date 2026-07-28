type PlanningArtifactApprovalResult = {
    status: "ok";
    approvedFileDigest: string;
} | {
    status: "error";
    reason: string;
};
/** Approves a planning artifact and writes its immutable verification sidecar. */
declare function approvePlanningArtifact(pathValue: string, preApprovalDigest: string, sessionId: string): Promise<PlanningArtifactApprovalResult>;

export { type PlanningArtifactApprovalResult, approvePlanningArtifact };
