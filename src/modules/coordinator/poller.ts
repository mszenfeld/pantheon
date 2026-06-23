import { probeSessionActive } from "./session-active.js"
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
   * probe reports inactive. For the COMPLETION gate it is consulted ONLY after
   * the message predicate passes (no extra HTTP per ordinary poll); a rejection
   * is treated as inactive so a broken status endpoint degrades to message-only
   * completion instead of wedging the task until `timeoutMs`. When
   * `idleTimeoutMs` is set it is ALSO consulted as a liveness fallback, but only
   * on a poll where the visible content did not grow (see `idleTimeoutMs`).
   */
  isSessionActive?: () => Promise<boolean>
  /**
   * Optional INACTIVITY window (ms) — a heartbeat timeout layered under the
   * absolute `timeoutMs` backstop. When set, the loop tracks the wall-clock of
   * the last observed sign of life and throws `PollerTimeoutError(reason:
   * "idle")` once `idleTimeoutMs` elapses with NO progress. "Progress" is:
   *   1. the last assistant message's content grew (UTF-8 bytes changed since
   *      the previous poll — a streaming/generating turn), OR
   *   2. on a poll where content did NOT change, `isSessionActive()` reports the
   *      turn loop still busy (a long SILENT step — a multi-minute tool call or
   *      pre-emit reasoning where the visible message is static).
   * The status probe in (2) fires only on a static poll, so a steadily
   * streaming turn never pays the extra HTTP call. This lets a healthy but slow
   * child run for as long as it keeps working, while a genuinely wedged child
   * (no new output AND not busy) is caught within `idleTimeoutMs` rather than
   * burning the full `timeoutMs`. Omitted ⇒ pure wall-clock (`timeoutMs` only),
   * the historical behavior — so callers that do not opt in are unaffected.
   */
  idleTimeoutMs?: number
}

/** Which of the two bounds tripped — surfaced in the error message and on the
 * `reason` field so a dispatch result distinguishes "slow/wedged with no
 * progress" (`idle`) from "hit the absolute ceiling" (`wall-clock`). */
export type PollerTimeoutReason = "wall-clock" | "idle"

export class PollerTimeoutError extends Error {
  readonly kind = "timeout" as const
  readonly elapsedMs: number
  readonly reason: PollerTimeoutReason

  constructor(elapsedMs: number, reason: PollerTimeoutReason = "wall-clock") {
    super(`pollUntilIdle: ${reason} timeout after ${elapsedMs}ms`)
    this.name = "PollerTimeoutError"
    this.elapsedMs = elapsedMs
    this.reason = reason
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
    idleTimeoutMs,
  } = options
  const startTime = Date.now()
  // Heartbeat state (only consulted when `idleTimeoutMs` is set; otherwise the
  // loop is a pure wall-clock timer, unchanged from before). `lastProgressAt`
  // is the wall-clock of the last observed sign of life; `lastContentBytes` is
  // the last assistant content length we measured (-1 ⇒ nothing seen yet, so
  // the first non-empty content reads as progress).
  let lastProgressAt = startTime
  let lastContentBytes = -1

  while (true) {
    if (signal?.aborted === true) {
      throw new PollerAbortError(Date.now() - startTime)
    }

    const elapsed = Date.now() - startTime
    if (elapsed >= timeoutMs) {
      throw new PollerTimeoutError(elapsed, "wall-clock")
    }
    // Inactivity backstop: no sign of life for `idleTimeoutMs`. Checked before
    // the fetch so a wedged child is reported even if a prior `fetchMessages`
    // is the thing stalling.
    if (
      idleTimeoutMs !== undefined &&
      Date.now() - lastProgressAt >= idleTimeoutMs
    ) {
      throw new PollerTimeoutError(Date.now() - lastProgressAt, "idle")
    }

    const messages = await fetchMessages()
    const last: PollerMessage | undefined = messages[messages.length - 1]

    // Heartbeat: record progress BEFORE the maxBytes truncation below mutates
    // `last.content` — a capped message would otherwise report a constant
    // length every poll and mask real streaming progress. Progress = content
    // grew, OR (on a static poll only) the session is still busy — the busy
    // probe is a fallback so a long SILENT step (a multi-minute tool call /
    // pre-emit reasoning) does not read as a hang, and a streaming turn pays no
    // extra status call.
    if (idleTimeoutMs !== undefined) {
      const contentBytes =
        last !== undefined && last.role === "assistant"
          ? Buffer.byteLength(last.content, "utf8")
          : lastContentBytes
      let progressed = contentBytes !== lastContentBytes
      lastContentBytes = contentBytes
      if (!progressed && (await probeSessionActive(isSessionActive))) {
        progressed = true
      }
      if (progressed) {
        lastProgressAt = Date.now()
      }
    }

    if (last !== undefined && last.role === "assistant" && last.finish_reason) {
      // Confirm via session status before collecting: a terminal-looking
      // message observed while the session is still active is the inter-step
      // (or compaction) race, not completion — keep polling. See the
      // `isSessionActive` option doc for the failure-mode rationale.
      if (!(await probeSessionActive(isSessionActive))) {
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
      throw new PollerTimeoutError(Date.now() - startTime, "wall-clock")
    }

    // Bound the sleep by BOTH the wall-clock remaining and the idle remaining
    // so an inactivity timeout is observed within one interval rather than
    // overshooting it. `idleRemaining` is +Infinity when the heartbeat is off,
    // so `Math.min` collapses to the historical `min(pollInterval, remaining)`.
    const idleRemaining =
      idleTimeoutMs !== undefined
        ? idleTimeoutMs - (Date.now() - lastProgressAt)
        : Number.POSITIVE_INFINITY
    await sleepOrAbort(
      Math.min(pollIntervalMs, remaining, idleRemaining),
      signal,
      startTime,
    )
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
