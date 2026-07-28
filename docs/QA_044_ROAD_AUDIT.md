# QA 0.4.4 — Road / 3 lanes / Scalper / collisions AUDIT

Generated: 2026-07-27T14:23:32.600Z  
Version: 0.4.4 | laneCount: 3 | L=1754.1  
Mode: **audit-only** (no code fixes)  
Script: `node scripts/qa-audit-044-road.mjs`  
Raw: `docs/qa-044-road-raw.json`

## Verdict: **FAIL (HIGH)** — not CRITICAL-BLOCKED on reproduced lane/collision physics

| Severity | FAIL count |
|----------|------------|
| CRITICAL | **0** |
| HIGH | **1** (`PICK-EMPTY` — spawn always prefers L0 on empty ring) |
| Checks | 94 |

### Release reading vs user preliminary BLOCKED

User symptoms were enough to **start** a block investigation. After reproduction:

| User symptom | Audit result |
|--------------|--------------|
| 250 regular, zero Scalper | **Reproduced only without AZS.** With ≥1 station Scalper **does** spawn (SC-AZS / SC-GATE-OPEN). Gate: `sortedStationSlots().length`. |
| L1 cars stuck in `drive` | **Not reproduced as L1-only broken sim.** L0/L1/L2 all update; follow-to-stop works when adjacent blocked; 60s stuck scan = 0. |
| gap≈1347 vs expected ≈86 | **Not a leader bug.** Follower@1238→leader@1345 gap=**86.0**. Ahead car’s large gap is **ring wrap** (~1626) to the car behind. |

**Conclusion:** do **not** treat “two-lane leftover branch” as confirmed root cause. Confirmed issues are **Scalper AZS gate / UX**, **L0 spawn bias**, and **§24 endgate mismatch** (removed in 0.4.3.3).

---

## Executive findings

### 1. Scalper spawn (CRITICAL user symptom → explained)

- `tickSpecialSpawns` requires `sortedStationSlots().length` before `makeScalper()`.
- `newGame` clears all stations → **no AZS ⇒ Scalper never appears**; timer only resets (`blockedNoStation` hundreds of times on L1/5/10/20).
- With AZS + budget + timer: Scalper **appears** (`SC-GATE-OPEN`, `SC-AZS-L*`).
- Only **one** Scalper at a time (`Game.scalper.unit`); further attempts count as `blockedUnit`.
- Runtime cooldown = `currentSpawnInterval * spawnIntervalMult(10)` (~40s at start).  
  `modeCfg.scalper.firstAt` / `intervalStart` in `levels.js` are **dead for runtime** (legacy).
- QA §24 last-10/20 endgate: **removed in 0.4.3.3**; 0.4.4 uses shared `spawned` budget (`canSpawnScalper === canSpawnMoreCars`).

### 2. Three lanes are real simulation lanes

- `game.js` `update()` loops `allLaneLists()` → L0/L1/L2 all call `updateLane`.
- Per-lane motion + leader + stopped-leader(**adjacent blocked**) PASS; no body tunnel.
- Free-adjacent “pass” is **overtake/lane-change**, not body overlap (1D+lat model).

### 3. L1 gap / stuck (user debug)

- A@1238 len19 → B@1345 len23: `findForwardLeader` gap=**86.0** (expected).
- B→A wrap gap≈**1626** (order of user “~1347” if another forward car / different L snapshot).
- Both `maxV=0`: `s` unchanged (parked ≠ stuck-alive).
- Blocked adjacent: follower stops at gap≈7.8, `v≈1.3`, bodyOv=0.

### 4. Spawn lane bias (HIGH FAIL)

- `pickSpawnLane` on empty ring: **60/60 → L0**.
- Dense play still uses all three lanes (250 spawn: L0/L1/L2 all >0).
- Scalper on empty ring also lands L0; when L0 blocked near spawn, deploys to L1/L2.

### 5. GBR / EXITING / FPS / queues

- PATROL/RETURNING: siren off, no yield; CHASE: siren + yield-right.
- CHASE jam 3-abreast: no body tunnel; assigned Scalper 0/20 pass-through.
- EXITING in lane lists; no body tunnel; maxJump≪len.
- FPS 1/60, 0.033, 0.05: 0 overlaps in dense probe.
- Apron spacing by vehicle lengths PASS.

---

## Blockers
- **HIGH PICK-EMPTY**: pickSpawnLane empty ring ALWAYS prefers L0: {"0":60,"1":0,"2":0}. Under light traffic L1/L2 under-spawn until L0 congested near spawnS.

