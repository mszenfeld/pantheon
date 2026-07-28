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
declare const NON_ENGLISH_TOKENS: ReadonlySet<string>;
/**
 * §3 tokenizer: lowercase → fold `ł`→`l` (U+0142 has no canonical
 * decomposition; the `g` flag is load-bearing — an unfolded `ł` becomes a
 * token separator in the split below and silently shatters the word) →
 * NFD → strip combining marks → split on non-alphanumerics. Returns the
 * FIRST listed token (in its folded, lowercased spelling), else undefined.
 */
declare function findNonEnglishToken(text: string): string | undefined;

export { NON_ENGLISH_TOKENS, findNonEnglishToken };
