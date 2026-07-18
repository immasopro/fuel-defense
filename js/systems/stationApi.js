/**

 * Единственный модуль, изменяющий очереди колонок и карманы АЗС.

 * Остальные системы вызывают только эти методы.

 */

import { CONFIG } from '../config/index.js';

import { Game } from '../core/gameState.js';

import { Road, approachStopS, apronPoseForRank, pocketEntryS, pocketPoseForRank } from '../world/roadNetwork.js';

import { findFreePump } from '../world/map.js';

import { setScalperPhase, ScalperPhase } from './entityFsm.js';



function wakePumpQueue(pump) {

  if (!pump || !pump.cars.length) return;

  for (const car of pump.cars) {

    if (car.state === 'drive') {

      car.approachWait = 0;

      car.stopS = approachStopS(car.targetSlot);

    }

  }

}



function pumpRank(pump, vehicle) {

  return Math.max(0, pump.cars.indexOf(vehicle));

}



function claimColumn(st, vehicle, pumpJ) {

  const pump = st.pumps[pumpJ];

  if (!pump) return false;

  const inQueue = pump.cars.includes(vehicle);

  if (!inQueue && pump.cars.length >= CONFIG.pump.queueMax) return false;

  if (!inQueue) pump.cars.push(vehicle);

  vehicle.pump = pump;

  vehicle.pumpJ = pumpJ;

  vehicle.station = st;

  return true;

}



function releaseColumn(vehicle, opts) {

  opts = opts || {};

  const pump = vehicle.pump;

  if (!pump) {

    vehicle.pumpJ = 0;

    return null;

  }

  if (opts.unblock) pump.blocked = false;

  pump.serving = false;

  const i = pump.cars.indexOf(vehicle);

  if (i >= 0) pump.cars.splice(i, 1);

  wakePumpQueue(pump);

  vehicle.pump = null;

  vehicle.pumpJ = 0;

  return pump;

}



function enqueuePocket(vehicle, slot) {

  if (vehicle.pocketSlot) return false;

  const st = slot.station;

  if (!st || st.pocket.length >= CONFIG.station.pocketMax) return false;

  st.pocket.push(vehicle);

  vehicle.pocketSlot = slot;

  vehicle.targetSlot = slot;

  vehicle.stopS = pocketEntryS(slot);

  vehicle.approachWait = 0;

  return true;

}



function releasePocketSlot(vehicle) {

  const slot = vehicle.pocketSlot;

  if (!slot) return;

  const st = slot.station;

  const i = st.pocket.indexOf(vehicle);

  if (i >= 0) st.pocket.splice(i, 1);

  vehicle.pocketSlot = null;

  repositionPocket(st);

}



function repositionPocket(st) {

  for (let i = 0; i < st.pocket.length; i++) {

    const car = st.pocket[i];

    if (car.state === 'pocket' && car.pose && car.animT >= car.animDur)

      car.pose = pocketPoseForRank(st.slot, i);

  }

}



function stationHasFuelFor(vehicle, st) {

  const fuelKey = vehicle.fuelKey;

  if (!fuelKey) return false;

  for (const pump of st.pumps) {

    if (pump.fuel !== fuelKey || pump.blocked) continue;

    if (st.res + pump.buffer < CONFIG.station.minReserve) continue;

    return true;

  }

  return false;

}



/** Единая постановка в очередь АЗС — карман ожидания (клиенты и перекупы) */

function joinStationWaitQueue(vehicle, slot) {

  const st = slot?.station;

  if (!st) return false;

  if (!stationHasFuelFor(vehicle, st)) return false;

  return enqueuePocket(vehicle, slot);
}



function promotePocket(st, slot) {

  for (let pi = 0; pi < st.pocket.length; pi++) {

    const v = st.pocket[pi];

    if (v.state !== 'pocket' || !v.pose || v.animT < v.animDur) continue;

    let bestJ = -1, bestQ = Infinity;

    for (let j = 0; j < st.pumps.length; j++) {

      const pump = st.pumps[j];

      if (pump.fuel !== v.fuelKey || pump.blocked) continue;

      if (pump.serving) continue;

      if (pump.cars.length >= CONFIG.pump.queueMax) continue;

      if (st.res + pump.buffer < CONFIG.station.minReserve) continue;

      const q = pump.cars.length;

      if (q < bestQ) { bestQ = q; bestJ = j; }

    }

    if (bestJ < 0) continue;

    st.pocket.splice(pi, 1);

    claimColumn(st, v, bestJ);

    v.pocketSlot = null;

    v.pocketWaitT = 0;

    v.state = 'pullIn';

    v.animT = 0;

    v.animDur = CONFIG.visual.pullInDur;

    v.animFrom = { ...v.pose };

    v.animTo = apronPoseForRank(slot, bestJ, pumpRank(st.pumps[bestJ], v));

    v.v = 0;

    v.stopS = null;

    repositionPocket(st);

    return true;

  }

  return false;

}



