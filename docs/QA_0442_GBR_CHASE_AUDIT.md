# QA 0.4.4.2 — CHASE free-lane / cut-off arrest

Version: 0.4.4.2 | lanes: 3
Verdict: **PASS** (12/12 pass)

## Results
- [x] **VER** (CRITICAL): GameVersion=0.4.4.2
- [x] **CFG-CAP** (HIGH): bumperCapFrac=0.88 outerAheadPad=14
- [x] **CFG-FORCE** (HIGH): forceAhead=8 forceBehind=6
- [x] **CFG-CUT** (CRITICAL): cutOff.passBehind=70
- [x] **CHASE-PRIO** (CRITICAL): phase=chase
- [x] **OVT-CIV** (HIGH): can overtake civilian
- [x] **OVT-TGT** (HIGH): can overtake own target for cut-off
- [x] **SPEED-L0** (HIGH): after jam ticks v=100.0 (want >40% maxV)
- [x] **FREE-LANE** (CRITICAL): lane=2 laneChange=true (not teleported to 0)
- [x] **CUT-GEOM** (CRITICAL): GBR ahead same lane blocks
- [x] **CUT-ARREST** (CRITICAL): cut-off allows arrest
- [x] **CUT-PHASE** (CRITICAL): gbr=arrest sc=arresting
