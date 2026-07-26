# QA 0.4.3.1 — GBR teleport after Scalper catch (CHASE → RETURNING)

Status: **FAIL reproduced; fixed in 0.4.3.2**  
Repro: `node scripts/qa-audit-0431-gbr-return.mjs`

## Verdict (pre-fix)

**FAIL** — поимка Scalper сразу после прохождения базы по кольцу вызывала мгновенное завершение `RETURNING` (визуально — телепорт на базу).

## Root cause

В `updateGBR` для фазы `RETURNING`:

```js
const dp = Math.hypot(GBRBase.pos.x - p.x, GBRBase.pos.y - p.y);
if (dp < 40 || distAhead(g.s, GBRBase.spawnS, L) < 8) { /* complete */ }
```

Евклидово `dp < 40` срабатывает в зоне **+1…~+35 px** после `GBRBase.spawnS`, где `ringAhead ≈ L` (~1750 px). GBR ещё геометрически рядом с базой, но по маршруту должен проехать почти полный круг.

На карте 420×730 найдено **45** ложных точек (`dp < 40` ∧ `ringAhead > 30`).

## Scenario results (pre-fix)

| # | Сценарий | Результат |
|---|----------|-----------|
| 1 | Поимка далеко до базы (offset −400) | PASS |
| 2 | Поимка перед базой (−25) | PASS |
| 3 | Поимка сразу после базы (+25) | **FAIL** — instant complete, ringAhead=1729, euclid=28.4 |
| 4 | Критическая точка (+1) | **FAIL** — instant complete, ringAhead=1753, euclid=13.5 |
| 5 | Несколько GBR | FAIL у экипажа с offset +1; остальные PASS |

## Fix (0.4.3.2)

Убран евклидов критерий. Прибытие только по кольцу: `distAhead(g.s, GBRBase.spawnS, L) < 8`.

Не менялись: CHASE, скорость возврата 60, prep 20 с, экономика.

## Post-fix

Повторный прогон `qa-audit-0431-gbr-return.mjs` → **PASS** по всем сценариям.
