import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { FleetState } from './tankerLogistics.js';

const GBR_FLEET_MAX = 10;

function gbrFleetSize() {
  return Game.gbrBase.level;
}

function makeUnit(id) {
  return { id, state: FleetState.WAIT_PREPARING, prepT: 0, vehicle: null };
}

export function gbrPatrolSpeed() {
  return CONFIG.gbrBase.speeds[Game.gbrBase.level - 1];
}

export function countGbrOnMission() {
  if (!Game.gbrLogistics) return 0;
  return Game.gbrLogistics.units.filter(u => u.state === FleetState.ON_MISSION).length;
}

export function gbrCallCost() {
  return CONFIG.gbrBase.baseCallCost * (countGbrOnMission() + 1);
}

export function initGbrLogistics() {
  const n = gbrFleetSize();
  const units = [];
  for (let i = 1; i <= n; i++) units.push(makeUnit(i));
  Game.gbrLogistics = { prepSlot: null, units };
  tryStartNextGbrPrep();
}

function findUnit(id) {
  return Game.gbrLogistics?.units.find(u => u.id === id) || null;
}

function unitOnPrepPost() {
  if (!Game.gbrLogistics?.prepSlot) return null;
  return findUnit(Game.gbrLogistics.prepSlot);
}

export function tryStartNextGbrPrep() {
  const L = Game.gbrLogistics;
  if (!L || L.prepSlot != null) return false;
  const next = L.units.find(u => u.state === FleetState.WAIT_PREPARING);
  if (!next) return false;
  next.state = FleetState.PREPARING;
  next.prepT = CONFIG.gbrBase.prepDuration;
  L.prepSlot = next.id;
  return true;
}

export function tickGbrLogistics(dt) {
  const L = Game.gbrLogistics;
  if (!L) return;
  sanitizeGbrPrepSlot();
  const onPost = unitOnPrepPost();
  if (onPost && onPost.state === FleetState.PREPARING) {
    onPost.prepT -= dt;
    if (onPost.prepT <= 0) {
      onPost.prepT = 0;
      onPost.state = FleetState.READY;
    }
  }
  if (!L.prepSlot) tryStartNextGbrPrep();
}

function sanitizeGbrPrepSlot() {
  const L = Game.gbrLogistics;
  if (!L?.prepSlot) return;
  const u = findUnit(L.prepSlot);
  if (!u || (u.state !== FleetState.PREPARING && u.state !== FleetState.READY)) {
    L.prepSlot = null;
  }
}

export function findReadyGbr() {
  return Game.gbrLogistics?.units.find(u => u.state === FleetState.READY) || null;
}

export function countGbrOnMap() {
  if (!Game.gbrLogistics) return 0;
  return Game.gbrLogistics.units.filter(u =>
    u.state === FleetState.ON_MISSION || u.state === FleetState.RETURNING
  ).length;
}

export function canDispatchGbr() {
  if (!Game.gbrLogistics) return false;
  if (!findReadyGbr()) return false;
  if (countGbrOnMap() >= gbrFleetSize()) return false;
  return true;
}

export function attachVehicleToGbr(unit, vehicle) {
  unit.vehicle = vehicle;
  unit.state = FleetState.ON_MISSION;
  Game.gbrLogistics.prepSlot = null;
  vehicle.fleetId = unit.id;
  sanitizeGbrPrepSlot();
  tryStartNextGbrPrep();
}

export function notifyGbrReturning(fleetId) {
  const unit = findUnit(fleetId);
  if (unit && unit.state === FleetState.ON_MISSION) {
    unit.state = FleetState.RETURNING;
  }
}

export function onGbrMissionComplete(fleetId) {
  const unit = findUnit(fleetId);
  if (!unit) return;
  unit.vehicle = null;
  unit.state = FleetState.WAIT_PREPARING;
  unit.prepT = 0;
  sanitizeGbrPrepSlot();
  tryStartNextGbrPrep();
}

export function onGbrBaseLevelUp() {
  const L = Game.gbrLogistics;
  if (!L) return;
  const n = gbrFleetSize();
  while (L.units.length < n) {
    L.units.push(makeUnit(L.units.length + 1));
  }
  tryStartNextGbrPrep();
}

function gbrPanelStatusLabel(unit) {
  switch (unit.state) {
    case FleetState.READY:
      return 'READY';
    case FleetState.ON_MISSION:
      return 'ON MISSION';
    case FleetState.RETURNING:
      return 'ON MISSION';
    case FleetState.PREPARING:
      return 'PREPARING (' + Math.ceil(unit.prepT) + ' с)';
    default:
      return 'WAITING';
  }
}

/** Ближайший таймер подготовки (сек), если нет READY */
export function nearestGbrPrepSeconds() {
  if (findReadyGbr()) return null;
  const onPost = unitOnPrepPost();
  if (onPost?.state === FleetState.PREPARING) return Math.max(0, onPost.prepT);
  return null;
}

/** Компактный текст кнопки: стоимость + READY или таймер */
export function gbrButtonSub(fmtCost) {
  const lines = [fmtCost(gbrCallCost())];
  if (findReadyGbr()) {
    lines.push('READY');
  } else {
    const prep = nearestGbrPrepSeconds();
    if (prep != null) lines.push('Подготовка: ' + Math.ceil(prep) + ' с');
  }
  return lines.join('\n');
}

/** Полный автопарк для панели базы ГБР */
export function gbrFleetPanelLines() {
  const lines = [];
  const owned = gbrFleetSize();
  for (let i = 1; i <= GBR_FLEET_MAX; i++) {
    const unit = Game.gbrLogistics?.units.find(u => u.id === i);
    if (!unit || i > owned) {
      lines.push('🚓 №' + i + '   Не приобретён');
      continue;
    }
    lines.push('🚓 №' + unit.id + '   ' + gbrPanelStatusLabel(unit));
  }
  return lines;
}

export function forceGbrReadyForTests(unitId = 1) {
  const L = Game.gbrLogistics;
  if (!L) initGbrLogistics();
  const unit = findUnit(unitId);
  if (!unit) return;
  if (L.prepSlot != null && L.prepSlot !== unitId) {
    const other = findUnit(L.prepSlot);
    if (other) {
      other.state = FleetState.WAIT_PREPARING;
      other.prepT = 0;
    }
  }
  unit.state = FleetState.READY;
  unit.prepT = 0;
  L.prepSlot = unitId;
}

export function gbrBaseUpgradeCost() {
  return Game.gbrBase.level >= GBR_FLEET_MAX
    ? null : CONFIG.gbrBase.upgradeCosts[Game.gbrBase.level - 1];
}

export { gbrFleetSize, findUnit, GBR_FLEET_MAX };
