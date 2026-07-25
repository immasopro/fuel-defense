import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road, pumpPose, apronPoseForRank, approachStopS } from '../world/roadNetwork.js';
import { mod, shortAngle } from '../core/utils.js';
import { laneGapFree, crossed } from '../vehicles/vehicle.js';
import { outerLaneList } from './trafficSystem.js';
import { finishFuel } from './economySystem.js';
import { refillCanisterReserve } from '../stations/reservoir.js';
import { cleanupVehicle, scanForStation, tryApproachPocket, tryApproachPullIn,
  beginLaneChange, beginPullOut, processStationPocket } from '../stations/stationQueue.js';
import { StationApi } from './stationApi.js';
import { ScalperPhase, GbrPhase } from './entityFsm.js';
import { ScalperOwner, completeStationExit, getScalperOwner, isScalperLeavingMap, updateScalpersLeavingMap } from './scalperLifecycle.js';
import {
  updateScalperTour, updateScalperAtColumn, updateScalperWaiting,
  updateGBR, tickSpecialSpawns, onGbrReturnPullOutComplete
} from './specialVehicles.js';
import {
  updateTankerDrive, updateTankerTechService, updateTankerDepotService,
  finishTankerPullOut, tryRemoveExitingTanker
} from './tankerSystem.js';

