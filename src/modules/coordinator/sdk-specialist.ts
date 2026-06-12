import type {
  Agent,
  AssistantMessage,
  createOpencodeClient,
  Message,
} from "@opencode-ai/sdk"
import type { DispatchSpecialist, AgentInfo } from "./dispatch.js"
import type { PollerMessage } from "./poller.js"

/**
 * SDK adapter layer: bridges the strongly-typed OpenCode SDK client into the
 * plain `DispatchSpecialist` / `AgentInfo` shapes that `dispatchParallel`
 * consumes. Extracting this here keeps `index.ts` thin and — crucially — makes
 * the adapter independently unit-testable with a fake `OpencodeClient` (see
 * `tests/sdk-specialist.test.ts`).
 */
export type SDKClient = ReturnType<typeof createOpencodeClient>

export function createSDKSpecialist(
  client: SDKClient,
  parentSessionID: string,
): DispatchSpecialist {
  return {
    async startTask(
      agentName: string,
      prompt: string,
      onSessionCreated?: (sessionId: string) => void,
    ): Promise<string> {
      // OpenCode's session.create body accepts only parentID/title — the target
      // agent is bound on the subsequent prompt call. Two-step is required.
      const created = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: `[perun] dispatch to ${agentName}`,
        },
      })
      const sessionId: string = created.data?.id ?? ""
      if (sessionId.length === 0) {
        throw new Error(
          `createSession returned no session id for agent ${agentName}`,
        )
      }

      // Fire the created-callback BEFORE prompting. The turn runs server-side
      // (incl. the bash calls that trigger the `shell.env` hook), so the
      // child→agent mapping must be recorded here — recording it after
      // `startTask` resolves would be after the hook already ran. Defensive
      // try/catch: a callback fault must not abort the dispatch.
      try {
        onSessionCreated?.(sessionId)
      } catch (err) {
        // Swallow: registration is best-effort and must not break the turn.
        // But leave an observability breadcrumb — without it, a failed binding
        // registration silently stops `shell.env` injection with no trace (the
        // exact symptom this dispatch path is meant to fix). The breadcrumb
        // call is itself best-effort: `client.app.log` returns a promise we do
        // NOT await (the turn must not block on it), and a `.catch` keeps a
        // rejected log from resurfacing as an unhandled rejection — neither the
        // swallow semantics nor the dispatch are affected.
        void client.app
          .log({
            body: {
              service: "perun/dispatch",
              level: "warn",
              message: `onSessionCreated callback threw for agent ${agentName} (session ${sessionId}); binding injection may not occur — continuing dispatch`,
              extra: {
                error: err instanceof Error ? err.message : String(err),
              },
            },
          })
          .catch(() => {})
      }

      // Fire-and-forget the turn via `promptAsync` (returns 204 immediately;
      // the server runs the LLM turn autonomously). We deliberately do NOT use
      // the blocking `session.prompt` here: awaiting it would park this worker
      // inside an un-timed, un-abortable call for the WHOLE turn, so the
      // 5-minute `taskTimeoutMs` and `ToolContext.abort` would only govern the
      // post-turn confirmatory poll — never the turn itself (a hung specialist
      // would block the worker, the dispatch, and Perun's turn indefinitely,
      // and an aborting user could not cancel the child server-side). By firing
      // async and letting `dispatch.ts`'s `pollUntilIdle` drive completion, the
      // task timeout and abort signal cover the ENTIRE turn — and abort reaches
      // `abortTask(sessionId)` while the child is still running, cancelling it
      // server-side. This mirrors the background path (`startBackground`) so
      // both dispatch primitives honour the same documented runtime contract.
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          agent: agentName,
          parts: [{ type: "text", text: prompt }],
        },
      })

      return sessionId
    },
    async fetchMessages(sessionId: string): Promise<PollerMessage[]> {
      const result = await client.session.messages({ path: { id: sessionId } })
      const list = result.data ?? []
      // Project to `[last]` here so the poller never holds the full
      // transcript in memory. `pollUntilIdle` only inspects `messages[last]`,
      // so returning a singleton (or empty) list is sufficient for the
      // poller's contract while bounding allocations to O(1) per poll instead
      // of O(transcript-length). Combined with `maxBytes` (which caps the
      // last message's content), this makes `pollUntilIdle.maxBytes` a true
      // per-poll memory bound.
      return list.length === 0 ? [] : [toPollerMessage(list[list.length - 1]!)]
    },
    async abortTask(sessionId: string): Promise<void> {
      // POST /session/{id}/abort — server-side cleanup of an in-flight child
      // session when the parent's abort signal fires. Errors are surfaced to
      // the caller but `dispatch.ts` already swallows them on the abort path,
      // so this remains best-effort end to end.
      await client.session.abort({ path: { id: sessionId } })
    },
    async isSessionActive(sessionId: string): Promise<boolean> {
      // GET /session/status returns a map of NON-idle sessions only — the
      // server deletes an entry when it sets the session idle, so absence
      // from the map means idle. `busy` covers the whole turn loop (set at
      // every step) and `retry` covers provider backoff between attempts;
      // both mean "the turn is still in flight, do not collect". Errors are
      // swallowed to `false` so a broken status endpoint degrades the
      // completion check to message-only instead of failing the dispatch —
      // same contract as oh-my-openagent's `isSessionActive`.
      try {
        const result = await client.session.status()
        const status = (result.data ?? {})[sessionId]
        return (
          status !== undefined && ACTIVE_SESSION_STATUS_TYPES.has(status.type)
        )
      } catch {
        return false
      }
    },
    async startBackground(agentName: string, prompt: string): Promise<string> {
      // NOTE: unlike `startTask`, `startBackground` takes no `onSessionCreated`
      // callback — the background turn is fire-and-forget (`promptAsync`) and
      // consults no `shell.env` bindings, so it has no before-the-turn ordering
      // constraint. Identity registration in `sessionAgentRegistry` is instead
      // done by the CALLER (`background.ts` `startBackgroundTask`) right after
      // this resolves: that flips the child out of the caller gate's "is the
      // coordinator" bucket. This adapter stays bindings-free; the QA module's
      // generic `session.deleted` unregister covers cleanup.
      // See background.ts `startBackgroundTask` for the registration-site note.
      const created = await client.session.create({
        body: {
          parentID: parentSessionID,
          title: `[perun] background ${agentName}`,
        },
      })
      const sessionId: string = created.data?.id ?? ""
      if (sessionId.length === 0) {
        throw new Error(
          `startBackground returned no session id for agent ${agentName}`,
        )
      }
      // Fire-and-forget: promptAsync returns 204 immediately; the server runs
      // the LLM turn autonomously. We do NOT await the turn — completion is
      // observed later by polling the child session (poll_background/wait_background).
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          agent: agentName,
          parts: [{ type: "text", text: prompt }],
        },
      })
      return sessionId
    },
  }
}

