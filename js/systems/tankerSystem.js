import { mod } from '../core/utils.js';
import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { onTankerMissionComplete, notifyTankerReturning } from './tankerLogistics.js';
import {
  Road, tankerTechStopS, tankerCommitS, tankerDecisionS,
  tankerTechPose, distNearStop, distAhead
} from '../world/roadNetwork.js';
import { Depot } from '../world/map.js';
import { TankerPhase, setTankerPhase } from './entityFsm.js';
import { addFloat } from './economySystem.js';
import { crossed } from '../vehicles/vehicle.js';

function tankerTour() {
  return Road.slots.slice();
}

function legNeedFuel(slot) {
  const st = slot.station;
  if (!st) return false;
  return st.cap - st.res > 0.5;
}

function legDecision(slot, load) {
  if (!slot.station) return 'SKIP';
  if (load <= 0.01) return 'SKIP';
  if (!legNeedFuel(slot)) return 'SKIP';
  return 'REFUEL';
}

function buildLegSnapshot(slot, load) {
  const st = slot.station;
  const needFuel = legNeedFuel(slot);
  const decision = legDecision(slot, load);
  return {
    spotNum: slot.i + 1,
    spotId: slot.i,
    slot,
    exists: !!st,
    current: st ? st.res : 0,
    capacity: st ? st.cap : 0,
    needFuel,
    decision,
    decided: false,
    committed: false,
    done: false
  };
}

function buildTankerManifest(load) {
  return tankerTour().map(slot => buildLegSnapshot(slot, load));
}

function currentLeg(v) {
  const plan = v.routePlan || v.manifest;
  return plan && v.tourIdx < plan.length ? plan[v.tourIdx] : null;
}

/** Пустые площадки не участвуют в маршруте — сразу переходим к следующему споту */
function advancePastEmptyLegs(v) {
  let leg = currentLeg(v);
  while (leg && !leg.slot.station && !leg.done) {
    leg.decided = true;
    leg.committed = true;
    logTankerEvent(v, 'Spot' + leg.spotNum + ' empty — pass');
    completeLeg(v);
    leg = currentLeg(v);
  }
  return leg;
}

function logTankerEvent(v, msg) {
  if (!v.eventLog) v.eventLog = [];
  v.eventLog.push(msg);
  if (v.eventLog.length > 16) v.eventLog.shift();
}

function initTankerRoute(v) {
  v.routePlan = buildTankerManifest(v.load);
  v.manifest = v.routePlan;
  v.tourIdx = 0;
  v.eventLog = [];
  logTankerEvent(v, 'Spawn');
  logTankerEvent(v, 'Route generated');
  for (const leg of v.routePlan) {
    logTankerEvent(v, 'Spot' + leg.spotNum + ' → ' + leg.decision);
  }
}

function onTankerDeployed(v) {
  if (v.tankerPhase === TankerPhase.SPAWNING) {
    setTankerPhase(v, TankerPhase.MOVING);
    if (!v.routePlan) initTankerRoute(v);
    primeLegTargeting(v);
  }
}

function beginTankerTechPullIn(v, slot) {
  if (v.state !== 'drive') return;
  setTankerPhase(v, TankerPhase.REFUELLING);
  v.serviceSlot = slot;
  v.state = 'pullIn';
  v.animT = 0;
  v.animDur = 0.85;
  const lat = Road.laneW / 2 + (v.latOff || 0);
  v.animFrom = Road.posAt(v.s, lat);
  v.animTo = tankerTechPose(slot);
  v.v = 0;
  v.stopS = null;
}

function beginTankerTechPullOut(v, slot) {
  v.state = 'pullOut';
  v.animT = 0;
  v.animDur = 0.7;
  v.animFrom = { ...v.pose };
  const mergeS = mod(slot.s + 20, Road.length);
  v.animTo = Road.posAt(mergeS, Road.laneW / 2);
  v.exitS = mergeS;
}

