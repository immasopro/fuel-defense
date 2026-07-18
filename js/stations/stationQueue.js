import { CONFIG } from '../config/index.js';
import { mod } from '../core/utils.js';
import { Road, pumpPose, apronPoseForRank, approachStopS, pocketEntryS,
  pocketPoseForRank, distAhead } from '../world/roadNetwork.js';
import { StationApi as SA } from '../systems/stationApi.js';

const repositionPocket = SA.repositionPocket;

function cleanupVehicle(v) {
  SA.cleanupVehicleStationLinks(v);
}

function releasePumpClaim(v, opts) {
  SA.releaseColumn(v, opts);
}

function releasePocket(v) {
  const wasPocketAnim = v.state === 'pocket';
  SA.releasePocketSlot(v);
  if (wasPocketAnim) {
    v.state = 'drive';
    v.pose = null;
    v.animT = 0;
    v.v = Math.max(v.v || 0, v.maxV * 0.35);
  }
  v.targetSlot = null;
  v.stopS = null;
  v.pocketWaitT = 0;
}

function promotePocket(st) {
  SA.promotePocket(st, st.slot);
}

function processStationPocket(st, dt) {
  SA.processPocket(st, dt);
}

function scanForStation(v) {
  if (v.served || v.kind !== 'car') return;
  if (v.pocketSlot || v.pump) return;
  const L = Road.length;
  let bestSlot = null, bestPocket = Infinity, bestD = Infinity;
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st || st.pocket.length >= CONFIG.station.pocketMax) continue;
    const d = mod(slot.s - v.s, L);
    if (d < 50) continue;
    if (!SA.stationHasFuelFor(v, st)) continue;
    const q = st.pocket.length;
    if (q < bestPocket || (q === bestPocket && d < bestD)) {
      bestPocket = q; bestD = d; bestSlot = slot;
    }
  }
  if (bestSlot) assignToPocket(v, bestSlot);
}

function assignToPocket(v, slot) {
  SA.joinStationWaitQueue(v, slot);
}

function releaseReservation(v) {
  SA.releaseReservation(v);
}

function poseForRank(v) {
  const ctx = SA.getColumnContext(v);
  const rank = ctx ? ctx.rank : 0;
  return apronPoseForRank(v.targetSlot, v.pumpJ, rank);
}

function wakePumpQueue(pump) {
  SA.wakePumpQueue(pump);
}

function tryApproachPullIn(v, L) {
  const ctx = SA.getColumnContext(v);
  if (!ctx || !v.targetSlot || v.overtake) return;
  const stopS = approachStopS(v.targetSlot);
  v.stopS = stopS;
  const d = distAhead(v.s, stopS, L);
  if (d < CONFIG.road.pullInDist) { beginPullIn(v); return; }
  if (d > L - CONFIG.road.passReleaseDist) { releaseReservation(v); return; }
  if (v.v < 1.5) {
    v.approachWait = (v.approachWait || 0) + (1 / 60);
    if (v.approachWait > CONFIG.road.forcePullInTime && d < CONFIG.road.forcePullInDist)
      beginPullIn(v);
  } else {
    v.approachWait = 0;
  }
}

function tryApproachPocket(v, L) {
  if (!v.pocketSlot || v.overtake || v.served) return;
  const entryS = pocketEntryS(v.pocketSlot);
  const d = distAhead(v.s, entryS, L);
  if (d < CONFIG.road.pullInDist) { beginPocketPullIn(v); return; }
  if (d > L - CONFIG.road.passReleaseDist) { releasePocket(v); return; }
  v.stopS = entryS;
}

function beginPocketPullIn(v) {
  const slot = v.pocketSlot;
  const rank = slot.station.pocket.indexOf(v);
  v.state = 'pocket';
  v.animT = 0;
  v.animDur = CONFIG.visual.pocketDur;
  const lat = Road.laneW / 2 + (v.latOff || 0);
  v.animFrom = Road.posAt(v.s, lat);
  v.animTo = pocketPoseForRank(slot, rank);
  v.v = 0; v.stopS = null; v.approachWait = 0;
}

function beginPullIn(v) {
  v.state = 'pullIn';
  v.animT = 0;
  v.animDur = CONFIG.visual.pullInDur + v.pumpJ * 0.06;
  const lat = Road.laneW / 2 + (v.latOff || 0);
  v.animFrom = Road.posAt(v.s, lat);
  v.animTo = poseForRank(v);
  v.v = 0; v.stopS = null; v.approachWait = 0;
}

function beginTankerPullIn(v, slot, pumpJ) {
  v.state = 'pullIn';
  v.animT = 0; v.animDur = 0.75;
  v.animFrom = Road.posAt(v.s, Road.laneW / 2);
  v.animTo = pumpPose(slot, pumpJ);
  v.pumpJ = pumpJ;
  v.unloadSlot = slot;
  v.targetSlot = slot;
  v.v = 0; v.stopS = null;
}

function beginPullOut(v, mergeS) {
  v.state = 'pullOut';
  v.animT = 0;
  v.animDur = CONFIG.visual.pullOutDur + v.pumpJ * 0.06;
  v.animFrom = { ...v.pose };
  v.animTo = Road.posAt(mergeS, -Road.laneW / 2);
  v.exitS = mergeS;
}

function beginLaneChange(v) {
  const exitS = mod(v.s + 14, Road.length);
  v.state = 'pullOut';
  v.animT = 0; v.animDur = CONFIG.visual.pullOutDur;
  v.animFrom = Road.posAt(v.s, Road.laneW / 2);
  v.animTo = Road.posAt(exitS, -Road.laneW / 2);
  v.exitS = exitS;
}

export { cleanupVehicle, releasePumpClaim, repositionPocket, releasePocket, promotePocket, processStationPocket, scanForStation, assignToPocket, releaseReservation, poseForRank, wakePumpQueue, tryApproachPullIn, tryApproachPocket, beginPocketPullIn, beginPullIn, beginTankerPullIn, beginPullOut, beginLaneChange };
