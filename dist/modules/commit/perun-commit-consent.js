import { randomBytes } from "node:crypto";
import { createAuditSink } from "./commit-audit.js";
const LIFETIME_MS = 5 * 60 * 1e3;
function opaque() {
  return randomBytes(32).toString("hex");
}
function renderProposal(message, challenge, snapshot) {
  const changes = snapshot.changes.map((change) => {
    if (change.status === "renamed") return `- renamed ${change.renameFrom} \u2192 ${change.path}`;
    if (change.status === "deleted") return `- deleted (destructive) ${change.path}`;
    return `- ${change.status} ${change.path}`;
  });
  return ["Perun exact commit scope", `Intent: ${message}`, "Included changes:", ...changes, "Excluded changes: none", `Reply exactly: Commit this exact scope ${challenge}`, "Or reply: Abort"].join("\n");
}
class PerunCommitConsentStore {
  constructor(audit = createAuditSink(), now = Date.now) {
    this.now = now;
    this.audit = audit;
  }
  now;
  proposals = /* @__PURE__ */ new Map();
  authorizations = /* @__PURE__ */ new Map();
  audit;
  prepare(sessionId, message, snapshot) {
    if (snapshot.changes.length === 0) throw new Error("Perun commit scope: no current changes to propose.");
    const id = opaque();
    const challenge = opaque();
    const proposal = { id, sessionId, message, challenge, rendered: renderProposal(message, challenge, snapshot), snapshot, expiresAt: this.now() + LIFETIME_MS };
    this.proposals.set(id, proposal);
    this.audit.emit({ event: "proposal.created", timestamp: new Date(this.now()).toISOString(), sessionId, proposalId: id });
    return proposal;
  }
  authorize(proposalId, sessionId, transcript) {
    const proposal = this.proposals.get(proposalId);
    if (proposal === void 0 || proposal.sessionId !== sessionId || proposal.expiresAt <= this.now()) {
      this.audit.emit({ event: "consent.expired", timestamp: new Date(this.now()).toISOString(), sessionId, proposalId });
      throw new Error("Perun commit consent: proposal is missing, expired, or belongs to another session.");
    }
    let proposalIndex = -1;
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      const message = transcript[index];
      if (message?.role === "assistant" && message.text === proposal.rendered) {
        proposalIndex = index;
        break;
      }
    }
    const last = proposalIndex === -1 ? void 0 : transcript[proposalIndex + 1];
    if (last?.role !== "user") {
      throw new Error("Perun commit consent: the exact proposal must be immediately followed by a user response.");
    }
    if (transcript.slice(proposalIndex + 2).some((message) => message.role === "user")) {
      throw new Error("Perun commit consent: the conversation moved on after the reply; re-propose the scope.");
    }
    if (last.text === "Abort") {
      this.proposals.delete(proposalId);
      this.audit.emit({ event: "consent.rejected", timestamp: new Date(this.now()).toISOString(), sessionId, proposalId });
      throw new Error("Perun commit consent: proposal aborted.");
    }
    if (last.text !== `Commit this exact scope ${proposal.challenge}`) {
      throw new Error("Perun commit consent: user response does not match the fresh challenge.");
    }
    const token = opaque();
    const authorization = { token, sessionId, message: proposal.message, snapshot: proposal.snapshot, state: "pending", expiresAt: proposal.expiresAt };
    this.authorizations.set(token, authorization);
    this.proposals.delete(proposalId);
    this.audit.emit({ event: "consent.accepted", timestamp: new Date(this.now()).toISOString(), sessionId, proposalId, authorizationId: token });
    return authorization;
  }
  take(token, sessionId, message) {
    const authorization = this.authorizations.get(token);
    if (authorization === void 0 || authorization.sessionId !== sessionId || authorization.state !== "pending" || authorization.expiresAt <= this.now() || authorization.message !== message) {
      throw new Error("Perun commit authorization: invalid, expired, consumed, or mismatched.");
    }
    authorization.state = "in-flight";
    this.audit.emit({ event: "authorization.started", timestamp: new Date(this.now()).toISOString(), sessionId, authorizationId: token });
    return authorization;
  }
  consume(authorization, succeeded) {
    authorization.state = "consumed";
    this.audit.emit({ event: succeeded ? "commit.succeeded" : "commit.failed", timestamp: new Date(this.now()).toISOString(), sessionId: authorization.sessionId, authorizationId: authorization.token });
  }
  clearSession(sessionId) {
    for (const [id, proposal] of this.proposals) if (proposal.sessionId === sessionId) this.proposals.delete(id);
    for (const [token, authorization] of this.authorizations) if (authorization.sessionId === sessionId) this.authorizations.delete(token);
  }
  sweep() {
    const now = this.now();
    for (const [id, proposal] of this.proposals) if (proposal.expiresAt <= now) this.proposals.delete(id);
    for (const [token, authorization] of this.authorizations) if (authorization.expiresAt <= now) this.authorizations.delete(token);
  }
}
export {
  PerunCommitConsentStore
};
