/**
 * Единый владелец и процедура выезда перекупа с АЗС (v0.3.5).
 * special → station (территория АЗС) → road (до EXIT).
 */

import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { mod } from '../core/utils.js';
import { ScalperPhase, setScalperPhase } from './entityFsm.js';
import { StationApi } from './stationApi.js';
import { logPursuitEvent } from './gbrPursuit.js';
import { outerLaneList } from './trafficSystem.js';

export function isVehicleInUpdateLane(v) {
  if (!v) return false;
  if (v.lane === 'outer') return v.state === 'drive';
  if (v.lane === 'inner') return v.state === 'drive' || v.state === 'action' || v.state === 'tow';
  return false;
}

function scalperInAnyStationList(sc) {
  if (sc.pump || sc.pocketSlot || sc.station || sc.targetSlot) return true;
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st) continue;
    if (st.pocket.includes(sc)) return true;
    for (const pump of st.pumps) {
      if (pump.cars.includes(sc)) return true;
    }
  }
  return false;
}

/** Проверка инвариантов после передачи перекупа дорожной системе. */
export function assertRoadHandoffInvariants(sc, context) {
  if (!sc) return false;
  const tag = context ? '[' + context + '] ' : '';
  const violations = [];

  if (getScalperOwner(sc) !== ScalperOwner.ROAD) {
    violations.push('owner !== ROAD (got ' + ownerDebugLabel(sc) + ')');
  }
  if (sc.state !== 'drive') {
    violations.push('state !== drive (got ' + sc.state + ')');
  }
  if (sc.lane !== 'outer') {
    violations.push('lane !== outer (got ' + sc.lane + ')');
  }
  if (sc.pose != null) {
    violations.push('pose !== null');
  }
  if (sc.stopS !== Road.spawnS) {
    violations.push('stopS !== Road.spawnS (got ' + sc.stopS + ', want ' + Road.spawnS + ')');
  }
  if (!outerLaneList().includes(sc)) {
    violations.push('not in outerLaneList()');
  }
  if (scalperInAnyStationList(sc)) {
    violations.push('still referenced in station lists');
  }

  for (const detail of violations) {
    const msg = '[ROAD HANDOFF] ' + tag + detail;
    console.error(msg);
    logPursuitEvent(msg);
  }
  return violations.length === 0;
}

function finishRoadHandoff(sc, context) {
  assertRoadHandoffInvariants(sc, context);
}

export function scalperMovementDebug(sc) {
  const L = Road.length;
  const ds = mod((sc.s || 0) - (sc.prevS ?? sc.s ?? 0), L);
  return {
    phase: String(sc.scalperPhase || ScalperPhase.DRIVING).toUpperCase(),
    state: sc.state || '?',
    lane: sc.lane || '?',
    owner: ownerDebugLabel(sc),
    move: isVehicleInUpdateLane(sc) ? 'ON' : 'OFF',
    v: Math.round(sc.v || 0),
    ds: Math.round(ds * 10) / 10
  };
}

export const ScalperOwner = {
  SPECIAL: 'special',
  STATION: 'station',
  ROAD: 'road'
};

const MAX_OWNER_LOG = 40;

export function resetScalperLifecycleState() {
  Game.scalperOwnerLog = [];
}

export function getScalperOwner(sc) {
  return sc?.scalperOwner || ScalperOwner.SPECIAL;
}

export function ownerDebugLabel(sc) {
  const o = getScalperOwner(sc);
  if (o === ScalperOwner.SPECIAL) return 'SPECIAL';
  if (o === ScalperOwner.STATION) return 'STATION';
  if (o === ScalperOwner.ROAD) return 'ROAD';
  return String(o).toUpperCase();
}

export function transferScalperOwner(sc, to, tag) {
  if (!sc) return;
  const from = getScalperOwner(sc);
  if (from === to) return;
  sc.scalperOwner = to;
  const msg = 'OWNER ' + ownerDebugLabel({ scalperOwner: from }) + ' -> ' + ownerDebugLabel({ scalperOwner: to }) +
    (tag ? ' (' + tag + ')' : '');
  if (!Game.scalperOwnerLog) Game.scalperOwnerLog = [];
  Game.scalperOwnerLog.push({ t: Game.time, msg });
  if (Game.scalperOwnerLog.length > MAX_OWNER_LOG) Game.scalperOwnerLog.shift();
  logPursuitEvent(msg);
}

