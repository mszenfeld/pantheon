import { afterEach, describe, expect, it, vi } from "vitest"
import type { Agent, AssistantMessage, Message } from "@opencode-ai/sdk"
import {
  AGENT_REGISTRY_TTL_MS,
  createSDKSpecialist,
  loadAgentRegistry,
  toPollerMessage,
  type SDKClient,
} from "../../../src/modules/coordinator/sdk-specialist.js"

/**
 * Fake `OpencodeClient` recorder — keeps a permanent transcript of every call
 * argument as a plain array. We deliberately avoid `vi.fn` / spies: the project
 * convention is "fakes over mocks" so assertions read against real data rather
 * than mock-machinery affordances.
 *
 * Only the four methods exercised by the SDK adapter are implemented. The
 * shape is cast through `unknown` to `SDKClient` because the real client has
 * a much wider surface than the adapter touches.
 */
interface FakeClient {
  client: SDKClient
  calls: {
    sessionCreate: Array<Record<string, unknown>>
    sessionPrompt: Array<Record<string, unknown>>
    sessionPromptAsync: Array<Record<string, unknown>>
    sessionMessages: Array<Record<string, unknown>>
    sessionAbort: Array<Record<string, unknown>>
    sessionStatus: Array<Record<string, unknown> | undefined>
    appAgents: Array<Record<string, unknown> | undefined>
    appLog: Array<Record<string, unknown>>
  }
}

interface FakeClientConfig {
  createResponses?: Array<{ data?: { id?: string } | undefined }>
  promptResponse?: { data?: unknown }
  messagesResponses?: Record<
    string,
    {
      data?: Array<{
        info: Message
        parts: Array<{
          type: string
          text?: string
          metadata?: Record<string, unknown>
        }>
      }>
    }
  >
  agentsResponse?: { data?: Agent[] } | Error
  /**
   * Response for `session.status` — the server returns a map of NON-idle
   * sessions only ({ [sessionID]: { type: "busy" | "retry" } }); an Error makes
   * the endpoint reject (degraded-mode coverage).
   */
  statusResponse?: { data?: Record<string, { type: string }> } | Error
  /** When set, `app.log` rejects with this error — used to prove the breadcrumb is itself best-effort. */
  logRejectsWith?: Error
}

function makeFakeClient(config: FakeClientConfig = {}): FakeClient {
  const calls: FakeClient["calls"] = {
    sessionCreate: [],
    sessionPrompt: [],
    sessionPromptAsync: [],
    sessionMessages: [],
    sessionAbort: [],
    sessionStatus: [],
    appAgents: [],
    appLog: [],
  }

  let createIndex = 0

  const fake = {
    session: {
      async create(options: Record<string, unknown>) {
        calls.sessionCreate.push(options)
        const response = config.createResponses?.[createIndex] ?? {
          data: { id: "default-session-id" },
        }
        createIndex += 1
        return response
      },
      async prompt(options: Record<string, unknown>) {
        calls.sessionPrompt.push(options)
        return config.promptResponse ?? { data: {} }
      },
      async promptAsync(options: Record<string, unknown>) {
        calls.sessionPromptAsync.push(options)
        return config.promptResponse ?? { data: undefined }
      },
      async messages(
        options: { path: { id: string } } & Record<string, unknown>,
      ) {
        calls.sessionMessages.push(options)
        const id = options.path.id
        return config.messagesResponses?.[id] ?? { data: [] }
      },
      async abort(options: { path: { id: string } } & Record<string, unknown>) {
        calls.sessionAbort.push(options)
        return { data: true }
      },
      async status(options?: Record<string, unknown>) {
        calls.sessionStatus.push(options)
        if (config.statusResponse instanceof Error) {
          throw config.statusResponse
        }
        return config.statusResponse ?? { data: {} }
      },
    },
    app: {
      async agents(options?: Record<string, unknown>) {
        calls.appAgents.push(options)
        if (config.agentsResponse instanceof Error) {
          throw config.agentsResponse
        }
        return config.agentsResponse ?? { data: [] }
      },
      async log(options: Record<string, unknown>) {
        calls.appLog.push(options)
        if (config.logRejectsWith !== undefined) {
          throw config.logRejectsWith
        }
        return { data: true }
      },
    },
  }

  return {
    client: fake as unknown as SDKClient,
    calls,
  }
}

