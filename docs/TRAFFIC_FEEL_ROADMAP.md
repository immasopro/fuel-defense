# Fuel Defense — Traffic Feel Roadmap

**Status:** approved (PO)  
**Baseline:** v0.4.4.2  
**Scope:** traffic readability / “cars feel like cars” — not monetization, not major economy rework.

Monetization stays **after** the game feels like a finished product.

---

## Versioning

| Kind | Pattern | Example |
|------|---------|---------|
| Segment (feature) | bump **third** digit by `0.0.1` | `0.4.5` → `0.4.6` → … → `0.4.9` |
| Hotfix / bugfix between segments | fourth digit `0.4.x.y` | `0.4.5.1`, `0.4.6.2` |

Do **not** skip a roadmap segment just to ship a bugfix — fix on `0.4.x.y`, then continue.

---

## Problem statement

Traffic currently reads as **sliders on a spline**, not as vehicles:

- capsules on the ring with soft `latOff` lane changes;
- tiny `visualSteer`;
- little telegraph before manoeuvres;
- weak identity for diesel / GBR / “call GBR” urgency.

**Feel target:** a short, readable “habit physics” (not BeamNG): braking visible, manoeuvre telegraphed, neighbours sometimes rude.

**Non-goals for this roadmap:** 3D, tyre sim, full traffic code, ads/IAP.

**Success (global):** in ~10s of play the eye catches several “car-like” micro-events with clear cause.

---

## Vocabulary (for tickets)

| Term | Meaning |
|------|---------|
| **Telegraph** | Intent shown before the move (e.g. indicator ≥ ~0.4s) |
| **Commit** | Point of no return after telegraph |
| **Body language** | Steer / roll readable for ~1s |
| **Brake grammar** | Brake lights = closing on a bumper |
| **Micro-aggression** | Rare rudeness (cut-in), not chaos every frame |
| **Readable chaos** | Player understands *why* lights flashed |

---

## Segment roadmap

### 0.4.5 — A. Motion feel + telegraph colors

**Goal:** less “soap”; diesel / GBR / “call GBR” readable at a glance.

**In scope**
- Stronger `visualSteer` / light body roll on lane change & overtake; less perfect soap-smooth commit.
- Optional micro “nose dip” on hard brake (`Δv`).
- Diesel (`ДТ`) → brown (replace current orange `#ff9800`).
- GBR → white body + black roof (replace flat grey `#37474f`); CHASE siren kept.
- Flashing siren / lightbar icon near AZS while there is a **wanted scalper without a crew** tied to that station (`alarmStationId` / unpursued wanted).  
  Note: `station.gbrAlarm` already ticks briefly but is not drawn on canvas — make the cue **persistent** until assigned/cleared.

**Out of scope:** full chrome, NPC social chaos, road decoration.

**Done when:** lane change reads as a turn; DT ≠ petrol by colour; GBR pops in traffic; post-theft AZS shows call cue until GBR is assigned.

**Hotfixes:** `0.4.5.1+`

---

### 0.4.6 — B. Vehicle chrome

**Goal:** silhouette = car, not capsule.

**In scope**
- Cabin / body / simple shadow.
- Headlights (low beam).
- Clearer sedan / SUV / truck proportions.
- Light contrast outline; tanker & GBR in the same form language.

**Out of scope:** new signal AI beyond static lights; traffic behaviour changes.

**Done when:** on pause, vehicle type is clear without relying on fuel colour alone.

**Hotfixes:** `0.4.6.1+`

---

### 0.4.7 — C. Signal language

**Goal:** intent readable **before** the lateral move.

**In scope**
- Turn indicators before / during lane change.
- Brake lights on hard braking / closing gap.
- Rare high-beam flash (“let me through”).
- Hazards on long stop / angry / blocked.

**Out of scope:** new aggressive AI (that is D); only telegraph + visuals wired to existing states.

**Done when:** ~10s of play shows ≥3 meaningful light events with clear cause.

**Hotfixes:** `0.4.7.1+`

---

### 0.4.8 — D. Social chaos

**Goal:** traffic a bit livelier and ruder, still readable.

**In scope**
- Rare aggressive cut-in.
- Occasional refuse-to-yield.
- Short gap conflicts.
- Reactions to neighbour high-beam / hazards.
- Tunable rates (not every frame).

**Careful:** do not break collision follow, GBR chase, or defeat fairness.

**Done when:** chaos is noticeable but each event has an understandable reason.

**Hotfixes:** `0.4.8.1+`

---

### 0.4.9 — E. Road presence

**Goal:** road feels like a surface/environment, not a soap backdrop.

**In scope**
- Lane markings / arrows.
- Light asphalt noise / gradient.
- Entry/exit cues.
- Optional soft edge parallax; curb/edge shadows.

**Out of scope:** new gameplay systems; monetization.

**Done when:** vehicles feel “on” the lane, not floating over a flat colour.

**Hotfixes:** `0.4.9.1+`

---

## Dependencies

```
0.4.5 (A) → 0.4.6 (B) → 0.4.7 (C) → 0.4.8 (D)
                ↘︎ (optional) 0.4.9 (E) after A; prefer after C so signals aren’t lost on empty road
```

Recommended order: **A → B → C → D → E**.  
**E** may start after **A**, but shipping after **C** is safer for readability.

---

## Product note (priority)

This roadmap is **approved as the traffic-feel track**.  
Core session stability (fair defeat, clear GBR loop, campaign pacing) still outranks pure aesthetics. Segment **0.4.5** deliberately mixes **thin motion** with **gameplay-readable cues** (AZS alarm, GBR/DT colours). Full chrome / chaos / road art stay after that.

Monetization (interstitial / rewarded life / rewarded 2x) remains **post product-ready**, outside this document’s delivery sequence.

---

## Related code (baseline)

- Motion: `js/vehicles/vehicle.js` (`latOff`, `laneChange`, `visualSteer`, overtake)
- Draw: `js/ui/renderer.js` (`drawVehicle`)
- Fuel colours: `js/config/balance.js` → `fuels.diesel.color`
- GBR alarm stub: `station.gbrAlarm` in `gbrPursuit.js` / `stationSystem.js` (not rendered yet)
- Wanted / station link: `alarmStationId` on scalper after theft
