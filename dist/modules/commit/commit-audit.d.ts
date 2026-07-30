interface CommitAuditEvent {
    event: string;
    timestamp: string;
    sessionId: string;
    proposalId?: string;
    authorizationId?: string;
    reason?: string;
    commitSha?: string;
}
interface CommitAuditSink {
    emit(event: CommitAuditEvent): void;
}
declare function createAuditSink(write?: (line: string) => void): CommitAuditSink;

export { type CommitAuditEvent, type CommitAuditSink, createAuditSink };
