import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { GBRBase } from '../world/map.js';
import { makeGBR } from '../vehicles/vehicleFactory.js';
import {
  gbrPatrolSpeed, gbrCallCost, findReadyGbr, attachVehicleToGbr, canDispatchGbr
} from './gbrLogistics.js';
import { addFloat } from './economySystem.js';
import { fmtRubDelta } from '../core/currency.js';
import { GbrPhase, setGbrPhase } from './entityFsm.js';

let nextScalperId = 1;
const MAX_LOG = 60;

export function resetPursuitState() {
  nextScalperId = 1;
  Game.pursuitEventLog = [];
}

export function logPursuitEvent(msg) {
  if (!Game.pursuitEventLog) Game.pursuitEventLog = [];
  Game.pursuitEventLog.push({ t: Game.time, msg });
  if (Game.pursuitEventLog.length > MAX_LOG) Game.pursuitEventLog.shift();
}

export function ensureScalperId(sc) {
  if (!sc.scalperId) sc.scalperId = nextScalperId++;
  return sc.scalperId;
}

function vehicleWorldPos(v) {
  if (v.pose) return { x: v.pose.x, y: v.pose.y };
  const lat = v.lane === 'inner' ? Road.laneW / 2 : -Road.laneW / 2;
  const p = Road.posAt(v.s, lat + (v.latOff || 0));
  return { x: p.x, y: p.y };
}

export function findUnpursuedWantedScalpers() {
  return Game.vehicles.filter(v =>
    v.kind === 'scalper' && v.wanted && !v.pursuedBy
  );
}

export function getScalperById(id) {
  if (id == null) return null;
  return Game.vehicles.find(v => v.kind === 'scalper' && v.scalperId === id) || null;
}

export function getGbrTarget(g) {
  if (!g?.targetScalperId) return g?.chaseTarget || null;
  return getScalperById(g.targetScalperId) || g.chaseTarget || null;
}

export function gbrDistanceToTarget(g) {
  const sc = getGbrTarget(g);
  if (!sc) return null;
  const pg = vehicleWorldPos(g);
  const ps = vehicleWorldPos(sc);
  return Math.hypot(ps.x - pg.x, ps.y - pg.y);
}

function isGbrAvailableForAssignment(g) {
  if (!g || g.kind !== 'gbr') return false;
  if (g.gbrPhase === GbrPhase.RETURNING || g.gbrPhase === GbrPhase.ARREST) return false;
  if (g.targetScalperId) return false;
  if (g.state === 'pullIn' || g.state === 'pullOut') return false;
  return true;
}

