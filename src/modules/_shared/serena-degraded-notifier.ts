// Single source of truth for the "serena MCP absent → degraded mode" warning.
//
// Before this helper, `explore/index.ts` and `plan/index.ts` each hand-rolled
// the identical `serenaMissing`/`toastShown` latch plus the `session.created`
// event handler that fires a one-time degraded-mode toast — they differed only
// by the warning string (see the prior code-review rationale). That meant a behavioral fix
// (e.g. the latch semantics, the headless-safe try/catch, the stderr mirror)
// had to be hand-mirrored into both entrypoints. This helper collapses the two
// copies into one, leaving each agent to supply only its distinct message and
// keep its own tools-map / model wiring untouched.

/**
 * Structural view of the slice of the OpenCode plugin `client` this notifier
 * uses. Mirrors the `ConfigLike` pattern in `serena-detect.ts`: we model only
 * the one method we call so the helper stays decoupled from the exact SDK type
 * and is trivial to fake in tests. The parameter is optional and the `variant`
 * is the SDK's literal union so a real `OpencodeClient` is assignable here
 * (contravariant arg position — a stricter/required arg would reject it).
 */
export interface ToastClientLike {
  tui: {
    showToast: (input?: {
      body: {
        variant: "success" | "error" | "warning" | "info"
        title: string
        message: string
      }
    }) => Promise<unknown>
  }
}

/** Structural view of the OpenCode `event` payload this notifier inspects. */
export interface EventLike {
  event: { type: string }
}

export interface SerenaDegradedNotifier {
  /**
   * Record whether serena is missing. Call from the `config` hook (which runs
   * at config-assembly time, BEFORE the first `session.created`). Passing
   * `false` re-arms the "serena present" path; the toast only fires when this
   * was last called with `true`.
   */
  markSerenaMissing(missing: boolean): void
  /**
   * `event`-hook handler. Fires the degraded-mode toast at most once, and only
   * when serena was marked missing. Best-effort: headless / non-TUI
   * invocations (where `showToast` throws) must not crash the session.
   */
  onEvent(input: EventLike): Promise<void>
}

/**
 * Build the shared serena degraded-mode notifier. `message` is the agent's
 * distinct warning string (Triglav talks about exploration, Veles about
 * planning); everything else — the once-only latch, the stderr mirror, the
 * headless-safe try/catch — is shared.
 */
export function makeSerenaDegradedNotifier(
  client: ToastClientLike,
  message: string,
): SerenaDegradedNotifier {
  let serenaMissing = false
  let toastShown = false

  return {
    markSerenaMissing(missing: boolean): void {
      serenaMissing = missing
    },
    async onEvent({ event }: EventLike): Promise<void> {
      if (event.type !== "session.created") return
      if (toastShown || !serenaMissing) return
      try {
        console.error(`Pantheon: ${message}`)
        await client.tui.showToast({
          body: { variant: "warning", title: "Pantheon", message },
        })
      } catch {
        // best-effort: headless / non-TUI invocations must not crash.
      }
      toastShown = true
    },
  }
}
