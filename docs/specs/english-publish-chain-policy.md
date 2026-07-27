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
and commit subjects like `fix: naprawa logowania`. The existing charsets reject diacritics, but
Polish written without diacritics passes every current rule.

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
- Unit tests for the module and one reject + one accept vector per integration surface.

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

- `findNonEnglishToken` lowercases the input, splits it on `/[^a-z0-9]+/` (so it tokenizes
  kebab-case branch descriptions, spaced commit subjects, and punctuated PR titles alike),
  drops empty tokens, and returns the **first** token contained in `NON_ENGLISH_TOKENS`;
  `undefined` when none match. Pure TypeScript, no I/O, no spawns.
- Matching is exact set membership. No stemming, no fuzzy matching — predictability over
  recall.

### 3.1 Curation rules (binding for the initial list and every future addition)

1. Tokens are lowercase ASCII, length ≥ 3, stored in their diacritic-stripped spelling
   (charsets upstream already reject diacritics, so `blad` is listed, not `błąd`).
2. **Collision rule:** a token that is also an English word, a common English abbreviation, or
   an established tech term never enters the list. Examples excluded by this rule:
   `testy` (an English adjective), `menu`, `panel`, `status`, `admin`, `token`, `pod` (the
   Kubernetes term), and `plan` — words spelled identically in Polish and English. A word
   merely *similar* to English stays in (`lista`, `raport`, `adres` are not English spellings).
3. The list targets development vocabulary — words an agent would emit when naming a change —
   not general Polish.

### 3.2 Initial token list (normative)

Change verbs/nouns: `naprawa naprawy naprawic naprawiono poprawka poprawki poprawic poprawiono
poprawa blad bledu bledow bledy dodanie dodania dodaj dodano dodawanie usuniecie usuniecia usun
usunieto usuwanie zmiana zmiany zmien zmieniono zmienic aktualizacja aktualizacji aktualizuj
zaktualizowano wdrozenie wdrozenia migracja migracji refaktoryzacja refaktoryzacji optymalizacja
optymalizacji tworzenie tworzenia utworz utworzono generowanie generowania generuj pobieranie
pobierania pobierz wysylanie wysylania wyslij zapisywanie zapisz odczyt odczytu edycja edycji
edytuj podglad podgladu filtrowanie filtrowania sortowanie sortowania wyszukiwanie wyszukiwania
wyszukiwarka szukaj ladowanie ladowania obsluga obslugi wsparcie wsparcia`

Domain nouns: `uzytkownik uzytkownika uzytkownikow uzytkownicy logowanie logowania wylogowanie
rejestracja rejestracji haslo hasla sesja sesji uprawnienia uprawnien uprawnienie powiadomienie
powiadomienia powiadomien wiadomosc wiadomosci platnosc platnosci koszyk koszyka zamowienie
zamowienia zamowien formularz formularza formularze walidacja walidacji konfiguracja
konfiguracji ustawienia ustawien strona strony widok widoku widoki przycisk przycisku przyciski
okno okna naglowek naglowka stopka stopki tabela tabeli kolumna kolumny wiersz wiersza plik
pliku plikow pliki katalog katalogu baza bazy dane danych funkcja funkcji funkcje
funkcjonalnosc funkcjonalnosci modul modulu komponent komponentu komponenty usluga uslugi
klient klienta klientow serwer serwera adres adresu jezyk jezyka tlumaczenie tlumaczenia
tlumaczen motyw motywu motywy ciemny jasny ekran ekranu przelacznik zadanie zadania zadan
blokada blokady blokowanie raport raportu raporty kolejka kolejki harmonogram harmonogramu
lista listy`

Function words/adjectives: `dla oraz przy bez przed wedlug jako nowy nowa nowe nowego nowych
stary stara stare szybki szybkie glowny glowna glowne pelny pelna pusty pusta domyslny domyslna
domyslne brakujacy brakujace niepoprawny niepoprawna bledny bledna`

## 4. Integration points (normative)

