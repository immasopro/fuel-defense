# QA 0.4.3.3 — Аудит коллизий, габаритов и физического взаимодействия

**Версия:** 0.4.3.3  
**Дата:** 2026-07-27  
**Режим:** audit-only (код игры не изменялся)  
**Скрипт:** `node scripts/qa-audit-0433-collisions.mjs`  
**Сырые данные:** `docs/qa-0433-collision-raw.json`

## Вердикт

**QA FAIL (блокирует выпуск патча коллизий).**  
В игре **нет AABB/circle collision detection**. Есть только 1D follow + soft-snap по дуге `s`. Обнаружен стабильный баг потери лидера при `gap ≤ 0`, из‑за которого автомобили (в т.ч. Scalper) **проезжают сквозь остановившихся** впереди. GBR в CHASE при обгоне гражданских намеренно отключает soft-fix и проходит через них в пространстве `s` при неполном `latOff`. EXITING Scalper исключён из lane-list и игнорируется трафиком.

Исправления — отдельным патчем. Спавн / экономика / win-gate 0.4.3.3 не затрагивались.

---

## 1. Архитектура (факт)

| Слой | Что есть |
|------|----------|
| Collision detection | **Нет.** Нет pairwise AABB/circle, нет collision event, нет hitbox-объекта |
| Collision avoidance | IDM-подобное следование: `percGap` / `percLV`, `gapMin`, `gapK`, reaction delay, `emergencyGap` |
| Soft resolution | После движения: если `g < 0` → snap `s` за лидера (`vehicle.js` `updateLane`) |
| GBR↔Scalper catch | **Евклидово** `hypot(dx,dy) ≤ arrestDist(22)`, не bumper |
| Tick order | `updateLane(inner)` → `updateLane(outer)` → … → `updateVehicles` |
| dt clamp | `FrameTimer` → `maxDeltaTime = 0.05` с |

**Условие «столкновения» (фактически soft-bumper):**

```text
g = mod(leader.s - v.s, L) - (leader.len + v.len) / 2
если g < 0 и !overtake → snap v.s за bumper лидера
```

- Координаты: только кольцевая дуга `s` (+ `len`)
- Направление/скорость: учитываются в avoidance (цель `vt`), не в отдельном collision test
- Полоса: только через членство в `innerLaneList` / `outerLaneList`
- Safety gap: `follow.gapMin=7`; chase GBR `chaseDrive.gapMin=1.5`
- Проверка: каждый tick для участников lane-list, **после** перемещения

**Lane membership (кто участвует):**

- inner: `lane==inner` && `state ∈ {drive, action, tow}`
- outer: `lane==outer` && `drive` && **не** `(scalper && EXITING)`
- Вне списков: `station`, `pocket`, `pullIn`, `block`, `waitMerge`, `pullOut`, EXITING scalper

---

## 2. Габариты: visual ↔ «collision»

| Тип | len | w | Visual | Collision shape | Отдельно? |
|-----|-----|---|--------|-----------------|-----------|
| sedan | 19 | 9 | `rr(-len/2,-w/2,len,w)` | 1D segment `len` | carTypes |
| suv | 23 | 10 | то же | 1D `len` | carTypes |
| truck | 36 | 11 | то же + шов кабины | 1D `len` | carTypes |
| Scalper | 23 | **10** (factory hardcode) | то же | 1D `len` + Euclid arrest vs GBR | balance.len only |
| GBR | 22 | **10** (factory hardcode) | body + мигалка **выше** `-w/2` | 1D `len` + Euclid 22 | balance.len; w не в balance |
| tanker | 40 | **12** (hardcode) | cab 10 + tank `len-12` | 1D `len` | |
| bg | as carTypes | | gray body | 1D `len` | |

**Центр:** поза `Road.posAt(s, laneLat + latOff)` или `v.pose` на станции.  
**Collision offset:** нет; bumper считается от `s` как от центра длины.  
**Ширина `w` в коллизиях не используется** — боковые пересечения (latOff / соседняя полоса) системой не ловятся.

### Несоответствия visual ↔ hitbox

