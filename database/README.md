# Baza danych do analizy kardiologicznej

SQLite: `cardio_analysis.db` (Qt czyta ją przez moduł QtSql, sterownik `QSQLITE`).

Odtworzenie bazy (deterministyczne, ten sam wynik za każdym razem):

```bash
python3 database/generate_cardio_db.py
```

## Co jest prawdziwe, a co wymyślone

**Dane referencyjne – z dokumentów NASA MRID JSC 28913:**
- `MEDB 1.6 Resting ECG` – 12-odprowadzeniowe EKG przed i po locie,
- `N3.07 Cycle Ergometer Test / Aerobic Functional Capacity` – test wysiłkowy na cykloergometrze (VO₂peak, HR, ciśnienie, RPE).

| Tabela | Zawartość |
|---|---|
| `medical_requirement` | oba wymagania: cel, mierzone parametry, wyniki |
| `schedule_point` | harmonogram (L-12 m, L-90/30 d, FD 14, FD 75, R-14, R+5, R+30, …) z tolerancją dni |
| `protocol_stage` | protokół obciążeń *nominal* i *light* (waty, czas etapów) |
| `termination_criterion` | 7 kryteriów przerwania testu |
| `test_constraint` | ograniczenia (kofeina, posiłki, wysiłek przed testem, limit 350 W CEVIS, …) |
| `equipment` | sprzęt naziemny i na ISS |

`reference_range` – zakresy norm do oznaczania wyników. **Nie pochodzą z dokumentów**, to ogólne wartości kliniczne dla dorosłych.

**Dane syntetyczne (wymyślone, generowane skryptem):**

| Tabela | Wiersze | Zawartość |
|---|---|---|
| `crew_member` | 15 | fikcyjni astronauci (12 w misjach, 3 tylko z testami rocznymi) |
| `mission`, `crew_assignment` | 4 / 12 | misje HMS-1 … HMS-4 (2024–2026, ~180 dni) |
| `test_session` | 155 | sesje testów zgodne z harmonogramem z dokumentów |
| `cycle_test_result` | 131 | VO₂peak, próg wentylacyjny, moc szczytowa, HR, RER, RPE |
| `stage_measurement` | ~1100 | HR / VO₂ / RPE na każdym etapie testu |
| `bp_measurement` | ~1400 | ciśnienie: spoczynek, wysiłek, 5 min regeneracji |
| `ecg_result` | 24 | raporty EKG (PR, QRS, QTc, rytm, wnioski) |
| `vitals_reading` | ~4400 | 2× dziennie w locie: ciśnienie, HR, oddechy, temp. skóry, SpO₂ |

**Grywalizacja i poradnik (używane przez panel w aplikacji):**

| Tabela | Zawartość |
|---|---|
| `health_task` | 8 codziennych zadań prozdrowotnych (pomiary, ćwiczenia, sen, nawodnienie, nauka) z punktami |
| `task_completion` | ~34 tys. wykonanych zadań (syntetyczna historia do 13.11.2026 + to, co odhaczysz w aplikacji) |
| `indicator_guide` | proste wyjaśnienia: czym jest wskaźnik, jak mierzyć, dlaczego ważny w kosmosie, kiedy reagować |

Punkty, serie (streak), rangi i odznaki liczy `gamification.cpp` na podstawie `task_completion`.

Wbudowane zdarzenia do analizy:
test przerwany z powodu arytmii (FD 75), duszność po powrocie (R+5),
test submaksymalny do powtórzenia, awaria PPFS (test bez analizy gazów), blok AV I st.,
pojedyncze PVC, wydłużony QTc, epizod podwyższonego CO₂ na HMS-2 (oddechy ↑, SpO₂ ↓),
gorączka, narastające ciśnienie pod koniec misji.

## Generowanie danych w aplikacji („Generate user data”)

Przycisk w formularzu nowego użytkownika tworzy osobę i od razu generuje dla niej **fałszywe** dane
do analizy (zapis w tej bazie, kolumna `created_in_app = 1`):

- misja `SIM-xxx` (~150–190 dni, zakończona 5–6 tygodni temu),
- testy na cykloergometrze wg harmonogramu N3.07 (annual, L-12 m, L-90/30 supine + upright, FD 14, FD 75, R-14, R+5, R+30)
  z wynikami etapów i ciśnieniem,
- EKG przed i po locie, pomiary w locie 2× dziennie.

Dla różnorodności każda osoba losowo dostaje 0–3 odchylenia od normy: nadciśnienie, niedociśnienie, tachykardia,
bradykardia, gorączka, podwyższone CO₂, desaturacja (SpO₂ < 92 %), artefakty czujników, silny spadek VO₂peak,
nieprawidłowe EKG, przerwany test R+5. Co zostało zasymulowane, zapisuje tabela **`simulated_event`**
(`source = 'app'`; zdarzenia ze skryptu Pythona mają `source = 'generator'`) – to „prawda” do sprawdzania analiz.

```sql
-- Czy alerty pokrywają się z zasymulowanymi zdarzeniami?
SELECT e.kind, e.start_flight_day, e.end_flight_day, COUNT(a.id) AS alerts
FROM simulated_event e
LEFT JOIN vitals_reading v ON v.crew_id = e.crew_id
     AND v.flight_day BETWEEN e.start_flight_day AND e.end_flight_day
LEFT JOIN v_vitals_alerts a ON a.id = v.id
WHERE e.start_flight_day IS NOT NULL
GROUP BY e.id;
```

## Widoki do analizy

- `v_session_overview` – wszystkie sesje z nazwiskiem, misją i etykietą harmonogramu,
- `v_vo2_trend` – VO₂peak w czasie i % zmiany względem testu L-90/30 d,
- `v_vitals_alerts` – odczyty w locie poza normą (`warning` / `critical`),
- `v_ecg_findings` – nieprawidłowe EKG.

Przykład:

```sql
SELECT label, ROUND(AVG(pct_change_vs_preflight), 1) AS avg_change
FROM v_vo2_trend GROUP BY label;
```
