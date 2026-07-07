import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const docPath = join(__dirname, "../../docs/plugins/qa-loop-engineering.md")

describe("loop-engineering doctrine doc", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true)
  })

  it("defines the scenario-kind taxonomy used by classify.ts (§5)", () => {
    const doc = readFileSync(docPath, "utf8")
    for (const kind of ["feature", "sanity", "negative"]) {
      expect(doc).toContain(kind)
    }
  })

  it("defines the coverage buckets used by qa_loop_ingest (§5)", () => {
    const doc = readFileSync(docPath, "utf8")
    for (const bucket of [
      "enforcement",
      "auth-unverified",
      "mutation-guard",
      "tool-unavailable",
    ]) {
      expect(doc).toContain(bucket)
    }
  })

  it("states the oracle-separation invariant", () => {
    const doc = readFileSync(docPath, "utf8")
    expect(doc).toMatch(/oracle separation|independent re-run|only.*final.*Fixed/i)
  })

  it("documents the §8 auto-reverting-seed default (kept in sync with tools.ts / perun.md)", () => {
    // The pre-branch doc described only strip-by-default; pin the shipped §8 behavior so a
    // regression back to that stale text (the canonical doc lagging the code) fails here.
    const doc = readFileSync(docPath, "utf8")
    for (const term of [
      "auto-reverting",
      "Teardown",
      "auto_reverting",
      "teardowns_pending",
      "allow-mutations",
    ]) {
      expect(doc).toContain(term)
    }
    // The non-local floor: the default only applies against a loopback base-url.
    expect(doc).toMatch(/local|loopback/i)
  })
})
