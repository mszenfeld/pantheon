import { truncateBytes } from "./truncate-bytes.js"

export interface PollerMessage {
  role: string
  content: string
  /**
   * TERMINAL finish reason, or null/undefined while the turn is still in
   * flight. The SDK adapter (`toPollerMessage`) maps the server's
   * non-terminal step finishes (`"tool-calls"`, `"unknown"`, or any finish on
   * a message that still carries client-executed tool calls) to null —
   * mirroring the OpenCode turn loop's own exit predicate — so a truthy value
   * here means "this step will not be followed by another".
   */
  finish_reason?: string | null | undefined
}

export interface PollUntilIdleOptions {
  fetchMessages: () => Promise<PollerMessage[]>
  timeoutMs: number
  pollIntervalMs: number
  /**
   * Optional abort signal. When the signal aborts during polling (or during
   * the inter-poll sleep), `pollUntilIdle` throws `PollerAbortError` within
   * one poll-interval. This is how the coordinator surfaces
   * `ToolContext.abort` to in-flight child sessions.
   */
  signal?: AbortSignal
  /**
   * Optional byte-level cap on the polled assistant content (UTF-8 bytes).
   * When set, `pollUntilIdle` truncates the LAST message's content using a
   * UTF-8-safe slice before returning it as the result. Together with the
   * adapter's projection in `createSDKSpecialist.fetchMessages` (which
   * returns at most a single message — the latest one), this provides a true
   * per-poll memory bound: each poll allocates O(maxBytes) rather than
   * O(transcript-length).
   */
  maxBytes?: number
  /**
   * Optional session-status probe — the authoritative "turn loop still
   * running" signal. A terminal-looking message is necessary but NOT
   * sufficient: the OpenCode server persists `finish` after EVERY step, so
   * between two LLM steps (and during auto-compaction) the last message can
   * carry a terminal finish while the turn is still in flight. When provided,
   * `pollUntilIdle` only resolves once the message looks terminal AND this
   * probe reports inactive. It is consulted ONLY after the message predicate
   * passes (no extra HTTP per ordinary poll), and a rejection is treated as
   * inactive so a broken status endpoint degrades to message-only completion
   * instead of wedging the task until `timeoutMs`.
   */
  isSessionActive?: () => Promise<boolean>
}

export class PollerTimeoutError extends Error {
  readonly kind = "timeout" as const
  readonly elapsedMs: number

  constructor(elapsedMs: number) {
    super(`pollUntilIdle: timeout after ${elapsedMs}ms`)
    this.name = "PollerTimeoutError"
    this.elapsedMs = elapsedMs
  }
}

export class PollerAbortError extends Error {
  readonly kind = "abort" as const
  readonly elapsedMs: number

  constructor(elapsedMs: number) {
    super(`pollUntilIdle: aborted after ${elapsedMs}ms`)
    this.name = "PollerAbortError"
    this.elapsedMs = elapsedMs
  }
}

export async function pollUntilIdle(
  options: PollUntilIdleOptions,
): Promise<string> {
  const {
    fetchMessages,
    timeoutMs,
    pollIntervalMs,
    signal,
    maxBytes,
    isSessionActive,
  } = options
  const startTime = Date.now()

  while (true) {
    if (signal?.aborted === true) {
      throw new PollerAbortError(Date.now() - startTime)
    }

    const elapsed = Date.now() - startTime
    if (elapsed >= timeoutMs) {
      throw new PollerTimeoutError(elapsed)
    }

    const messages = await fetchMessages()
    const last: PollerMessage | undefined = messages[messages.length - 1]

    if (last !== undefined && last.role === "assistant" && last.finish_reason) {
      // Confirm via session status before collecting: a terminal-looking
      // message observed while the session is still active is the inter-step
      // (or compaction) race, not completion — keep polling. See the
      // `isSessionActive` option doc for the failure-mode rationale.
      if (!(await sessionStillActive(isSessionActive))) {
        return maxBytes === undefined
          ? last.content
          : truncateBytes(last.content, maxBytes)
      }
    }

    // Bound the size of the LAST assistant message between polls so each
    // poll's allocation stays O(maxBytes) rather than O(transcript-length).
    // The adapter (`createSDKSpecialist.fetchMessages`)
    // already projects the SDK response to a single message — the latest
    // one — so `messages.length <= 1` here. Truncating that one entry's
    // content via `truncateBytes` therefore bounds the entire array's
    // memory footprint to O(maxBytes), not just the eventual result.
    if (
      maxBytes !== undefined &&
      last !== undefined &&
      last.role === "assistant" &&
      Buffer.byteLength(last.content, "utf8") > maxBytes
    ) {
      last.content = truncateBytes(last.content, maxBytes)
    }

    const remaining = timeoutMs - (Date.now() - startTime)
    if (remaining <= 0) {
      throw new PollerTimeoutError(Date.now() - startTime)
    }

    await sleepOrAbort(Math.min(pollIntervalMs, remaining), signal, startTime)
  }
}

/**
 * Defensive wrapper around the `isSessionActive` probe: absent probe ⇒
 * inactive (message-only completion, the pre-status-gate contract), and a
 * thrown/rejected probe ⇒ inactive — a broken status endpoint must degrade
 * gracefully, never wedge the poll until timeout.
 */
async function sessionStillActive(
  isSessionActive: (() => Promise<boolean>) | undefined,
): Promise<boolean> {
  if (isSessionActive === undefined) {
    return false
  }
  try {
    return await isSessionActive()
  } catch {
    return false
  }
}

/**
 * Sleep for `ms`, but reject early with `PollerAbortError` if `signal` aborts
 * during the wait. Using `addEventListener` (not a polling check) means we
 * react to aborts immediately rather than waiting out the full poll interval.
 */
function sleepOrAbort(
  ms: number,
  signal: AbortSignal | undefined,
  startTime: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new PollerAbortError(Date.now() - startTime))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      reject(new PollerAbortError(Date.now() - startTime))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
