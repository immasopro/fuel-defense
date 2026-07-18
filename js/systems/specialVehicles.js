import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road, approachStopS, apronPoseForRank, distAhead, distNearStop } from '../world/roadNetwork.js';
import { GBRBase } from '../world/map.js';
import { mod, rand } from '../core/utils.js';
import { makeScalper, makeBgCar } from '../vehicles/vehicleFactory.js';
import { finishScalperFuel, addFloat } from './economySystem.js';
import { currentSpawnInterval, scalperCooldown } from './spawnSystem.js';
import { onHolderChanged, addToHolder } from './trafficSystem.js';
import { sortedStationSlots } from '../world/map.js';
import { StationApi } from './stationApi.js';
import { onGbrMissionComplete, notifyGbrReturning, gbrPatrolSpeed } from './gbrLogistics.js';
import { currentScalperMaxLiters } from './scalperEvolution.js';
import { ScalperPhase, GbrPhase, setScalperPhase, setGbrPhase } from './entityFsm.js';
import { beginPullIn } from '../stations/stationQueue.js';
import { crossed } from '../vehicles/vehicle.js';
import {
  onScalperTheftDetected, getGbrTarget, releaseGbrTarget,
  onGbrArrestStarted, onGbrArrestComplete, onScalperLeavingStation, logPursuitEvent
} from './gbrPursuit.js';
import {
  ScalperOwner, initScalperLifecycle, isStationExitActive,
  beginStationExit, handoffScalperToRoad, transferScalperOwner, getScalperOwner
} from './scalperLifecycle.js';
import { fmtRubDelta } from '../core/currency.js';



const SA = StationApi;



function scalperCap(v) {

  return v.maxLiters != null ? v.maxLiters : currentScalperMaxLiters();

}



function requestScalperLeaveStation(v, L, reason) {
  if (isStationExitActive(v)) return;

  const slot = v.targetSlot;
  const pumpJ = v.pumpJ ?? 0;
  const onStation = v.state === 'station' || v.state === 'block' || v.pump || v.pocketSlot;

  if (onStation) {
    const gbr = Game.vehicles.find(x => x.kind === 'gbr' && x.fleetId === v.pursuedBy);
    onScalperLeavingStation(v, gbr);
    beginStationExit(v, reason, { slot, pumpJ });
    return;
  }

  handoffScalperToRoad(v);
}

function beginScalperExit(v, L, slotOverride, pumpJOverride) {
  if (isStationExitActive(v)) return;
  if (slotOverride) v.targetSlot = slotOverride;
  if (pumpJOverride != null) v.pumpJ = pumpJOverride;
  requestScalperLeaveStation(v, L, 'leave');
}

function advanceScalperFromStation(v, L) {
  const slot = v.targetSlot;
  const st = v.station;
  const pumpJ = v.pumpJ || 0;
  SA.detachDealer(v);
  if (st && slot) SA.promotePocket(st, slot);
  v.tourIdx++;
  v.stationRefuelling = false;
  if (v.totalGot >= scalperCap(v) - 0.01) {
    beginScalperExit(v, L, slot, pumpJ);
    return;
  }
  transferScalperOwner(v, ScalperOwner.SPECIAL, 'continue_tour');
  setScalperPhase(v, ScalperPhase.DRIVING);
  v.state = 'drive';
}



function tryAttachScalperToStation(sc, slot) {
  const ok = SA.joinStationWaitQueue(sc, slot);
  if (ok) {
    setScalperPhase(sc, ScalperPhase.QUEUE);
    transferScalperOwner(sc, ScalperOwner.STATION, 'join_queue');
  }
  return ok;
}



function updateScalperTour(v, dt, L) {
  if (getScalperOwner(v) !== ScalperOwner.SPECIAL) return;
  if (v.scalperPhase === ScalperPhase.ARRESTING ||
      v.scalperPhase === ScalperPhase.EXITING ||
      v.scalperPhase === ScalperPhase.ESCAPING ||
      isStationExitActive(v)) return;



  if (v.totalGot >= scalperCap(v) - 0.01) {

    beginScalperExit(v, L);

    return;

  }



  if (v.tourIdx >= v.tour.length) {

    v.tourIdx = 0;

    if (!v.tour.length) {

      beginScalperExit(v, L);

      return;

    }

  }



  const slot = v.tour[v.tourIdx];

  const st = slot?.station;



  if (!v.targetSlot && !v.pocketSlot && !v.pump) {

    setScalperPhase(v, ScalperPhase.DRIVING);

    if (!st) {

      v.tourIdx++;

      return;

    }

    if (!tryAttachScalperToStation(v, slot)) {
      v.tourIdx++;
      return;
    }
  }
}