function makeAssistant(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: "msg-1",
    sessionID: "sess-1",
    role: "assistant",
    time: { created: 1700000000 },
    parentID: "parent-1",
    modelID: "model-1",
    providerID: "provider-1",
    mode: "default",
    path: { cwd: "/tmp", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    ...overrides,
  }
}

function makeAgent(
  overrides: Partial<Agent> & Pick<Agent, "name" | "mode">,
): Agent {
  return {
    description: undefined,
    builtIn: false,
    permission: {
      edit: "ask",
      bash: {},
    },
    tools: {},
    options: {},
    ...overrides,
  }
}

describe("createSDKSpecialist.startTask", () => {
  it("creates a child session with parentID/title, then fires promptAsync (not the blocking prompt) with agent + text part, returns the created session id", async () => {
    const fake = makeFakeClient({
      createResponses: [{ data: { id: "sess-child-1" } }],
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const returnedId = await specialist.startTask(
      "qa-fe-tester",
      "run the smoke tests",
    )

    expect(returnedId).toBe("sess-child-1")

    // session.create must be invoked with exactly { body: { parentID, title } }.
    expect(fake.calls.sessionCreate).toHaveLength(1)
    expect(fake.calls.sessionCreate[0]).toEqual({
      body: {
        parentID: "parent-session-42",
        title: "[perun] dispatch to qa-fe-tester",
      },
    })

    // The foreground turn is fired via the async (fire-and-forget) endpoint so
    // `pollUntilIdle` (with taskTimeoutMs + abort signal) governs the whole
    // turn — NOT the blocking `session.prompt`, which would park the worker for
    // an un-timed, un-abortable turn. It must use the freshly-created id and
    // bind the target agent.
    expect(fake.calls.sessionPromptAsync).toHaveLength(1)
    expect(fake.calls.sessionPromptAsync[0]).toEqual({
      path: { id: "sess-child-1" },
      body: {
        agent: "qa-fe-tester",
        parts: [{ type: "text", text: "run the smoke tests" }],
      },
    })
    // The blocking endpoint must NOT be used by the foreground path.
    expect(fake.calls.sessionPrompt).toHaveLength(0)
  })

  it("invokes onSessionCreated with the new session id BEFORE the turn is fired", async () => {
    // Regression for the binding-propagation bug: the subagent turn — including
    // the bash calls that fire the `shell.env` hook — starts as soon as
    // `session.promptAsync` is acknowledged and then runs autonomously
    // server-side. So the child→agent registration MUST happen between
    // `session.create` and `session.promptAsync`; doing it after `startTask`
    // resolves races the hook (it could run with no agent mapping and inject no
    // bindings). This asserts the callback fires while `session.promptAsync`
    // has NOT yet been called.
    const fake = makeFakeClient({
      createResponses: [{ data: { id: "sess-child-7" } }],
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const observed: Array<{ id: string; promptCallsAtCallback: number }> = []
    const returnedId = await specialist.startTask(
      "zmora-be",
      "run BE-01",
      (id) => {
        observed.push({
          id,
          promptCallsAtCallback: fake.calls.sessionPromptAsync.length,
        })
      },
    )

    expect(returnedId).toBe("sess-child-7")
    expect(observed).toEqual([{ id: "sess-child-7", promptCallsAtCallback: 0 }])
    // The async prompt still runs afterwards.
    expect(fake.calls.sessionPromptAsync).toHaveLength(1)
  })

  it("does not invoke onSessionCreated when session.create returns no id", async () => {
    const fake = makeFakeClient({ createResponses: [{ data: { id: "" } }] })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    let called = false
    await expect(
      specialist.startTask("zmora-be", "ignored", () => {
        called = true
      }),
    ).rejects.toThrow("createSession returned no session id")
    expect(called).toBe(false)
  })

  it("throws when session.create returns no session id and does not fire the turn", async () => {
    const fake = makeFakeClient({
      createResponses: [{ data: { id: "" } }],
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(
      specialist.startTask("qa-be-tester", "ignored"),
    ).rejects.toThrow(
      "createSession returned no session id for agent qa-be-tester",
    )

    expect(fake.calls.sessionPromptAsync).toHaveLength(0)
  })

  it("throws when session.create returns no data at all", async () => {
    const fake = makeFakeClient({
      createResponses: [{ data: undefined }],
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.startTask("qa-fe-tester", "noop")).rejects.toThrow(
      "createSession returned no session id for agent qa-fe-tester",
    )

    expect(fake.calls.sessionPromptAsync).toHaveLength(0)
  })

  it("emits a client warning breadcrumb but still completes the dispatch when onSessionCreated throws", async () => {
    // A callback fault must NOT abort the dispatch (swallow semantics), but it
    // must leave an observability breadcrumb — otherwise a failed binding
    // registration silently stops `shell.env` injection with no trace. Assert:
    // the warning is logged via the client mechanism AND the turn still
    // proceeds (promptAsync fires, session id returned).
    const fake = makeFakeClient({
      createResponses: [{ data: { id: "sess-child-9" } }],
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const returnedId = await specialist.startTask(
      "zmora-be",
      "run BE-09",
      () => {
        throw new Error("registry Map.set blew up")
      },
    )

    // Dispatch is NOT aborted: id returned and the turn fired afterwards.
    expect(returnedId).toBe("sess-child-9")
    expect(fake.calls.sessionPromptAsync).toHaveLength(1)

    // A single warn-level breadcrumb was logged via the client mechanism,
    // naming the agent and carrying the underlying error in `extra`.
    expect(fake.calls.appLog).toHaveLength(1)
    const logged = fake.calls.appLog[0]?.body as {
      service: string
      level: string
      message: string
      extra?: { error?: string }
    }
    expect(logged.level).toBe("warn")
    expect(logged.message).toContain("zmora-be")
    expect(logged.extra?.error).toBe("registry Map.set blew up")
  })

  it("still completes the dispatch even if the warning breadcrumb itself fails to log", async () => {
    // The breadcrumb is best-effort too: if `client.app.log` rejects, the
    // rejection must not resurface (no unhandled rejection) and the dispatch
    // must still finish. Guards against the observability fix re-introducing a
    // throw on the very path it set out to make safe.
    const fake = makeFakeClient({
      createResponses: [{ data: { id: "sess-child-10" } }],
      logRejectsWith: new Error("log endpoint 500"),
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const returnedId = await specialist.startTask(
      "zmora-be",
      "run BE-10",
      () => {
        throw new Error("callback fault")
      },
    )

    expect(returnedId).toBe("sess-child-10")
    expect(fake.calls.sessionPromptAsync).toHaveLength(1)
    expect(fake.calls.appLog).toHaveLength(1)
  })
})

describe("createSDKSpecialist.fetchMessages", () => {
  it("calls session.messages with { path: { id } } and projects to only the LAST message", async () => {
    const fake = makeFakeClient({
      messagesResponses: {
        "sess-child-1": {
          data: [
            {
              info: makeAssistant({ finish: undefined }),
              parts: [{ type: "text", text: "thinking…" }],
            },
            {
              info: makeAssistant({ finish: "end_turn" }),
              parts: [
                { type: "text", text: "final " },
                // providerExecuted keeps this fixture terminal — a
                // client-executed tool call alongside a finish is the mid-turn
                // state and would (correctly) map finish_reason to null.
                {
                  type: "tool",
                  text: "ignored-tool-output",
                  metadata: { providerExecuted: true },
                },
                { type: "text", text: "answer" },
              ],
            },
          ],
        },
      },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const messages = await specialist.fetchMessages("sess-child-1")

    expect(fake.calls.sessionMessages).toHaveLength(1)
    expect(fake.calls.sessionMessages[0]).toEqual({
      path: { id: "sess-child-1" },
    })

    // The adapter must project to `[last]` only — `pollUntilIdle` inspects
    // `messages[last]` exclusively, and holding the full transcript
    // (~300 polls per 5-minute task) is unbounded by `maxBytes`. Returning a
    // singleton bounds per-poll memory to O(1) entries.
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(
      toPollerMessage({
        info: makeAssistant({ finish: "end_turn" }),
        parts: [
          { type: "text", text: "final " },
          {
            type: "tool",
            text: "ignored-tool-output",
            metadata: { providerExecuted: true },
          },
          { type: "text", text: "answer" },
        ],
      }),
    )
    expect(messages[0]?.content).toBe("final answer")
    expect(messages[0]?.finish_reason).toBe("end_turn")
  })

  it("projects a single-message transcript to that single entry", async () => {
    // Single-message responses must still round-trip via `toPollerMessage`
    // — the projection is `[last]`, which for length-1 lists is the only
    // entry. Pins the boundary case alongside the multi-message case above.
    const fake = makeFakeClient({
      messagesResponses: {
        "sess-single": {
          data: [
            {
              info: makeAssistant({ finish: "end_turn" }),
              parts: [{ type: "text", text: "sole answer" }],
            },
          ],
        },
      },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const messages = await specialist.fetchMessages("sess-single")

    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(
      toPollerMessage({
        info: makeAssistant({ finish: "end_turn" }),
        parts: [{ type: "text", text: "sole answer" }],
      }),
    )
  })

  it("returns an empty list when SDK returns no data", async () => {
    const fake = makeFakeClient({
      messagesResponses: {
        "sess-empty": { data: undefined },
      },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    const messages = await specialist.fetchMessages("sess-empty")

    expect(messages).toEqual([])
    expect(fake.calls.sessionMessages[0]).toEqual({
      path: { id: "sess-empty" },
    })
  })
})

/**
 * `isSessionActive` is the authoritative "turn loop still running" signal that
 * complements the message-finish predicate in `pollUntilIdle`. The server's
 * `GET /session/status` returns only NON-idle sessions (idle entries are
 * deleted from its in-memory map), so absence from the map means idle.
 */
describe("createSDKSpecialist.isSessionActive", () => {
  it("returns true while the session is busy", async () => {
    const fake = makeFakeClient({
      statusResponse: { data: { "sess-child-1": { type: "busy" } } },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.isSessionActive("sess-child-1")).resolves.toBe(true)
    expect(fake.calls.sessionStatus).toHaveLength(1)
  })

  it("returns true while the session is retrying (provider backoff is still an in-flight turn)", async () => {
    const fake = makeFakeClient({
      statusResponse: { data: { "sess-child-1": { type: "retry" } } },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.isSessionActive("sess-child-1")).resolves.toBe(true)
  })

  it("returns false when the session is absent from the status map (server deletes idle entries)", async () => {
    const fake = makeFakeClient({
      statusResponse: { data: { "some-other-session": { type: "busy" } } },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.isSessionActive("sess-child-1")).resolves.toBe(
      false,
    )
  })

  it("returns false for an explicit idle entry", async () => {
    const fake = makeFakeClient({
      statusResponse: { data: { "sess-child-1": { type: "idle" } } },
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.isSessionActive("sess-child-1")).resolves.toBe(
      false,
    )
  })

  it("returns false when the SDK returns no data", async () => {
    const fake = makeFakeClient({ statusResponse: { data: undefined } })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.isSessionActive("sess-child-1")).resolves.toBe(
      false,
    )
  })

  it("returns false (never throws) when the status endpoint fails — degrades to message-only completion", async () => {
    const fake = makeFakeClient({
      statusResponse: new Error("HTTP 503 from /session/status"),
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.isSessionActive("sess-child-1")).resolves.toBe(
      false,
    )

    // The degraded path is observable: a single warn-level breadcrumb names the
    // session and carries the underlying status-endpoint error in `extra` (same
    // shape as the startTask breadcrumb), so a status outage is not silent.
    expect(fake.calls.appLog).toHaveLength(1)
    const logged = fake.calls.appLog[0]?.body as {
      service: string
      level: string
      message: string
      extra?: { error?: string }
    }
    expect(logged.service).toBe("perun/dispatch")
    expect(logged.level).toBe("warn")
    expect(logged.message).toContain("sess-child-1")
    expect(logged.extra?.error).toBe("HTTP 503 from /session/status")
  })

  it("still returns false when the degraded-mode breadcrumb itself fails to log", async () => {
    // The breadcrumb is fire-and-forget: if `client.app.log` rejects, the
    // rejection must not resurface (no unhandled rejection) and the probe must
    // still degrade to `false`. Guards the observability fix from re-introducing
    // a throw on the very path it set out to keep safe.
    const fake = makeFakeClient({
      statusResponse: new Error("HTTP 503 from /session/status"),
      logRejectsWith: new Error("log endpoint 500"),
    })
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await expect(specialist.isSessionActive("sess-child-1")).resolves.toBe(
      false,
    )
    expect(fake.calls.appLog).toHaveLength(1)
  })
})

describe("createSDKSpecialist.abortTask", () => {
  it("calls client.session.abort with { path: { id } } for the given session id", async () => {
    const fake = makeFakeClient()
    const specialist = createSDKSpecialist(fake.client, "parent-session-42")

    await specialist.abortTask("sess-child-1")

    expect(fake.calls.sessionAbort).toHaveLength(1)
    expect(fake.calls.sessionAbort[0]).toEqual({ path: { id: "sess-child-1" } })
  })
})

describe("loadAgentRegistry", () => {
  it("calls client.app.agents() and builds a registry keyed by agent.name, preserving SDK mode", async () => {
    const fake = makeFakeClient({
      agentsResponse: {
        data: [
          makeAgent({ name: "qa-fe-tester", mode: "subagent" }),
          makeAgent({ name: "perun", mode: "primary" }),
          makeAgent({ name: "ambient", mode: "all" }),
        ],
      },
    })

    const registry = await loadAgentRegistry(fake.client)

    expect(fake.calls.appAgents).toHaveLength(1)
    expect(registry).toEqual({
      "qa-fe-tester": { mode: "subagent" },
      perun: { mode: "primary" },
      ambient: { mode: "all" },
    })
  })

  it("skips agents with an empty name", async () => {
    const fake = makeFakeClient({
      agentsResponse: {
        data: [
          makeAgent({ name: "", mode: "subagent" }),
          makeAgent({ name: "qa-be-tester", mode: "subagent" }),
        ],
      },
    })

    const registry = await loadAgentRegistry(fake.client)

    expect(registry).toEqual({ "qa-be-tester": { mode: "subagent" } })
  })

  it("returns an empty registry when SDK returns no agent data", async () => {
    const fake = makeFakeClient({
      agentsResponse: { data: undefined },
    })

    const registry = await loadAgentRegistry(fake.client)

    expect(registry).toEqual({})
  })

  it("wraps SDK errors in a clear coordinator error", async () => {
    const fake = makeFakeClient({
      agentsResponse: new Error("HTTP 503 from /app/agents"),
    })

    await expect(loadAgentRegistry(fake.client)).rejects.toThrow(
      "dispatch_parallel: failed to load agent registry from SDK: HTTP 503 from /app/agents",
    )
  })

  it("wraps non-Error throwables in the same coordinator error envelope", async () => {
    // Some HTTP layers throw plain strings; loadAgentRegistry must still
    // produce a deterministic, well-prefixed error message.
    const fake = makeFakeClient()
    const clientWithThrowingAgents = {
      ...fake.client,
      app: {
        async agents() {
          throw "boom"
        },
      },
    } as unknown as SDKClient

    await expect(loadAgentRegistry(clientWithThrowingAgents)).rejects.toThrow(
      "dispatch_parallel: failed to load agent registry from SDK: boom",
    )
  })
})

/**
 * Registry cache: `loadAgentRegistry` is called fresh on every `dispatch_parallel`
 * invocation, but the agent inventory only changes on plugin reload. Caching it
 * per-client with a short TTL eliminates ~50–150ms (one HTTP round-trip) from
 * every dispatch without introducing staleness in practice.
 *
 * Pinned behaviours:
 *   - Per-client scope (WeakMap-keyed) — two clients have independent caches.
 *   - TTL: `AGENT_REGISTRY_TTL_MS` after which a fresh fetch is performed.
 *   - Concurrent first-calls dedupe into a single HTTP request.
 *   - Failed fetches are NOT cached — the next call retries.
 */
describe("loadAgentRegistry — caching", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("caches the registry within the TTL and serves subsequent calls from memory", async () => {
    const fake = makeFakeClient({
      agentsResponse: {
        data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })],
      },
    })

    const first = await loadAgentRegistry(fake.client)
    const second = await loadAgentRegistry(fake.client)

    expect(fake.calls.appAgents).toHaveLength(1)
    expect(first).toEqual({ "qa-fe-tester": { mode: "subagent" } })
    expect(second).toEqual(first)
  })

  it("re-fetches after the TTL expires", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-19T10:00:00Z"))

    const fake = makeFakeClient({
      agentsResponse: {
        data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })],
      },
    })

    await loadAgentRegistry(fake.client)
    vi.setSystemTime(new Date(Date.now() + AGENT_REGISTRY_TTL_MS + 1))
    await loadAgentRegistry(fake.client)

    expect(fake.calls.appAgents).toHaveLength(2)
  })

  it("deduplicates concurrent first-calls into a single HTTP request", async () => {
    const fake = makeFakeClient({
      agentsResponse: {
        data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })],
      },
    })

    const [a, b] = await Promise.all([
      loadAgentRegistry(fake.client),
      loadAgentRegistry(fake.client),
    ])

    expect(fake.calls.appAgents).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it("does not cache failures — the next call retries the fetch", async () => {
    // Custom fake: first `app.agents()` call rejects, the second succeeds.
    // Mirrors a transient HTTP failure where caching would otherwise pin the
    // dispatch in a permanently-broken state.
    const calls: Array<undefined> = []
    let invocation = 0
    const client = {
      app: {
        async agents(): Promise<{ data: Agent[] }> {
          calls.push(undefined)
          invocation += 1
          if (invocation === 1) throw new Error("transient HTTP 503")
          return {
            data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })],
          }
        },
      },
    } as unknown as SDKClient

    await expect(loadAgentRegistry(client)).rejects.toThrow(
      "transient HTTP 503",
    )
    const recovered = await loadAgentRegistry(client)

    expect(calls).toHaveLength(2)
    expect(recovered).toEqual({ "qa-fe-tester": { mode: "subagent" } })
  })

  it("caches are scoped per client — two clients fetch independently", async () => {
    const fakeA = makeFakeClient({
      agentsResponse: {
        data: [makeAgent({ name: "qa-fe-tester", mode: "subagent" })],
      },
    })
    const fakeB = makeFakeClient({
      agentsResponse: {
        data: [makeAgent({ name: "qa-be-tester", mode: "subagent" })],
      },
    })

    const a = await loadAgentRegistry(fakeA.client)
    const b = await loadAgentRegistry(fakeB.client)

    expect(fakeA.calls.appAgents).toHaveLength(1)
    expect(fakeB.calls.appAgents).toHaveLength(1)
    expect(a).toEqual({ "qa-fe-tester": { mode: "subagent" } })
    expect(b).toEqual({ "qa-be-tester": { mode: "subagent" } })
  })
})