/**
 * Session-status types that mean "the turn loop is still in flight". The
 * server's status map only ever contains non-idle sessions, so this set is
 * matched against present entries; `"running"` is not emitted by the current
 * SDK but is included for forward compatibility (mirrors oh-my-openagent's
 * `ACTIVE_SESSION_STATUSES`).
 */
export const ACTIVE_SESSION_STATUS_TYPES: ReadonlySet<string> = new Set([
  "busy",
  "retry",
  "running",
])

/**
 * Finish reasons the OpenCode turn loop does NOT treat as terminal. The server
 * persists `finish` on the assistant message after EVERY LLM step —
 * `"tool-calls"` for an intermediate step — and its own loop-exit predicate is
 * `finish && !["tool-calls", "unknown"].includes(finish) && !hasToolCalls`
 * (packages/opencode/src/session/prompt.ts in sst/opencode). Treating any
 * truthy finish as terminal made dispatch collect mid-turn with an empty
 * result while the child kept running; this set keeps the adapter pinned to
 * the server's semantics.
 */
const NON_TERMINAL_FINISH_REASONS: ReadonlySet<string> = new Set([
  "tool-calls",
  "unknown",
])

/**
 * Type guard that narrows `Message` (UserMessage | AssistantMessage) down to
 * `AssistantMessage` via the SDK's discriminated `role` field. Using a guard
 * — instead of `as AssistantMessage` — lets the compiler verify the narrowing
 * is sound, so any future SDK change to the discriminant surfaces as a type
 * error here rather than as a silent runtime cast.
 */
