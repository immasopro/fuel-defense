# QA 0.4.4 — Three lanes + collision re-audit

Generated: 2026-07-27T13:58:59.347Z
Version: 0.4.4  |  laneCount: 3

## Result: PASS (0 blockers / 0 fails / 53 checks)

### Blockers
_none_

### All checks
- [x] VER-01 (CRITICAL): GameVersion=0.4.4
- [x] LANE-CFG-01 (CRITICAL): laneCount param=3 api=3 (must be 3, no 4th)
- [x] LANE-CFG-02 (CRITICAL): serviceLane=0 exitLane=2
- [x] LANE-CFG-03 (INFO): laneLat: 0=15.0 1=0.0 2=-15.0
- [x] COLL-001 (CRITICAL): lostLeader=false tunneled=false minGap=0.75 floor=0.75
- [x] COLL-002 (CRITICAL): chase overtake latConflict minGap=1.50 bodyOverlap=0.00 deepNeg=false
- [x] EXIT-JUMP (CRITICAL): no large per-tick jump (watched 100 ticks)
- [x] EXIT-GHOST (CRITICAL): inLaneList=true tunneled=false minGap=7.01 ds=32.0
- [x] MAT-NPC-NPC-L0 (INFO): NPC→stopped NPC worstOverlap=0.00
- [x] MAT-SC-NPC-L0 (INFO): Scalper→stopped NPC worstOverlap=0.00
- [x] MAT-NPC-SC-L0 (INFO): NPC→stopped Scalper worstOverlap=0.00
- [x] MAT-NPC-GBR-L0 (INFO): NPC→stopped PATROL GBR worstOverlap=0.00
- [x] MAT-SC-GBR-L0 (INFO): Scalper→stopped RETURNING GBR worstOverlap=0.00
- [x] MAT-NPC-NPC-L1 (INFO): NPC→stopped NPC worstOverlap=0.00
- [x] MAT-SC-NPC-L1 (INFO): Scalper→stopped NPC worstOverlap=0.00
- [x] MAT-NPC-SC-L1 (INFO): NPC→stopped Scalper worstOverlap=0.00
- [x] MAT-NPC-GBR-L1 (INFO): NPC→stopped PATROL GBR worstOverlap=0.00
- [x] MAT-SC-GBR-L1 (INFO): Scalper→stopped RETURNING GBR worstOverlap=0.00
- [x] MAT-NPC-NPC-L2 (INFO): NPC→stopped NPC worstOverlap=0.00
- [x] MAT-SC-NPC-L2 (INFO): Scalper→stopped NPC worstOverlap=0.00
- [x] MAT-NPC-SC-L2 (INFO): NPC→stopped Scalper worstOverlap=0.00
- [x] MAT-NPC-GBR-L2 (INFO): NPC→stopped PATROL GBR worstOverlap=0.00
- [x] MAT-SC-GBR-L2 (INFO): Scalper→stopped RETURNING GBR worstOverlap=0.00
- [x] GBR-CHASE-NPC (CRITICAL): CHASE GBR vs stopped NPC (right blocked) worstOverlap=0.00
- [x] GBR-SC-20 (CRITICAL): passThrough assigned Scalper: 0/20
- [x] SIREN-PATROL (CRITICAL): PATROL siren off
- [x] SIREN-RET (CRITICAL): RETURNING siren off
- [x] SIREN-CHASE (CRITICAL): CHASE siren on
- [x] YIELD-FREE (CRITICAL): CHASE behind + right free → yield laneChange=true to=1
- [x] YIELD-BLOCKED (CRITICAL): right occupied → no yield (laneChange=false)
- [x] YIELD-PATROL (CRITICAL): PATROL GBR does not trigger yield
- [x] SHIFT-01 (CRITICAL): beginLaneShift starts transition (not instant): lane=0 hasLC=true
- [x] SHIFT-02 (CRITICAL): after dur lane committed to 1 (lane=1 lc=false)
- [x] SHIFT-23 (CRITICAL): 1→2→3 path ends lane=2
- [x] SHIFT-32 (CRITICAL): 3→2 path ends lane=1
- [x] JAM-01 (CRITICAL): 3-abreast jam: worstOverlap=0.00 passedWall=false
- [x] QUEUE-sedan-sedan (INFO): apron sep=23.0 need≥23.0
- [x] QUEUE-suv-suv (INFO): apron sep=27.0 need≥27.0
- [x] QUEUE-truck-truck (INFO): apron sep=40.0 need≥40.0
- [x] QUEUE-truck-sedan (INFO): apron sep=31.5 need≥31.5
- [x] QUEUE-sedan-truck (INFO): apron sep=31.5 need≥31.5
- [x] QUEUE-scalper-truck (INFO): apron Scalper→truck sep=33.5 need≥33.5
- [x] POCKET-truck-truck (INFO): pocket sep=40.0 need≥40.0
- [x] SPAWN-BLOCK-L0 (CRITICAL): lane 0 blocked at spawn clear=false
- [x] SPAWN-BLOCK-L1 (CRITICAL): lane 1 blocked at spawn clear=false
- [x] SPAWN-BLOCK-L2 (CRITICAL): lane 2 blocked at spawn clear=false
- [x] SPAWN-PICK (CRITICAL): pickSpawnLane prefers free lane: picks=2
- [x] FPS-60 (INFO): dt=1/60 overlaps=0 depth=0.00
- [x] FPS-20 (INFO): dt=0.05 overlaps=0 depth=0.00
- [x] FPS-SENS (INFO): depth Δ 60vs20fps=0.00
- [x] FPS-BIG (INFO): dt=0.2 (uncapped stress) depth=0.00 overlaps=0
- [x] REG-SPAWN (CRITICAL): Economy/spawn configs present (lane patch must not strip them)
- [x] REG-NO4 (CRITICAL): No 4th lane in 0.4.4

### FPS
- dt=1/60: overlaps=0 depth=0.00
- dt=0.05: overlaps=0 depth=0.00
- dt=0.2 stress: overlaps=0 depth=0.00
