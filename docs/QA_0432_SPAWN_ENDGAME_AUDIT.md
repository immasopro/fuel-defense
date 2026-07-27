# QA 0.4.3.2 — Spawn budget, Scalper endgate, fuel crisis, win/lose

Status: **audit complete (read-only, no product fix)**  
Repro: `node scripts/qa-audit-0432-spawn-endgame.mjs`  
Version: **0.4.3.2**

## Snapshot fields

| Field | Source |
|-------|--------|
| `targetCars` | `Game.modeCfg.targetCars` (`getTargetCars`) |
| `spawnedCars` | `Game.stats.spawned` — **только обычные клиенты** (`spawnRegularCar`) |
| `servedCars` | `Game.stats.served` — инкремент при уходе заправленного `kind==='car'` |
| `vehiclesOnMap` | `Game.vehicles.length` (cars + scalper + tanker + gbr) |

**Важно:** Scalper **не** увеличивает `spawned`.

---

## Уровень 1 (`targetCars = 100`, Scalper limit = 90)

| Момент | target | spawned | served | onMap | regular | Scalper | state |
|--------|-------:|--------:|-------:|------:|:-------:|:-------:|-------|
| Старт | 100 | 0 | 0 | 0 | ✓ | ✓ | play |
| Спавн остановлен (бюджет) | 100 | 100 | 0 | 100 | ✗ | ✗ | play |
| 90/100 | 100 | 90 | 90 | 0 | ✓ | ✗ | play |
| 95/100 | 100 | 95 | 95 | 0 | ✓ | ✗ | play |
| 100/100 (ещё 2 машины на карте) | 100 | 100 | 100 | 2 | ✗ | ✗ | → **win** |
| 100/100, money &lt; 0 | 100 | 100 | 100 | 0 | ✗ | ✗ | → **over / bankruptcy** |

После `served >= 100` и `money >= 0` уровень **сразу** завершается победой, даже если на карте ещё есть автомобили.

---

## Уровень 5 (`targetCars = 280`, reserve = 10, Scalper limit = 270)

| Условие | Результат |
|---------|-----------|
| `spawned = 269` | новый Scalper **можно** |
| `spawned = 270` | новый Scalper **нельзя** |
| `spawned = 279` | обычная машина **можно**, Scalper **нельзя** |
| Scalper среди «последних» (`spawned=269`) | спавнится; `spawned` остаётся 269 |
| Scalper при `spawned=270` | не создаётся |
| Уже существующий Scalper при `spawned≥270` | **остаётся** на карте, доживает lifecycle |
| После despawn / ухода с карты при `spawned≥270` | новый Scalper **не** появляется |
| **Пойман GBR** при `spawned≥270` | `spawned`/`served` не меняются; новый Scalper **не** появляется |
| Несколько Scalper подряд (`spawned=50`) | ок: одновременно только один (`Game.scalper.unit`), после despawn — следующий |

---

## Частичный спавн

**`spawned=95`, `served=95` (L1):**

- Обычные машины: **да, продолжают** (`95 < 100`)
- Scalper: **нет** (`95 ≥ 90`)

---

## После полного спавна

**`spawned=100`, `served=80`, 3 машины на карте:**

- Новых обычных нет
- Победы ещё нет (`served < target`)
- Игра ждёт, пока `served` догонит `target` (или кризис/пробка)

---

## Топливный кризис

Триггер (`checkFuelCrisis` в `defeatSystem.js`):

1. `hasWaitingClients()` — в кампании: `served < target` **или** есть незаправленный `car` в holder/vehicles  
2. `isFuelExhausted()` — depot + все станции ≈ 0  
3. `isTankerCreditBlocked()` — нельзя оплатить минимальный заказ **20%** (`canAffordFuelOrder`)

Кредит (`canOrderTanker` / `canAffordFuelOrder`):  
`money - cost >= -cost` ⟺ **`money >= 0`**.

Заказ в долг возможен с нуля/плюса (баланс уходит в минус на сумму заказа).  
При **уже отрицательном** балансе заказ блокируется → при пустом топливе и waiting clients срабатывает кризис.

| Сценарий | Кризис? |
|----------|---------|
| Топливо пусто, танкер READY, money &gt; 0 | нет |
| Топливо пусто, READY, money = 0 (кредит разрешён) | нет |
| Топливо пусто, READY, money = −1 | **да** |
| Топливо пусто, READY, money = −80k | **да** |
| Топливо пусто, танкер PREPARING, money &gt; 0 | нет |
| Топливо пусто, танкер PREPARING, money &lt; 0 | **да** |
| Топливо пусто, served≥target, нет waiting cars | нет |
| На нефтебазе есть топливо | нет |
| Несколько типов топлива на карте, всё пусто, money &lt; 0 | **да** |

«Минимальный бензовоз недоступен» (PREPARING) **сам по себе** кризиса не даёт, если кредит ещё разрешён (`money >= 0`).

---

## Победа / поражение — где в коде

| Исход | Где | Условие |
|-------|-----|---------|
| **Победа** | `js/game.js` `update()` | campaign: `served >= targetCars` и `money >= 0` → `endGame(true)` |
| **Банкротство** | там же | `served >= target` и `money < 0` → `endGame(false, 'bankruptcy')` |
| **Пробка** | `defeatSystem.updateDefeatTimer` | зелёный свет + holder полон + въезд заблокирован ≥ `CONFIG.defeatTime` |
| **Топливный кризис** | `defeatSystem.checkFuelCrisis` | waiting ∧ fuel exhausted ∧ credit blocked |

Победа **не** требует пустой карты и **не** требует `spawned === target` (достаточно `served`).

---

## Выводы

1. Бюджет обычных машин и endgate Scalper работают как в 0.4.2.5.  
2. На L1 «последние 10» — зона без нового Scalper при продолжении обычного спавна.  
3. Win срабатывает по `served`, мгновенно, с машинами на карте.  
4. Кризис топлива фактически завязан на **`money >= 0`** для возможности минимального заказа 20%, а не на отдельный UI-лимит −70k как единственный порог.
