import { createHash } from "node:crypto";
function createAuditSink(write = console.info) {
  return {
    emit(event) {
      write(JSON.stringify({ ...event, proposalId: event.proposalId === void 0 ? void 0 : createHash("sha256").update(event.proposalId).digest("hex"), authorizationId: event.authorizationId === void 0 ? void 0 : createHash("sha256").update(event.authorizationId).digest("hex") }));
    }
  };
}
export {
  createAuditSink
};