function beginTankerDepotPullIn(v) {
  if (v.state !== 'depotDrive' && v.state !== 'drive') return;
  v.state = 'pullIn';
  v.animT = 0;
  v.animDur = 0.55;
  v.animFrom = { ...(v.pose || Depot.unloadStop) };
  v.animTo = { ...Depot.unloadPose };
  v.v = 0;
  v.stopS = null;
}

function beginTankerDepotPullOut(v) {
  v.state = 'pullOut';
  v.animT = 0;
  v.animDur = 0.55;
  v.animFrom = { ...v.pose };
  v.animTo = { ...Depot.driveFromDepot[0] };
  v.afterDepotReturn = true;
}

function beginDepotBranch(v) {
  setTankerPhase(v, TankerPhase.MAIN_STORAGE);
  v.depotPathMode = 'toDepot';
  v.depotWaypoint = 0;
  v.state = 'depotDrive';
  v.stopS = null;
  const wp = Depot.driveToDepot[0];
  v.pose = { x: wp.x, y: wp.y, a: wp.a };
  v.s = Depot.ringJoinS;
  v.prevS = v.s;
  logTankerEvent(v, '→ Depot road');
}

function updateDepotDrive(v, dt) {
  const path = v.depotPathMode === 'toDepot' ? Depot.driveToDepot : Depot.driveFromDepot;
  let idx = v.depotWaypoint || 0;
  if (idx >= path.length) {
    if (v.depotPathMode === 'toDepot') beginTankerDepotPullIn(v);
    else finishDepotReturn(v);
    return;
  }
  const target = path[idx];
  const speed = CONFIG.tanker.speed;
  const px = v.pose?.x ?? target.x;
  const py = v.pose?.y ?? target.y;
  const dx = target.x - px;
  const dy = target.y - py;
  const dist = Math.hypot(dx, dy);
  if (dist < 5) {
    v.depotWaypoint = idx + 1;
    if (v.depotWaypoint >= path.length) {
      if (v.depotPathMode === 'toDepot') beginTankerDepotPullIn(v);
      else finishDepotReturn(v);
    }
    return;
  }
  const move = Math.min(speed * dt, dist);
  if (!v.pose) v.pose = { x: px, y: py, a: target.a };
  v.pose.x += dx / dist * move;
  v.pose.y += dy / dist * move;
  v.pose.a = Math.atan2(dy, dx);
}

function finishDepotReturn(v) {
  v.depotPathMode = null;
  v.depotWaypoint = 0;
  v.pose = null;
  v.s = Depot.ringJoinS;
  v.prevS = v.s;
  v.lane = 'inner';
  logTankerEvent(v, '→ Exit');
  startTankerExit(v);
}

function startTankerExit(v) {
  if (v.fleetId) notifyTankerReturning(v.fleetId);
  setTankerPhase(v, TankerPhase.EXIT);
  v.lane = 'outer';
  v.state = 'drive';
  v.pose = null;
  v.stopS = null;
  v.serviceSlot = null;
  v.v = Math.max(v.v || 0, 24);
  logTankerEvent(v, '→ Exit map');
}

function completeLeg(v) {
  const leg = currentLeg(v);
  if (!leg || leg.done) return;
  leg.done = true;
  logTankerEvent(v, 'Leaving Spot' + leg.spotNum);
  v.tourIdx++;
  const next = currentLeg(v);
  if (next) {
    logTankerEvent(v, 'Next Spot' + next.spotNum);
    primeLegTargeting(v);
  } else {
    v.stopS = null;
  }
}

function zoneJustPassed(v, zoneS, L) {
  const behind = distAhead(zoneS, v.s, L);
  return behind > 0 && behind < 30;
}

function syncLegCatchUp(v, leg, L) {
  if (!leg || leg.done || !leg.slot.station) return;
  if (!leg.decided && zoneJustPassed(v, tankerDecisionS(leg.slot), L)) {
    leg.decided = true;
    logTankerEvent(v, 'Spot' + leg.spotNum + ' decision zone');
  }
  if (leg.decided && !leg.committed && zoneJustPassed(v, tankerCommitS(leg.slot), L)) {
    leg.committed = true;
    logTankerEvent(v, 'Spot' + leg.spotNum + ' committed');
    if (leg.decision === 'SKIP') completeLeg(v);
  }
}

