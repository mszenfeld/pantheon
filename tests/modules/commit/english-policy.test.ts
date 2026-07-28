import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  NON_ENGLISH_TOKENS,
  findNonEnglishToken,
} from "../../../src/modules/commit/english-policy.js"

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/english-collision-words.txt",
)

/** §7 fixture format: one token per line; blank lines and `#` comments ignored. */
function readCollisionFixture(): string[] {
  return readFileSync(fixturePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line !== "")
    .flatMap((line) => line.split(/\s+/))
}

describe("english-policy", () => {
  it("detects a listed token in kebab, spaced, and mixed-case inputs (first hit)", () => {
    expect(findNonEnglishToken("naprawa-bledu")).toBe("naprawa")
    expect(findNonEnglishToken("naprawa logowania")).toBe("naprawa")
    expect(findNonEnglishToken("Naprawa bledu")).toBe("naprawa")
  })

  it("detects the accented spelling via folding", () => {
    expect(findNonEnglishToken("fix: obsługa płatności")).toBe("obsluga")
    expect(findNonEnglishToken("błędu")).toBe("bledu")
  })

  it("folds ł globally — a first-occurrence-only replace shatters the second word", () => {
    // "łatwe" folds to unlisted "latwe"; only a GLOBAL /ł/g fold lets "wysyłanie"
    // form the listed token "wysylanie" instead of splitting into "wysy"+"anie".
    expect(findNonEnglishToken("fix: łatwe wysyłanie")).toBe("wysylanie")
  })

  it("returns undefined for clean English", () => {
    expect(findNonEnglishToken("fix-login-flow")).toBeUndefined()
    expect(findNonEnglishToken("feat: add retry logic")).toBeUndefined()
  })

  it("collision sanity: the exported set never intersects the committed fixture", () => {
    const fixture = readCollisionFixture()
    expect(fixture.length).toBeGreaterThanOrEqual(49)
    for (const word of fixture) {
      expect(word).toMatch(/^[a-z0-9]{3,}$/)
    }
    expect(fixture.filter((word) => NON_ENGLISH_TOKENS.has(word))).toEqual([])
  })

  it("list invariants: literal size 221, charset, and group-boundary spot-checks", () => {
    expect(NON_ENGLISH_TOKENS.size).toBe(221)
    for (const token of NON_ENGLISH_TOKENS) {
      expect(token).toMatch(/^[a-z0-9]{3,}$/)
    }
    // First and last token of each §3.2 group (76 + 113 + 32).
    for (const token of [
      "naprawa",
      "wsparcia",
      "uzytkownik",
      "listy",
      "dla",
      "bledna",
    ]) {
      expect(NON_ENGLISH_TOKENS.has(token)).toBe(true)
    }
  })

  it("rule-2 exclusions are absent from the set and present in the fixture", () => {
    const fixture = new Set(readCollisionFixture())
    const exclusions = [
      "testy",
      "menu",
      "panel",
      "status",
      "admin",
      "token",
      "pod",
      "plan",
      "stare",
      "dane",
    ]
    for (const word of exclusions) {
      expect(NON_ENGLISH_TOKENS.has(word)).toBe(false)
      expect(fixture.has(word)).toBe(true)
    }
  })
})