| ID | Sev | Суть |
|----|-----|------|
| DIM-W | LOW | `w` есть у спрайта, в collision отсутствует |
| DIM-GBR-LIGHT | LOW | мигалка GBR рисуется вне `len×w` |
| DIM-NO-AABB | MEDIUM | отдельного hitbox нет; «collision bounds» = проекция на `s` |

---

## 3. Tunneling

При `dt ≤ 0.05` один tick GBR@150 ≈ 7.5 юнитов &lt; половины длин → классический tunnel через soft-snap **обычно** удерживается, **пока лидер находится**.

**Критический дефект COLL-001 (см. §Bugs):** после soft-snap `gap == 0` лидер теряется (`findForwardLeader` требует `g > 0`), follower разгоняется и **проезжает сквозь** остановившуюся машину за ~1–1.5 с. Это стабильный tunneling / pass-through, не требующий большого dt.

EXITING stall-jump: до `max(step*2, dist*0.35)` ≈ 35+ за tick (&gt; `scalper.len=23`) при игноре outer-трафика.

---

## 4. Матрица взаимодействий (автоматизированное ядро)

Скрипт прогнал пары × сценарии A/B/D/E (same speed / faster follower / leader stopped / both stopped) на inner lane через `updateLane`.

| Пара | A same | B faster | D leader stopped | E both stopped |
|------|--------|----------|------------------|----------------|
| NPC→NPC | PASS | PASS | PASS* | PASS |
| NPC→Scalper | PASS | PASS | PASS* | PASS |
| Scalper→NPC | PASS | PASS | **FAIL** | PASS |
| Scalper→Scalper | PASS | PASS | **FAIL** | PASS |
| GBR→NPC | PASS | PASS | PASS* | PASS |
| GBR→Scalper | PASS | PASS | PASS* | PASS |
| NPC→GBR | PASS | PASS | **FAIL** | PASS |
| Scalper→GBR | PASS | PASS | **FAIL** | PASS |
| GBR→GBR | PASS | PASS | PASS* | PASS |

\*Узкий прогон матрицы (80 tick) иногда не успевал поймать COLL-001; **отдельный trial** показал `passed:true` для NPC→NPC, GBR→NPC, NPC→GBR при остановленном лидере. Считать **системным FAIL** для всех типов при «лидер полностью остановлен + follower доезжает до bumper».

Сценарии G–J (lane change / queue / enter / exit) — см. §6–9 (архитектурные FAIL без полной матрицы 90 клеток).

---

## 5. GBR ↔ Scalper (приоритет, 20 прогонов)

| Проверка | Результат |
|----------|-----------|
| GBR проходит сквозь Scalper в CHASE (bumper, soft-fix on, assigned target) | **0/20** pass-through |
| Глубокий s-overlap | **0/20** |
| Euclid ≤ arrestDist при chase `gapMin=1.5` | достижимо (~21.1 &lt; 22) — арест на дороге **возможен** |
| GBR overtake **гражданского** во время chase | **FAIL**: soft-fix выкл., gap до **-18** при `latOff≈-9` (неполный уход) → визуальный проход сквозь NPC |
| EXITING Scalper vs outer traffic | **FAIL**: не в `outerLaneList`, autonomous motion → ghost |
| Scalper → stopped GBR | **FAIL** (COLL-001) |
| Два объекта в одной точке | возможно после COLL-001 / overtake pass |
| Зависимость от скорости | да: быстрее → чаще soft-snap в 0 → потеря лидера |
| Collision event | нет (только Euclid arrest / soft snap) |

**Arrest:** `startArrest` обнуляет скорости, фазы ARREST/ARRESTING; не bumper-based.

---

## 6. Очереди АЗС

- Позиции: `apronPoseForRank` / `pocketPoseForRank` — шаг `queueGap=21`, `pocketGap=18`
- Bumper-коллизий в очереди **нет**
- Машины в `station/pocket/block` **вне** `updateLane`
- `queueGap=21 < truck.len=36` → фуры в соседних рангах **визуально пересекаются** (MEDIUM)
- Кольцевой трафик может иметь тот же `s`, что и машина на колонке — взаимодействия нет

---

## 7. Смена полосы / обгон