function zoneReached(v, zoneS, L) {
  if (crossed(v, zoneS)) return true;
  return distNearStop(v.s, zoneS, L, CONFIG.road.pullInDist + 6) && v.v < 6;
}

function tryCrossLegZones(v) {
  const leg = advancePastEmptyLegs(v);
  if (!leg || leg.done || !leg.slot.station) return;
  const L = Road.length;

  if (!leg.decided && zoneReached(v, tankerDecisionS(leg.slot), L)) {
    leg.decided = true;
    logTankerEvent(v, 'Spot' + leg.spotNum + ' decision zone');
  }
  if (leg.decided && !leg.committed && zoneReached(v, tankerCommitS(leg.slot), L)) {
    leg.committed = true;
    logTankerEvent(v, 'Spot' + leg.spotNum + ' committed');
    if (leg.decision === 'SKIP') completeLeg(v);
  }
  syncLegCatchUp(v, leg, L);
}

function primeLegTargeting(v) {
  const L = Road.length;
  let leg = advancePastEmptyLegs(v);
  if (!leg) {
    v.stopS = null;
    return;
  }
  syncLegCatchUp(v, leg, L);
  leg = currentLeg(v);
  if (!leg || leg.done) {
    v.stopS = null;
    return;
  }
  if (!leg.slot.station) {
    v.stopS = null;
    return;
  }

  if (leg.committed && leg.decision === 'SKIP' && !leg.done) {
    completeLeg(v);
    return;
  }

  // Замедление только перед фактическим заездом на АЗС (REFUEL + committed)
  if (leg.committed && leg.decision === 'REFUEL') {
    v.stopS = tankerTechStopS(leg.slot);
    return;
  }
  v.stopS = null;
}

function advanceTourOrDepot(v) {
  if (v.load <= 0.01) {
    startTankerExit(v);
    return;
  }
  const plan = v.routePlan || v.manifest;
  if (v.tourIdx >= plan.length) {
    if (Game.depot.res >= Game.depot.cap - 0.5) {
      startTankerExit(v);
      return;
    }
    setTankerPhase(v, TankerPhase.MAIN_STORAGE);
    beginDepotBranch(v);
    return;
  }
  setTankerPhase(v, TankerPhase.MOVING);
  primeLegTargeting(v);
}

function updateTankerDrive(v, dt, L, removeSet) {
  onTankerDeployed(v);
  const phase = v.tankerPhase;

  if (phase === TankerPhase.EXIT) return;

  if (phase === TankerPhase.MOVING && v.state === 'drive') {
    if (v.load <= 0.01) {
      startTankerExit(v);
      return;
    }
    const plan = v.routePlan || v.manifest;
    if (v.tourIdx >= plan.length) {
      advanceTourOrDepot(v);
      return;
    }

    tryCrossLegZones(v);

    const leg = currentLeg(v);
    if (!leg) {
      advanceTourOrDepot(v);
      return;
    }

    primeLegTargeting(v);

    if (leg.done) return;

    if (leg.committed && leg.decision === 'REFUEL') {
      if (distNearStop(v.s, v.stopS, L, CONFIG.road.pullInDist + 8) && v.v < 12) {
        beginTankerTechPullIn(v, leg.slot);
      }
    }
    return;
  }

  if (phase === TankerPhase.MAIN_STORAGE) {
    if (v.state === 'depotDrive') {
      updateDepotDrive(v, dt);
      return;
    }
    if (v.load <= 0.01) {
      startTankerExit(v);
      return;
    }
    return;
  }
}