export function updateVehicles(dt, L) {
  const removeSet = new Set();
  updateScalpersLeavingMap(dt, L, removeSet);
  const outer = outerLaneList();
  for (const v of Game.vehicles) {
    if (removeSet.has(v)) continue;
    if (v.kind === 'gbr') updateGBR(v, dt, L, removeSet);
    if (removeSet.has(v)) continue;
    if (v.state === 'drive') {
      if (v.lane === 'inner') {
        if (v.kind === 'car') {
          if (!v.served && !v.pump && !v.pocketSlot && !v.angry && !v.overtake) {
            v.scanT -= dt;
            if (v.scanT <= 0) { v.scanT = 0.25; scanForStation(v); }
            if (!v.served && !v.pump && !v.pocketSlot && v.trip > CONFIG.giveUpLaps * L) v.angry = true;
          }
          if (!v.served && v.pocketSlot && !v.pump) tryApproachPocket(v, L);
          if (!v.served && v.pump) tryApproachPullIn(v, L);
          if (v.angry) {
            v.mergeT -= dt;
            if (v.mergeT <= 0) {
              v.mergeT = 0.3;
              if (laneGapFree(outer, mod(v.s + 14, L), v.len)) beginLaneChange(v);
            }
          }
        } else if (v.kind === 'scalper' && !isScalperLeavingMap(v)) {
          if (v.pocketSlot && !v.pump) tryApproachPocket(v, L);
          else if (v.pump) {
            const ctx = StationApi.getColumnContext(v);
            if (ctx && ctx.rank > 0) v.stopS = approachStopS(v.targetSlot);
            else tryApproachPullIn(v, L);
          } else updateScalperTour(v, dt, L);
        } else if (v.kind === 'tanker') {
          updateTankerDrive(v, dt, L, removeSet);
        }
      } else if (crossed(v, Road.spawnS)) {
        if (v.trip > 30) {
          if (v.kind === 'car' && v.served) Game.stats.served++;
          if (v.kind === 'tanker') tryRemoveExitingTanker(v, removeSet);
          else if (v.kind !== 'gbr') removeSet.add(v);
        }
      }
    } else if (v.state === 'depotDrive' && v.kind === 'tanker') {
      updateTankerDrive(v, dt, L, removeSet);
    } else if (v.state === 'pullIn') {
      v.animT += dt;
      if (v.animT >= v.animDur) {
        v.pose = { ...v.animTo };
        if (v.kind === 'tanker') v.state = v.serviceSlot ? 'tankerService' : 'tankerDepot';
        else v.state = 'station';
      }
    } else if (v.state === 'pocket') {
      if (!v.pocketSlot && v.animT >= v.animDur) {
        v.state = 'drive';
        v.pose = null;
        v.v = Math.max(v.v || 0, v.maxV * 0.35);
      }
      if (!v.pose || v.animT < v.animDur) {
        v.animT += dt;
        if (v.animT >= v.animDur) v.pose = { ...v.animTo };
      }
    } else if (v.state === 'tankerService') {
      updateTankerTechService(v, dt, L);
    } else if (v.state === 'tankerDepot') {
      updateTankerDepotService(v, dt, removeSet);
    } else if (v.state === 'station') {
      if (v.kind === 'scalper' && getScalperOwner(v) === ScalperOwner.ROAD) continue;
      if (v.kind === 'scalper') {
        updateScalperAtColumn(v, dt, L);
        continue;
      }
      if (v.kind === 'gbr') continue;
      const ctx = StationApi.getColumnContext(v);
      if (!ctx) {
        v.state = 'waitMerge';
        v.mergeT = 0;
        continue;
      }
      const { pump, st, rank } = ctx;
      const desired = apronPoseForRank(v.targetSlot, v.pumpJ, rank);
      const dx = desired.x - v.pose.x, dy = desired.y - v.pose.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1.5) {
        const step = Math.min(dist, CONFIG.pump.queueSpeed * dt);
        v.pose.x += dx / dist * step;
        v.pose.y += dy / dist * step;
        v.pose.a += shortAngle(desired.a - v.pose.a) * Math.min(1, dt * 6);
      } else if (rank === 0) {
        pump.serving = true;
        let d;
        if (pump.buffer > 0.01) {
          d = Math.min(pump.rate * CONFIG.pump.fastMult * dt, v.need - v.got, pump.buffer);
          pump.buffer -= d;
        } else {
          d = Math.min(pump.rate * dt, v.need - v.got, st.res);
          st.res -= d;
        }
        v.got += d;
        if (v.got >= v.need - 0.01 || (pump.buffer <= 0.01 && st.res <= 0.01)) finishFuel(v);
      }
    } else if (v.state === 'block' && v.kind === 'scalper') {
      updateScalperWaiting(v);
    } else if (v.state === 'waitMerge') {
      v.mergeT -= dt;
      if (v.mergeT <= 0) {
        v.mergeT = 0.25;
        const ms = mod(v.targetSlot.s + 16, L);
        if (laneGapFree(outer, ms, v.len)) beginPullOut(v, ms);
      }
    } else if (v.state === 'pullOut') {
      v.animT += dt;
      if (v.animT >= v.animDur) {
        if (v.kind === 'scalper' && v.stationExitActive) {
          completeStationExit(v);
        } else if (v.kind === 'gbr' && v.gbrPhase === GbrPhase.RETURNING && v.returnPullOut) {
          onGbrReturnPullOutComplete(v, L);
        } else if (v.kind === 'tanker') {
          finishTankerPullOut(v, L, removeSet);
        } else if (v.kind === 'car') {
          v.lane = 'outer';
          v.state = 'drive';
          v.s = v.exitS; v.prevS = v.s; v.v = 25;
          v.trip = 0; v.stopS = null;
          v.targetSlot = null; v.station = null; v.pump = null;
          v.pocketSlot = null;
          v.percGap = 1e9; v.percT = 0;
        } else {
          v.lane = v.tourIdx >= (v.tour ? v.tour.length : 0) ? 'outer' : 'inner';
          v.state = 'drive';
          v.s = v.exitS; v.prevS = v.s; v.v = 25;
          v.trip = 0; v.stopS = null;
          if (v.kind !== 'scalper' || v.scalperPhase === ScalperPhase.EXITING) {
            v.targetSlot = null; v.station = null; v.pump = null;
          }
          v.percGap = 1e9; v.percT = 0;
        }
      }
    }
    tryRemoveExitingTanker(v, removeSet);
  }
  for (const v of removeSet) cleanupVehicle(v);
  if (removeSet.size) Game.vehicles = Game.vehicles.filter(v => !removeSet.has(v));
}

export function postStationMaintenance(dt) {
  const bufMax = CONFIG.pump.bufferMax();
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st) continue;
    if (st.gbrAlarm > 0) st.gbrAlarm -= dt;
    processStationPocket(st, dt);
    refillCanisterReserve(st, dt);
    for (const pump of st.pumps) {
      if (!pump.serving && !pump.blocked && pump.buffer < bufMax - 0.01 && st.res > 0.01) {
        const amt = Math.min(bufMax / CONFIG.pump.bufferFillTime * dt, bufMax - pump.buffer, st.res);
        pump.buffer += amt;
        st.res -= amt;
      }
      pump.serving = false;
    }
  }
}

export { tickSpecialSpawns };
