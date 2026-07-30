import { randomBytes } from "node:crypto"
import type { CommitAuditSink } from "./commit-audit.js"
import { createAuditSink } from "./commit-audit.js"
import type { CommitScopeSnapshot } from "./git-scope-snapshot.js"

export interface PendingProposal {
  id: string
  sessionId: string
  message: string
  challenge: string
  rendered: string
  snapshot: CommitScopeSnapshot
  expiresAt: number
}

export interface CommitAuthorization {
  token: string
  sessionId: string
  message: string
  snapshot: CommitScopeSnapshot
  state: "pending" | "in-flight" | "consumed" | "invalidated"
  expiresAt: number
}

export interface TranscriptMessage {
  role: string
  text: string
}

const LIFETIME_MS = 5 * 60 * 1000

function opaque(): string {
  return randomBytes(32).toString("hex")
}

function renderProposal(message: string, challenge: string, snapshot: CommitScopeSnapshot): string {
  const changes = snapshot.changes.map((change) => {
    if (change.status === "renamed") return `- renamed ${change.renameFrom} → ${change.path}`
    if (change.status === "deleted") return `- deleted (destructive) ${change.path}`
    return `- ${change.status} ${change.path}`
  })
  return ["Perun exact commit scope", `Intent: ${message}`, "Included changes:", ...changes, "Excluded changes: none", `Reply exactly: Commit this exact scope ${challenge}`, "Or reply: Abort"].join("\n")
}

export class PerunCommitConsentStore {
  private readonly proposals = new Map<string, PendingProposal>()
  private readonly authorizations = new Map<string, CommitAuthorization>()
  private readonly audit: CommitAuditSink

  constructor(audit: CommitAuditSink = createAuditSink(), private readonly now: () => number = Date.now) {
    this.audit = audit
  }

  prepare(sessionId: string, message: string, snapshot: CommitScopeSnapshot): PendingProposal {
    if (snapshot.changes.length === 0) throw new Error("Perun commit scope: no current changes to propose.")
    const id = opaque()
    const challenge = opaque()
    const proposal: PendingProposal = { id, sessionId, message, challenge, rendered: renderProposal(message, challenge, snapshot), snapshot, expiresAt: this.now() + LIFETIME_MS }
    this.proposals.set(id, proposal)
    this.audit.emit({ event: "proposal.created", timestamp: new Date(this.now()).toISOString(), sessionId, proposalId: id })
    return proposal
  }

  authorize(proposalId: string, sessionId: string, transcript: readonly TranscriptMessage[]): CommitAuthorization {
    const proposal = this.proposals.get(proposalId)
    if (proposal === undefined || proposal.sessionId !== sessionId || proposal.expiresAt <= this.now()) {
      this.audit.emit({ event: "consent.expired", timestamp: new Date(this.now()).toISOString(), sessionId, proposalId })
      throw new Error("Perun commit consent: proposal is missing, expired, or belongs to another session.")
    }
    const last = transcript.at(-1)
    const previous = transcript.at(-2)
    if (previous?.role !== "assistant" || previous.text !== proposal.rendered || last?.role !== "user") {
      throw new Error("Perun commit consent: the exact proposal must be immediately followed by a user response.")
    }
    if (last.text === "Abort") {
      this.proposals.delete(proposalId)
      this.audit.emit({ event: "consent.rejected", timestamp: new Date(this.now()).toISOString(), sessionId, proposalId })
      throw new Error("Perun commit consent: proposal aborted.")
    }
    if (last.text !== `Commit this exact scope ${proposal.challenge}`) {
      throw new Error("Perun commit consent: user response does not match the fresh challenge.")
    }
    const token = opaque()
    const authorization: CommitAuthorization = { token, sessionId, message: proposal.message, snapshot: proposal.snapshot, state: "pending", expiresAt: proposal.expiresAt }
    this.authorizations.set(token, authorization)
    this.proposals.delete(proposalId)
    this.audit.emit({ event: "consent.accepted", timestamp: new Date(this.now()).toISOString(), sessionId, proposalId, authorizationId: token })
    return authorization
  }

  take(token: string, sessionId: string, message: string): CommitAuthorization {
    const authorization = this.authorizations.get(token)
    if (authorization === undefined || authorization.sessionId !== sessionId || authorization.state !== "pending" || authorization.expiresAt <= this.now() || authorization.message !== message) {
      throw new Error("Perun commit authorization: invalid, expired, consumed, or mismatched.")
    }
    authorization.state = "in-flight"
    this.audit.emit({ event: "authorization.started", timestamp: new Date(this.now()).toISOString(), sessionId, authorizationId: token })
    return authorization
  }

  consume(authorization: CommitAuthorization, succeeded: boolean): void {
    authorization.state = "consumed"
    this.audit.emit({ event: succeeded ? "commit.succeeded" : "commit.failed", timestamp: new Date(this.now()).toISOString(), sessionId: authorization.sessionId, authorizationId: authorization.token })
  }

  clearSession(sessionId: string): void {
    for (const [id, proposal] of this.proposals) if (proposal.sessionId === sessionId) this.proposals.delete(id)
    for (const [token, authorization] of this.authorizations) if (authorization.sessionId === sessionId) this.authorizations.delete(token)
  }

  sweep(): void {
    const now = this.now()
    for (const [id, proposal] of this.proposals) if (proposal.expiresAt <= now) this.proposals.delete(id)
    for (const [token, authorization] of this.authorizations) if (authorization.expiresAt <= now) this.authorizations.delete(token)
  }
}
