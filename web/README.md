# Health Monitor – wersja React

Przepisana aplikacja Qt (`login`, `mainform`, `statsscreen`) jako aplikacja webowa:

- **React** (Vite) – ekrany: logowanie → dodawanie użytkownika („Generate user data”) → panel zdrowia,
- **Express + `node:sqlite`** – API na tej samej bazie co aplikacja Qt: `../database/cardio_analysis.db`
  (wbudowany moduł SQLite w Node, bez natywnych zależności do kompilowania).

Aplikacja Qt zostaje w repo bez zmian; obie wersje mogą korzystać z tej samej bazy.

## Uruchomienie

Wymaga Node.js 22.13+ (testowane na Node 26).

```bash
cd web
npm install
npm run dev          # http://localhost:5173
```

Produkcyjnie: `npm run build && npm start`. Inna baza (np. kopia do testów):
`CARDIO_DB=/ścieżka/do/kopii.db npm run dev`. Port: zmienna `PORT`.

Testy API (działają na tymczasowej kopii bazy, prawdziwej nie zmieniają): `npm test`.

## Ekrany

| Qt | React | Co robi |
|---|---|---|
| `login.ui` | `src/screens/Login.jsx` | wybór astronauty (lista z bazy, nie z `users.json`), Log in / Add user / Delete user |
| `mainform.ui` | `src/screens/UserForm.jsx` | formularz + „Generate user data” → fałszywe dane z 0–3 odchyleniami od normy |
| `statsscreen.ui` | `src/screens/Dashboard.jsx` | panel: przegląd, wykresy parametrów życiowych, wydolność (VO₂peak), EKG, zadania dnia, poradnik |

Usuwać można tylko osoby dodane w aplikacji (`created_in_app = 1`) – razem z ich danymi i misją `SIM-xxx`.
Fikcyjna załoga referencyjna z `generate_cardio_db.py` jest chroniona.

## Serwer

| Plik | Zawartość |
|---|---|
| `server/generator.js` | port `datagenerator.cpp` 1:1 (te same rozkłady, harmonogram N3.07, zdarzenia → `simulated_event`) |
| `server/api.js` | `GET/POST/DELETE /api/crew`, `GET /api/crew/:id/dashboard`, `GET/POST /api/crew/:id/tasks`, `GET /api/guide` |
| `server/gamification.js` | punkty, serie, rangi, odznaki (te same zasady co panel Qt z gałęzi `cardio_analysis`) |
