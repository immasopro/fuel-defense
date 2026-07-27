/**
 * Единый владелец и процедура выезда перекупа с АЗС.
 * special → station (территория АЗС) → EXITING (выход с карты) → DESPAWN.
 */

import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { mod } from '../core/utils.js';
import { ScalperPhase, setScalperPhase } from './entityFsm.js';
import { StationApi } from './stationApi.js';
import { logPursuitEvent, clearScalperWanted } from './gbrPursuit.js';
import { outerLaneList } from './trafficSystem.js';
import { commitScalperEscapeTheft } from './economySystem.js';

export const ScalperOwner = {
  SPECIAL: 'special',
  STATION: 'station',
  ROAD: 'road'
};

const MAX_OWNER_LOG = 40;

export function isScalperLeavingMap(sc) {
  return sc?.kind === 'scalper' && sc.scalperPhase === ScalperPhase.EXITING;
}

export function isVehicleInUpdateLane(v) {
  if (!v || isScalperLeavingMap(v)) return false;
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

function distAheadOnRing(from, to, L) {
  return mod(to - from, L);
}

/** Миссия завершена — начало выхода с карты (этап 1→2). */
function beginScalperLeavingMap(sc) {
  if (!sc || sc.scalperLeavingMap) return;
  sc.scalperLeavingMap = true;
  sc.scalperExitT = 0;
  sc.scalperExitStallT = 0;
  sc.stopS = null;
  sc.state = 'drive';
  sc.lane = 'outer';
  sc.pose = null;
  sc.tour = [];
  sc.tourIdx = 0;
  sc.pump = null;
  sc.station = null;
  sc.pocketSlot = null;
  sc.targetSlot = null;
  setScalperPhase(sc, ScalperPhase.EXITING);
  logPursuitEvent('[SCALPER] Leaving map');
}

/** Удаление объекта (этап 3). Wanted снимается только здесь. */
export function despawnScalper(sc, removeSet) {
  if (!sc) return;
  logPursuitEvent('[SCALPER] Despawn complete');
  commitScalperEscapeTheft(sc);
  clearScalperWanted(sc);
  setScalperPhase(sc, ScalperPhase.DESPAWN);
  sc.scalperLeavingMap = false;
  removeSet.add(sc);
  if (Game.scalper.unit === sc) Game.scalper.unit = null;
}

/**
 * Автономное движение EXITING-перекупов — вне updateLane.
 * Гарантированный прогресс; не зависит от crossed(), лидеров, stopS.
 */
export function updateScalpersLeavingMap(dt, L, removeSet) {
  const C = CONFIG.scalper;
  const exitSpeed = C.exitSpeed;
  const arrive = C.exitArriveDist;
  const maxT = C.exitMaxTime;
  const stallMax = C.exitStallMax;
  const minStep = C.exitMinStep;

  for (const sc of Game.vehicles) {
    if (!isScalperLeavingMap(sc)) continue;

    sc.scalperExitT = (sc.scalperExitT || 0) + dt;

    const distToExit = distAheadOnRing(sc.s, Road.spawnS, L);
    if (distToExit < arrive || sc.scalperExitT >= maxT) {
      despawnScalper(sc, removeSet);
      continue;
    }

    const prevS = sc.s;
    sc.prevS = prevS;
    const step = Math.max(exitSpeed * dt, minStep * dt);
    sc.s = mod(sc.s + step, L);
    sc.v = exitSpeed;

    const ds = mod(sc.s - prevS, L);
    if (ds < 0.5 * dt) {
      sc.scalperExitStallT = (sc.scalperExitStallT || 0) + dt;
      if (sc.scalperExitStallT >= stallMax) {
        const jump = Math.max(step * 2, distToExit * 0.35);
        sc.s = mod(sc.s + jump, L);
        sc.scalperExitStallT = 0;
      }
    } else {
      sc.scalperExitStallT = 0;
    }

    if (distAheadOnRing(sc.s, Road.spawnS, L) < arrive) {
      despawnScalper(sc, removeSet);
    }
  }
}

/** Проверка инвариантов после передачи в режим выхода с карты. */
export function assertRoadHandoffInvariants(sc, context) {
  if (!sc) return false;
  const tag = context ? '[' + context + '] ' : '';
  const violations = [];

  if (sc.scalperPhase !== ScalperPhase.EXITING) {
    violations.push('phase !== EXITING (got ' + sc.scalperPhase + ')');
  }
  if (!sc.scalperLeavingMap) {
    violations.push('scalperLeavingMap not set');
  }
  if (sc.stopS != null) {
    violations.push('stopS must be null during EXITING (got ' + sc.stopS + ')');
  }
  if (outerLaneList().includes(sc)) {
    violations.push('EXITING scalper must not be in outerLaneList');
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

function finishLeavingMapHandoff(sc, context) {
  assertRoadHandoffInvariants(sc, context);
}

export function scalperMovementDebug(sc) {
  const L = Road.length;
  const ds = mod((sc.s || 0) - (sc.prevS ?? sc.s ?? 0), L);
  let move = 'OFF';
  if (isScalperLeavingMap(sc)) move = 'EXIT';
  else if (isVehicleInUpdateLane(sc)) move = 'ON';
  return {
    phase: String(sc.scalperPhase || ScalperPhase.DRIVING).toUpperCase(),
    state: sc.state || '?',
    lane: sc.lane || '?',
    owner: ownerDebugLabel(sc),
    move,
    v: Math.round(sc.v || 0),
    ds: Math.round(ds * 10) / 10
  };
}

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
  sc.scalperLeavingMap = false;
  sc.scalperExitT = 0;
  sc.scalperExitStallT = 0;
  sc.pocketApproachT = 0;
  sc.pocketWaitT = 0;
}

/**
 * Вернуть Scalper в штатный тур после срыва заезда/очереди (D-SPAWN-002).
 * Не трогает ARRESTING / EXITING / ESCAPING / DESPAWN.
 */
export function restoreScalperToTour(sc, tag) {
  if (!sc || sc.kind !== 'scalper') return false;
  if (isScalperLeavingMap(sc)) return false;
  const phase = sc.scalperPhase;
  if (phase === ScalperPhase.ARRESTING ||
      phase === ScalperPhase.ESCAPING ||
      phase === ScalperPhase.EXITING ||
      phase === ScalperPhase.DESPAWN) {
    return false;
  }
  sc.targetSlot = null;
  sc.stopS = null;
  sc.pocketWaitT = 0;
  sc.pocketApproachT = 0;
  sc.approachWait = 0;
  if (sc.state === 'pocket' || sc.state === 'pullIn') {
    sc.state = 'drive';
    sc.pose = null;
    sc.animT = 0;
    sc.v = Math.max(sc.v || 0, sc.maxV * 0.35);
  } else if (sc.state !== 'drive') {
    sc.state = 'drive';
    sc.pose = null;
  }
  transferScalperOwner(sc, ScalperOwner.SPECIAL, tag || 'restore_tour');
  setScalperPhase(sc, ScalperPhase.DRIVING);
  return true;
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

/** Единая точка входа: выезд с территории АЗС. */
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

/** Завершение выезда с АЗС → начало автономного выхода с карты. */
export function completeStationExit(sc) {
  if (!sc) return false;

  StationApi.cleanupVehicleStationLinks(sc);
  sc.pump = null;
  sc.pocketSlot = null;
  sc.station = null;
  sc.targetSlot = null;
  sc.stopS = null;
  sc.stationExitActive = false;

  transferScalperOwner(sc, ScalperOwner.ROAD, 'exit_complete');

  if (sc.exitS != null) {
    sc.s = sc.exitS;
    sc.prevS = sc.s;
  }
  sc.v = Math.max(sc.v || 0, CONFIG.scalper.exitSpeed);
  sc.trip = 0;
  sc.exitSlot = null;
  sc.exitPumpJ = 0;

  beginScalperLeavingMap(sc);
  finishLeavingMapHandoff(sc, 'exit_complete');
  return true;
}

/** Перекуп вне АЗС — сразу в режим выхода с карты. */
export function handoffScalperToRoad(sc) {
  if (!sc || isScalperLeavingMap(sc)) return false;
  if (isStationExitActive(sc)) return false;

  StationApi.cleanupVehicleStationLinks(sc);
  sc.stationExitActive = false;
  transferScalperOwner(sc, ScalperOwner.ROAD, 'road_handoff');
  sc.v = Math.max(sc.v || 0, CONFIG.scalper.exitSpeed);

  beginScalperLeavingMap(sc);
  finishLeavingMapHandoff(sc, 'road_handoff');
  return true;
}

export function scalperOwnerLogLines() {
  return (Game.scalperOwnerLog || []).slice(-12).map(e => '[' + Math.round(e.t) + 's] ' + e.msg);
}