function updateTankerTechService(v, dt) {
  if (v.state !== 'tankerService') return;
  const slot = v.serviceSlot;
  const leg = currentLeg(v);
  if (!slot || !slot.station || !leg || leg.decision !== 'REFUEL') return;

  const st = slot.station;
  const C = CONFIG.tanker;
  const required = st.cap - st.res;
  const transfer = Math.min(required, v.load, C.stationRate * dt);
  if (transfer > 0) {
    st.res += transfer;
    v.load -= transfer;
    const tp = tankerTechPose(slot);
    addFloat(tp.x, tp.y - 18, '+' + Math.round(transfer) + 'л', '#fdd835');
  }
  const done = v.load <= 0.01 || st.res >= st.cap - 0.5 || required <= 0.5;
  if (!done) return;

  const spotNum = leg.spotNum;
  completeLeg(v);
  if (v.load <= 0.01) {
    beginTankerTechPullOut(v, slot, Road.length);
    v.afterTechExit = 'exit';
    return;
  }
  beginTankerTechPullOut(v, slot, Road.length);
  v.afterTechExit = 'tour';
}

function updateTankerDepotService(v, dt) {
  if (v.state !== 'tankerDepot') return;
  const C = CONFIG.tanker;
  const space = Game.depot.cap - Game.depot.res;
  const transfer = Math.min(v.load, space, C.depotRate * dt);
  if (transfer > 0) {
    Game.depot.res += transfer;
    v.load -= transfer;
    addFloat(Depot.unloadPose.x, Depot.unloadPose.y - 18, '+' + Math.round(transfer) + 'л', '#5c6bc0');
  }
  if (v.load > 0.01) return;
  v.depotPathMode = 'fromDepot';
  v.depotWaypoint = 1;
  beginTankerDepotPullOut(v);
}

function finishTankerPullOut(v, L, removeSet) {
  if (v.afterDepotReturn) {
    v.afterDepotReturn = false;
    v.state = 'depotDrive';
    v.depotPathMode = 'fromDepot';
    v.depotWaypoint = 1;
    v.pose = { ...Depot.driveFromDepot[0] };
    return;
  }

  v.lane = 'inner';
  v.state = 'drive';
  v.s = v.exitS;
  v.prevS = v.s;
  v.v = 28;
  v.pose = null;
  v.serviceSlot = null;

  if (v.afterTechExit === 'exit') {
    v.afterTechExit = null;
    startTankerExit(v);
    return;
  }
  v.afterTechExit = null;
  setTankerPhase(v, TankerPhase.MOVING);
  advanceTourOrDepot(v);
}

function tryRemoveExitingTanker(v, removeSet) {
  if (v.kind !== 'tanker' || v.tankerPhase !== TankerPhase.EXIT) return;
  if (v.lane === 'outer' && v.trip > 20 && crossed(v, Road.spawnS)) {
    removeSet.add(v);
    if (v.fleetId) onTankerMissionComplete(v.fleetId);
    if (Game.tanker.unit === v) Game.tanker.unit = null;
  }
}

function getTankerRoutePlan(v) {
  return v.routePlan || v.manifest || [];
}

function getTankerEventLog(v) {
  return v.eventLog || [];
}

function getTankerDebugInfo(v) {
  const leg = currentLeg(v);
  const lines = [];
  if (leg) {
    lines.push('NEXT: Spot ' + leg.spotNum + ' (ID:' + leg.spotId + ')');
    lines.push('Decision: ' + leg.decision);
    if (leg.committed) lines.push('Committed');
  } else if (v.tankerPhase === TankerPhase.MAIN_STORAGE) {
    lines.push('→ Нефтебаза');
  } else if (v.tankerPhase === TankerPhase.EXIT) {
    lines.push('→ Выезд');
  } else {
    lines.push('DONE');
  }
  return { lines };
}

export {
  tankerTour, buildTankerManifest, buildLegSnapshot, legDecision, legNeedFuel,
  initTankerRoute, onTankerDeployed, logTankerEvent,
  updateTankerDrive, updateTankerTechService, updateTankerDepotService,
  finishTankerPullOut, tryRemoveExitingTanker, startTankerExit,
  getTankerDebugInfo, getTankerRoutePlan, getTankerEventLog, currentLeg, primeLegTargeting,
  beginDepotBranch, updateDepotDrive, finishDepotReturn
};
