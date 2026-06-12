import { describe, expect, it } from "vitest"
import type { AssistantMessage, Message, UserMessage } from "@opencode-ai/sdk"
import { toPollerMessage } from "../../../src/modules/coordinator/index.js"

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

function makeUser(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    id: "msg-u",
    sessionID: "sess-1",
    role: "user",
    time: { created: 1700000000 },
    ...overrides,
  } as UserMessage
}

describe("toPollerMessage (SDK adapter)", () => {
  it("maps assistant message with finish to finish_reason", () => {
    const raw: {
      info: Message
      parts: Array<{ type: string; text?: string }>
    } = {
      info: makeAssistant({ finish: "end_turn" }),
      parts: [
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
      ],
    }

    const result = toPollerMessage(raw)

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("Hello world")
    expect(result.finish_reason).toBe("end_turn")
  })

  it("returns null finish_reason when assistant has no finish field", () => {
    const raw: {
      info: Message
      parts: Array<{ type: string; text?: string }>
    } = {
      info: makeAssistant({ finish: undefined }),
      parts: [{ type: "text", text: "partial" }],
    }

    const result = toPollerMessage(raw)

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("partial")
    expect(result.finish_reason).toBeNull()
  })

  it("returns null finish_reason for non-assistant roles", () => {
    const raw: {
      info: Message
      parts: Array<{ type: string; text?: string }>
    } = {
      info: makeUser(),
      parts: [{ type: "text", text: "user input" }],
    }

    const result = toPollerMessage(raw)

    expect(result.role).toBe("user")
    expect(result.content).toBe("user input")
    expect(result.finish_reason).toBeNull()
  })

  it("ignores non-text parts when assembling content", () => {
    const raw: {
      info: Message
      parts: Array<{
        type: string
        text?: string
        metadata?: Record<string, unknown>
      }>
    } = {
      info: makeAssistant({ finish: "end_turn" }),
      parts: [
        { type: "text", text: "answer" },
        // providerExecuted keeps the message terminal — a client-executed tool
        // call would (correctly) read as mid-turn; terminality is pinned by
        // the "non-terminal finish states" suite below, not here.
        { type: "tool", text: "ignored", metadata: { providerExecuted: true } },
        { type: "reasoning" },
      ],
    }

    const result = toPollerMessage(raw)

    expect(result.content).toBe("answer")
    expect(result.finish_reason).toBe("end_turn")
  })

  it("handles missing part text safely", () => {
    const raw: {
      info: Message
      parts: Array<{ type: string; text?: string }>
    } = {
      info: makeAssistant({ finish: "end_turn" }),
      parts: [{ type: "text" }, { type: "text", text: "ok" }],
    }

    const result = toPollerMessage(raw)

    expect(result.content).toBe("ok")
    expect(result.finish_reason).toBe("end_turn")
  })
})

/**
 * Mirror of the OpenCode server's own loop-exit predicate
 * (packages/opencode/src/session/prompt.ts in sst/opencode): the turn loop
 * persists EVERY step's assistant message with a `finish` value — `"tool-calls"`
 * for intermediate steps — and only exits when
 * `finish && !["tool-calls","unknown"].includes(finish) && !hasToolCalls`.
 * Treating any truthy `finish` as terminal made `dispatch_parallel` return
 * mid-turn with an empty result while the child kept running (the
 * Perun-re-dispatched-Veles bug). These tests pin the adapter to the server's
 * predicate: a non-terminal `finish` maps to `finish_reason: null`.
 */
describe("toPollerMessage — non-terminal finish states", () => {
  it("maps finish 'tool-calls' (intermediate step) to null finish_reason", () => {
    const raw: {
      info: Message
      parts: Array<{ type: string; text?: string }>
    } = {
      info: makeAssistant({ finish: "tool-calls" }),
      parts: [{ type: "text", text: "calling tools…" }],
    }

    const result = toPollerMessage(raw)

    expect(result.content).toBe("calling tools…")
    expect(result.finish_reason).toBeNull()
  })

  it("maps finish 'unknown' to null finish_reason", () => {
    const raw: {
      info: Message
      parts: Array<{ type: string; text?: string }>
    } = {
      info: makeAssistant({ finish: "unknown" }),
      parts: [],
    }

    const result = toPollerMessage(raw)

    expect(result.finish_reason).toBeNull()
  })

  it("maps finish 'stop' to null when the message still carries client-executed tool calls", () => {
    // Server comment: "Some providers return 'stop' even when the assistant
    // message contains tool calls" — the loop keeps running so tool results
    // can be sent back. The adapter must not read such a message as terminal.
    const raw: {
      info: Message
      parts: Array<{
        type: string
        text?: string
        metadata?: Record<string, unknown>
      }>
    } = {
      info: makeAssistant({ finish: "stop" }),
      parts: [{ type: "text", text: "let me check" }, { type: "tool" }],
    }

    const result = toPollerMessage(raw)

    expect(result.finish_reason).toBeNull()
  })

  it("keeps finish 'stop' terminal when the only tool calls are provider-executed", () => {
    // Provider-executed tools (metadata.providerExecuted) never produce a
    // follow-up step — the server excludes them from its hasToolCalls check.
    const raw: {
      info: Message
      parts: Array<{
        type: string
        text?: string
        metadata?: Record<string, unknown>
      }>
    } = {
      info: makeAssistant({ finish: "stop" }),
      parts: [
        { type: "tool", metadata: { providerExecuted: true } },
        { type: "text", text: "final answer" },
      ],
    }

    const result = toPollerMessage(raw)

    expect(result.content).toBe("final answer")
    expect(result.finish_reason).toBe("stop")
  })

  it("keeps finish 'error' terminal (failed turns must not poll to timeout)", () => {
    const raw: {
      info: Message
      parts: Array<{ type: string; text?: string }>
    } = {
      info: makeAssistant({ finish: "error" }),
      parts: [{ type: "text", text: "partial" }],
    }

    const result = toPollerMessage(raw)

    expect(result.finish_reason).toBe("error")
  })
})
