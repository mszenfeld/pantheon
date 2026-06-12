function createSDKSpecialist(client, parentSessionID) {
  return {
    async startTask(agentName, prompt, onSessionCreated) {
      const created = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: `[perun] dispatch to ${agentName}`
        }
      });
      const sessionId = created.data?.id ?? "";
      if (sessionId.length === 0) {
        throw new Error(
          `createSession returned no session id for agent ${agentName}`
        );
      }
      try {
        onSessionCreated?.(sessionId);
      } catch (err) {
        void client.app.log({
          body: {
            service: "perun/dispatch",
            level: "warn",
            message: `onSessionCreated callback threw for agent ${agentName} (session ${sessionId}); binding injection may not occur \u2014 continuing dispatch`,
            extra: {
              error: err instanceof Error ? err.message : String(err)
            }
          }
        }).catch(() => {
        });
      }
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          agent: agentName,
          parts: [{ type: "text", text: prompt }]
        }
      });
      return sessionId;
    },
    async fetchMessages(sessionId) {
      const result = await client.session.messages({ path: { id: sessionId } });
      const list = result.data ?? [];
      return list.length === 0 ? [] : [toPollerMessage(list[list.length - 1])];
    },
    async abortTask(sessionId) {
      await client.session.abort({ path: { id: sessionId } });
    },
    async isSessionActive(sessionId) {
      try {
        const result = await client.session.status();
        const status = (result.data ?? {})[sessionId];
        return status !== void 0 && ACTIVE_SESSION_STATUS_TYPES.has(status.type);
      } catch {
        return false;
      }
    },
    async startBackground(agentName, prompt) {
      const created = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: `[perun] background ${agentName}`
        }
      });
      const sessionId = created.data?.id ?? "";
      if (sessionId.length === 0) {
        throw new Error(
          `startBackground returned no session id for agent ${agentName}`
        );
      }
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          agent: agentName,
          parts: [{ type: "text", text: prompt }]
        }
      });
      return sessionId;
    }
  };
}
const ACTIVE_SESSION_STATUS_TYPES = /* @__PURE__ */ new Set([
  "busy",
  "retry",
  "running"
]);
const NON_TERMINAL_FINISH_REASONS = /* @__PURE__ */ new Set([
  "tool-calls",
  "unknown"
]);
function isAssistant(message) {
  return message.role === "assistant";
}
function toPollerMessage(raw) {
  const role = raw.info.role;
  const text = raw.parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
  const rawFinish = isAssistant(raw.info) && typeof raw.info.finish === "string" ? raw.info.finish : null;
  const hasClientToolCalls = raw.parts.some(
    (p) => p.type === "tool" && !p.metadata?.["providerExecuted"]
  );
  const finishReason = rawFinish !== null && !NON_TERMINAL_FINISH_REASONS.has(rawFinish) && !hasClientToolCalls ? rawFinish : null;
  return {
    role,
    content: text,
    finish_reason: finishReason
  };
}
const AGENT_REGISTRY_TTL_MS = 6e4;
const registryCache = /* @__PURE__ */ new WeakMap();
async function loadAgentRegistry(client) {
  const now = Date.now();
  const cached = registryCache.get(client);
  if (cached !== void 0 && cached.expiresAt > now) {
    return cached.promise;
  }
  const promise = fetchAgentRegistry(client);
  registryCache.set(client, { promise, expiresAt: now + AGENT_REGISTRY_TTL_MS });
  promise.catch(() => {
    if (registryCache.get(client)?.promise === promise) {
      registryCache.delete(client);
    }
  });
  return promise;
}
async function fetchAgentRegistry(client) {
  let list;
  try {
    const result = await client.app.agents();
    list = result.data ?? [];
  } catch (err) {
    throw new Error(
      `dispatch_parallel: failed to load agent registry from SDK: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const registry = {};
  for (const agent of list) {
    const name = agent.name;
    if (name.length > 0) {
      registry[name] = { mode: agent.mode };
    }
  }
  return registry;
}
export {
  ACTIVE_SESSION_STATUS_TYPES,
  AGENT_REGISTRY_TTL_MS,
  createSDKSpecialist,
  loadAgentRegistry,
  toPollerMessage
};