| Surface | Field gated | Rule id | Runs after | File |
|---|---|---|---|---|
| `create_branch` | normalized `description` (never `id`) | **S9** `non-english-token` | S3–S8 | `create-branch.ts` |
| `av_commit` | first line of the trimmed message (subject) | — (plain sentence) | Conventional-Commits header check | `message-policy.ts` |
| `create_pr` | trimmed `title` | **T4** `non-english-token` | T3 | `create-pr.ts` |

Error templates (normative; `<token>` is the JSON-encoded offending token):

- **S9:** `create_branch: segment 'description' violates rule S9 (non-english-token): <token> — branch names must be English; translate the description and retry.`
- **av_commit:** `Commit message subject must be English; found non-English token <token>. Translate the subject and retry.`
- **T4:** `create_pr: field 'title' violates rule T4 (non-english-token): <token> — PR titles must be English; translate the title and retry.`

S9 and T4 extend their families' fixed templates with the fixed trailing hint (D4); the hint
text never varies, so tests can assert the full message exactly. All three checks are pure
TypeScript and cost **zero** process spawns (for `create_pr`, T4 fires before any `runGit`
invocation, preserving the fail-fast contract).

`av_commit` gates only the subject: the body (everything after the first line), including the
`Refs:` footer, is never scanned (D3).

## 5. Schema copy (normative, `src/modules/commit/index.ts`)

- `create_branch.description`: `"Short English description (MUST be in English — translate first; non-English tokens are rejected); whitespace becomes dashes"`
- `av_commit.message`: `"The Conventional Commit message to create (subject MUST be in English — translate first; non-English tokens are rejected)"`
- `create_pr.title`: `"Pull request title (MUST be in English — translate first; non-English tokens are rejected)"`

## 6. Agent documentation (one sentence, added to each file)

> Publish-chain artifacts — branch names, commit messages, PR titles — are always written in
> English, regardless of the conversation language.

Added to: `AGENTS.md` (conventions section), `src/modules/stribog/stribog.md`,
`src/modules/svarog/svarog.md`, `src/commands/commit.md`.

## 7. Testing requirements

- **Module unit tests** (`tests/modules/commit/english-policy.test.ts`):
  - detects a listed token in kebab (`naprawa-bledu`), spaced (`naprawa logowania`), and
    mixed-case (`Naprawa`) inputs, returning the first hit;
  - returns `undefined` for clean English (`fix-login-flow`, `feat: add retry logic`);
  - **collision sanity:** the intersection of `NON_ENGLISH_TOKENS` with an embedded sample of
    ~50 common English dev words (`fix add remove update test menu panel status admin token
    pod plan data list report client server address …`) is empty;
  - list invariants: non-empty, every entry matches `/^[a-z0-9]{3,}$/`.
- **Per-surface vectors:**
  - `create_branch`: `description: "naprawa bledu logowania"` → exact S9 message with token
    `"naprawa"`; `id: "ZMIANA-12"` with an English description → **passes** (id exemption);
    `description: "fix login flow"` → passes. Zero recorded git calls on rejection.
  - `av_commit`: `"fix: naprawa logowania"` → exact subject error; a message with an English
    subject and Polish body content → **passes** (body exemption).
  - `create_pr`: `title: "Naprawa bledu logowania"` → exact T4 message, zero recorded runner
    calls; an English title → passes existing AC-3 flow unchanged.
- Existing English vectors across the three suites keep passing (regression).

## 8. Residual risk & limitations (accepted)

- The gate is a **heuristic**: Polish (or any language) outside the list passes — e.g. rare
  words, heavy inflections, or another language entirely (German, Spanish) is not detected.
  The prompt layer carries those cases; the list is extensible one token at a time.
- A future genuinely-English token colliding with a listed word would be a false positive; the
  collision rule plus the collision-sanity test guard the current list, and any hit is
  correctable by removing the token.

## 9. Acceptance criteria

- **AC-1:** Every §4 reject vector throws its exact normative message; every accept vector
  passes; rejections record zero git/gh calls.
- **AC-2:** The collision-sanity and list-invariant tests pass.
- **AC-3:** Schema descriptions match §5 verbatim; the four §6 docs each contain the doctrine
  sentence.
- **AC-4:** `bun run check` (build + typecheck + test) passes; `dist/` is synced.
