# QA Audit 0.4.2.4 — LIFECYCLE / SPAWN INVARIANTS

Status: **audit completed; fixed in 0.4.2.5**  
Reproduction (pre-fix): `node --input-type=module -e "await import('./scripts/qa-audit-0424-spawn.mjs')"`  
Fix: patch **0.4.2.5** (`canSpawnScalper` + `restoreScalperToTour` on `releasePocket`)

---

## Answers to QA key questions

| Question | Answer |
|----------|--------|
| Учитывается ли Scalper в `spawned/target`? | **Нет.** `stats.spawned` инкрементируется только в `spawnRegularCar()` (`makeCar`). Scalper идёт через `tickSpecialSpawns` → `makeScalper`. |
| Что запускает `tickSpecialSpawns`? | Каждый кадр `game.update` → `tickSpecialSpawns(dt)` (рядом с `tickSpawnPipeline`, независимо). |
| Почему `target` не останавливает special spawn? | В `tickSpecialSpawns` **нет** проверки `canSpawnRegularCar` / `spawned` / `served` / `targetCars`. |
| Есть ли лимит special events? | Только «один живой» `Game.scalper.unit` + таймер `scalperCooldown()` (= `currentSpawnInterval() * 10`). После `despawn`/`arrest` cleanup `unit = null` → снова можно спавнить. |
| Может ли special spawn идти после `regularSpawned >= target`? | **Да.** Runtime: 5 волн Scalper подряд при `spawned === 280` (уровень 5). |
| Что после despawn / arrest? | `Game.scalper.unit = null` → следующий тик с `timer <= 0` создаёт нового Scalper. |

**Ключевой вопрос QA:** «Может ли специальный трафик бесконечно порождаться после лимита обычного?»  
→ **Да. Confirmed.**

---

## D-SPAWN-001 — бесконечный Scalper после лимита обычного трафика

**Severity:** Critical — **CONFIRMED**

### Gate в коде

```743:785:js/systems/specialVehicles.js
function tickSpecialSpawns(dt) {
  // ...
  Game.scalperTimer -= dt;
  if (Game.scalperTimer <= 0 && !Game.scalper.unit) {
    if (sortedStationSlots().length) {
      const sc = makeScalper();
      // ...
      Game.scalper.unit = sc;
      Game.scalperTimer = scalperCooldown();
    }
  }
}
```

Условия спавна Scalper:
1. `scalperTimer <= 0`
2. `!Game.scalper.unit`
3. есть хотя бы одна АЗС

**Не проверяется:** `spawned`, `served`, `targetCars`, конец уровня, «бюджет обычного трафика исчерпан».

### Runtime evidence (уровень 5, target=280)

- `spawned=280`, `canSpawnRegular=false`
- 5 циклов: `unit=null` → `tickSpecialSpawns` → новый Scalper каждый раз
- `spawned` остаётся 280
- Forced chain: **20** Scalper подряд без роста `spawned`

---

## D-SPAWN-002 — Scalper в бессрочном QUEUE на кольце

**Severity:** Critical — **CONFIRMED**  
Debug snapshot QA (`QUEUE` / `drive` / `inner` / `OWNER:STATION` / `MOVE:ON` / `V:64`) **воспроизведён 1:1**.

### Цепочка поломки

1. `tryAttachScalperToStation` → `joinStationWaitQueue` → `PHASE:QUEUE`, `OWNER:STATION`, `pocketSlot` set.
2. Scalper едет к карману (`tryApproachPocket`).
3. Если проезжает точку въезда (`d > L - passReleaseDist`) → `releasePocket(sc)`.
4. `releasePocket` сбрасывает `pocketSlot` / `targetSlot` / `stopS`, **но не**:
   - `scalperOwner` (остаётся `station`)
   - `scalperPhase` (остаётся `queue`)
5. Далее `stationSystem` вызывает `updateScalperTour`, который сразу выходит:

```96:97:js/systems/specialVehicles.js
function updateScalperTour(v, dt, L) {
  if (getScalperOwner(v) !== ScalperOwner.SPECIAL) return;
```

6. Итог: объект навсегда в `QUEUE` + `OWNER:STATION` + `state:drive` на inner, кружит по кольцу.
7. Нет: `giveUpLaps` (только для `car`), timeout `pocketMaxWait` пока `state !== 'pocket'`, сброса owner/phase.

### Runtime evidence

После `releasePocket`: 10 с симуляции → всё ещё на карте, `trip≈624`, `V:64`, phase/owner не изменились.

### Связь с остановкой regular spawn

**Не блокирует** regular spawn напрямую.  
Обычный спавн уже остановлен правилом 0.4.2.3: `spawned >= target`.  
Stuck Scalper **блокирует** только следующего Scalper (`Game.scalper.unit` занят) — это **антипод** D-001.

---

## Общая архитектура vs одна первопричина

| | D-SPAWN-001 | D-SPAWN-002 |
|--|-------------|-------------|
| Симптом | бесконечные новые Scalper | один Scalper навсегда на кольце |
| Условие | `unit` очищен (arrest/despawn) | `unit` жив, lifecycle сломан |
| Корень | special spawn **без** end-of-level gate | QUEUE/OWNER **не откатываются** при срыве заезда |

**Общее:** нет модели «уровень закончил порождать обычный трафик, special всё ещё живёт / special тоже ограничен».

**Раздельное:** D-001 — политика спавна; D-002 — инвариант owner/phase. Чинить одним патчем «выключить special после target» **не** закроет D-002 (застрявший объект останется). Чинить только owner reset **не** остановит D-001.

---

## Инварианты (факт 0.4.2.4)

| Инвариант | Сейчас |
|-----------|--------|
| `regularSpawned <= levelTarget` | ✅ (0.4.2.3) |
| после target обычные не создаются | ✅ |
| Scalper не продлевает порождение обычных | ✅ (не влияет на budget) |
| Scalper не продлевает «жизнь special-спавна» бесконечно | ❌ D-001 |
| завершение Scalper не спавнит нового, если special запрещён | ❌ нет запрета |
| Scalper вне АЗС не бывает бессрочным QUEUE | ❌ D-002 |
| `OWNER:STATION` ↔ реальное состояние | ❌ после `releasePocket` |
| active special не блокирует regular spawning | ✅ (budget независим) |
| regular / special — разделённые условия завершения | ❌ special без end condition |

---

## Рекомендации на следующий патч (не делать в этом аудите)

1. **D-001:** явный gate в `tickSpecialSpawns` (например не спавнить после `spawned >= target` в campaign, или отдельный `specialSpawnAllowed`).
2. **D-002:** при `releasePocket` / timeout / failed attach — `OWNER→SPECIAL`, `PHASE→DRIVING`, продолжение тура или exit; timeout для approaching (`drive`+`pocketSlot`).
3. Не смешивать фиксы: сначала lifecycle invariants, отдельно policy «special после budget».
