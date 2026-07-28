export { VELES_AGENT_KEY } from './veles.metadata.js';
import '../agent-registry/agent-metadata.js';

interface ReservePlanningPathArgs {
    directory: string;
    baseName: string;
    extension: string;
}
interface WritePlanningArtifactArgs {
    path: string;
    content: string;
}
interface PlanningArtifactContext {
    sessionID: string;
    worktree: string;
}
interface PlanningArtifactPathServiceDeps {
    resolveAgent: (sessionID: string) => Promise<string | undefined>;
}
interface VelesPlanningWriteGateDeps {
    resolveAgent: (sessionID: string) => Promise<string | undefined>;
    worktree?: string;
}
interface VelesPlanningWriteGateInput {
    tool: string;
    sessionID: string;
}
interface VelesPlanningWriteGateOutput {
    args: {
        filePath?: unknown;
        path?: unknown;
    };
}
type ArtifactPathResult = {
    status: "ok";
    path: string;
} | {
    status: "forbidden";
    reason: string;
} | {
    status: "error";
    reason: string;
};
type ArtifactWriteResult = {
    status: "ok";
} | {
    status: "forbidden";
    reason: string;
} | {
    status: "error";
    reason: string;
};
/**
 * Creates the session-scoped reservation service used by Veles's planning
 * artifact tools. A successful reservation is an empty file created with `wx`,
 * so concurrent planners cannot choose the same durable path.
 */
declare function createPlanningArtifactPathService(deps: PlanningArtifactPathServiceDeps): {
    reserve: (args: ReservePlanningPathArgs, context: PlanningArtifactContext) => Promise<ArtifactPathResult>;
    write: (args: WritePlanningArtifactArgs, context: PlanningArtifactContext) => Promise<ArtifactWriteResult>;
};
/** Defense-in-depth gate for native Write calls Veles must route through the reservation tool. */
declare function makeVelesPlanningWriteGate(deps: VelesPlanningWriteGateDeps): (input: VelesPlanningWriteGateInput, output: VelesPlanningWriteGateOutput) => Promise<void>;

export { type PlanningArtifactContext, type PlanningArtifactPathServiceDeps, type ReservePlanningPathArgs, type VelesPlanningWriteGateDeps, type VelesPlanningWriteGateInput, type VelesPlanningWriteGateOutput, type WritePlanningArtifactArgs, createPlanningArtifactPathService, makeVelesPlanningWriteGate };
