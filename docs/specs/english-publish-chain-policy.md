---
title: "English-only publish-chain policy — non-English token gate for create_branch, av_commit, create_pr"
date: 2026-07-27
source: "Operator request (2026-07-27): enforce English names when creating branches; scope widened by operator decision to the whole publish chain (branch description, commit subject, PR title)"
approved: false
---

# Feature Specification: English-only publish-chain policy

## 1. Goal

The publish-chain tools (`create_branch`, `av_commit`, `create_pr`) are called by LLM agents
(Svarog, Stribog, the `/commit` flow) that leak the conversation language into generated
artifacts: a session held in Polish produces branch names like `feature/naprawa-bledu-logowania`
and commit subjects like `fix: naprawa logowania`. Only `create_branch`'s segment charset rejects
diacritics — commit subjects and PR titles accept them — and Polish written without diacritics
passes every current rule on all three surfaces.

Enforce English in the three human-facing publish-chain fields with two layers:

1. **Prompt layer** (primary for LLM callers): the tool schemas state that the fields MUST be in
   English, instructing the model to translate before calling.
2. **Deterministic gate** (backstop): a curated stoplist of unambiguously non-English tokens,
   checked in pure TypeScript with zero process spawns; a hit rejects the call with an
   instructive error that tells the agent to translate and retry.

**In scope**

- New module `src/modules/commit/english-policy.ts` (stoplist + checker).
- `create_branch`: new rule **S9** on the normalized `description` segment.
- `av_commit`: subject-line (first line) check in `normalizeCommitMessage`.
- `create_pr`: new rule **T4** on the trimmed `title`.
- Schema-description copy updates for the three arguments in `src/modules/commit/index.ts`.
- One-line English-only doctrine note in `AGENTS.md`, `src/modules/stribog/stribog.md`,
  `src/modules/svarog/svarog.md`, `src/commands/commit.md`.
- Unit tests for the module, and at least one reject + one accept vector per integration
  surface (plus the `create_branch` id-exemption vector).

**Out of scope**

- Commit **bodies** and PR **bodies** — they legitimately quote user-facing copy, error
  messages, or translations, and are never gated.
- The `id` segment of `create_branch` (ticket identifiers are never language-checked) and
  `taskId` / `base` / `draft` parameters.
- Any change to git invocation contracts, guards, or the bash policy.
- True language detection (dictionaries, n-gram models) — rejected by operator decision as
  heavy and false-positive-prone; the stoplist is an explicitly incomplete heuristic.

## 2. Design decisions (operator-approved 2026-07-27)

- **D1 — Mechanism:** schema copy + curated stoplist gate (option "Schema + stoplista").
  A full English-wordlist allowlist was rejected (jargon/proper-noun false positives, embedded
  dictionary weight); schema-only was rejected (no hard gate).
- **D2 — Scope:** the whole publish chain (branch description, commit subject, PR title), not
  just `create_branch`.
- **D3 — Human-fields-only:** the gate binds exactly the fields a human reads in git/GitHub
  chrome (ref names, log subjects, PR list titles). Quotable free-text (bodies) is exempt so a
  Polish product string inside a commit body can never block a commit.
- **D4 — Fail with instruction, not just rejection:** every gate error names the offending
  token and ends with a fixed "translate … and retry." hint, because the caller is an LLM that
  will self-correct when told how.

## 3. `english-policy.ts` module (normative)

```ts
export const NON_ENGLISH_TOKENS: ReadonlySet<string>
export function findNonEnglishToken(text: string): string | undefined
```

- `findNonEnglishToken` lowercases the input, folds diacritics — applies
  `.replace(/ł/g, "l")` (the `g` flag is required: U+0142 has no canonical decomposition, and
  any unfolded `ł` becomes a token separator in the split below, silently shattering the word),
  then applies `String.prototype.normalize("NFD")` and strips combining marks
  (`/[\u0300-\u036f]/g`) so `błąd`→`blad` and `obsługa`→`obsluga` — then splits on
  `/[^a-z0-9]+/` (so it tokenizes kebab-case branch descriptions, spaced commit subjects, and
  punctuated PR titles alike), drops empty tokens, and returns the **first** token contained in
  `NON_ENGLISH_TOKENS`;
  `undefined` when none match. Pure TypeScript, no I/O, no spawns.
- Matching is exact set membership. No stemming, no fuzzy matching — predictability over
  recall.

### 3.1 Curation rules (binding for the initial list and every future addition)

1. Tokens are lowercase ASCII, length ≥ 3, stored in their diacritic-stripped spelling
   (the tokenizer folds diacritics before matching, so `blad` is listed, not `błąd` — both
   spellings then match).
2. **Collision rule:** a token that is also an English word, a common English abbreviation, or
   an established tech term never enters the list. Examples excluded by this rule:
   `testy` (an English adjective), `menu`, `panel`, `status`, `admin`, `token`, `pod` (the
   Kubernetes term), `plan`, `stare` (an English verb), and `dane` (folds onto the DANE
   protocol term and the proper noun) — words spelled identically in Polish and English. A word
   merely *similar* to English stays in (`lista`, `raport`, `adres` are not English spellings).
