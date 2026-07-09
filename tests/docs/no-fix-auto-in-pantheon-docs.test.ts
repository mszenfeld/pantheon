import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "../..")

describe("Pantheon docs no longer advertise fix-auto as a Pantheon specialist", () => {
  it("pantheon.md has no fix-auto reference", () => {
    expect(readFileSync(join(root, "docs/plugins/pantheon.md"), "utf8"))
      .not.toContain("fix-auto")
  })

  it("coordinator.md mentions fix-auto only as a code-review cross-reference", () => {
    const doc = readFileSync(join(root, "docs/plugins/coordinator.md"), "utf8")
    const hits = doc.split("\n").filter((l) => l.includes("fix-auto"))
    // the only surviving mention is the code-review.md See-Also pointer
    for (const line of hits) {
      expect(line).toMatch(/code-review\.md/)
    }
  })

  it("coordinator.md documents Svarog as the in-loop fixer", () => {
    const doc = readFileSync(join(root, "docs/plugins/coordinator.md"), "utf8")
    expect(doc).toMatch(/Svarog/)
    expect(doc).toMatch(/QA loop|test→fix→retest/i)
  })
})
