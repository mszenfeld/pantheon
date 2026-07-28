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
