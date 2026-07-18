import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { sortedStationSlots } from '../world/map.js';
import { tankerTruckCapacity } from '../systems/economySystem.js';
import { tankerTour, buildTankerManifest, initTankerRoute } from '../systems/tankerSystem.js';
import { currentScalperMaxLiters } from '../systems/scalperEvolution.js';
import { gbrPatrolSpeed } from '../systems/gbrLogistics.js';
import { TankerPhase } from '../systems/entityFsm.js';
import { rand, weightedPick, lerp } from '../core/utils.js';
import { baseVehicle } from './vehicle.js';

function rollCanister(typeKey) {
  if (Math.random() >= CONFIG.canister.prob) return null;
  if (typeKey === 'sedan') return { liters: CONFIG.canister.red, color: 'red' };
  if (typeKey === 'suv') return Math.random() < 0.5
    ? { liters: CONFIG.canister.red, color: 'red' }
    : { liters: CONFIG.canister.green, color: 'green' };
  return null;
}

function pickClientType(diff) {
  if (Game.stats.served < CONFIG.truckUnlockAt) {
    return weightedPick({ sedan: 0.5, suv: 0.5 });
  }
  const truckW = lerp(0.08, 0.28, diff);
  const rest = 1 - truckW;
  return weightedPick({ sedan: rest * 0.55, suv: rest * 0.45, truck: truckW });
}

function pickClientFuel(typeKey) {
  if (typeKey === 'truck') return 'diesel';
  if (Math.random() < 0.34) return 'diesel';
  return Math.random() < 0.67 ? 'a92' : 'a95';
}

function makeCar(diff) {
  const typeKey = pickClientType(diff);
  const fuelKey = pickClientFuel(typeKey);
  const T = CONFIG.carTypes[typeKey];
  const need = T.tank * rand(CONFIG.needMin, CONFIG.needMax);
  const can = rollCanister(typeKey);
  return baseVehicle('car', {
    typeKey, fuelKey,
    canister: !!can, canisterLiters: can ? can.liters : 0, canisterColor: can ? can.color : null,
    canisterGot: 0, canisterPaid: false,
    len: T.len, w: T.w, maxV: T.maxV * rand(.92, 1.08), accel: T.accel, brake: T.brake,
    v: T.maxV * .5, tank: T.tank, need, got: 0
  });
}

function pickScalperFuel() {
  const fuels = new Set();
  for (const slot of sortedStationSlots()) {
    for (const key of slot.station.unlocked) fuels.add(key);
  }
  const list = [...fuels];
  if (!list.length) return 'a92';
  return list[Math.floor(Math.random() * list.length)];
}

function scalperTourFor(fuelKey) {
  return sortedStationSlots().filter(slot => slot.station.unlocked.includes(fuelKey));
}

function makeScalper() {
  const C = CONFIG.scalper;
  const fuelKey = pickScalperFuel();
  const tour = scalperTourFor(fuelKey);
  const maxLiters = currentScalperMaxLiters();
  return baseVehicle('scalper', {
    fuelKey,
    len: C.len, w: 10, maxV: C.speed, accel: C.accel, brake: C.brake, v: C.speed * .4,
    tour, tourIdx: 0, totalGot: 0, maxLiters,
    targetSlot: null, pump: null, pumpJ: 0, waitReserve: false,
    scalperId: null, wanted: false, pursuedBy: null, alarmStationId: null, crimeStarted: false,
    scalperOwner: 'special', stationExitActive: false, stationExitReason: null
  });
}

function makeTanker(fleetId) {
  const C = CONFIG.tanker;
  const cap = tankerTruckCapacity();
  const t = baseVehicle('tanker', {
    len: C.len, w: 12, maxV: C.speed, accel: 28, brake: 70, v: C.speed * .4,
    load: cap, capacity: cap, react: .25,
    tour: tankerTour(), tourIdx: 0, depotLeg: 0,
    tankerPhase: TankerPhase.SPAWNING,
    fleetId: fleetId || null
  });
  initTankerRoute(t);
  return t;
}

function makeGBR(fleetId) {
  const C = CONFIG.gbr;
  const speed = gbrPatrolSpeed();
  return baseVehicle('gbr', {
    lane: 'inner', len: C.len, w: 10, maxV: speed, accel: C.accel, brake: C.brake,
    v: speed * .4, react: .08,
    target: null, towT: 0, towTotal: C.towTime, towProgress: 0,
    fleetId: fleetId || null, targetScalperId: null, chaseTarget: null
  });
}

function makeBgCar() {
  const typeKey = weightedPick({ sedan: .5, suv: .35, truck: .15 });
  const T = CONFIG.carTypes[typeKey];
  return baseVehicle('bg', {
    typeKey, laps: 0, exitAfterLap: false,
    len: T.len, w: T.w, maxV: T.maxV * rand(.9, 1.05), accel: T.accel, brake: T.brake,
    v: T.maxV * .45
  });
}

export {
  rollCanister, pickClientType, pickClientFuel, pickScalperFuel, scalperTourFor,
  makeCar, makeScalper, makeTanker, makeGBR, makeBgCar
};