function processPocket(st, dt) {

  st.pocket = st.pocket.filter(c => {

    if (!Game.vehicles.includes(c)) return false;

    if (c.kind === 'scalper') return true;

    return !c.served;

  });

  for (const v of st.pocket) {

    if (v.state === 'pocket') {

      v.pocketWaitT = (v.pocketWaitT || 0) + dt;

      if (v.pocketWaitT > CONFIG.station.pocketMaxWait) {

        releasePocketSlot(v);

        if (v.kind === 'car') {

          v.angry = true;

          v.scanT = 0.2;

        } else {

          v.tourIdx++;

          v.targetSlot = null;

        }

      }

    }

  }

  promotePocket(st, st.slot);

}



function vehicleQueueTag(v, idx) {

  const kind = v.kind === 'scalper' ? 'S' : v.kind === 'car' ? 'C' : v.kind[0].toUpperCase();

  return kind + idx;

}



function stationQueueDebugLines() {

  const lines = [];

  for (const slot of Road.slots) {

    const st = slot.station;

    if (!st) continue;

    const pocketIds = st.pocket.map((v, i) => vehicleQueueTag(v, i + 1)).join(' → ') || '—';

    lines.push('АЗС #' + (slot.i + 1) + ' карман[' + st.pocket.length + ']: ' + pocketIds);

    st.pumps.forEach((pump, j) => {

      const order = pump.cars.map((v, i) => {

        const tag = vehicleQueueTag(v, i + 1);

        return pump.serving && i === 0 ? tag + '*' : tag;

      }).join(' → ') || '—';

      const svc = pump.serving ? ' ОБСЛ' : '';

      lines.push('  К' + (j + 1) + ' очередь[' + pump.cars.length + ']' + svc + ': ' + order);

    });

  }

  return lines;

}



function findDealerPumpForFuel(st, fuelKey) {

  let bestJ = -1, bestQ = Infinity;

  for (let j = 0; j < st.pumps.length; j++) {

    const pump = st.pumps[j];

    if (pump.fuel !== fuelKey || pump.blocked) continue;

    if (pump.serving) continue;

    if (pump.cars.length >= CONFIG.pump.queueMax) continue;

    if (st.res + pump.buffer < CONFIG.station.minReserve) continue;

    const q = pump.cars.length;

    if (q < bestQ) { bestQ = q; bestJ = j; }

  }

  return bestJ;

}



function findDealerPump(st, preferCanister) {

  let pj = -1;

  if (preferCanister) pj = findFreePump(st);

  if (pj < 0) pj = findFreePump(st);

  if (pj < 0) {

    for (let j = 0; j < st.pumps.length; j++) {

      if (!st.pumps[j].blocked) { pj = j; break; }

    }

  }

  if (pj < 0) pj = 0;

  return pj;

}



function detachDealer(sc) {

  releaseColumn(sc, { unblock: true });

  releasePocketSlot(sc);

  sc.targetSlot = null;

  sc.station = null;

  sc.stopS = null;

  sc.waitReserve = false;

}



function removeDealer(sc, removeSet, early, onClaw) {

  releaseColumn(sc, { unblock: true });

  releasePocketSlot(sc);

  sc.targetSlot = null;

  sc.station = null;

  sc.stopS = null;

  sc.pump = null;

  sc.pumpJ = 0;

  sc.state = 'action';

  setScalperPhase(sc, ScalperPhase.ARRESTING);

  if (early && sc.totalGot > 0 && onClaw) onClaw(sc);

  removeSet.add(sc);

  if (Game.scalper.unit === sc) Game.scalper.unit = null;

}



function releaseReservation(vehicle) {

  releaseColumn(vehicle);

  releasePocketSlot(vehicle);

  vehicle.station = null;

  vehicle.targetSlot = null;

  vehicle.stopS = null;

}



function cleanupVehicleStationLinks(v) {

  releaseColumn(v, { unblock: true });

  releasePocketSlot(v);

  for (const slot of Road.slots) {

    const st = slot.station;

    if (!st) continue;

    const pi = st.pocket.indexOf(v);

    if (pi >= 0) {

      st.pocket.splice(pi, 1);

      repositionPocket(st);

    }

  }

  v.pump = null;

  v.pocketSlot = null;

  v.station = null;

  v.targetSlot = null;

  v.stopS = null;

}



function getColumnContext(vehicle) {

  const pump = vehicle.pump;

  const st = vehicle.station;

  if (!pump || !st) return null;

  if (!pump.cars.includes(vehicle)) return null;

  return { pump, st, rank: pumpRank(pump, vehicle) };

}



function claimTankerColumn(st, vehicle) {

  const pj = findFreePump(st);

  if (pj < 0) return -1;

  claimColumn(st, vehicle, pj);

  return pj;

}



export const StationApi = {

  wakePumpQueue,

  pumpRank,

  claimColumn,

  releaseColumn,

  enqueuePocket,

  releasePocketSlot,

  repositionPocket,

  promotePocket,

  processPocket,

  joinStationWaitQueue,

  stationHasFuelFor,

  findDealerPump,

  findDealerPumpForFuel,

  detachDealer,

  removeDealer,

  releaseReservation,

  cleanupVehicleStationLinks,

  getColumnContext,

  claimTankerColumn,

  stationQueueDebugLines,

  vehicleQueueTag

};


