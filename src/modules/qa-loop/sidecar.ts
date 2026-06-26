import { renameSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import type { Sidecar } from "./types.js"

/**
 * Derive the gitignored sidecar path from the report path: the `<date>-<topic>` stem
 * matches the report so REUSE/ADOPT can pair them (§5). `…-report.md` -> `…-loop-state.json`;
 * any other report basename just gets `-loop-state.json` appended to its stem.
 */
export function sidecarPathFor(reportPath: string): string {
  const dir = dirname(reportPath)
  const base = basename(reportPath)
  const stem = base.endsWith("-report.md")
    ? base.slice(0, -"-report.md".length)
    : base.replace(/\.md$/, "")
  return join(dir, `${stem}-loop-state.json`)
}

/**
 * Tool-owned sidecar persistence: an in-process Map (speed, same shape as QaRunState)
 * PLUS an atomic disk-JSON layer (durability + cross-session resume that QaRunState lacks).
 * The qa-loop tool is the single writer of both layers (§5).
 */
export class QaLoopState {
  private readonly mem = new Map<string, Sidecar>()

  /** In-process lookup by parent (Perun) session id; undefined when cold. */
  load(parentId: string): Sidecar | undefined {
    return this.mem.get(parentId)
  }

  /** Write both layers: in-process map + atomic disk JSON at the sidecar path. */
  save(parentId: string, s: Sidecar): void {
    this.mem.set(parentId, s)
    const path = sidecarPathFor(s.report_path)
    const tmp = `${path}.tmp`
    // atomic: write to a sibling temp file, then rename over the target (same dir => atomic on POSIX).
    writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8")
    renameSync(tmp, path)
  }

  /**
   * Cross-session resume primitive: read the sidecar straight off disk by report path,
   * bypassing the cold in-process map. `qa_loop_start` uses this to decide REUSE/ADOPT.
   */
  loadFromDisk(reportPath: string): Sidecar | undefined {
    const path = sidecarPathFor(reportPath)
    if (!existsSync(path)) return undefined
    return JSON.parse(readFileSync(path, "utf8")) as Sidecar
  }
}
