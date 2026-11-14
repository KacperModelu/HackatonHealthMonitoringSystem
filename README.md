# HackatonHealthMonitoringSystem

Long-duration missions expose astronauts to space radiation, isolation and confinement, altered gravity, and a hostile closed environment, which can bring immune changes, bone loss, cardiovascular events, and behavioral health problems. On long missions, astronauts carry much of the responsibility for spotting these changes in themselves.

**Health Monitor** helps astronauts track their own health: colour-coded vitals, charts over the
mission, fitness and ECG results, psychological wellbeing and cognitive tests, daily health tasks
with points and badges, and plain-language explanations of every measurement.

## Uruchomienie

Wymaga Node.js 22.13+ (testowane na Node 26).

```bash
npm install
npm run dev          # http://localhost:5173
```

Produkcyjnie: `npm run build && npm start`. Inna baza (np. kopia do testów):
`CARDIO_DB=/ścieżka/do/kopii.db npm run dev`. Port: zmienna `PORT`.

Testy API (działają na tymczasowej kopii bazy, prawdziwej nie zmieniają): `npm test`.

## Budowa

- **React** (Vite) – `src/`: logowanie → dodawanie użytkownika („Generate user data”) → panel zdrowia,
- **Express + `node:sqlite`** – `server/`: API na bazie `database/cardio_analysis.db`
  (wbudowany moduł SQLite w Node, bez natywnych zależności do kompilowania),
- **Baza** – `database/`: schemat, generator w Pythonie i opis danych ([database/README.md](database/README.md)).

## Ekrany

| Plik | Co robi |
|---|---|
| `src/screens/Login.jsx` | wybór astronauty z bazy, Log in / Add user / Delete user |
| `src/screens/UserForm.jsx` | formularz + „Generate user data” → fałszywe dane z 0–3 odchyleniami od normy |
| `src/screens/Dashboard.jsx` | panel: przegląd, wykresy parametrów życiowych, wydolność (VO₂peak), EKG |
| `src/screens/Wellbeing.jsx` | kwestionariusz psychologiczny (10 pytań), dziennik, ćwiczenia oddechowe (3 min) i medytacja (5 min) |
| `src/screens/Cognitive.jsx` | 6 testów kognitywnych: czas reakcji, pamięć cyfr, 2-back, matryce, orientacja przestrzenna, cyfry-symbole |
| `src/screens/Tasks.jsx` | zadania dnia: punkty, serie, rangi, odznaki |
| `src/screens/Guide.jsx` | poradnik: czym jest wskaźnik, jak mierzyć, kiedy reagować |

Usuwać można tylko osoby dodane w aplikacji (`created_in_app = 1`) – razem z ich danymi i misją `SIM-xxx`.
Fikcyjna załoga referencyjna z `generate_cardio_db.py` jest chroniona.

## Serwer

| Plik | Zawartość |
|---|---|
| `server/generator.js` | fałszywe dane: misja, testy na cykloergometrze wg harmonogramu NASA N3.07, EKG, pomiary w locie; zdarzenia → `simulated_event` |
| `server/api.js` | `GET/POST/DELETE /api/crew`, `GET /api/crew/:id/dashboard`, `GET/POST /api/crew/:id/tasks`, `GET /api/guide`, `GET /api/crew/:id/wellbeing`, `POST /api/crew/:id/psych`, `POST /api/crew/:id/journal`, `GET/POST /api/crew/:id/cognitive` |
| `server/gamification.js` | punkty, serie, rangi, odznaki |
| `src/assessments.js` | pytania i testy – wspólne dla ekranów i serwera (serwer sam przelicza wynik kwestionariusza) |
