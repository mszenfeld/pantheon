import { afterEach, describe, expect, it, vi } from "vitest"
import {
  makeSerenaDegradedNotifier,
  type ToastClientLike,
} from "../../../src/modules/_shared/serena-degraded-notifier.js"

const MESSAGE = "serena absent — degraded mode"

function fakeClient(showToast = vi.fn(async () => {})): {
  client: ToastClientLike
  showToast: typeof showToast
} {
  return { client: { tui: { showToast } } as ToastClientLike, showToast }
}

function sessionCreated() {
  return { event: { type: "session.created" } }
}

describe("makeSerenaDegradedNotifier", () => {
  afterEach(() => vi.restoreAllMocks())

  it("warns exactly once when serena is marked missing", async () => {
    const { client, showToast } = fakeClient()
    const notifier = makeSerenaDegradedNotifier(client, MESSAGE)
    notifier.markSerenaMissing(true)

    await notifier.onEvent(sessionCreated())
    await notifier.onEvent(sessionCreated())

    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it("passes the agent's distinct message through as a warning toast", async () => {
    const { client, showToast } = fakeClient()
    const notifier = makeSerenaDegradedNotifier(client, MESSAGE)
    notifier.markSerenaMissing(true)

    await notifier.onEvent(sessionCreated())

    expect(showToast).toHaveBeenCalledWith({
      body: { variant: "warning", title: "Pantheon", message: MESSAGE },
    })
  })

  it("does not warn when serena was never marked missing", async () => {
    const { client, showToast } = fakeClient()
    const notifier = makeSerenaDegradedNotifier(client, MESSAGE)

    await notifier.onEvent(sessionCreated())

    expect(showToast).not.toHaveBeenCalled()
  })

  it("does not warn when serena is marked present", async () => {
    const { client, showToast } = fakeClient()
    const notifier = makeSerenaDegradedNotifier(client, MESSAGE)
    notifier.markSerenaMissing(false)

    await notifier.onEvent(sessionCreated())

    expect(showToast).not.toHaveBeenCalled()
  })

  it("ignores non-session.created events", async () => {
    const { client, showToast } = fakeClient()
    const notifier = makeSerenaDegradedNotifier(client, MESSAGE)
    notifier.markSerenaMissing(true)

    await notifier.onEvent({ event: { type: "session.deleted" } })

    expect(showToast).not.toHaveBeenCalled()
  })

  it("mirrors the warning to stderr", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { client } = fakeClient()
    const notifier = makeSerenaDegradedNotifier(client, MESSAGE)
    notifier.markSerenaMissing(true)

    await notifier.onEvent(sessionCreated())

    expect(errorSpy).toHaveBeenCalledWith(`Pantheon: ${MESSAGE}`)
  })

  it("swallows a throwing showToast (headless / non-TUI) and still latches", async () => {
    const showToast = vi.fn(async () => {
      throw new Error("no TUI")
    })
    const { client } = fakeClient(showToast)
    vi.spyOn(console, "error").mockImplementation(() => {})
    const notifier = makeSerenaDegradedNotifier(client, MESSAGE)
    notifier.markSerenaMissing(true)

    await expect(notifier.onEvent(sessionCreated())).resolves.toBeUndefined()
    // Latch still trips on a thrown toast: a second event must not re-attempt.
    await notifier.onEvent(sessionCreated())
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
