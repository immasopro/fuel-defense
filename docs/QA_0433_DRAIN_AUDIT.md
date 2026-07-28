# QA 0.4.3.3 — Spawned progress / DRAINING / fuel crisis

Script: `node scripts/qa-audit-0433-drain.mjs`

## Scope

Levels **1 / 5 / 10** (targets 100 / 280 / 1000).

| Area | Expectation |
|------|-------------|
| Progress | `spawned` (regular + Scalper) gates budget; `served` is stats only |
| Scalper reserve | Removed (no last-10/20); shared `spawned` slot |
| DRAINING | After `spawned >= target`; no new spawn |
| Win | `spawned >= target` && `vehiclesOnMap == 0` → money ≥0 win / &lt;0 bankruptcy |
| Fuel crisis | 8s timer + warning; cancel if tanker ordered / condition clears |
| Infinite Scalper | Impossible after target (no new Scalper) |

## Result

**41/41 PASS** (2026-07-27). Ready for deploy `v0.4.3.3`.
