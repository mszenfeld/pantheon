import { CommitAuditSink } from './commit-audit.js';
import { CommitScopeSnapshot } from './git-scope-snapshot.js';

interface PendingProposal {
    id: string;
    sessionId: string;
    message: string;
    challenge: string;
    rendered: string;
    snapshot: CommitScopeSnapshot;
    expiresAt: number;
}
interface CommitAuthorization {
    token: string;
    sessionId: string;
    message: string;
    snapshot: CommitScopeSnapshot;
    state: "pending" | "in-flight" | "consumed" | "invalidated";
    expiresAt: number;
}
interface TranscriptMessage {
    role: string;
    text: string;
}
declare class PerunCommitConsentStore {
    private readonly now;
    private readonly proposals;
    private readonly authorizations;
    private readonly audit;
    constructor(audit?: CommitAuditSink, now?: () => number);
    prepare(sessionId: string, message: string, snapshot: CommitScopeSnapshot): PendingProposal;
    authorize(proposalId: string, sessionId: string, transcript: readonly TranscriptMessage[]): CommitAuthorization;
    take(token: string, sessionId: string, message: string): CommitAuthorization;
    consume(authorization: CommitAuthorization, succeeded: boolean): void;
    clearSession(sessionId: string): void;
    sweep(): void;
}

export { type CommitAuthorization, type PendingProposal, PerunCommitConsentStore, type TranscriptMessage };