function isAssistant(message: Message): message is AssistantMessage {
  return message.role === "assistant"
}

export function toPollerMessage(raw: {
  info: Message
  parts: Array<{
    type: string
    text?: string
    metadata?: Record<string, unknown>
  }>
}): PollerMessage {
  const role: string = raw.info.role
  const text = raw.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")
  const rawFinish: string | null =
    isAssistant(raw.info) && typeof raw.info.finish === "string"
      ? raw.info.finish
      : null
  // Some providers return "stop" even when the message contains tool calls —
  // the server keeps the loop running so tool results can be sent back, and
  // excludes provider-executed tools (which never produce a follow-up step).
  // Mirror both rules so `finish_reason` is truthy ONLY for a finish the
  // server's own loop would exit on.
  const hasClientToolCalls = raw.parts.some(
    (p) => p.type === "tool" && !p.metadata?.["providerExecuted"],
  )
  const finishReason: string | null =
    rawFinish !== null &&
    !NON_TERMINAL_FINISH_REASONS.has(rawFinish) &&
    !hasClientToolCalls
      ? rawFinish
      : null
  return {
    role,
    content: text,
    finish_reason: finishReason,
  }
}

/**
 * TTL for the agent-registry cache (60 s). The registry only changes when the
 * OpenCode server reloads plugins, which is rare relative to dispatch volume —
 * but we keep a TTL (rather than caching forever) so a hot-reloaded plugin's
 * new agents are picked up within a minute without restarting the coordinator.
 */
export const AGENT_REGISTRY_TTL_MS = 60_000

interface RegistryCacheEntry {
  /**
   * Stored as a Promise (not the resolved value) so concurrent first-calls
   * dedupe into a single HTTP request: the second caller observes the
   * in-flight promise via the cache and awaits it instead of firing again.
   */
  promise: Promise<Record<string, AgentInfo>>
  expiresAt: number
}

/**
 * Per-client cache. WeakMap-keyed so the cache is naturally released when an
 * `SDKClient` goes out of scope — no manual reset hook needed for tests, and
 * no cross-test pollution. Module-scope state survives `loadAgentRegistry`
 * calls within the same client identity, which is exactly the use case.
 */
const registryCache = new WeakMap<SDKClient, RegistryCacheEntry>()

export async function loadAgentRegistry(
  client: SDKClient,
): Promise<Record<string, AgentInfo>> {
  const now = Date.now()
  const cached = registryCache.get(client)
  if (cached !== undefined && cached.expiresAt > now) {
    return cached.promise
  }

  const promise = fetchAgentRegistry(client)
  registryCache.set(client, { promise, expiresAt: now + AGENT_REGISTRY_TTL_MS })

  // Invalidate the cache on failure so transient HTTP errors don't pin the
  // coordinator in a permanently-broken state. Only delete if the entry still
  // points at THIS promise — a later successful refresh may have replaced it.
  // `.catch` here returns a new promise we deliberately discard; the original
  // `promise` rejection still propagates to whoever awaits it below.
  promise.catch(() => {
    if (registryCache.get(client)?.promise === promise) {
      registryCache.delete(client)
    }
  })

  return promise
}

async function fetchAgentRegistry(
  client: SDKClient,
): Promise<Record<string, AgentInfo>> {
  let list: Agent[]
  try {
    const result = await client.app.agents()
    list = result.data ?? []
  } catch (err) {
    throw new Error(
      `dispatch_parallel: failed to load agent registry from SDK: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  const registry: Record<string, AgentInfo> = {}
  for (const agent of list) {
    const name = agent.name
    if (name.length > 0) {
      // Preserve the SDK's three-way mode union ("subagent" | "primary" | "all")
      // — dispatchParallel enforces default-deny against anything other than
      // strict "subagent" to keep anti-recursion guarantees intact.
      registry[name] = { mode: agent.mode }
    }
  }
  return registry
}
