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
`;
const NON_ENGLISH_TOKENS = new Set(
  TOKEN_LIST.split(/\s+/).filter((token) => token !== "")
);
function findNonEnglishToken(text) {
  const folded = text.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const token of folded.split(/[^a-z0-9]+/)) {
    if (token !== "" && NON_ENGLISH_TOKENS.has(token)) {
      return token;
    }
  }
  return void 0;
}
export {
  NON_ENGLISH_TOKENS,
  findNonEnglishToken
};
