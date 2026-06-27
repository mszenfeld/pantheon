import { renameSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
function sidecarPathFor(reportPath) {
  const dir = dirname(reportPath);
  const base = basename(reportPath);
  const stem = base.endsWith("-report.md") ? base.slice(0, -"-report.md".length) : base.replace(/\.md$/, "");
  return join(dir, `${stem}-loop-state.json`);
}
class QaLoopState {
  mem = /* @__PURE__ */ new Map();
  /** In-process lookup by parent (Perun) session id; undefined when cold. */
  load(parentId) {
    return this.mem.get(parentId);
  }
  /** Write both layers: in-process map + atomic disk JSON at the sidecar path. */
  save(parentId, s) {
    this.mem.set(parentId, s);
    const path = sidecarPathFor(s.report_path);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
    renameSync(tmp, path);
  }
  /**
   * Cross-session resume primitive: read the sidecar straight off disk by report path,
   * bypassing the cold in-process map. `qa_loop_start` uses this to decide REUSE/ADOPT.
   */
  loadFromDisk(reportPath) {
    const path = sidecarPathFor(reportPath);
    if (!existsSync(path)) return void 0;
    return JSON.parse(readFileSync(path, "utf8"));
  }
  /** Drop the in-process entry for a parent session (called on session.deleted).
   * Does NOT delete the on-disk sidecar — that is the durable cross-session resume artifact. */
  clearRun(parentId) {
    this.mem.delete(parentId);
  }
}
export {
  QaLoopState,
  sidecarPathFor
};