## Recommended next steps (still audit-only here)
1. Confirm user run had **≥1 built AZS** when claiming zero Scalper; if yes, capture `scalperTimer` / `Game.scalper.unit` / `blocked*` telemetry.
2. Treat L0-only empty spawn as **HIGH** design/UX for three-lane visibility, not CRITICAL collision.
3. Clarify product intent for §24 endgate vs 0.4.3.3 shared budget.
4. Optional: enrich debug with `leaderId`, `v`/`maxV`, `scalperTimer`, `stationsBuilt` to avoid misreading wrap gaps as leader loss.

---

## All checks
- [x] **VER** (INFO): GameVersion=0.4.4
- [x] **LANE-N** (CRITICAL): laneCount=3 CONFIG=3
- [x] **SC-NOAZS-L1** (CRITICAL): no AZS: scalpers=0 attempts=496 blockedNoStation=496 spawned=80
- [x] **SC-AZS-L1** (INFO): with AZS: scalpers=1 spawned=100/100 blockedBudget=0 blockedUnit=536 lanes=[0]
- [x] **SC-NOAZS-L5** (CRITICAL): no AZS: scalpers=0 attempts=576 blockedNoStation=576 spawned=80
- [x] **SC-AZS-L5** (INFO): with AZS: scalpers=1 spawned=93/280 blockedBudget=0 blockedUnit=666 lanes=[0]
- [x] **SC-NOAZS-L10** (CRITICAL): no AZS: scalpers=0 attempts=623 blockedNoStation=623 spawned=80
- [x] **SC-AZS-L10** (INFO): with AZS: scalpers=1 spawned=94/1000 blockedBudget=0 blockedUnit=666 lanes=[0]
- [x] **SC-NOAZS-L20** (CRITICAL): no AZS: scalpers=0 attempts=622 blockedNoStation=622 spawned=80
- [x] **SC-AZS-L20** (INFO): with AZS: scalpers=1 spawned=83/5000 blockedBudget=0 blockedUnit=666 lanes=[0]
- [x] **SC-GATE-OPEN** (CRITICAL): open gates (AZS+budget+timer): can=true unit=true phase=driving
- [x] **LANE-MOT-L0** (INFO): movedL=80.0 movedF=117.1 sawLeader=120/120 minGap=1.87 ov=0.00 ΔsL=80.0 ΔsF=117.1
- [x] **LANE-MOT-L1** (INFO): movedL=80.0 movedF=116.4 sawLeader=120/120 minGap=2.60 ov=0.00 ΔsL=80.0 ΔsF=116.4
- [x] **LANE-MOT-L2** (INFO): movedL=80.0 movedF=116.9 sawLeader=120/120 minGap=2.11 ov=0.00 ΔsL=80.0 ΔsF=116.9
- [x] **LEAD-L0-sameSpeed** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=37.00 worstBody=0.00
- [x] **LEAD-L0-fastFollower** (INFO): lost=true bodyTunnel=false laneChanged=true wrongGap=false minGap=-20.73 worstBody=0.00
- [x] **LEAD-L0-stoppedLeader** (INFO): lost=true bodyTunnel=false laneChanged=true wrongGap=false minGap=-22.88 worstBody=0.00
- [x] **LEAD-L0-stoppedLeaderBlocked** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=7.01 worstBody=0.00
- [x] **LEAD-L0-bothStopped** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=41.00 worstBody=0.00
- [x] **LEAD-L1-sameSpeed** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=41.00 worstBody=0.00
- [x] **LEAD-L1-fastFollower** (INFO): lost=false bodyTunnel=false laneChanged=true wrongGap=false minGap=-20.09 worstBody=0.00
- [x] **LEAD-L1-stoppedLeader** (INFO): lost=true bodyTunnel=false laneChanged=true wrongGap=false minGap=-22.88 worstBody=0.00
- [x] **LEAD-L1-stoppedLeaderBlocked** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=7.01 worstBody=0.00
- [x] **LEAD-L1-bothStopped** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=41.00 worstBody=0.00
- [x] **LEAD-L2-sameSpeed** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=39.00 worstBody=0.00
- [x] **LEAD-L2-fastFollower** (INFO): lost=false bodyTunnel=false laneChanged=true wrongGap=false minGap=-18.19 worstBody=0.00
- [x] **LEAD-L2-stoppedLeader** (INFO): lost=true bodyTunnel=false laneChanged=true wrongGap=false minGap=-22.88 worstBody=0.00
- [x] **LEAD-L2-stoppedLeaderBlocked** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=7.00 worstBody=0.00
- [x] **LEAD-L2-bothStopped** (INFO): lost=false bodyTunnel=false laneChanged=false wrongGap=false minGap=39.00 worstBody=0.00
- [x] **GAP-L1-REPRO** (INFO): A(1238)→B(1345): leader=true gap=86.0 expect≈86; B→A wrap: leader=true gap=1626.1 largeWrap=true
- [x] **L1-STOPPED-PAIR** (INFO): both maxV=0 stay put ΔsA=0.000 ΔsB=0.000 (parked, not stuck-alive)
- [x] **L1-FOLLOW-FREE** (INFO): free adj: laneChanged=false bodyOv=0.00 Δs=150.4 (overtake OK if no body ov)
- [x] **L1-FOLLOW-STOP** (INFO): blocked adj: stayedL1=true finalGap=7.76 v=1.3 bodyOv=0.00
- [x] **STUCK-60s** (INFO): stuck-drive events (>5s no Δs): 0 byLane={"0":0,"1":0,"2":0} sample=[]
- [x] **SC-LIFE-DRIVE-L0** (INFO): post-spawn drive: moved=320.0 state=drive phase=undefined phases=[]
- [x] **SC-LIFE-DRIVE-L1** (INFO): post-spawn drive: moved=320.0 state=drive phase=undefined phases=[]
- [x] **SC-LIFE-DRIVE-L2** (INFO): post-spawn drive: moved=320.0 state=drive phase=undefined phases=[]
- [x] **SC-LANE-DIST-EMPTY** (HIGH): 100 Scalper deploys on mostly-empty ring: L0=100 L1=0 L2=0 fail=0 lanesUsed=1. Prefer L0 when clear is pickSpawnLane scoring (also affects NPC).
- [x] **SC-BLOCK-L0** (INFO): block L0 near spawn: scalper=true deployedLane=2
- [x] **SC-BLOCK-L1** (INFO): block L1 near spawn: scalper=true deployedLane=2
- [x] **SC-BLOCK-L2** (INFO): block L2 near spawn: scalper=true deployedLane=1
- [x] **REG-L1-N100** (INFO): spawned=100/100 lanes={"0":23,"1":12,"2":2} used=3
- [x] **REG-L5-N100** (INFO): spawned=100/280 lanes={"0":19,"1":11,"2":2} used=3
- [x] **REG-L5-N250** (INFO): spawned=250/280 lanes={"0":25,"1":17,"2":11} used=3
- [x] **REG-LANE-DIST-250** (INFO): 250-spawn lane use: {"0":25,"1":17,"2":11}
- [ ] **PICK-EMPTY** (HIGH): pickSpawnLane empty ring ALWAYS prefers L0: {"0":60,"1":0,"2":0}. Under light traffic L1/L2 under-spawn until L0 congested near spawnS.
- [x] **SHIFT-0-1** (INFO): start=true gradual=true finalLane=1 lat=0.00
- [x] **SHIFT-1-0** (INFO): start=true gradual=true finalLane=0 lat=0.00
- [x] **SHIFT-1-2** (INFO): start=true gradual=true finalLane=2 lat=0.00
- [x] **SHIFT-2-1** (INFO): start=true gradual=true finalLane=1 lat=0.00
- [x] **NPC-USE-L2** (INFO): NPC reached L2=true followOnL2=60/60
- [x] **SIREN-P** (HIGH): PATROL siren off
- [x] **SIREN-R** (HIGH): RETURNING siren off
- [x] **SIREN-C** (CRITICAL): CHASE siren on
- [x] **YIELD-CHASE** (CRITICAL): CHASE yield LC=true to=1
- [x] **YIELD-PATROL** (HIGH): PATROL no yield
- [x] **YIELD-RET** (HIGH): RETURNING no yield
- [x] **GBR-JAM** (CRITICAL): CHASE jammed 3-abreast worstBodyOv=0.00
- [x] **GBR-SC-20** (CRITICAL): passThrough assigned Scalper 0/20
- [x] **EXIT-L0** (INFO): inList=true bodyTunnel=false laneChanged=true maxJump=2.7 (len=23)
- [x] **EXIT-L1** (INFO): inList=true bodyTunnel=false laneChanged=true maxJump=2.7 (len=23)
- [x] **EXIT-L2** (INFO): inList=true bodyTunnel=false laneChanged=false maxJump=2.7 (len=23)
- [x] **STOP-NPC-NPC-L0** (INFO): worstBodyOv=0.00
- [x] **STOP-SC-NPC-L0** (INFO): worstBodyOv=0.00
- [x] **STOP-GBR-NPC-L0** (INFO): worstBodyOv=0.00
- [x] **STOP-NPC-GBR-L0** (INFO): worstBodyOv=0.00
- [x] **STOP-SC-GBR-L0** (INFO): worstBodyOv=0.00
- [x] **STOP-NPC-NPC-L1** (INFO): worstBodyOv=0.00
- [x] **STOP-SC-NPC-L1** (INFO): worstBodyOv=0.00
- [x] **STOP-GBR-NPC-L1** (INFO): worstBodyOv=0.00
- [x] **STOP-NPC-GBR-L1** (INFO): worstBodyOv=0.00
- [x] **STOP-SC-GBR-L1** (INFO): worstBodyOv=0.00
- [x] **STOP-NPC-NPC-L2** (INFO): worstBodyOv=0.00
- [x] **STOP-SC-NPC-L2** (INFO): worstBodyOv=0.00
- [x] **STOP-GBR-NPC-L2** (INFO): worstBodyOv=0.00
- [x] **STOP-NPC-GBR-L2** (INFO): worstBodyOv=0.00
- [x] **STOP-SC-GBR-L2** (INFO): worstBodyOv=0.00
- [x] **FPS-60** (INFO): dt=1/60 ov=0 depth=0.00
- [x] **FPS-33** (INFO): dt=0.033 ov=0 depth=0.00
- [x] **FPS-05** (INFO): dt=0.05 ov=0 depth=0.00
- [x] **QUEUE-sedan-sedan** (INFO): sep=23.0 need≥23.0
- [x] **QUEUE-truck-truck** (INFO): sep=40.0 need≥40.0
- [x] **QUEUE-truck-sedan** (INFO): sep=31.5 need≥31.5
- [x] **QUEUE-sedan-truck** (INFO): sep=31.5 need≥31.5
- [x] **ENDGATE-REMOVED** (INFO): v0.4.3.3+: getSpecialSpawnReserve removed; canSpawnScalper===canSpawnMoreCars. At spawned=95/100 canScalper=true. QA item §24 (last-10/20) is NOT active in 0.4.4 codebase.
- [x] **ENDGATE-BUDGET** (CRITICAL): at target: canScalper=false draining=true
- [x] **SC-APPEARS** (CRITICAL): special spawn when allowed: unit=true
- [x] **SC-DESPAWN** (CRITICAL): despawn clears unit=true removedFromVehicles=true
- [x] **SC-RESPAWN** (CRITICAL): next Scalper after despawn=true
- [x] **SANITY-L1** (HIGH): 30s: spawned=7/100 scalperTicks=0 lanes=0,2,1 state=play
- [x] **SANITY-L5** (HIGH): 30s: spawned=8/280 scalperTicks=0 lanes=0,2 state=play
- [x] **SANITY-L10** (HIGH): 30s: spawned=6/1000 scalperTicks=0 lanes=0,2,1 state=play
- [x] **SANITY-L20** (HIGH): 30s: spawned=7/5000 scalperTicks=0 lanes=0,2 state=play
- [x] **CODE-SC-AZS-GATE** (CRITICAL): tickSpecialSpawns requires sortedStationSlots().length before makeScalper(). newGame clears all stations. No-AZS play ⇒ Scalper never spawns (timer only resets).