3. The list targets the vocabulary an agent emits when naming a change — development nouns and
   verbs, plus the high-frequency function words and adjectives that appear inside such names —
   not general Polish beyond that set.
4. **Enforcement:** every future addition is checked against the collision fixture used by §7's
   collision-sanity test before it enters the list; a token that intersects the fixture is
   rejected. The fixture is extended whenever a collision is discovered in the field. The
   fixture MUST contain every token enumerated as excluded by rule 2.

### 3.2 Initial token list (normative)

Change verbs/nouns (76 tokens): `naprawa naprawy naprawic naprawiono poprawka poprawki poprawic poprawiono
poprawa blad bledu bledow bledy dodanie dodania dodaj dodano dodawanie usuniecie usuniecia usun
usunieto usuwanie zmiana zmiany zmien zmieniono zmienic aktualizacja aktualizacji aktualizuj
zaktualizowano wdrozenie wdrozenia migracja migracji refaktoryzacja refaktoryzacji optymalizacja
optymalizacji tworzenie tworzenia utworz utworzono generowanie generowania generuj pobieranie
pobierania pobierz wysylanie wysylania wyslij zapisywanie zapisz odczyt odczytu edycja edycji
edytuj podglad podgladu filtrowanie filtrowania sortowanie sortowania wyszukiwanie wyszukiwania
wyszukiwarka szukaj ladowanie ladowania obsluga obslugi wsparcie wsparcia`

Domain nouns (113 tokens): `uzytkownik uzytkownika uzytkownikow uzytkownicy logowanie logowania wylogowanie
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
lista listy`

Function words/adjectives (32 tokens): `dla oraz przy bez przed wedlug jako nowy nowa nowe nowego nowych
stary stara szybki szybkie glowny glowna glowne pelny pelna pusty pusta domyslny domyslna
domyslne brakujacy brakujace niepoprawny niepoprawna bledny bledna`

The list contains exactly the **221** tokens above (76 + 113 + 32); the implementation exports
them verbatim, and the module test pins the literal count and spot-checks the first and last
token of each group.

## 4. Integration points (normative)

| Surface | Field gated | Rule id | Runs after | File |
|---|---|---|---|---|
| `create_branch` | normalized `description` (never `id`) | **S9** `non-english-token` | S3–S8 | `create-branch.ts` |
| `av_commit` | first line of the trimmed message (subject) | — (plain sentence) | Conventional-Commits header check | `message-policy.ts` |
| `create_pr` | trimmed `title` | **T4** `non-english-token` | T3 | `create-pr.ts` |