- Оvertake = анимация `latOff`, объект **остаётся** в том же lane-list
- Пока `overtake != null`, soft-fix **отключён** → s-overlap by design
- Chase GBR: ускоренный overtake, ослабленные pads; может форсировать обгон в плотном потоке
- Scalper/tanker/**не car/gbr** — `canStartOvertake` = false (не обгоняют)
- Angry lane-change: `laneGapFree` (pads +10/+26), затем `beginLaneChange`

**FAIL LANE-02:** частичное/полное визуальное пересечение во время pass при ненулевом перекрытии `s`.

---

## 8–9. Въезд / выезд

**Въезд:** `spawnClear` — зона у `Road.spawnS` с pads −4 / +12 по `(lenA+lenB)/2`.  
`releaseHolderBurst` не выпускает, пока занято. Старт: `s=spawnS`, `v=maxV*0.4`.

**Выезд:**
- Обычные: `crossed(spawnS)` на outer → removeSet
- EXITING Scalper: вне collision list; despawn по `exitArriveDist` / timeout / stall-jump
- После `despawnScalper` → removeSet; из массива — в конце `updateVehicles` (в том же tick ещё может быть в `Game.vehicles`)

---

## 10–11. Arrest / despawn

- После arrest Scalper не едет (`v=0`, block)
- Новый Scalper от ошибочного lifecycle в аудите не воспроизводился
- После filter removeSet объект не в lane-list → не блокирует follow

---

## 12–13. Плотность и FPS

| Условие | overlap events | max depth |
|---------|----------------|-----------|
| 12 cars, dt=1/60 | 0 | 0 |
| 12 cars, dt=0.05 (clamp max) | **0…42** (флаки) | **0…21** |
| dt=0.2 (bypass clamp) | зависит от сценария | — |

Плотный прогон **недетерминирован** (random `makeCar` types/speeds + overtake chance): на части сидов overlaps=0, на других depth≈16–21 при том же dt=0.05.

**FAIL FPS-01 / COLL-005:** при крупном dt (низкий FPS → clamp 0.05) выше шанс проявления COLL-001 и overtake s-overlap; при 60 FPS чаще «держит».

---

## 14. Логирование

Отдельного collision debug overlay нет. Для аудита использованы:

- `findForwardLeader` / bumper gap
- `euclid` через `Road.posAt`
- фазы `gbrPhase` / `scalperPhase`
- сырой JSON прогона

Рекомендация для следующего патча (не в этом QA): debug draw bumper segment + lane membership + overtake flag.

---

## 15–16. PASS/FAIL по критериям ТЗ

| Критерий PASS | Статус |
|---------------|--------|
| Visual ↔ collision bounds | **FAIL** (нет 2D bounds; w игнорируется) |
| Никто стабильно не проходит сквозь | **FAIL** (COLL-001) |
| GBR ↛ сквозь Scalper (chase target) | PASS (0/20) |
| Scalper ↛ сквозь GBR | **FAIL** (stopped GBR + COLL-001) |
| Нет tunneling | **FAIL** (COLL-001; EXIT jump) |
| Очередь без наложений | **FAIL** для truck (gap&lt;len) |
| Смена полосы без пересечений | **FAIL** (overtake s-overlap) |
| Въезд/выезд без ложных коллизий | частично PASS (spawnClear OK; EXIT ghost FAIL) |
| Despawn убирает из системы | PASS (со следующего tick) |
| Независимость от FPS | **FAIL** |
| Arrest lifecycle | PASS (по коду + точечные проверки) |
| Не ломает spawn/win 0.4.3.3 | N/A (код не менялся) |

**Блокирующие FAIL ТЗ:** проход сквозь при stopped leader; GBR сквозь NPC при chase-overtake; EXITING ghost; FPS dependence; bounds ≠ visual 2D.

---

## 17. Реестр багов

### CRITICAL

#### COLL-001 — Потеря лидера при `gap ≤ 0` → проезд насквозь
- **Объекты:** любой follower (NPC / Scalper / GBR) → любой stopped leader  
- **Сценарий:** догнать полностью остановившуюся машину на той же полосе  
- **Ожидание:** остановиться с зазором, не пересекать  
- **Факт:** soft-snap ставит `gap=0` → `findForwardLeader` (`g > 0`) не видит лидера → IDM даёт разгон → проезд сквозь (~30 tick @0.05)  
- **Частота:** **100%** в controlled trial (NPC→NPC, GBR→NPC, NPC→GBR, Scalper→NPC)  
- **Причина:** `vehicle.js` `findForwardLeader`: условие `g > 0` вместо `g >= 0` (или ε); soft-fix не восстанавливает уже «проглоченного» лидера сзади  
- **Код:** `js/vehicles/vehicle.js` ~35–42, 192–203

#### COLL-002 — Chase GBR: s-overlap с гражданскими на фазе overtake
- **Объекты:** GBR (CHASE) → NPC  
- **Сценарий:** преследование Scalper, на пути медленный/стопнутый гражданский  
- **Ожидание:** объезд без визуального пересечения корпуса  
- **Факт:** `overtake` отключает soft-fix; gap до **-18** при `latOff≈-9` (макс. ~12.75) → корпуса пересекаются  
- **Частота:** стабильно в симуляции chase-press  
- **Причина:** by-design disable soft-fix + агрессивный chase overtake  
- **Код:** `vehicle.js` 132–203, `canStartOvertake` chase branch

### HIGH

#### COLL-003 — EXITING Scalper — ghost вне collision
- **Объекты:** Scalper EXITING ↔ outer NPC/GBR  
- **Факт:** исключён из `outerLaneList`; `updateScalpersLeavingMap` двигает автономно; возможен проход сквозь  
- **Частота:** always by design  
- **Код:** `trafficSystem.js` 16–19; `scalperLifecycle.js` 84–128

#### COLL-004 — EXITING stall jump > len
- Прыжок до ~35 u/tick при stall recovery → tunneling относительно игнорируемого трафика  
- **Код:** `scalperLifecycle.js` 114–119

#### COLL-005 — Зависимость плотности от dt/FPS
- 12 машин: при dt=1/60 overlaps=0; при dt=0.05 overlaps=36, depth≈16  
- Усиливает COLL-001 / overtake

#### COLL-006 — Оvertake pass = намеренный s-overlap
- Любой car/GBR overtake: визуальное пересечение возможно  
- Отдельно от COLL-002 (гражданский режим тоже)

### MEDIUM

#### COLL-007 — Очередь АЗС: `queueGap < truck.len`
- rank spacing 21 &lt; 36 → фуры накладываются визуально  
- Нет bumper между queued cars

#### COLL-008 — Station vs ring decoupling
- Машина на колонке вне lane-list; кольцевой трафик может совпасть по `s` без реакции

### LOW

#### COLL-009 — `w` не в collision; мигалка GBR вне body box  
#### COLL-010 — Scalper/GBR/tanker `w` hardcode в factory, не в balance

---

## Категории (итог)

| Sev | IDs |
|-----|-----|
| **CRITICAL** | COLL-001, COLL-002 |
| **HIGH** | COLL-003, COLL-004, COLL-005, COLL-006 |
| **MEDIUM** | COLL-007, COLL-008 |
| **LOW** | COLL-009, COLL-010 |

---

## Рекомендации для следующего патча (не делать в этом QA)

1. **COLL-001:** `findForwardLeader`: `g >= -eps` **или** после soft-snap держать `gapMin` floor &gt; 0; не терять лидера при `g==0`.  
2. **COLL-002:** на chase overtake сохранять soft-fix / clip `s` пока `latOff` не достиг безопасного смещения; или временно выводить в outer list.  
3. **COLL-003/004:** EXITING участвует в follow **или** ghost-only на свободной дуге; убрать/ограничить stall jump.  
4. Опционально: 2D debug bounds; выровнять `queueGap` под max len.

**Не трогать** при фиксе: spawned/served, DRAINING, fuel crisis, экономику.

---

## Приложения

- Прогон: `scripts/qa-audit-0433-collisions.mjs`  
- JSON: `docs/qa-0433-collision-raw.json`  
- Ключевые файлы: `js/vehicles/vehicle.js`, `js/systems/trafficSystem.js`, `js/systems/scalperLifecycle.js`, `js/systems/specialVehicles.js`, `js/ui/renderer.js`, `js/config/balance.js`, `js/vehicles/vehicleFactory.js`