function updateScalperAtColumn(v, dt, L) {
  if (getScalperOwner(v) === ScalperOwner.ROAD) return;
  if (v.scalperPhase === ScalperPhase.ARRESTING) return;

  const ctx = SA.getColumnContext(v);

  if (!ctx) {

    setScalperPhase(v, ScalperPhase.DRIVING);

    v.state = 'drive';

    return;

  }

  const { pump, st, rank } = ctx;

  const C = CONFIG.scalper;

  if (rank > 0) return;



  const canRefuel = pump.fuel === v.fuelKey &&

    st.res + pump.buffer > CONFIG.station.minReserve;



  if (v.scalperPhase === ScalperPhase.REFUELING) {
    if (canRefuel && v.totalGot < scalperCap(v)) {
      pump.serving = true;

      let d = 0;

      if (pump.buffer > 0.01) {

        d = Math.min(pump.rate * CONFIG.pump.fastMult * dt, scalperCap(v) - v.totalGot, pump.buffer);

        pump.buffer -= d;

      } else {

        d = Math.min(C.fillRate * dt, scalperCap(v) - v.totalGot, st.res - CONFIG.station.minReserve);

        if (d > 0) st.res -= d;

      }

      if (d > 0) finishScalperFuel(v, d);

    }

    const done = v.totalGot >= scalperCap(v) - 0.01 || !canRefuel;

    if (done) advanceScalperFromStation(v, L);

    return;

  }



  if (!canRefuel) {

    advanceScalperFromStation(v, L);

    return;

  }



  if (v.scalperPhase !== ScalperPhase.REFUELING) {
    onScalperTheftDetected(st, v);
  }

  setScalperPhase(v, ScalperPhase.REFUELING);

  v.stationRefuelling = true;

  v.state = 'station';

  if (rank === 0) pump.serving = true;

}



function updateScalperWaiting(v) {
  if (getScalperOwner(v) === ScalperOwner.ROAD) return;
  if (v.scalperPhase === ScalperPhase.ARRESTING ||
      v.scalperPhase === ScalperPhase.EXITING ||
      v.scalperPhase === ScalperPhase.ESCAPING ||
      isStationExitActive(v)) return;
}



function scalperOnColumn(sc) {

  return sc && (sc.state === 'station' || sc.state === 'block' || sc.state === 'pullIn');

}



function vehicleWorldPos(v) {

  if (v.pose) return { x: v.pose.x, y: v.pose.y };

  const lat = v.lane === 'inner' ? Road.laneW / 2 : -Road.laneW / 2;

  const p = Road.posAt(v.s, lat + (v.latOff || 0));

  return { x: p.x, y: p.y };

}



function scalperOnMap(sc) {
  return sc && Game.vehicles.includes(sc) &&
    sc.scalperPhase !== ScalperPhase.DESPAWN;
}

/** Цель ГБР — перекуп, уже укравший топливо */
function scalperIsGbrTarget(sc) {
  return scalperOnMap(sc) &&
    sc.scalperPhase !== ScalperPhase.ARRESTING &&
    !!sc.wanted;
}



function gbrSeesScalper(g, sc) {
  if (!scalperIsGbrTarget(sc)) return false;
  const pg = vehicleWorldPos(g);
  const ps = vehicleWorldPos(sc);
  const dist = Math.hypot(ps.x - pg.x, ps.y - pg.y);
  return dist <= CONFIG.gbr.visionRadius;
}

function gbrTargetsInRange(g) {
  const hits = [];
  for (const v of Game.vehicles) {
    if (v.kind !== 'scalper') continue;
    if (!gbrSeesScalper(g, v)) continue;
    const ps = vehicleWorldPos(v);
    const pg = vehicleWorldPos(g);
    hits.push({ v, dist: Math.hypot(ps.x - pg.x, ps.y - pg.y) });
  }
  hits.sort((a, b) => a.dist - b.dist);
  return hits.map(h => h.v);
}



function gbrArrestPose(sc) {

  const rank = SA.pumpRank(sc.pump, sc);

  return apronPoseForRank(sc.targetSlot, sc.pumpJ, rank + 1);

}



function beginGbrPullIn(g, sc) {

  if (g.state !== 'drive' || !sc.targetSlot || !sc.pump) return false;

  const slot = sc.targetSlot;

  const st = slot.station;

  if (!SA.claimColumn(st, g, sc.pumpJ)) return false;

  g.targetSlot = slot;

  setGbrPhase(g, GbrPhase.ENTER_SERVICE_LANE);

  g.state = 'pullIn';

  g.animT = 0;

  g.animDur = CONFIG.visual.pullInDur + sc.pumpJ * 0.06;

  const lat = Road.laneW / 2 + (g.latOff || 0);

  g.animFrom = Road.posAt(g.s, lat);

  g.animTo = gbrArrestPose(sc);

  g.v = 0;

  g.stopS = null;

  g.approachWait = 0;

  return true;

}



