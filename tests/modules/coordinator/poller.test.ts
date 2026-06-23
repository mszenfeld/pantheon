import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  pollUntilIdle,
  PollerAbortError,
} from "../../../src/modules/coordinator/poller.js"
import type { PollerMessage } from "../../../src/modules/coordinator/poller.js"

describe("pollUntilIdle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves when assistant message has finish_reason", async () => {
    const messages: PollerMessage[] = [
      { role: "assistant", content: "done", finish_reason: "end_turn" },
    ]
    const fetchMessages = vi.fn().mockResolvedValue(messages)

    const result = await pollUntilIdle({
      fetchMessages,
      timeoutMs: 1000,
      pollIntervalMs: 50,
    })

    expect(result).toBe("done")
  })

  it("returns empty string when finished message has no content", async () => {
    const messages: PollerMessage[] = [
      { role: "assistant", content: "", finish_reason: "end_turn" },
    ]
    const fetchMessages = vi.fn().mockResolvedValue(messages)

    const result = await pollUntilIdle({
      fetchMessages,
      timeoutMs: 1000,
      pollIntervalMs: 50,
    })

    expect(result).toBe("")
  })

  it("polls until finish_reason appears", async () => {
    let callCount = 0
    const fetchMessages = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount < 3) {
        return []
      }
      return [
        {
          role: "assistant",
          content: "final answer",
          finish_reason: "end_turn",
        },
      ]
    })

    const pollIntervalMs = 100
    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 5000,
      pollIntervalMs,
    })

    await vi.advanceTimersByTimeAsync(pollIntervalMs)
    await vi.advanceTimersByTimeAsync(pollIntervalMs)

    const result = await promise

    expect(result).toBe("final answer")
    expect(fetchMessages).toHaveBeenCalledTimes(3)
  })

  it("rejects on timeout", async () => {
    const fetchMessages = vi.fn().mockResolvedValue([])

    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 100,
      pollIntervalMs: 50,
    })

    const rejection = expect(promise).rejects.toThrow("timeout")
    await vi.advanceTimersByTimeAsync(200)
    await rejection
  })

  it("ignores non-assistant final messages", async () => {
    let callCount = 0
    const fetchMessages = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return [{ role: "user", content: "test" }]
      }
      return [
        { role: "assistant", content: "response", finish_reason: "end_turn" },
      ]
    })

    const pollIntervalMs = 100
    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 5000,
      pollIntervalMs,
    })

    await vi.advanceTimersByTimeAsync(pollIntervalMs)

    const result = await promise

    expect(result).toBe("response")
    expect(fetchMessages).toHaveBeenCalledTimes(2)
  })

  it("ignores assistant messages without finish_reason", async () => {
    let callCount = 0
    const fetchMessages = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return [{ role: "assistant", content: "partial", finish_reason: null }]
      }
      return [
        { role: "assistant", content: "complete", finish_reason: "end_turn" },
      ]
    })

    const pollIntervalMs = 100
    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 5000,
      pollIntervalMs,
    })

    await vi.advanceTimersByTimeAsync(pollIntervalMs)

    const result = await promise

    expect(result).toBe("complete")
    expect(fetchMessages).toHaveBeenCalledTimes(2)
  })

  it("propagates fetchMessages errors", async () => {
    const fetchMessages = vi.fn().mockRejectedValue(new Error("network fail"))

    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 1000,
      pollIntervalMs: 50,
    })

    await expect(promise).rejects.toThrow("network fail")
  })

  it("throws PollerAbortError when signal is already aborted on entry", async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMessages = vi.fn().mockResolvedValue([])

    await expect(
      pollUntilIdle({
        fetchMessages,
        timeoutMs: 1000,
        pollIntervalMs: 50,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(PollerAbortError)

    // Loop bailed before fetching.
    expect(fetchMessages).not.toHaveBeenCalled()
  })

  it("throws PollerAbortError when signal aborts during the inter-poll sleep", async () => {
    const controller = new AbortController()
    // Never finishes — keeps the poller looping until the abort fires.
    const fetchMessages = vi.fn().mockResolvedValue([])

    const promise = pollUntilIdle({
      fetchMessages,
      timeoutMs: 60_000,
      pollIntervalMs: 100,
      signal: controller.signal,
    })

    // Attach the rejection assertion *before* triggering the abort so Vitest
    // never sees an unhandled-rejection blip while the microtask queue drains.
    const assertion = expect(promise).rejects.toBeInstanceOf(PollerAbortError)

    // First poll runs, then enters the inter-poll sleep.
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)

    await assertion
  })

  /**
   * Status gate: a terminal-looking message is necessary but NOT sufficient.
   * Between two LLM steps (and during auto-compaction) the child session's
   * last message can carry a truthy finish while the server-side turn loop is
   * still running — `GET /session/status` is the authoritative "loop exited"
   * signal. The poller must only resolve when the message looks terminal AND
   * the session is no longer active.
   */
  describe("isSessionActive gate", () => {
    it("keeps polling while the session is active, resolves once it goes inactive", async () => {
      const messages: PollerMessage[] = [
        { role: "assistant", content: "done", finish_reason: "stop" },
      ]
      const fetchMessages = vi.fn().mockResolvedValue(messages)
      let active = true
      const isSessionActive = vi.fn(async () => active)

      const pollIntervalMs = 100
      const promise = pollUntilIdle({
        fetchMessages,
        timeoutMs: 5000,
        pollIntervalMs,
        isSessionActive,
      })

      // Two polls with an active session — must NOT resolve yet.
      await vi.advanceTimersByTimeAsync(pollIntervalMs)
      active = false
      await vi.advanceTimersByTimeAsync(pollIntervalMs)

      const result = await promise

      expect(result).toBe("done")
      // Polled at least twice while gated, then resolved on the inactive read.
      expect(fetchMessages.mock.calls.length).toBeGreaterThanOrEqual(3)
      expect(isSessionActive.mock.calls.length).toBeGreaterThanOrEqual(3)
    })

    it("does not consult session status while the message is non-terminal", async () => {
      // Cheap gating: the status HTTP call only fires once the message LOOKS
      // terminal — otherwise every poll would double the request volume.
      let callCount = 0
      const fetchMessages = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return [{ role: "assistant", content: "wip", finish_reason: null }]
        }
        return [{ role: "assistant", content: "done", finish_reason: "stop" }]
      })
      const isSessionActive = vi.fn(async () => false)

      const pollIntervalMs = 100
      const promise = pollUntilIdle({
        fetchMessages,
        timeoutMs: 5000,
        pollIntervalMs,
        isSessionActive,
      })

      await vi.advanceTimersByTimeAsync(pollIntervalMs)

      const result = await promise

      expect(result).toBe("done")
      expect(isSessionActive).toHaveBeenCalledTimes(1)
    })

    it("treats an isSessionActive rejection as inactive (degrades to message-only)", async () => {
      // A broken/unavailable status endpoint must not wedge the dispatch until
      // taskTimeoutMs — fall back to the message predicate alone.
      const messages: PollerMessage[] = [
        { role: "assistant", content: "done", finish_reason: "stop" },
      ]
      const fetchMessages = vi.fn().mockResolvedValue(messages)
      const isSessionActive = vi
        .fn()
        .mockRejectedValue(new Error("status endpoint 500"))

      const result = await pollUntilIdle({
        fetchMessages,
        timeoutMs: 1000,
        pollIntervalMs: 50,
        isSessionActive,
      })

      expect(result).toBe("done")
    })

    it("times out (not resolves) when the session never goes inactive", async () => {
      const messages: PollerMessage[] = [
        { role: "assistant", content: "mid-turn", finish_reason: "stop" },
      ]
      const fetchMessages = vi.fn().mockResolvedValue(messages)
      const isSessionActive = vi.fn(async () => true)

      const promise = pollUntilIdle({
        fetchMessages,
        timeoutMs: 300,
        pollIntervalMs: 100,
        isSessionActive,
      })

      const rejection = expect(promise).rejects.toThrow("timeout")
      await vi.advanceTimersByTimeAsync(500)
      await rejection
    })
  })

  /**
   * Inactivity heartbeat: when `idleTimeoutMs` is set, the loop layers an
   * inactivity timeout UNDER the absolute `timeoutMs` backstop. A healthy but
   * slow turn (still producing output, or still busy) keeps resetting the idle
   * deadline and runs until the backstop; a genuinely wedged turn (no new output
   * AND not busy) is caught within `idleTimeoutMs`. None of the other tests pass
   * `idleTimeoutMs`, so the historical pure-wall-clock behavior is unaffected.
   */
  describe("inactivity heartbeat (idleTimeoutMs)", () => {
    it("content growth resets the idle deadline (only the wall-clock backstop ultimately fires)", async () => {
      // Content grows every poll, so if the heartbeat resets correctly the idle
      // window (300ms) NEVER trips and the run reaches the 2s backstop. A broken
      // heartbeat would instead reject with reason "idle" at ~300ms.
      let n = 0
      const fetchMessages = vi.fn(async () => {
        n++
        return [{ role: "assistant", content: "x".repeat(n), finish_reason: null }]
      })
      const promise = pollUntilIdle({
        fetchMessages,
        timeoutMs: 2000,
        idleTimeoutMs: 300,
        pollIntervalMs: 100,
      })
      const rejection = expect(promise).rejects.toThrow("wall-clock timeout")
      await vi.advanceTimersByTimeAsync(2500)
      await rejection
    })

    it("a busy session resets the idle deadline even when content is static (silent step is not a hang)", async () => {
      // Content never changes (a long silent tool call / pre-emit reasoning) but
      // the session reports busy — the busy fallback must keep the turn alive, so
      // only the wall-clock backstop fires.
      const fetchMessages = vi.fn(async () => [
        { role: "assistant", content: "static", finish_reason: null },
      ])
      const isSessionActive = vi.fn(async () => true)
      const promise = pollUntilIdle({
        fetchMessages,
        isSessionActive,
        timeoutMs: 2000,
        idleTimeoutMs: 300,
        pollIntervalMs: 100,
      })
      const rejection = expect(promise).rejects.toThrow("wall-clock timeout")
      await vi.advanceTimersByTimeAsync(2500)
      await rejection
      // The busy probe was actually consulted as the heartbeat fallback (content
      // was static after the first poll).
      expect(isSessionActive.mock.calls.length).toBeGreaterThan(1)
    })

    it("trips the idle timeout when there is no progress, before the wall-clock backstop", async () => {
      // No content, not busy → no sign of life → idle (300ms) fires long before
      // the 60s backstop, carrying reason "idle".
      const fetchMessages = vi.fn(async () => [])
      const isSessionActive = vi.fn(async () => false)
      const promise = pollUntilIdle({
        fetchMessages,
        isSessionActive,
        timeoutMs: 60_000,
        idleTimeoutMs: 300,
        pollIntervalMs: 100,
      })
      const rejection = expect(promise).rejects.toMatchObject({
        name: "PollerTimeoutError",
        reason: "idle",
      })
      await vi.advanceTimersByTimeAsync(500)
      await rejection
    })

    it("still enforces the wall-clock backstop while the session keeps reporting progress", async () => {
      // Busy + growing forever (the "busy forever, never finishes" pathology):
      // the heartbeat never trips, so the absolute backstop must still fire.
      let n = 0
      const fetchMessages = vi.fn(async () => {
        n++
        return [{ role: "assistant", content: "y".repeat(n), finish_reason: null }]
      })
      const isSessionActive = vi.fn(async () => true)
      const promise = pollUntilIdle({
        fetchMessages,
        isSessionActive,
        timeoutMs: 1000,
        idleTimeoutMs: 10_000,
        pollIntervalMs: 100,
      })
      const rejection = expect(promise).rejects.toMatchObject({
        name: "PollerTimeoutError",
        reason: "wall-clock",
      })
      await vi.advanceTimersByTimeAsync(1200)
      await rejection
    })
  })

  it("truncates oversized polled content by UTF-8 bytes when maxBytes is set", async () => {
    // 200 × "ż" → 400 UTF-8 bytes, 200 UTF-16 code units. With maxBytes=128
    // the byte length is clearly over, so we must truncate even though the
    // UTF-16 .length is under-reading.
    const heavy = "ż".repeat(200)
    const messages: PollerMessage[] = [
      { role: "assistant", content: heavy, finish_reason: "end_turn" },
    ]
    const fetchMessages = vi.fn().mockResolvedValue(messages)

    const result = await pollUntilIdle({
      fetchMessages,
      timeoutMs: 1000,
      pollIntervalMs: 50,
      maxBytes: 128,
    })

    const truncationMarker = "\n[…truncated…]"
    expect(result.endsWith(truncationMarker)).toBe(true)
    const body = result.slice(0, result.length - truncationMarker.length)
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(128)
    expect(body).not.toContain("�")
  })
})
