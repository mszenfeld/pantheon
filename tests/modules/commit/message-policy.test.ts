import { describe, expect, it } from "vitest"
import { normalizeCommitMessage } from "../../../src/modules/commit/message-policy.js"

describe("normalizeCommitMessage", () => {
  it("accepts a valid Conventional Commit subject", () => {
    expect(normalizeCommitMessage("feat: add commit plugin")).toBe(
      "feat: add commit plugin",
    )
  })

  it("appends a Refs footer once", () => {
    expect(normalizeCommitMessage("fix: block direct commit", "AV-42")).toBe(
      "fix: block direct commit\n\nRefs: AV-42",
    )
  })

  it("rejects disallowed co-authorship footers", () => {
    expect(() =>
      normalizeCommitMessage(
        "feat: add plugin\n\nCo-Authored-By: Bot <bot@example.com>",
      ),
    ).toThrow(/Co-Authored-By/i)
  })

  it("rejects messages that do not follow Conventional Commits", () => {
    expect(() => normalizeCommitMessage("add plugin")).toThrow(
      /Conventional Commits/i,
    )
  })

  it("rejects a taskId containing a newline", () => {
    expect(() =>
      normalizeCommitMessage(
        "feat: add plugin",
        "PROJ-123\nSigned-off-by: x@example.com",
      ),
    ).toThrow(/newlines|carriage returns/i)
  })

  it("rejects a taskId containing a carriage return", () => {
    expect(() =>
      normalizeCommitMessage("feat: add plugin", "PROJ-123\rExtra"),
    ).toThrow(/newlines|carriage returns/i)
  })

  it("produces the expected Refs footer for a normal taskId", () => {
    expect(normalizeCommitMessage("feat: add plugin", "PROJ-123")).toBe(
      "feat: add plugin\n\nRefs: PROJ-123",
    )
  })

  it("trims surrounding whitespace from a taskId", () => {
    expect(normalizeCommitMessage("feat: add plugin", "  PROJ-123  ")).toBe(
      "feat: add plugin\n\nRefs: PROJ-123",
    )
  })

  it("re-runs the disallowed-footer check on the combined message (defense in depth)", () => {
    // Even though the sanitizer rejects newlines in `taskId`, the combined
    // message is re-validated. This covers the case where a disallowed
    // footer is present in the body — it must still be rejected before the
    // Refs footer is appended.
    expect(() =>
      normalizeCommitMessage(
        "feat: add plugin\n\nCo-Authored-By: Bot <bot@example.com>",
        "PROJ-123",
      ),
    ).toThrow(/Co-Authored-By/i)
  })
})

describe("english-policy subject gate", () => {
  function captureMessage(fn: () => unknown): string {
    try {
      fn()
    } catch (error) {
      return (error as Error).message
    }
    return "<no throw>"
  }

  it("rejects a Polish subject with the exact plain-sentence message", () => {
    expect(
      captureMessage(() => normalizeCommitMessage("fix: naprawa logowania")),
    ).toBe(
      'Commit message subject must be English; found non-English token "naprawa". Translate the subject and retry.',
    )
  })

  it("folds an accented subject and reports the folded token", () => {
    expect(
      captureMessage(() => normalizeCommitMessage("feat: obsługa płatności")),
    ).toBe(
      'Commit message subject must be English; found non-English token "obsluga". Translate the subject and retry.',
    )
  })

  it("never scans the body — a listed token below the subject passes (body exemption)", () => {
    const message = "fix: add login retry\n\nNaprawa logowania: opisano zmiany."
    expect(normalizeCommitMessage(message)).toBe(message)
  })

  it("runs after the Conventional-Commits header check", () => {
    // A malformed header with a Polish word must still report the CC error, not the token.
    expect(
      captureMessage(() => normalizeCommitMessage("naprawa logowania")),
    ).toBe("Commit message must follow Conventional Commits.")
  })

  it("the Refs footer never triggers the gate", () => {
    expect(normalizeCommitMessage("fix: add retry", "ZMIANA-12")).toBe(
      "fix: add retry\n\nRefs: ZMIANA-12",
    )
  })
})
