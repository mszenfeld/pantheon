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

  it("authorizes when the transcript still ends with Perun's own in-flight turn", () => {
    // `authorize_perun_commit_scope` is called from inside Perun's assistant turn, so the tail of
    // the transcript is that turn — not the user's reply. Anchoring on the tail deadlocks the flow.
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)

    const authorization = store.authorize(proposal.id, "session", [
      { role: "user", text: "/commit" },
      { role: "assistant", text: proposal.rendered },
      { role: "user", text: `Commit this exact scope ${proposal.challenge}` },
      { role: "assistant", text: "" },
    ])

    expect(authorization.token).not.toBe("")
    expect(authorization.snapshot).toBe(snapshot)
  })

  it("refuses once the user has spoken again after the reply", () => {
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)

    expect(() =>
      store.authorize(proposal.id, "session", [
        { role: "assistant", text: proposal.rendered },
        { role: "user", text: `Commit this exact scope ${proposal.challenge}` },
        { role: "assistant", text: "committed?" },
        { role: "user", text: "wait, not that one" },
      ]),
    ).toThrow(/moved on after the reply/i)
  })

  it("refuses a reply that does not carry the fresh challenge", () => {
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)

    expect(() =>
      store.authorize(proposal.id, "session", [
        { role: "assistant", text: proposal.rendered },
        { role: "user", text: "Commit this exact scope please" },
      ]),
    ).toThrow(/fresh challenge/i)
  })

  it("drops the proposal on Abort so the same consent cannot be retried", () => {
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)
    const transcript = [
      { role: "assistant", text: proposal.rendered },
      { role: "user", text: "Abort" },
    ]

    expect(() => store.authorize(proposal.id, "session", transcript)).toThrow(/aborted/i)
    expect(() => store.authorize(proposal.id, "session", transcript)).toThrow(
      /missing, expired, or belongs to another session/i,
    )
  })

  it("expires a proposal and the authorization it minted after five minutes", () => {
    let now = 0
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => now)
    const stale = store.prepare("session", "feat: add consent", snapshot)
    now = 5 * 60 * 1000
    expect(() => store.authorize(stale.id, "session", [
      { role: "assistant", text: stale.rendered },
      { role: "user", text: `Commit this exact scope ${stale.challenge}` },
    ])).toThrow(/expired/i)

    now = 0
    const fresh = store.prepare("session", "feat: add consent", snapshot)
    const authorization = store.authorize(fresh.id, "session", [
      { role: "assistant", text: fresh.rendered },
      { role: "user", text: `Commit this exact scope ${fresh.challenge}` },
    ])
    now = 5 * 60 * 1000
    expect(() => store.take(authorization.token, "session", "feat: add consent")).toThrow(
      /invalid, expired, consumed, or mismatched/i,
    )
  })

  it("binds an authorization to its session and its exact message", () => {
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)
    const authorization = store.authorize(proposal.id, "session", [
      { role: "assistant", text: proposal.rendered },
      { role: "user", text: `Commit this exact scope ${proposal.challenge}` },
    ])

    expect(() => store.take(authorization.token, "other", "feat: add consent")).toThrow(
      /invalid, expired, consumed, or mismatched/i,
    )
    expect(() => store.take(authorization.token, "session", "feat: something else")).toThrow(
      /invalid, expired, consumed, or mismatched/i,
    )
    expect(() => store.take("not-a-token", "session", "feat: add consent")).toThrow(
      /invalid, expired, consumed, or mismatched/i,
    )
    // A rejected take must not have burned the still-valid authorization.
    expect(store.take(authorization.token, "session", "feat: add consent").state).toBe("in-flight")
  })

  it("refuses a second take even when the first commit failed", () => {
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)
    const authorization = store.authorize(proposal.id, "session", [
      { role: "assistant", text: proposal.rendered },
      { role: "user", text: `Commit this exact scope ${proposal.challenge}` },
    ])

    store.take(authorization.token, "session", "feat: add consent")
    store.consume(authorization, false)

    expect(() => store.take(authorization.token, "session", "feat: add consent")).toThrow(
      /invalid, expired, consumed, or mismatched/i,
    )
  })

  it("clears a deleted session's pending proposals and authorizations", () => {
    const store = new PerunCommitConsentStore({ emit(): void {} }, () => 1)
    const proposal = store.prepare("session", "feat: add consent", snapshot)
    const authorization = store.authorize(proposal.id, "session", [
      { role: "assistant", text: proposal.rendered },
      { role: "user", text: `Commit this exact scope ${proposal.challenge}` },
    ])
    const survivor = store.prepare("other-session", "feat: add consent", snapshot)

    store.clearSession("session")

    expect(() => store.take(authorization.token, "session", "feat: add consent")).toThrow(
      /invalid, expired, consumed, or mismatched/i,
    )
    expect(
      store.authorize(survivor.id, "other-session", [
        { role: "assistant", text: survivor.rendered },
        { role: "user", text: `Commit this exact scope ${survivor.challenge}` },
      ]).token,
    ).not.toBe("")
  })

  it("emits an audit record for every accepted, rejected, and completed consent", () => {
    const events: string[] = []
    const store = new PerunCommitConsentStore(
      { emit: (record: { event: string }): void => void events.push(record.event) },
      () => 1,
    )
    const proposal = store.prepare("session", "feat: add consent", snapshot)
    const authorization = store.authorize(proposal.id, "session", [
      { role: "assistant", text: proposal.rendered },
      { role: "user", text: `Commit this exact scope ${proposal.challenge}` },
    ])
    store.take(authorization.token, "session", "feat: add consent")
    store.consume(authorization, true)

    expect(events).toEqual([
      "proposal.created",
      "consent.accepted",
      "authorization.started",
      "commit.succeeded",
    ])
  })
})