function tryGbrApproach(g, sc, dt, L) {

  const slot = sc.targetSlot;

  if (!slot) return;

  const stopS = approachStopS(slot);

  g.stopS = stopS;

  g.maxV = gbrPatrolSpeed();

  const d = distAhead(g.s, stopS, L);

  if (d < CONFIG.road.pullInDist + 4 && g.v < 14) {

    beginGbrPullIn(g, sc);

    return;

  }

  if (d > L - CONFIG.road.passReleaseDist) {

    g.approachWait = 0;

    return;

  }

  if (distNearStop(g.s, stopS, L, CONFIG.road.forcePullInDist + 6) && g.v < 16) {

    beginGbrPullIn(g, sc);

    return;

  }

  if (g.v < 1.5) {

    g.approachWait = (g.approachWait || 0) + dt;

    if (g.approachWait > CONFIG.road.forcePullInTime && d < CONFIG.road.forcePullInDist + 12) {

      beginGbrPullIn(g, sc);

    }

  } else {

    g.approachWait = 0;

  }

}



function startArrest(g, sc) {
  const st = sc.station;
  const slot = sc.targetSlot;
  SA.releaseColumn(sc, { unblock: true });
  sc.pump = null;
  sc.station = null;
  if (st && slot) SA.promotePocket(st, slot);
  setGbrPhase(g, GbrPhase.ARREST);
  setScalperPhase(sc, ScalperPhase.ARRESTING);
  sc.state = 'block';
  g.v = 0;
  g.arrestT = CONFIG.gbr.towTime;
  onGbrArrestStarted(g, sc);
  addFloat(g.pose?.x ?? 0, (g.pose?.y ?? 0) - 24, 'Задержание…', '#42a5f5');
}



function beginGbrReturn(g, slot, pumpJ, L) {
  releaseGbrTarget(g);
  if (g.fleetId) notifyGbrReturning(g.fleetId);

  setGbrPhase(g, GbrPhase.RETURNING);
  g.maxV = CONFIG.gbr.returnSpeed;
  g.returnPullOut = true;

  if (slot) {
    g.state = 'pullOut';
    g.animT = 0;
    g.animDur = CONFIG.visual.pullOutDur + pumpJ * 0.06;
    g.animFrom = { ...(g.pose || Road.posAt(g.s, Road.laneW / 2)) };
    const mergeS = mod(slot.s + 16, L);
    g.animTo = Road.posAt(mergeS, -Road.laneW / 2);
    g.exitS = mergeS;
  } else {
    g.state = 'drive';
    g.stopS = GBRBase.spawnS;
    g.v = CONFIG.gbr.returnSpeed;
  }
}



function finishArrest(g, sc, L) {

  const slot = sc?.targetSlot || g.targetSlot;

  const pumpJ = sc?.pumpJ ?? 0;



  if (!sc || !Game.vehicles.includes(sc)) {

    beginGbrReturn(g, slot, pumpJ, L);

    addFloat(g.pose?.x ?? 0, (g.pose?.y ?? 0) - 20, '→ база', '#42a5f5');

    return;

  }



  if (sc.totalGot > 0.01 && sc.fuelKey) {
    const F = CONFIG.fuels[sc.fuelKey];
    const pay = Math.round(sc.totalGot * F.price);
    Game.money += pay;
    Game.stats.earned += pay;
    Game.stats.liters += sc.totalGot;
    addFloat(sc.pose?.x ?? 0, (sc.pose?.y ?? 0) - 30, fmtRubDelta(pay) + ' оплата перекупа', '#8bc34a');
  }

  SA.releaseColumn(g);
  beginStationExit(sc, 'arrest', { slot, pumpJ });
  onScalperLeavingStation(sc, g);
  onGbrArrestComplete(g, sc);
  beginGbrReturn(g, slot, pumpJ, L);

  addFloat(g.pose?.x ?? 0, (g.pose?.y ?? 0) - 20, '→ база', '#42a5f5');

}



function decideAfterArrestExit(sc) {
  return 'exit';
}

function onGbrReturnPullOutComplete(g, L) {

  g.returnPullOut = false;

  g.lane = 'outer';

  g.state = 'drive';

  g.s = g.exitS;

  g.prevS = g.s;

  g.maxV = CONFIG.gbr.returnSpeed;

  g.v = CONFIG.gbr.returnSpeed;

  g.trip = 0;

  g.pose = null;

  g.stopS = GBRBase.spawnS;

  g.targetSlot = null;

}



function tickGbrMissionLap(g, L) {

  if (g.gbrPhase === GbrPhase.RETURNING || g.gbrPhase === GbrPhase.ARREST) return;

  if (!crossed(g, GBRBase.spawnS)) return;

  g.patrolLaps = (g.patrolLaps || 0) + 1;

  if (g.patrolLaps >= CONFIG.gbr.patrolMaxLaps) {

    beginGbrReturn(g, null, 0, L);

  }

}



