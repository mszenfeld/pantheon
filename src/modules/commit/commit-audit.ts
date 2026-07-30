import { createHash } from "node:crypto"

export interface CommitAuditEvent {
  event: string
  timestamp: string
  sessionId: string
  proposalId?: string
  authorizationId?: string
  reason?: string
  commitSha?: string
}

export interface CommitAuditSink {
  emit(event: CommitAuditEvent): void
}

export function createAuditSink(write: (line: string) => void = console.info): CommitAuditSink {
  return {
    emit(event: CommitAuditEvent): void {
      // IDs correlate lifecycle events but raw authorizations and Git content never enter logs.
      write(JSON.stringify({ ...event, proposalId: event.proposalId === undefined ? undefined : createHash("sha256").update(event.proposalId).digest("hex"), authorizationId: event.authorizationId === undefined ? undefined : createHash("sha256").update(event.authorizationId).digest("hex") }))
    },
  }
}
