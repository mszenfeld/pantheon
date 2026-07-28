const COORDINATOR_AGENT_NAME = "Perun - Coordinator";
async function getSessionAgent(sessionID, client) {
  try {
    const res = await client.session.messages({ path: { id: sessionID } });
    const msgs = res.data ?? [];
    const firstUser = msgs.find((m) => m.info?.role === "user")?.info;
    return firstUser?.agent;
  } catch {
    return void 0;
  }
}
const sessionAgentCache = /* @__PURE__ */ new Map();
const inFlight = /* @__PURE__ */ new Map();
const NEGATIVE_CACHE_AFTER_MISSES = 3;
const NEGATIVE_CACHE_TTL_MS = 5e3;
const missCounts = /* @__PURE__ */ new Map();
const negativeCacheUntil = /* @__PURE__ */ new Map();
async function getSessionAgentCached(sessionID, client) {
  const cached = sessionAgentCache.get(sessionID);
  if (cached !== void 0) return cached;
  const suppressUntil = negativeCacheUntil.get(sessionID);
  if (suppressUntil !== void 0) {
    if (suppressUntil > Date.now()) return void 0;
    negativeCacheUntil.delete(sessionID);
  }
  const pending = inFlight.get(sessionID);
  if (pending !== void 0) return pending;
  const promise = (async () => {
    const agent = await getSessionAgent(sessionID, client);
    if (agent !== void 0) {
      sessionAgentCache.set(sessionID, agent);
      missCounts.delete(sessionID);
      negativeCacheUntil.delete(sessionID);
    } else {
      const misses = (missCounts.get(sessionID) ?? 0) + 1;
      missCounts.set(sessionID, misses);
      if (misses >= NEGATIVE_CACHE_AFTER_MISSES) {
        negativeCacheUntil.set(sessionID, Date.now() + NEGATIVE_CACHE_TTL_MS);
        missCounts.delete(sessionID);
      }
    }
    return agent;
  })();
  inFlight.set(sessionID, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(sessionID) === promise) inFlight.delete(sessionID);
  }
}
function forgetSessionAgent(sessionID) {
  sessionAgentCache.delete(sessionID);
  inFlight.delete(sessionID);
  missCounts.delete(sessionID);
  negativeCacheUntil.delete(sessionID);
}
async function isCoordinatorSession(sessionID, client) {
  return await getSessionAgentCached(sessionID, client) === COORDINATOR_AGENT_NAME;
}
export {
  COORDINATOR_AGENT_NAME,
  forgetSessionAgent,
  getSessionAgent,
  getSessionAgentCached,
  isCoordinatorSession
};
