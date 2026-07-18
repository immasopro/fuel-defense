import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';

export const FleetState = {
  WAIT_PREPARING: 'WAIT_PREPARING',
  PREPARING: 'PREPARING',
  READY: 'READY',
  ON_MISSION: 'ON_MISSION',
  RETURNING: 'RETURNING'
};

function fleetMaxCount() {
  return CONFIG.fleet.maxCount[Game.fleet.level - 1];
}

function ownedTruckCount() {
  return fleetMaxCount();
}

function makeTruck(id) {
  return { id, state: FleetState.WAIT_PREPARING, prepT: 0, vehicle: null };
}

export function initLogistics() {
  const n = ownedTruckCount();
  const trucks = [];
  for (let i = 1; i <= 3; i++) {
    if (i <= n) trucks.push(makeTruck(i));
  }
  Game.logistics = { prepSlot: null, trucks };
  tryStartNextPrep();
}

function findTruck(id) {
  return Game.logistics?.trucks.find(t => t.id === id) || null;
}

function truckOnPrepPost() {
  if (!Game.logistics?.prepSlot) return null;
  return findTruck(Game.logistics.prepSlot);
}

export function tryStartNextPrep() {
  const L = Game.logistics;
  if (!L || L.prepSlot != null) return false;
  const next = L.trucks.find(t => t.state === FleetState.WAIT_PREPARING);
  if (!next) return false;
  next.state = FleetState.PREPARING;
  next.prepT = CONFIG.logistics.prepDuration;
  L.prepSlot = next.id;
  return true;
}

export function tickTankerLogistics(dt) {
  const L = Game.logistics;
  if (!L) return;
  sanitizePrepSlot();
  const onPost = truckOnPrepPost();
  if (onPost && onPost.state === FleetState.PREPARING) {
    onPost.prepT -= dt;
    if (onPost.prepT <= 0) {
      onPost.prepT = 0;
      onPost.state = FleetState.READY;
    }
  }
  if (!L.prepSlot) tryStartNextPrep();
}

export function findReadyTruck() {
  return Game.logistics?.trucks.find(t => t.state === FleetState.READY) || null;
}

export function countTrucksOnMap() {
  if (!Game.logistics) return 0;
  return Game.logistics.trucks.filter(t =>
    t.state === FleetState.ON_MISSION || t.state === FleetState.RETURNING
  ).length;
}

export function hasActiveTankerDelivery() {
  return countTrucksOnMap() > 0;
}

export function hasReadyTanker() {
  return !!findReadyTruck();
}

export function canDispatchTanker() {
  if (!Game.logistics) return false;
  if (!findReadyTruck()) return false;
  if (countTrucksOnMap() >= fleetMaxCount()) return false;
  return true;
}

export function attachVehicleToTruck(truck, vehicle) {
  truck.vehicle = vehicle;
  truck.state = FleetState.ON_MISSION;
  Game.logistics.prepSlot = null;
  vehicle.fleetId = truck.id;
  sanitizePrepSlot();
  tryStartNextPrep();
}

export function notifyTankerReturning(fleetId) {
  const truck = findTruck(fleetId);
  if (truck && truck.state === FleetState.ON_MISSION) {
    truck.state = FleetState.RETURNING;
  }
}

export function onTankerMissionComplete(fleetId) {
  const truck = findTruck(fleetId);
  if (!truck) return;
  truck.vehicle = null;
  truck.state = FleetState.WAIT_PREPARING;
  truck.prepT = 0;
  sanitizePrepSlot();
  tryStartNextPrep();
}

function sanitizePrepSlot() {
  const L = Game.logistics;
  if (!L?.prepSlot) return;
  const t = findTruck(L.prepSlot);
  if (!t || (t.state !== FleetState.PREPARING && t.state !== FleetState.READY)) {
    L.prepSlot = null;
  }
}

/** Ближайший таймер подготовки (сек), если нет READY */
export function nearestTankerPrepSeconds() {
  const L = Game.logistics;
  if (!L) return null;
  if (findReadyTruck()) return null;
  const onPost = truckOnPrepPost();
  if (onPost?.state === FleetState.PREPARING) return Math.max(0, onPost.prepT);
  return null;
}

/** Строки для кнопки вызова: стоимость + таймер или «Готов» */
export function tankerButtonSub(costRub, fmtCost) {
  const lines = [fmtCost(costRub)];
  if (findReadyTruck()) {
    lines.push('Готов');
  } else {
    const prep = nearestTankerPrepSeconds();
    if (prep != null) lines.push('Подготовка: ' + Math.ceil(prep) + ' с');
  }
  return lines.join('\n');
}

/** Полный список для DBG */
export function fleetDebugLines() {
  const lines = ['=== Tankers ==='];
  const owned = ownedTruckCount();
  for (let i = 1; i <= 3; i++) {
    const truck = Game.logistics?.trucks.find(t => t.id === i);
    if (!truck || i > owned) {
      lines.push('#' + i + ' NOT PURCHASED');
      continue;
    }
    let status;
    switch (truck.state) {
      case FleetState.READY:
        status = 'READY';
        break;
      case FleetState.PREPARING:
        status = 'PREPARING (' + Math.ceil(truck.prepT) + ' c)';
        break;
      case FleetState.ON_MISSION:
        status = 'ON_MISSION';
        break;
      case FleetState.RETURNING:
        status = 'RETURNING';
        break;
      default:
        status = 'WAITING';
        break;
    }
    lines.push('#' + truck.id + ' ' + status);
  }
  return lines;
}

export function onFleetLevelUp() {
  const L = Game.logistics;
  if (!L) return;
  const n = ownedTruckCount();
  while (L.trucks.length < n) {
    L.trucks.push(makeTruck(L.trucks.length + 1));
  }
  tryStartNextPrep();
}

export function fleetHudLines() {
  const lines = [];
  const owned = ownedTruckCount();
  for (let i = 1; i <= 3; i++) {
    const truck = Game.logistics?.trucks.find(t => t.id === i);
    if (!truck || i > owned) {
      lines.push('🚚 №' + i + '   Не приобретён');
      continue;
    }
    let status;
    switch (truck.state) {
      case FleetState.READY:
        status = 'READY';
        break;
      case FleetState.ON_MISSION:
      case FleetState.RETURNING:
        status = 'В пути';
        break;
      case FleetState.PREPARING:
        status = 'Подготовка ' + Math.ceil(truck.prepT) + ' с';
        break;
      default:
        status = 'Ожидание';
        break;
    }
    lines.push('🚚 №' + truck.id + '   ' + status);
  }
  return lines;
}

/** Тестовый хелпер: сразу перевести №1 в READY */
export function forceTankerReadyForTests(truckId = 1) {
  const L = Game.logistics;
  if (!L) initLogistics();
  const truck = findTruck(truckId);
  if (!truck) return;
  if (L.prepSlot != null && L.prepSlot !== truckId) {
    const other = findTruck(L.prepSlot);
    if (other) {
      other.state = FleetState.WAIT_PREPARING;
      other.prepT = 0;
    }
  }
  truck.state = FleetState.READY;
  truck.prepT = 0;
  L.prepSlot = truckId;
}

export { fleetMaxCount, ownedTruckCount, findTruck };