function findVisibleGbrTarget(g) {
  return gbrTargetsInRange(g)[0] || null;
}



function updateGbrChase(g, sc, dt, L) {
  if (!sc || !scalperOnMap(sc) || !scalperIsGbrTarget(sc)) {
    releaseGbrTarget(g);
    setGbrPhase(g, GbrPhase.PATROL);
    g.stopS = null;
    return;
  }

  if (scalperOnColumn(sc)) {
    tryGbrApproach(g, sc, dt, L);
    return;
  }

  g.maxV = gbrPatrolSpeed();
  g.stopS = mod(sc.s - CONFIG.gbr.chaseFollowDist, L);
}

function updateGBR(g, dt, L, removeSet) {
  const C = CONFIG.gbr;
  const sc = getGbrTarget(g);

  if (g.gbrPhase === GbrPhase.RETURNING) {
    g.stopS = GBRBase.spawnS;
    g.maxV = C.returnSpeed;
    const p = Road.posAt(g.s, 0);
    const dp = Math.hypot(GBRBase.pos.x - p.x, GBRBase.pos.y - p.y);
    if (dp < 40 || distAhead(g.s, GBRBase.spawnS, L) < 8) {
      releaseGbrTarget(g);
      if (g.fleetId) onGbrMissionComplete(g.fleetId);
      removeSet.add(g);
      if (Game.gbr.unit === g) Game.gbr.unit = null;
    }
    return;
  }

  if (g.gbrPhase === GbrPhase.ARREST) {
    g.arrestT -= dt;
    if (g.arrestT <= 0) finishArrest(g, getGbrTarget(g) || g.chaseTarget, L);
    return;
  }

  if (g.state === 'station' && g.gbrPhase === GbrPhase.ENTER_SERVICE_LANE) {
    const target = getGbrTarget(g) || g.chaseTarget;
    if (target && scalperIsGbrTarget(target) && scalperOnColumn(target)) {
      startArrest(g, target);
    }
    return;
  }

  if (g.state === 'pullIn' || g.state === 'pullOut') return;

  if (g.gbrPhase === GbrPhase.CHASE) {
    const sc2 = getGbrTarget(g);
    if (!sc2 || !scalperOnMap(sc2) || !scalperIsGbrTarget(sc2)) {
      releaseGbrTarget(g);
      setGbrPhase(g, GbrPhase.PATROL);
      g.stopS = null;
      return;
    }
    g.chaseTarget = sc2;
    if (scalperOnColumn(sc2)) {
      tryGbrApproach(g, sc2, dt, L);
      return;
    }
    g.maxV = gbrPatrolSpeed();
    g.stopS = mod(sc2.s - CONFIG.gbr.chaseFollowDist, L);
    return;
  }

  if (g.gbrPhase === GbrPhase.PATROL) {
    g.maxV = gbrPatrolSpeed();
    g.stopS = null;
    tickGbrMissionLap(g, L);
  }
}



function tickSpecialSpawns(dt) {

  if (CONFIG.bgTrafficEnabled) {

    Game.bgSpawnTimer = (Game.bgSpawnTimer || 0) - dt;

    if (Game.bgSpawnTimer <= 0 && Game.holder.length < CONFIG.holder.max) {

      Game.holder.push(makeBgCar());

      Game.bgSpawnTimer = currentSpawnInterval() * 2 * rand(.75, 1.25);

      onHolderChanged();

    }

  }

  Game.scalperTimer -= dt;

  if (Game.scalperTimer <= 0 && !Game.scalper.unit) {

    if (sortedStationSlots().length) {

      const sc = makeScalper();
      initScalperLifecycle(sc);
      setScalperPhase(sc, ScalperPhase.SPAWN);

      addToHolder(sc, { priority: false, countsForDefeat: false });

      Game.scalper.unit = sc;

      setScalperPhase(sc, ScalperPhase.DRIVING);

      Game.scalperTimer = scalperCooldown();

    } else {

      Game.scalperTimer = scalperCooldown();

    }

  }

}



function initGbrOnSpawn(g) {
  setGbrPhase(g, GbrPhase.PATROL);
  g.patrolLaps = 0;
  g.chaseTarget = null;
  g.targetScalperId = null;
}



export {
  updateScalperTour, updateScalperAtColumn, updateScalperWaiting,
  updateGBR, tickSpecialSpawns, initGbrOnSpawn, advanceScalperFromStation,
  decideAfterArrestExit, onGbrReturnPullOutComplete,
  beginGbrPullIn, tryGbrApproach, scalperIsGbrTarget, scalperOnMap,
  gbrSeesScalper, gbrTargetsInRange, startArrest, tryAttachScalperToStation
};