export function findNearestFreeGbrFor(sc) {
  const candidates = Game.vehicles.filter(isGbrAvailableForAssignment);
  if (!candidates.length) return null;
  const ps = vehicleWorldPos(sc);
  let best = candidates[0];
  let bestD = Infinity;
  for (const g of candidates) {
    const pg = vehicleWorldPos(g);
    const d = Math.hypot(ps.x - pg.x, ps.y - pg.y);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

export function assignGbrTarget(g, sc) {
  if (!g || !sc || !sc.wanted || sc.pursuedBy) return false;
  ensureScalperId(sc);
  g.targetScalperId = sc.scalperId;
  g.chaseTarget = sc;
  sc.pursuedBy = g.fleetId;
  setGbrPhase(g, GbrPhase.CHASE);
  logPursuitEvent('[GBR #' + g.fleetId + '] Target assigned: Scalper #' + sc.scalperId);
  logPursuitEvent('[GBR #' + g.fleetId + '] CHASING');
  return true;
}

export function releaseGbrTarget(g) {
  if (!g) return;
  const sc = getGbrTarget(g);
  if (sc && sc.pursuedBy === g.fleetId) {
    sc.pursuedBy = null;
    logPursuitEvent('[GBR #' + g.fleetId + '] Target lost');
  }
  g.targetScalperId = null;
  g.chaseTarget = null;
  g.stopS = null;
  g.approachWait = 0;
}

export function assignWantedToNearestFreeGbr() {
  const wanted = findUnpursuedWantedScalpers();
  for (const sc of wanted) {
    const g = findNearestFreeGbrFor(sc);
    if (g) assignGbrTarget(g, sc);
  }
}

export function spawnGbrUnit(cost, msgPos, preferredScalper) {
  if (Game.state !== 'play') return null;
  if (!canDispatchGbr() || Game.money < cost) return null;
  const unit = findReadyGbr();
  if (!unit) return null;
  Game.money -= cost;
  const g = makeGBR(unit.id);
  g.dispatchedCost = cost;
  g.s = GBRBase.spawnS;
  g.prevS = g.s;
  g.lane = 'inner';
  const speed = gbrPatrolSpeed();
  g.maxV = speed;
  g.v = speed * 0.5;
  g.targetScalperId = null;
  g.chaseTarget = null;
  setGbrPhase(g, GbrPhase.PATROL);
  g.patrolLaps = 0;
  attachVehicleToGbr(unit, g);
  Game.vehicles.push(g);
  Game.gbr.unit = g;
  if (preferredScalper?.wanted && !preferredScalper.pursuedBy) {
    assignGbrTarget(g, preferredScalper);
  } else {
    assignWantedToNearestFreeGbr();
  }
  if (msgPos) addFloat(msgPos.x, msgPos.y, fmtRubDelta(-cost) + ' ГБР', '#42a5f5');
  return g;
}

export function tryAutoSpawnGbr(station, scalper) {
  if (!station?.gbrAutoCall || !station.gbrAutoCallOn) return false;
  const slot = station.slot;
  if (!slot) return false;
  const cost = gbrCallCost();
  if (!canDispatchGbr()) {
    station.gbrAlarm = 1.5;
    addFloat(slot.pos.x, slot.pos.y - 30, 'Нет свободных машин ГБР', '#ef5350');
    return false;
  }
  if (Game.money < cost) {
    station.gbrAlarm = 1.5;
    addFloat(slot.pos.x, slot.pos.y - 30, 'Недостаточно средств для вызова ГБР', '#ef5350');
    return false;
  }
  const g = spawnGbrUnit(cost, { x: slot.pos.x, y: slot.pos.y - 20 }, scalper);
  if (g) {
    station.gbrAlarm = 1.5;
    addFloat(slot.pos.x, slot.pos.y - 45, 'Тревога!', '#ef5350');
  }
  return !!g;
}

export function onScalperTheftDetected(station, scalper) {
  ensureScalperId(scalper);
  const slot = station?.slot || scalper?.targetSlot;
  scalper.wanted = true;
  scalper.crimeStarted = true;
  scalper.alarmStationId = slot?.i ?? null;
  scalper.pursuedBy = null;
  if (station) station.gbrAlarm = 1.5;
  logPursuitEvent('[SCALPER] Theft detected');
  logPursuitEvent('[SCALPER] Wanted = TRUE');
  tryAutoSpawnGbr(station, scalper);
  assignWantedToNearestFreeGbr();
}

export function manualCallGbr(msgPos) {
  if (Game.state !== 'play') return false;
  if (!canDispatchGbr()) return false;
  const cost = gbrCallCost();
  if (Game.money < cost) return false;
  return !!spawnGbrUnit(cost, msgPos, null);
}

export function clearScalperWanted(sc) {
  if (!sc) return;
  sc.wanted = false;
  if (sc.pursuedBy) {
    const g = Game.vehicles.find(v => v.kind === 'gbr' && v.fleetId === sc.pursuedBy);
    if (g) releaseGbrTarget(g);
  }
  sc.pursuedBy = null;
}

export function onScalperExitReached(sc) {
  logPursuitEvent('[SCALPER] Exit reached');
  clearScalperWanted(sc);
  logPursuitEvent('[SCALPER] Exit');
}

export function onGbrArrestStarted(g, sc) {
  if (g?.fleetId) logPursuitEvent('[GBR #' + g.fleetId + '] Arrest started');
}

export function onGbrArrestComplete(g, sc) {
  if (g?.fleetId) logPursuitEvent('[GBR #' + g.fleetId + '] Arrest complete');
  if (sc) clearScalperWanted(sc);
}

export function onScalperLeavingStation(sc, g) {
  logPursuitEvent('[SCALPER] Leaving station');
  if (g?.fleetId && getGbrTarget(g) === sc) {
    logPursuitEvent('[GBR #' + g.fleetId + '] Continuing chase');
  }
}

export function tickGbrPursuit() {
  assignWantedToNearestFreeGbr();
}

export function pursuitDebugLines() {
  const lines = [];
  for (const v of Game.vehicles) {
    if (v.kind === 'scalper' && (v.wanted || v.crimeStarted)) {
      lines.push('SC#' + (v.scalperId || '?') + ' wanted:' + (v.wanted ? 'Y' : 'N') +
        ' pursued:' + (v.pursuedBy ?? '—') + ' st#' + (v.alarmStationId ?? '?'));
    }
  }
  return lines;
}

export function pursuitEventLogLines() {
  return (Game.pursuitEventLog || []).slice(-20).map(e => '[' + Math.round(e.t) + 's] ' + e.msg);
}

// legacy alias
export const logAlarmEvent = logPursuitEvent;