Error templates (normative; `<token>` is the JSON encoding of the value returned by
`findNonEnglishToken` — the lowercased, diacritic-folded token, which may differ from the
caller's spelling, e.g. `"obsluga"` for `obsługa`):

- **S9:** `create_branch: segment 'description' violates rule S9 (non-english-token): <token> — branch names must be English; translate the description and retry.`
- **av_commit:** `Commit message subject must be English; found non-English token <token>. Translate the subject and retry.`
- **T4:** `create_pr: field 'title' violates rule T4 (non-english-token): <token> — PR titles must be English; translate the title and retry.`

S9 and T4 extend their families' fixed templates with the fixed trailing hint (D4); the hint
text never varies, so tests can assert the full message exactly. All three checks are pure
TypeScript and add zero process spawns of their own. `create_branch` and `create_pr` reject
before any `runGit` invocation (T4 fires before the first git call), preserving their fail-fast
contracts. `av_commit`'s check sits in `normalizeCommitMessage`, which `createControlledCommit`
invokes after its repo check, `git add`, and `git diff --cached` — exactly where the existing
Conventional-Commits rejection happens; a rejected subject therefore leaves the index staged,
unchanged from today's behavior.

`av_commit` gates only the subject: the body (everything after the first line), including the
`Refs:` footer, is never scanned (D3).

## 5. Schema copy (normative, `src/modules/commit/index.ts`)

- `create_branch.description`: `"Short English description (MUST be in English — translate first; non-English tokens are rejected); whitespace becomes dashes"`
- `av_commit.message`: `"The Conventional Commit message to create (the subject line MUST be in English — translate first; non-English tokens in the subject are rejected; the body is not checked and may quote non-English text verbatim)"`
- `create_pr.title`: `"Pull request title (MUST be in English — translate first; non-English tokens are rejected)"`

## 6. Agent documentation (one sentence, added to each file)

> Publish-chain artifacts that humans read — branch descriptions, commit subjects, and PR
> titles — are always written in English, regardless of the conversation language; commit and PR
> bodies may quote non-English source material verbatim, and ticket identifiers are never
> translated.

Added to: `AGENTS.md` (under `## Plugin-tool enforcement model`), `src/modules/stribog/stribog.md`,
`src/modules/svarog/svarog.md`, `src/commands/commit.md`. In `src/commands/commit.md`, additionally
reconcile the existing copy: "`description` (required — plain English is fine)" becomes
"`description` (required — MUST be English; non-English tokens are rejected)", and the rule
enumerations `title` T1–T3 → T1–T4 and (`S1`–`S8`, `N1`–`N11`) → (`S1`–`S9`, `N1`–`N11`). In
that file's `create_pr` bullet, the error-contract sentence ("the offending value is
JSON-encoded") gains the T4 exception — T4 JSON-encodes the offending *token*, not the field
value, and appends a fixed translate-and-retry hint — and the `title` parenthetical becomes
"(non-empty, ≤ 256 code points, no control characters, no non-English token)". In the
`create_branch` bullet, the per-segment enumeration gains ", and no non-English token in
`description`", and its error sentence becomes "Errors name the violated rule (`S1`–`S9`,
`N1`–`N11`) so you can self-correct — S9 JSON-encodes the offending token and appends a
fixed translate-and-retry hint."

## 7. Testing requirements

- **Module unit tests** (`tests/modules/commit/english-policy.test.ts`):
  - detects a listed token in kebab (`naprawa-bledu`), spaced (`naprawa logowania`), and
    mixed-case (`Naprawa`) inputs, returning the first hit;
  - detects the accented spelling via folding (`"fix: obsługa płatności"` → token `obsluga`;
    `błędu` → `bledu`, exercising the `ł`→`l` map);
  - the fold is global: `"fix: łatwe wysyłanie"` → token `wysylanie` (a first-occurrence-only
    `ł` replace shatters the second word and wrongly passes);
  - returns `undefined` for clean English (`fix-login-flow`, `feat: add retry logic`);
  - **collision sanity:** the intersection of `NON_ENGLISH_TOKENS` with the committed fixture
    `tests/fixtures/english-collision-words.txt` is empty. The fixture is test-only (never
    bundled into `english-policy.ts`, per D1), seeded with at least: `fix add remove update test
    testy menu panel status admin token pod plan data list report client server address stare dane
    process module component date state stage rate mode note base case user file folder view page
    form table column row error log build deploy config option value type` — and is extended
    whenever a collision is discovered;
  - fixture format (normative): one token per line, lowercase ASCII in the same
    diacritic-folded spelling as the list (`/^[a-z0-9]{3,}$/`); blank lines and `#` comments
    are ignored; the test validates every parsed entry against that pattern before
    intersecting;
  - list invariants: non-empty, every entry matches `/^[a-z0-9]{3,}$/`, the set size equals
    the literal 221 stated in §3.2 (per-group: 76/113/32), and the first and last token of
    each §3.2 group are members.
- **Per-surface vectors:**
  - `create_branch`: `description: "naprawa bledu logowania"` → exact S9 message with token
    `"naprawa"`; `id: "ZMIANA-12"` with an English description → **passes** (id exemption);
    `description: "fix login flow"` → passes. Zero recorded git calls on rejection.
  - `av_commit`: `"fix: naprawa logowania"` → exact subject error; a message whose subject is English
    and whose body contains a listed token → **passes** (body exemption):
    `"fix: add login retry\n\nNaprawa logowania: opisano zmiany."` — the body token
    `naprawa` must not be reported.
  - `create_pr`: `title: "Naprawa bledu logowania"` → exact T4 message, zero recorded runner
    calls; an English title → the existing `create_pr` happy-path suite passes unchanged.
- Existing English vectors across the three suites keep passing (regression).

## 8. Residual risk & limitations (accepted)

- The gate is a **heuristic**: Polish (or any language) outside the list passes — e.g. rare
  words, heavy inflections, or another language entirely (German, Spanish) is not detected.
  The prompt layer carries those cases; the list is extensible one token at a time.
- A future genuinely-English token colliding with a listed word would be a false positive; the
  collision rule plus the fixture-based collision-sanity test guard the list against the
  enumerated collisions only, and any hit is correctable by removing the token.
- The gate binds the `description` argument of `create_branch`, not ref names in general: a
  branch created outside the tool (e.g. bash `git checkout -b`, which the bash rail does not
  block for non-executor sessions) keeps its non-English name, and `create_pr` re-validates the
  resolved head only against the R-rules before pushing it. Closing this would mean gating the
  resolved head, outside D2's three-field scope.

## 9. Acceptance criteria

- **AC-1:** Every §7 reject vector throws its exact §4 normative message; every §7 accept vector
  passes. `create_branch` and `create_pr` rejections record zero git/gh calls; the `av_commit`
  vector is asserted at the `normalizeCommitMessage` unit level.
- **AC-2:** The collision-sanity and list-invariant tests pass, including the §3.2
  literal-size (221; 76/113/32) and spot-membership checks.
- **AC-3:** Schema descriptions match §5 verbatim; the four §6 docs each contain the doctrine
  sentence; and `src/commands/commit.md` carries every §6 reconciliation edit (description
  copy, `title` T1–T4 parenthetical, `S1`–`S9` enumeration with the S9 note, and the T4
  error-contract exception).
- **AC-4:** `bun run check` (build + typecheck + test) passes; `dist/` is synced.
