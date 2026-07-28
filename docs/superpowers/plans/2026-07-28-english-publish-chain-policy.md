# English-Only Publish-Chain Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce English in the three human-facing publish-chain fields (`create_branch` description, `av_commit` subject, `create_pr` title) via a curated non-English-token stoplist gate plus strengthened tool-schema copy, per the converged spec `docs/specs/english-publish-chain-policy.md`.

**Architecture:** One new pure-TypeScript module (`english-policy.ts`) exports a 221-token `ReadonlySet` and a folding tokenizer (`lowercase → /ł/g→l → NFD → strip combining marks → split`). Three existing validators call it at spec-pinned points: `composeBranchName` (rule S9, after S3–S8, description only), `normalizeCommitMessage` (subject line, after the Conventional-Commits header check), `validateTitle` (rule T4, after T3). A committed test fixture is the collision-rule enforcement corpus.

**Tech Stack:** TypeScript (ESM/NodeNext, strict), vitest, bun. No new dependencies.

**Branch:** `feature/english-publish-chain` (stacked on `feature/create-branch-tool`). Spec at commit `ad7bbca`.

## Global Constraints

- The spec is normative: `docs/specs/english-publish-chain-policy.md`. Section references (§) below point there.
- Error messages are byte-exact (§4). The three templates, with `<token>` = JSON encoding of the **folded, lowercased** token returned by `findNonEnglishToken`:
  - S9: `create_branch: segment 'description' violates rule S9 (non-english-token): "naprawa" — branch names must be English; translate the description and retry.`
  - av_commit: `Commit message subject must be English; found non-English token "naprawa". Translate the subject and retry.`
  - T4: `create_pr: field 'title' violates rule T4 (non-english-token): "naprawa" — PR titles must be English; translate the title and retry.`
- The token list is verbatim §3.2 — exactly **221** tokens (76 + 113 + 32), no duplicates, every entry matches `/^[a-z0-9]{3,}$/`. Never add or drop a token while transcribing.
- The `ł`→`l` fold MUST use a global regex (`.replace(/ł/g, "l")`) — §3 pins the `g` flag.
- Never gated: commit/PR **bodies**, the `create_branch` **`id`** segment, `taskId`/`base`/`draft` (§1 Out of scope, D3).
- `create_branch` and `create_pr` rejections record **zero** git/gh calls; the `av_commit` check is asserted at the `normalizeCommitMessage` unit level (AC-1).
- Repo: ESM/NodeNext strict TS; no `any`; `bun run check` (build + typecheck + test) green at every task end; `dist/` is committed (synced in the final task).
- Commits: prefix every commit command with `AV_COMMIT_SKILL=1`; Conventional Commits; **never** any Co-Authored-By/AI-attribution trailer; **never** `git add -A` — always explicit paths; `docs/specs/reviews/english-publish-chain-policy.pre-loop.bak` stays untracked; never push.

---

### Task 1: Spec touch-ups — the six reported-only review minors

The review loop converged with six `reported-only` minors (SR-019…SR-024 in
`docs/specs/reviews/english-publish-chain-policy-review.md`). Land them first so every later
task reads the final spec text.