export function initScalperLifecycle(sc) {
  sc.scalperOwner = ScalperOwner.SPECIAL;
  sc.stationExitActive = false;
  sc.stationExitReason = null;
}

export function isStationExitActive(sc) {
  return !!sc?.stationExitActive;
}

function captureExitContext(sc, opts) {
  opts = opts || {};
  return {
    slot: opts.slot || sc.targetSlot || sc.pocketSlot,
    pumpJ: opts.pumpJ ?? sc.pumpJ ?? 0
  };
}

/** Единая точка входа: выезд с территории АЗС. Повторный вызов игнорируется. */
export function beginStationExit(sc, reason, opts) {
  if (!sc || isStationExitActive(sc)) return false;

  const { slot, pumpJ } = captureExitContext(sc, opts);
  sc.stationExitActive = true;
  sc.stationExitReason = reason || 'leave';
  sc.exitSlot = slot;
  sc.exitPumpJ = pumpJ;

  if (getScalperOwner(sc) === ScalperOwner.SPECIAL) {
    transferScalperOwner(sc, ScalperOwner.STATION, 'exit_begin');
  }

  const st = sc.station || slot?.station;
  StationApi.releaseColumn(sc, { unblock: true });
  if (st && slot) StationApi.promotePocket(st, slot);

  sc.pump = null;
  sc.station = null;
  sc.pocketSlot = null;
  sc.stopS = null;

  if (reason === 'arrest') {
    setScalperPhase(sc, ScalperPhase.ARRESTING);
  } else if (sc.scalperPhase !== ScalperPhase.ESCAPING) {
    setScalperPhase(sc, ScalperPhase.ESCAPING);
  }

  if (slot) {
    sc.state = 'pullOut';
    sc.animT = 0;
    sc.animDur = CONFIG.visual.pullOutDur + pumpJ * 0.06;
    sc.animFrom = { ...(sc.pose || Road.posAt(sc.s, Road.laneW / 2)) };
    const mergeS = mod(slot.s + 16, Road.length);
    sc.animTo = Road.posAt(mergeS, -Road.laneW / 2);
    sc.exitS = mergeS;
    sc.targetSlot = slot;
    return true;
  }

  return completeStationExit(sc);
}

/** Завершение выезда: полная очистка станции, передача дорожной системе. */
export function completeStationExit(sc) {
  if (!sc) return false;

  StationApi.cleanupVehicleStationLinks(sc);
  sc.pump = null;
  sc.pocketSlot = null;
  sc.station = null;
  sc.targetSlot = null;
  sc.stopS = null;
  sc.stationExitActive = false;

  setScalperPhase(sc, ScalperPhase.EXITING);
  transferScalperOwner(sc, ScalperOwner.ROAD, 'exit_complete');

  sc.lane = 'outer';
  sc.state = 'drive';
  if (sc.exitS != null) {
    sc.s = sc.exitS;
    sc.prevS = sc.s;
  }
  sc.v = Math.max(sc.v || 0, CONFIG.scalper.speed * 0.55);
  sc.trip = 0;
  sc.pose = null;
  sc.stopS = Road.spawnS;
  sc.exitSlot = null;
  sc.exitPumpJ = 0;
  finishRoadHandoff(sc, 'exit_complete');
  return true;
}

/** Перекуп уже вне территории АЗС — сразу на дорогу к EXIT. */
export function handoffScalperToRoad(sc) {
  if (!sc || getScalperOwner(sc) === ScalperOwner.ROAD) return false;
  if (isStationExitActive(sc)) return false;

  StationApi.cleanupVehicleStationLinks(sc);
  sc.stationExitActive = false;
  setScalperPhase(sc, ScalperPhase.EXITING);
  transferScalperOwner(sc, ScalperOwner.ROAD, 'road_handoff');
  sc.state = 'drive';
  sc.lane = 'outer';
  sc.pose = null;
  sc.stopS = Road.spawnS;
  sc.v = Math.max(sc.v || 0, CONFIG.scalper.speed * 0.55);
  finishRoadHandoff(sc, 'road_handoff');
  return true;
}

export function scalperOwnerLogLines() {
  return (Game.scalperOwnerLog || []).slice(-12).map(e => '[' + Math.round(e.t) + 's] ' + e.msg);
}
