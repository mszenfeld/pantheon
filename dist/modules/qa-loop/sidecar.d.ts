import { Sidecar } from './types.js';

/**
 * Derive the gitignored sidecar path from the report path: the `<date>-<topic>` stem
 * matches the report so REUSE/ADOPT can pair them (§5). `…-report.md` -> `…-loop-state.json`;
 * any other report basename just gets `-loop-state.json` appended to its stem.
 */
declare function sidecarPathFor(reportPath: string): string;
/**
 * Tool-owned sidecar persistence: an in-process Map (speed, same shape as QaRunState)
 * PLUS an atomic disk-JSON layer (durability + cross-session resume that QaRunState lacks).
 * The qa-loop tool is the single writer of both layers (§5).
 */
declare class QaLoopState {
    private readonly mem;
    /** In-process lookup by parent (Perun) session id; undefined when cold. */
    load(parentId: string): Sidecar | undefined;
    /** Write both layers: in-process map + atomic disk JSON at the sidecar path. */
    save(parentId: string, s: Sidecar): void;
    /**
     * Cross-session resume primitive: read the sidecar straight off disk by report path,
     * bypassing the cold in-process map. `qa_loop_start` uses this to decide REUSE/ADOPT.
     */
    loadFromDisk(reportPath: string): Sidecar | undefined;
    /** Drop the in-process entry for a parent session (called on session.deleted).
     * Does NOT delete the on-disk sidecar — that is the durable cross-session resume artifact. */
    clearRun(parentId: string): void;
}

export { QaLoopState, sidecarPathFor };
