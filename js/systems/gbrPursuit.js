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
import { GbrPhase, ScalperPhase, setGbrPhase } from './entityFsm.js';

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
  return Game.vehicles.filter(isScalperAssignableWanted);
}

/** Разыскиваемый перекуп, ещё на карте, без экипажа (включая EXITING). */
export function isScalperAssignableWanted(sc) {
  if (!sc || sc.kind !== 'scalper') return false;
  if (!sc.wanted || sc.pursuedBy) return false;
  if (sc.scalperPhase === ScalperPhase.ARRESTING) return false;
  if (sc.scalperPhase === ScalperPhase.DESPAWN) return false;
  return Game.vehicles.includes(sc);
}

/** Ближайший разыскиваемый без экипажа к данной ГБР (тай-брейк: раньше объявлен). */
export function findNearestUnpursuedWantedFor(g) {
  const wanted = findUnpursuedWantedScalpers();
  if (!wanted.length || !g) return null;
  const pg = vehicleWorldPos(g);
  let best = null;
  let bestD = Infinity;
  let bestWantedAt = Infinity;
  for (const sc of wanted) {
    const ps = vehicleWorldPos(sc);
    const d = Math.hypot(ps.x - pg.x, ps.y - pg.y);
    const wa = sc.wantedAt != null ? sc.wantedAt : Infinity;
    if (d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && wa < bestWantedAt)) {
      best = sc;
      bestD = d;
      bestWantedAt = wa;
    }
  }
  return best;
}

export function getScalperById(id) {
  if (id == null) return null;
  return Game.vehicles.find(v => v.kind === 'scalper' && v.scalperId === id) || null;
}

/** Перекуп ещё физически в игровом мире (до DESPAWN). */
export function isAssignedScalperOnMap(sc) {
  return !!sc && Game.vehicles.includes(sc) && sc.scalperPhase !== ScalperPhase.DESPAWN;
}

/** Назначенная цель ГБР по id — связь не зависит от фазы/владельца. */
export function isGbrAssignedTarget(g, sc) {
  if (!g || !sc || g.targetScalperId == null) return false;
  return sc.scalperId === g.targetScalperId;
}

export function getGbrTarget(g) {
  if (!g?.targetScalperId) return g?.chaseTarget || null;
  const sc = getScalperById(g.targetScalperId);
  if (sc) {
    g.chaseTarget = sc;
    return sc;
  }
  return g.chaseTarget || null;
}

/** Активная назначенная цель преследования или null (объект удалён). */
export function gbrPursuitTarget(g) {
  const sc = getGbrTarget(g);
  if (!sc || !isGbrAssignedTarget(g, sc) || !isAssignedScalperOnMap(sc)) return null;
  return sc;
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
  if (!g || !isScalperAssignableWanted(sc)) return false;
  ensureScalperId(sc);
  g.targetScalperId = sc.scalperId;
  g.chaseTarget = sc;
  sc.pursuedBy = g.fleetId;
  setGbrPhase(g, GbrPhase.CHASE);
  logPursuitEvent('[GBR #' + g.fleetId + '] Target assigned: Scalper #' + sc.scalperId);
  logPursuitEvent('[GBR #' + g.fleetId + '] CHASING');
  return true;
}

export function releaseGbrTarget(g, opts) {
  if (!g) return;
  opts = opts || {};
  const sc = getGbrTarget(g);
  if (sc && sc.pursuedBy === g.fleetId) {
    sc.pursuedBy = null;
    if (opts.reason === 'despawn') {
      logPursuitEvent('[GBR #' + g.fleetId + '] Target lost');
    }
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

/** Назначить данной ГБР ближайшую свободную цель (или preferred). */
export function assignSpawnGbrTarget(g, preferredScalper) {
  if (!g) return false;
  if (preferredScalper && isScalperAssignableWanted(preferredScalper)) {
    return assignGbrTarget(g, preferredScalper);
  }
  const sc = findNearestUnpursuedWantedFor(g);
  if (sc) return assignGbrTarget(g, sc);
  return false;
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
  logPursuitEvent('[GBR #' + g.fleetId + '] Spawned');
  if (!assignSpawnGbrTarget(g, preferredScalper)) {
    logPursuitEvent('[GBR #' + g.fleetId + '] PATROL');
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
  if (scalper.wantedAt == null) scalper.wantedAt = Game.time;
  scalper.alarmStationId = slot?.i ?? null;
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
  if (sc.pursuedBy) {
    const g = Game.vehicles.find(v => v.kind === 'gbr' && v.fleetId === sc.pursuedBy);
    if (g) releaseGbrTarget(g, { reason: 'despawn' });
  } else {
    sc.pursuedBy = null;
  }
  sc.wanted = false;
}

export function onScalperExitReached(sc) {
  logPursuitEvent('[SCALPER] Exit reached');
}

export function onGbrArrestStarted(g, sc) {
  if (g?.fleetId) logPursuitEvent('[GBR #' + g.fleetId + '] Arrest started');
}

export function onGbrArrestComplete(g, sc) {
  if (g?.fleetId) logPursuitEvent('[GBR #' + g.fleetId + '] Arrest complete');
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