**Files:**
- Modify: `docs/specs/english-publish-chain-policy.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the final normative spec text later tasks quote (fixture-format bullet, pinned T4 token vector, body-exemption vector with a listed token).

- [ ] **Step 1 (SR-023, §4):** Replace the line
  `Error templates (normative; \`<token>\` is the JSON-encoded offending token):`
  with:
  `Error templates (normative; \`<token>\` is the JSON encoding of the value returned by`
  `\`findNonEnglishToken\` — the lowercased, diacritic-folded token, which may differ from the`
  `caller's spelling, e.g. \`"obsluga"\` for \`obsługa\`):`

- [ ] **Step 2 (SR-020, §1):** Replace the bullet
  `- Unit tests for the module and one reject + one accept vector per integration surface.`
  with:
  `- Unit tests for the module, and at least one reject + one accept vector per integration`
  `  surface (plus the \`create_branch\` id-exemption vector).`

- [ ] **Step 3 (SR-021, §7):** In the per-surface `av_commit` vector, replace
  `a message with an English`
  `    subject and Polish body content → **passes** (body exemption).`
  with:
  `a message whose subject is English`
  `    and whose body contains a listed token → **passes** (body exemption):`
  `    \`"fix: add login retry\n\nNaprawa logowania: opisano zmiany."\` — the body token`
  `    \`naprawa\` must not be reported.`

- [ ] **Step 4 (SR-022, §6):** Replace the sentence added by the round-2 loop:
  `The`
  `same file's error-contract sentence ("the offending value is JSON-encoded") gains the T4/S9`
  `exception — those rules JSON-encode the offending token and append a fixed translate-and-retry`
  `hint — and the \`title\` parenthetical becomes "(non-empty, ≤ 256 code points, no control`
  `characters, no non-English token)".`
  with the correctly anchored version:
  `In`
  `that file's \`create_pr\` bullet, the error-contract sentence ("the offending value is`
  `JSON-encoded") gains the T4 exception — T4 JSON-encodes the offending *token*, not the field`
  `value, and appends a fixed translate-and-retry hint — and the \`title\` parenthetical becomes`
  `"(non-empty, ≤ 256 code points, no control characters, no non-English token)". In the`
  `\`create_branch\` bullet, the per-segment enumeration gains ", and no non-English token in`
  `\`description\`", and its error sentence becomes "Errors name the violated rule (\`S1\`–\`S9\`,`
  `\`N1\`–\`N11\`) so you can self-correct — S9 JSON-encodes the offending token and appends a`
  `fixed translate-and-retry hint."`

- [ ] **Step 5 (SR-024, §7):** After the collision-sanity bullet (ends `whenever a collision is discovered;`), add a sibling bullet:
  `  - fixture format (normative): one token per line, lowercase ASCII in the same`
  `    diacritic-folded spelling as the list (\`/^[a-z0-9]{3,}$/\`); blank lines and \`#\` comments`
  `    are ignored; the test validates every parsed entry against that pattern before`
  `    intersecting;`

- [ ] **Step 6 (SR-019, §9):** Replace AC-3:
  `- **AC-3:** Schema descriptions match §5 verbatim; the four §6 docs each contain the doctrine`
  `  sentence.`
  with:
  `- **AC-3:** Schema descriptions match §5 verbatim; the four §6 docs each contain the doctrine`
  `  sentence; and \`src/commands/commit.md\` carries every §6 reconciliation edit (description`
  `  copy, \`title\` T1–T4 parenthetical, \`S1\`–\`S9\` enumeration with the S9 note, and the T4`
  `  error-contract exception).`

- [ ] **Step 7: Commit**

```bash
git add docs/specs/english-publish-chain-policy.md
AV_COMMIT_SKILL=1 git commit -m "docs(spec): land the six reported-only round-3 review minors"
```

---

### Task 2: `english-policy.ts` module + collision fixture + unit tests

**Files:**
- Create: `src/modules/commit/english-policy.ts`
- Create: `tests/fixtures/english-collision-words.txt`
- Test: `tests/modules/commit/english-policy.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; pure TS, no I/O).
- Produces: `NON_ENGLISH_TOKENS: ReadonlySet<string>` (221 entries) and `findNonEnglishToken(text: string): string | undefined` — Tasks 3–5 import the function from `./english-policy.js`.

- [ ] **Step 1: Write the failing test** — create `tests/modules/commit/english-policy.test.ts`:

```ts
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
    for (const token of ["naprawa", "wsparcia", "uzytkownik", "listy", "dla", "bledna"]) {
      expect(NON_ENGLISH_TOKENS.has(token)).toBe(true)
    }
  })

  it("rule-2 exclusions are absent from the set and present in the fixture", () => {
    const fixture = new Set(readCollisionFixture())
    const exclusions = ["testy", "menu", "panel", "status", "admin", "token", "pod", "plan", "stare", "dane"]
    for (const word of exclusions) {
      expect(NON_ENGLISH_TOKENS.has(word)).toBe(false)
      expect(fixture.has(word)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/modules/commit/english-policy.test.ts`
Expected: FAIL — cannot resolve `../../../src/modules/commit/english-policy.js`.

- [ ] **Step 3: Create the fixture** — `tests/fixtures/english-collision-words.txt` (create the `tests/fixtures/` directory; one token per line):

```
# english-collision-words.txt — §7 collision fixture (test-only; never bundled
# into english-policy.ts, per D1). Format (§7): one lowercase, diacritic-folded
# token per line; blank lines and # comments ignored.
# §3.1 rule 4: every future stoplist addition must NOT appear here; extend this
# file whenever a collision is discovered. It MUST contain every token
# enumerated as excluded by §3.1 rule 2.
fix
add
remove
update
test
testy
menu
panel
status
admin
token
pod
plan
data
list
report
client
server
address
stare
dane
process
module
component
date
state
stage
rate
mode
note
base
case
user
file
folder
view
page
form
table
column
row
error
log
build
deploy
config
option
value
type
```

- [ ] **Step 4: Write the implementation** — `src/modules/commit/english-policy.ts`:

```ts
/**
 * English-only publish-chain policy (spec §3): a curated stoplist gate for the
 * chain's human-facing fields. The list stores diacritic-stripped spellings
 * (§3.1 rule 1); the tokenizer folds input to the same form, so accented and
 * stripped Polish both match. Pure TypeScript — no I/O, no spawns.
 *
 * Curation is spec-governed (§3.1): additions must be checked against
 * tests/fixtures/english-collision-words.txt (rule 4) and must never be
 * English words, abbreviations, or tech terms (rule 2).
 */

// §3.2 — exactly 221 tokens: 76 change verbs/nouns + 113 domain nouns +
// 32 function words/adjectives.
const TOKEN_LIST = `
naprawa naprawy naprawic naprawiono poprawka poprawki poprawic poprawiono
poprawa blad bledu bledow bledy dodanie dodania dodaj dodano dodawanie usuniecie usuniecia usun
usunieto usuwanie zmiana zmiany zmien zmieniono zmienic aktualizacja aktualizacji aktualizuj
zaktualizowano wdrozenie wdrozenia migracja migracji refaktoryzacja refaktoryzacji optymalizacja
optymalizacji tworzenie tworzenia utworz utworzono generowanie generowania generuj pobieranie
pobierania pobierz wysylanie wysylania wyslij zapisywanie zapisz odczyt odczytu edycja edycji
edytuj podglad podgladu filtrowanie filtrowania sortowanie sortowania wyszukiwanie wyszukiwania
wyszukiwarka szukaj ladowanie ladowania obsluga obslugi wsparcie wsparcia
uzytkownik uzytkownika uzytkownikow uzytkownicy logowanie logowania wylogowanie
rejestracja rejestracji haslo hasla sesja sesji uprawnienia uprawnien uprawnienie powiadomienie
powiadomienia powiadomien wiadomosc wiadomosci platnosc platnosci koszyk koszyka zamowienie
zamowienia zamowien formularz formularza formularze walidacja walidacji konfiguracja
konfiguracji ustawienia ustawien strona strony widok widoku widoki przycisk przycisku przyciski
okno okna naglowek naglowka stopka stopki tabela tabeli kolumna kolumny wiersz wiersza plik
pliku plikow pliki katalog katalogu baza bazy danych funkcja funkcji funkcje
funkcjonalnosc funkcjonalnosci modul modulu komponent komponentu komponenty usluga uslugi
klient klienta klientow serwer serwera adres adresu jezyk jezyka tlumaczenie tlumaczenia
tlumaczen motyw motywu motywy ciemny jasny ekran ekranu przelacznik zadanie zadania zadan
blokada blokady blokowanie raport raportu raporty kolejka kolejki harmonogram harmonogramu
lista listy
dla oraz przy bez przed wedlug jako nowy nowa nowe nowego nowych
stary stara szybki szybkie glowny glowna glowne pelny pelna pusty pusta domyslny domyslna
domyslne brakujacy brakujace niepoprawny niepoprawna bledny bledna
`

export const NON_ENGLISH_TOKENS: ReadonlySet<string> = new Set(
  TOKEN_LIST.split(/\s+/).filter((token) => token !== ""),
)

/**
 * §3 tokenizer: lowercase → fold `ł`→`l` (U+0142 has no canonical
 * decomposition; the `g` flag is load-bearing — an unfolded `ł` becomes a
 * token separator in the split below and silently shatters the word) →
 * NFD → strip combining marks → split on non-alphanumerics. Returns the
 * FIRST listed token (in its folded, lowercased spelling), else undefined.
 */
export function findNonEnglishToken(text: string): string | undefined {
  const folded = text
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  for (const token of folded.split(/[^a-z0-9]+/)) {
    if (token !== "" && NON_ENGLISH_TOKENS.has(token)) {
      return token
    }
  }
  return undefined
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bunx vitest run tests/modules/commit/english-policy.test.ts`
Expected: PASS (7 tests). If the size assertion fails, a token was dropped or duplicated in transcription — diff your `TOKEN_LIST` against spec §3.2 word by word; do NOT adjust the 221 literal.

- [ ] **Step 6: Commit**

```bash
git add src/modules/commit/english-policy.ts tests/fixtures/english-collision-words.txt tests/modules/commit/english-policy.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): add english-policy stoplist module with collision fixture"
```

---

### Task 3: `create_branch` rule S9

**Files:**
- Modify: `src/modules/commit/create-branch.ts` (the `segmentError` helper ~line 32 and `composeBranchName` ~line 130)
- Test: `tests/modules/commit/create-branch.test.ts`

**Interfaces:**
- Consumes: `findNonEnglishToken` from `./english-policy.js` (Task 2).
- Produces: S9 rejection inside `composeBranchName` — nothing new exported.

- [ ] **Step 1: Write the failing tests** — append to `tests/modules/commit/create-branch.test.ts` (the file already imports `composeBranchName`, `createBranch`, `GitRunner`, and defines `captureMessage`):

```ts
describe("S9 non-english-token (english-policy gate)", () => {
  it("rejects a Polish description with the exact S9 message naming the token", () => {
    expect(
      captureMessage(() =>
        composeBranchName({ type: "feature", description: "naprawa bledu logowania" }),
      ),
    ).toBe(
      `create_branch: segment 'description' violates rule S9 (non-english-token): "naprawa" — branch names must be English; translate the description and retry.`,
    )
  })

  it("never checks the id segment — ZMIANA-12 with an English description passes", () => {
    expect(
      composeBranchName({ type: "feature", id: "ZMIANA-12", description: "fix login flow" }),
    ).toBe("feature/ZMIANA-12-fix-login-flow")
  })

  it("accepts an English description", () => {
    expect(composeBranchName({ type: "fix", description: "fix login flow" })).toBe(
      "fix/fix-login-flow",
    )
  })

  it("S9 fires after S3–S8: a charset violation still reports S3, not S9", () => {
    expect(
      captureMessage(() => composeBranchName({ type: "fix", description: "naprawa/bledu" })),
    ).toContain("violates rule S3")
  })

  it("records zero git calls on an S9 rejection", async () => {
    const calls: string[][] = []
    const runGit: GitRunner = async (_cwd, args) => {
      calls.push([...args])
      return { stdout: "", stderr: "", exitCode: 0 }
    }
    await expect(
      createBranch({ cwd: "/repo", type: "feature", description: "naprawa bledu", runGit }),
    ).rejects.toThrow(/rule S9/)
    expect(calls).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/modules/commit/create-branch.test.ts`
Expected: the five new tests FAIL (no S9 yet; the Polish description currently composes successfully).

- [ ] **Step 3: Implement S9** in `src/modules/commit/create-branch.ts`:

Add the import at the top:

```ts
import { findNonEnglishToken } from "./english-policy.js"
```

Give `segmentError` an optional trailing hint (default keeps every existing S1–S8/N1–N11 message byte-identical):

```ts
function segmentError(
  segment: string,
  ruleId: string,
  slug: string,
  value: string,
  hint = "",
): Error {
  return new Error(
    `create_branch: segment '${segment}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}${hint}`,
  )
}
```

In `composeBranchName`, directly after `validateSegmentRules("description", description)`:

```ts
  // §4 S9: after S3–S8, on the normalized description only — never `id` (D3).
  const nonEnglishToken = findNonEnglishToken(description)
  if (nonEnglishToken !== undefined)
    throw segmentError(
      "description",
      "S9",
      "non-english-token",
      nonEnglishToken,
      " — branch names must be English; translate the description and retry.",
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/modules/commit/create-branch.test.ts tests/modules/commit/create-branch-wrapper.test.ts tests/modules/commit/create-branch.integration.test.ts`
Expected: PASS, including every pre-existing S1–S8/N-rule assertion (the hint default must not alter them).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/create-branch.ts tests/modules/commit/create-branch.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): enforce S9 non-english-token on create_branch descriptions"
```

---

### Task 4: `av_commit` subject gate

**Files:**
- Modify: `src/modules/commit/message-policy.ts` (inside `normalizeCommitMessage`, after the `COMMIT_HEADER` check ~line 38)
- Test: `tests/modules/commit/message-policy.test.ts`

**Interfaces:**
- Consumes: `findNonEnglishToken` from `./english-policy.js` (Task 2).
- Produces: subject-line rejection inside `normalizeCommitMessage` — signature unchanged.

- [ ] **Step 1: Write the failing tests** — append to `tests/modules/commit/message-policy.test.ts`:

```ts
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
    expect(captureMessage(() => normalizeCommitMessage("fix: naprawa logowania"))).toBe(
      'Commit message subject must be English; found non-English token "naprawa". Translate the subject and retry.',
    )
  })

  it("folds an accented subject and reports the folded token", () => {
    expect(captureMessage(() => normalizeCommitMessage("feat: obsługa płatności"))).toBe(
      'Commit message subject must be English; found non-English token "obsluga". Translate the subject and retry.',
    )
  })

  it("never scans the body — a listed token below the subject passes (body exemption)", () => {
    const message = "fix: add login retry\n\nNaprawa logowania: opisano zmiany."
    expect(normalizeCommitMessage(message)).toBe(message)
  })

  it("runs after the Conventional-Commits header check", () => {
    // A malformed header with a Polish word must still report the CC error, not the token.
    expect(captureMessage(() => normalizeCommitMessage("naprawa logowania"))).toBe(
      "Commit message must follow Conventional Commits.",
    )
  })

  it("the Refs footer never triggers the gate", () => {
    expect(normalizeCommitMessage("fix: add retry", "ZMIANA-12")).toBe(
      "fix: add retry\n\nRefs: ZMIANA-12",
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/modules/commit/message-policy.test.ts`
Expected: the two rejection tests FAIL (`<no throw>`); the three accept tests already pass.

- [ ] **Step 3: Implement the gate** in `src/modules/commit/message-policy.ts`:

Add the import:

```ts
import { findNonEnglishToken } from "./english-policy.js"
```

Directly after the `if (!COMMIT_HEADER.test(header)) { ... }` block:

```ts
  // §4: gate the subject (first line) only — the body, including the Refs
  // footer, is quotable free text and is never scanned (D3).
  const nonEnglishToken = findNonEnglishToken(header)
  if (nonEnglishToken !== undefined) {
    throw new Error(
      `Commit message subject must be English; found non-English token ${JSON.stringify(nonEnglishToken)}. Translate the subject and retry.`,
    )
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/modules/commit/message-policy.test.ts tests/modules/commit/controlled-commit.test.ts`
Expected: PASS — including the pre-existing `controlled-commit` suite (its fake-runner messages are English, so nothing regresses).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/message-policy.ts tests/modules/commit/message-policy.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): gate av_commit subjects through english-policy"
```

---

### Task 5: `create_pr` rule T4

**Files:**
- Modify: `src/modules/commit/create-pr.ts` (the `ruleError` helper ~line 31 and `validateTitle` ~line 48)
- Test: `tests/modules/commit/create-pr.test.ts`

**Interfaces:**
- Consumes: `findNonEnglishToken` from `./english-policy.js` (Task 2).
- Produces: T4 rejection inside `validateTitle` (runs before any `runGit` call) — signature unchanged.

- [ ] **Step 1: Write the failing tests** — append to `tests/modules/commit/create-pr.test.ts` (uses only public exports; `GitRunner` comes from `../../../src/modules/commit/controlled-commit.js` — reuse the file's existing import if present):

```ts
describe("T4 non-english-token (english-policy gate)", () => {
  it("rejects a non-English title with the exact T4 message and zero spawns", async () => {
    const gitCalls: string[][] = []
    const runGit: GitRunner = async (_cwd, args) => {
      gitCalls.push([...args])
      return { stdout: "", stderr: "", exitCode: 0 }
    }
    let message = "<no throw>"
    try {
      await createPr({ cwd: "/repo", title: "Naprawa bledu logowania", runGit })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toBe(
      `create_pr: field 'title' violates rule T4 (non-english-token): "naprawa" — PR titles must be English; translate the title and retry.`,
    )
    expect(gitCalls).toEqual([])
  })

  it("folds an accented title and reports the folded token", async () => {
    await expect(
      createPr({ cwd: "/repo", title: "Obsługa płatności" }),
    ).rejects.toThrow(/rule T4 \(non-english-token\): "obsluga"/)
  })

  it("T4 runs after T3: a control character still reports T3", async () => {
    await expect(
      createPr({ cwd: "/repo", title: "naprawa\u0007bledu" }),
    ).rejects.toThrow(/rule T3 \(control-characters\)/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/modules/commit/create-pr.test.ts`
Expected: the first two new tests FAIL (a Polish title currently sails past validation into head resolution); the T3 test already passes.

- [ ] **Step 3: Implement T4** in `src/modules/commit/create-pr.ts`:

Add the import:

```ts
import { findNonEnglishToken } from "./english-policy.js"
```

Give `ruleError` the same optional hint as Task 3's `segmentError`:

```ts
function ruleError(
  field: string,
  ruleId: string,
  slug: string,
  value: string,
  hint = "",
): Error {
  return new Error(
    `create_pr: field '${field}' violates rule ${ruleId} (${slug}): ${JSON.stringify(value)}${hint}`,
  )
}
```

In `validateTitle`, after the T3 check and before `return title`:

```ts
  const nonEnglishToken = findNonEnglishToken(title)
  if (nonEnglishToken !== undefined)
    throw ruleError(
      "title",
      "T4",
      "non-english-token",
      nonEnglishToken,
      " — PR titles must be English; translate the title and retry.",
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/modules/commit/create-pr.test.ts tests/modules/commit/create-pr-wrapper.test.ts tests/modules/commit/create-pr.integration.test.ts`
Expected: PASS, including every pre-existing T1–T3/K/B/R/G assertion (the hint default keeps their messages byte-identical).

- [ ] **Step 5: Commit**

```bash
git add src/modules/commit/create-pr.ts tests/modules/commit/create-pr.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(commit): add T4 non-english-token rule to create_pr titles"
```

---

### Task 6: Schema copy + agent documentation

**Files:**
- Modify: `src/modules/commit/index.ts` (three `.describe(...)` strings)
- Modify: `AGENTS.md` (under `## Plugin-tool enforcement model`, ~line 369)
- Modify: `src/modules/stribog/stribog.md`, `src/modules/svarog/svarog.md`
- Modify: `src/commands/commit.md`

**Interfaces:**
- Consumes: the doctrine sentence and copy strings from spec §5/§6 (verbatim below).
- Produces: nothing programmatic — prompt-layer copy only.

The doctrine sentence (spec §6, verbatim — used in all four docs):

> Publish-chain artifacts that humans read — branch descriptions, commit subjects, and PR titles — are always written in English, regardless of the conversation language; commit and PR bodies may quote non-English source material verbatim, and ticket identifiers are never translated.

- [ ] **Step 1: Schema copy** in `src/modules/commit/index.ts` — replace exactly (spec §5):
  - `"The Conventional Commit message to create"` → `"The Conventional Commit message to create (the subject line MUST be in English — translate first; non-English tokens in the subject are rejected; the body is not checked and may quote non-English text verbatim)"`
  - `"Short plain-English or kebab-case description; whitespace becomes dashes"` → `"Short English description (MUST be in English — translate first; non-English tokens are rejected); whitespace becomes dashes"`
  - `"Pull request title"` → `"Pull request title (MUST be in English — translate first; non-English tokens are rejected)"`

- [ ] **Step 2: AGENTS.md** — append the doctrine sentence as a standalone paragraph at the end of the `## Plugin-tool enforcement model` section (immediately before the next `##` heading).

- [ ] **Step 3: stribog.md** — append the doctrine sentence as the final line of the `## Style` section (end of file). **svarog.md** — insert the doctrine sentence as a new line directly under the `## Hard invariants` heading.

- [ ] **Step 4: commit.md reconciliation** (all five edits; current text quoted from `src/commands/commit.md`):
  1. Insert the doctrine sentence as a standalone paragraph immediately before the `` ## Publishing: the `create_pr` tool `` heading.
  2. In the create_pr validation bullet: `(the offending value is JSON-encoded)` → `(the offending value is JSON-encoded — except rule T4 (`non-english-token`), which JSON-encodes the offending *token* and appends a fixed translate-and-retry hint)`.
  3. Same bullet: `` `title` T1–T3 (non-empty, ≤ 256 code points, no control characters) `` → `` `title` T1–T4 (non-empty, ≤ 256 code points, no control characters, no non-English token) ``.
  4. In the create_branch section: `` `description` (required — plain English is fine) `` → `` `description` (required — MUST be English; non-English tokens are rejected) ``.
  5. Same section: `(charset ... no `.lock`/trailing-dot suffix)` gains `, and no non-English token in `description`` before the closing parenthesis, and `` Errors name the violated rule (`S1`–`S8`, `N1`–`N11`) so you can self-correct. `` → `` Errors name the violated rule (`S1`–`S9`, `N1`–`N11`) so you can self-correct — S9 JSON-encodes the offending token and appends a fixed translate-and-retry hint. ``

- [ ] **Step 5: Verify** — every command must print a hit:

```bash
grep -c "always written in English" AGENTS.md src/modules/stribog/stribog.md src/modules/svarog/svarog.md src/commands/commit.md
grep -c "T1–T4" src/commands/commit.md
grep -c "S1\`–\`S9" src/commands/commit.md
grep -c "MUST be in English" src/modules/commit/index.ts
```

Expected: `1` per doc for the doctrine sentence; ≥1 for each enumeration; `3` for index.ts.

- [ ] **Step 6: Run the commit-module suites** (the index.ts edit must not break tool registration):

Run: `bunx vitest run tests/modules/commit/plugin.test.ts tests/modules/commit/build-output.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/commit/index.ts AGENTS.md src/modules/stribog/stribog.md src/modules/svarog/svarog.md src/commands/commit.md
AV_COMMIT_SKILL=1 git commit -m "docs(agents): English-only publish-chain doctrine and schema copy"
```

---

### Task 7: Full gate + dist sync

**Files:**
- Modify: `dist/` (regenerated by the build — commit whatever the build changes under `dist/`)

- [ ] **Step 1: Run the full gate**

Run: `bun run check`
Expected: build clean, `tsc --noEmit` clean, ALL suites green (root 1540 pre-existing + the new english-policy/S9/subject/T4 tests). Any failure blocks this task — fix before proceeding.

- [ ] **Step 2: Inspect and stage the dist delta**

```bash
git status --short
git add dist/
git status --short
```

Expected staged set: only `dist/modules/commit/*` (english-policy + the three modified validators + index) and `dist/commands/commit.md` / copied agent md assets. If anything outside `dist/` appears, stop and investigate. `docs/specs/reviews/english-publish-chain-policy.pre-loop.bak` must remain untracked.

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git commit -m "chore(build): sync dist for the english-policy publish-chain gate"
```

- [ ] **Step 4: Re-run the acceptance criteria checklist (spec §9)**

- AC-1: covered by Tasks 3–5 test runs (exact messages; zero-call assertions; av_commit at unit level).
- AC-2: covered by Task 2 (collision sanity vs fixture; 221 literal; spot-membership).
- AC-3: covered by Task 6 Step 5 greps.
- AC-4: covered by Step 1 (`bun run check`) + Steps 2–3 (dist synced).

---

## Self-Review (done at plan-writing time)

- **Spec coverage:** §3 module + §3.1 rule 4 fixture + §3.2 list → Task 2; §4 S9/subject/T4 with exact templates and ordering → Tasks 3/4/5; §5 schema copy → Task 6 Step 1; §6 doctrine + commit.md reconciliation (SR-022-corrected anchors) → Task 6 Steps 2–4; §7 vectors (incl. folding, global-ł discriminator, id/body exemptions, zero-call assertions) → Tasks 2–5 test code; §9 ACs → Task 7 Step 4. The six reported-only review minors → Task 1.
- **Placeholder scan:** no TBD/TODO; every code step carries the full code; the fixture is enumerated in full (49 words); the 221-token list is transcribed in full in Task 2.
- **Type consistency:** `findNonEnglishToken(text: string): string | undefined` consumed identically in Tasks 3/4/5; `segmentError`/`ruleError` gain the same optional `hint = ""` parameter; `GitRunner` comes from `controlled-commit.js` everywhere.
