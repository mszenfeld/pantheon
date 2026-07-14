import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const docPath = join(__dirname, "../../docs/agent-contracts.md")
const triglavPath = join(__dirname, "../../src/modules/explore/triglav.md")
const qaDocPath = join(__dirname, "../../docs/plugins/qa.md")

describe("agent-contracts doctrine doc", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true)
  })

  // Each agent's closed vocabulary, bound to the roster row that must carry it.
  // Tokens are matched in their backticked form so `ok` / `error` / `timeout`
  // cannot satisfy the pin from surrounding prose.
  const ROSTER: ReadonlyArray<readonly [agent: string, tokens: readonly string[]]> = [
    ["Zmora (fe/be)", ["`PASS`", "`FAIL`", "`SKIP`", "`NEED_INFO`"]],
    [
      "zmora-setup",
      [
        "`Provisioned QA_BIND_<NAME>`",
        "`NEED_INFO kind=binding_input`",
        "`RECIPE_FAILED`",
        "`ERROR`",
        "`PROVISIONING_BLOCKED`",
      ],
    ],
    ["Svarog", ["`READY`", "`FAIL`", "`ESCALATE`"]],
    ["Stribog", ["`READY`", "`FAIL`", "`ESCALATE`"]],
    ["Veles", ["`ok`", "`error`", "`timeout`"]],
    [
      "qa-loop (run-level)",
      ["`Pass`", "`Fail`", "`BudgetExhausted`", "`Stopped`", "`NotVerified`"],
    ],
    ["Triglav", ["a reader, not a verdict agent"]],
  ]

  it("pins each roster row to its own verdict vocabulary (Section A)", () => {
    // Row-scoped, NOT document-scoped. A bare `expect(doc).toContain("READY")`
    // resolves against ANY row, so deleting the whole Svarog row leaves the pin
    // green (Stribog still supplies READY/ESCALATE, and FAIL is everywhere) —
    // exactly the silent roster drift this doc-guard exists to catch.
    const rows = readFileSync(docPath, "utf8").split("\n")

    for (const [agent, tokens] of ROSTER) {
      const row = rows.find((l) => l.startsWith(`| ${agent} |`))
      expect(row, `roster row for ${agent} is missing`).toBeDefined()
      for (const token of tokens) {
        expect(row, `${agent} row lost ${token}`).toContain(token)
      }
    }
  })

  it("states the bar terms verbatim", () => {
    // Match against a whitespace-normalized copy so the multi-word terms
    // ("named fields", "computed, not chosen") stay pinned even if the prose is
    // re-wrapped mid-phrase. Direction preserved: "computed, not chosen" still
    // requires the "not" between the words — a bare "computed … chosen" fails.
    const doc = readFileSync(docPath, "utf8").toLowerCase().replace(/\s+/g, " ")
    for (const term of [
      "fail-closed",
      "truncation",
      "named fields",
      "computed, not chosen",
      "exhaustion",
    ]) {
      expect(doc).toContain(term)
    }
  })

  it("keeps triglav.md in sync with the reader contract (truncation field + fail-closed)", () => {
    // "never synthesize" (negated phrase), NOT a bare "synthesize" token —
    // a bare token is direction-blind and would pass on an instruction TO synthesize.
    // The `\s+` keeps the negation reflow-invariant: it still requires "never"
    // immediately before "synthesize", but tolerates a re-wrap splitting the two.
    const triglav = readFileSync(triglavPath, "utf8")
    expect(triglav).toContain("truncation:")
    expect(triglav).toMatch(/never\s+synthesize/i)
  })

  it("keeps the docs/plugins/qa.md → agent-contracts.md back-link wired", () => {
    // Pin the actual Markdown LINK, not a mention of the filename. The regex
    // requires the "](../agent-contracts.md)" link syntax, so it fails if the
    // back-link is unwired even while the string "agent-contracts.md" survives
    // in surrounding prose. The link target has no internal whitespace, so it
    // is inherently reflow-safe — no normalization needed.
    expect(existsSync(qaDocPath)).toBe(true)
    const qaDoc = readFileSync(qaDocPath, "utf8")
    expect(qaDoc).toMatch(/\]\(\.\.\/agent-contracts\.md\)/)
  })
})
