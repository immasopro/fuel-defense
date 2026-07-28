# QA 0.4.4.1 — Entry / multi-Scalper / undercover / stats

Version: 0.4.4.1 | laneCount: 3 | L=1754.1
Verdict: **PASS** (20/20 pass)

## Scope
- Entry on L2 + merge-in toward L0
- Multi-Scalper capped only by spawned budget
- Undercover without AZS; countsForDefeat true; no empty-tour EXIT
- Extended end-level stats

## Results
- [x] **VER** (CRITICAL): GameVersion=0.4.4.1
- [x] **LANES** (CRITICAL): laneCount=3 exit=2 service=0
- [x] **POLICY-ENTRY** (HIGH): entryOnExitLane=true
- [x] **POLICY-UC** (HIGH): undercoverWithoutStation=true
- [x] **ENTRY-L2** (CRITICAL): lane=2 mergeIn=true
- [x] **MERGE-START** (HIGH): startedShift=true lane=0
- [x] **MERGE-IN** (HIGH): after merge attempts lane=0 mergeIn=false
- [x] **NO-AZS** (CRITICAL): slots=0
- [x] **UC-SPAWN** (CRITICAL): spawned id=1 phase=driving
- [x] **UC-DEFEAT** (CRITICAL): countsForDefeat=true
- [x] **UC-LOOK** (HIGH): wanted=false typeKey=sedan
- [x] **UC-STATS** (HIGH): scalpersSpawned=1
- [x] **UC-NO-EXIT** (CRITICAL): phase driving→driving after empty tour
- [x] **MULTI-SC** (CRITICAL): liveScalpers=3 units=3 spawned=3
- [x] **BUDGET-EQ** (HIGH): canSpawnScalper===canSpawnMoreCars (true)
- [x] **BUDGET-CAP** (CRITICAL): at target live=3 canSpawn=false
- [x] **PRE-TOUR** (INFO): tourLen=0
- [x] **POST-TOUR** (HIGH): tourLen after build=1
- [x] **STATS-HTML** (HIGH): htmlLen=629
- [x] **STATS-BTN** (HIGH): btn-end-stats present in DOM mock

## Notes
- Endgate last-10/20 remains abandoned (shared spawned budget).
- Undercover visually NPC until wanted.
