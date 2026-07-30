import { describe, expect, it } from "vitest"
import { PerunCommitConsentStore } from "../../../src/modules/commit/perun-commit-consent.js"
import type { CommitScopeSnapshot } from "../../../src/modules/commit/git-scope-snapshot.js"

const snapshot: CommitScopeSnapshot = {
  repository: { root: "/repo", commonDir: "/repo/.git" },
  head: "head",
  changes: [{ path: "note.ts", status: "modified", porcelain: ".M" }],
  digest: "digest",
}

describe("PerunCommitConsentStore", () => {
  it("requires the immediately preceding exact proposal and consumes an authorization", () => {
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)
    const authorization = store.authorize(proposal.id, "session", [
      { role: "assistant", text: proposal.rendered },
      { role: "user", text: `Commit this exact scope ${proposal.challenge}` },
    ])

    expect(store.take(authorization.token, "session", "feat: add consent").state).toBe("in-flight")
    store.consume(authorization, true)
    expect(() => store.take(authorization.token, "session", "feat: add consent")).toThrow(/consumed/i)
  })

  it("rejects altered proposal text and cross-session use", () => {
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)
    expect(() => store.authorize(proposal.id, "other", [])).toThrow(/another session/i)
    expect(() => store.authorize(proposal.id, "session", [
      { role: "assistant", text: "altered" },
      { role: "user", text: `Commit this exact scope ${proposal.challenge}` },
    ])).toThrow(/exact proposal/i)
  })
})