## Telemetry (abbrev)
```json
{
  "scalperAttempts": [
    {
      "label": "L1-noStation",
      "scalperCount": 0,
      "spawned": 80,
      "blockedNoStation": 496,
      "blockedBudget": 0,
      "lanes": []
    },
    {
      "label": "L1-withStation",
      "scalperCount": 1,
      "spawned": 100,
      "blockedNoStation": 0,
      "blockedBudget": 0,
      "lanes": [
        0
      ]
    },
    {
      "label": "L5-noStation",
      "scalperCount": 0,
      "spawned": 80,
      "blockedNoStation": 576,
      "blockedBudget": 0,
      "lanes": []
    },
    {
      "label": "L5-withStation",
      "scalperCount": 1,
      "spawned": 93,
      "blockedNoStation": 0,
      "blockedBudget": 0,
      "lanes": [
        0
      ]
    },
    {
      "label": "L10-noStation",
      "scalperCount": 0,
      "spawned": 80,
      "blockedNoStation": 623,
      "blockedBudget": 0,
      "lanes": []
    },
    {
      "label": "L10-withStation",
      "scalperCount": 1,
      "spawned": 94,
      "blockedNoStation": 0,
      "blockedBudget": 0,
      "lanes": [
        0
      ]
    },
    {
      "label": "L20-noStation",
      "scalperCount": 0,
      "spawned": 80,
      "blockedNoStation": 622,
      "blockedBudget": 0,
      "lanes": []
    },
    {
      "label": "L20-withStation",
      "scalperCount": 1,
      "spawned": 83,
      "blockedNoStation": 0,
      "blockedBudget": 0,
      "lanes": [
        0
      ]
    }
  ],
  "gapCases": [
    {
      "L": 1754.1238596594935,
      "gapA": 86,
      "gapB": 1626.1238596594935,
      "expectA": 86,
      "leaderA": true,
      "leaderB": true,
      "wrapGapB": 1626.1238596594935
    }
  ],
  "stuckSampleCount": 0
}
```
