/** Логистика автопарка ГБР — v0.4.3: параллельная подготовка + cooldown выезда */

import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { FleetState } from './tankerLogistics.js';

const GBR_FLEET_MAX = 10;

function gbrFleetSize() {
  return Game.gbrBase.level;
}

function gbrPrepDuration() {
  return CONFIG.gbrBase.prepDuration;
}

function gbrDepartCooldown() {
  return CONFIG.gbr.departCooldown ?? 5;
}

function makeUnit(id, startPreparing) {
  if (startPreparing) {
    return { id, state: FleetState.PREPARING, prepT: gbrPrepDuration(), vehicle: null };
  }
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
  for (let i = 1; i <= n; i++) units.push(makeUnit(i, true));
  Game.gbrLogistics = { units, departCd: 0 };
}

function findUnit(id) {
  return Game.gbrLogistics?.units.find(u => u.id === id) || null;
}

/** @deprecated sequential prep removed in 0.4.3 — kept as no-op for callers */
export function tryStartNextGbrPrep() {
  return false;
}

export function tickGbrLogistics(dt) {
  const L = Game.gbrLogistics;
  if (!L) return;
  if (L.departCd > 0) L.departCd = Math.max(0, L.departCd - dt);
  for (const u of L.units) {
    if (u.state === FleetState.PREPARING) {
      u.prepT -= dt;
      if (u.prepT <= 0) {
        u.prepT = 0;
        u.state = FleetState.READY;
      }
    }
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

export function getDepartCooldown() {
  return Math.max(0, Game.gbrLogistics?.departCd || 0);
}

export function canDispatchGbr() {
  if (!Game.gbrLogistics) return false;
  if (!findReadyGbr()) return false;
  if (countGbrOnMap() >= gbrFleetSize()) return false;
  if (getDepartCooldown() > 0) return false;
  return true;
}

export function attachVehicleToGbr(unit, vehicle) {
  unit.vehicle = vehicle;
  unit.state = FleetState.ON_MISSION;
  vehicle.fleetId = unit.id;
  if (Game.gbrLogistics) {
    Game.gbrLogistics.departCd = gbrDepartCooldown();
  }
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
  unit.state = FleetState.PREPARING;
  unit.prepT = gbrPrepDuration();
}

export function onGbrBaseLevelUp() {
  const L = Game.gbrLogistics;
  if (!L) return;
  const n = gbrFleetSize();
  while (L.units.length < n) {
    L.units.push(makeUnit(L.units.length + 1, true));
  }
}

function gbrPanelStatusLabel(unit) {
  switch (unit.state) {
    case FleetState.READY:
      return 'READY';
    case FleetState.ON_MISSION:
      return 'ON MISSION';
    case FleetState.RETURNING:
      return 'RETURNING';
    case FleetState.PREPARING:
      return 'PREPARING (' + Math.ceil(unit.prepT) + ' с)';
    default:
      return 'WAITING';
  }
}

/** Ближайший таймер подготовки среди PREPARING (сек), если нет READY */
export function nearestGbrPrepSeconds() {
  if (findReadyGbr()) return null;
  let best = null;
  for (const u of Game.gbrLogistics?.units || []) {
    if (u.state === FleetState.PREPARING) {
      if (best == null || u.prepT < best) best = u.prepT;
    }
  }
  return best != null ? Math.max(0, best) : null;
}

/**
 * Состояние кнопки ГБР (A/B/C/D + cooldown).
 * @returns {{
 *   canCall: boolean,
 *   red: boolean,
 *   title: string,
 *   lines: string[],
 *   cost: number|null,
 *   reason: 'ready'|'raid'|'prep'|'cooldown'|'blocked'
 * }}
 */
export function getGbrButtonState(fmtCost) {
  const cost = gbrCallCost();
  const ready = !!findReadyGbr();
  const departCd = getDepartCooldown();
  const prep = nearestGbrPrepSeconds();
  const onRaid = countGbrOnMap() > 0;
  const canCall = canDispatchGbr();

  // READY + cooldown закончился → красная, цена (A / D)
  if (ready && departCd <= 0) {
    return {
      canCall: true,
      red: true,
      title: '🚨 ГБР',
      lines: [fmtCost(cost)],
      cost,
      reason: 'ready'
    };
  }

  // READY, но действует 5с cooldown выезда — UI показывает причину (cooldown)
  if (ready && departCd > 0) {
    return {
      canCall: false,
      red: false,
      title: onRaid ? '🚨 Рейд' : '🚨 ГБР',
      lines: [Math.ceil(departCd) + ' с'],
      cost,
      reason: 'cooldown'
    };
  }

  // Нет READY: идёт подготовка — UI показывает именно prep, не max(prep, cd)
  if (prep != null) {
    const secs = Math.max(1, Math.ceil(prep));
    return {
      canCall: false,
      red: false,
      title: onRaid ? '🚨 Рейд' : '🚨 ГБР',
      lines: onRaid ? ['Подготовка: ' + secs + ' с'] : [secs + ' с'],
      cost: null,
      reason: 'prep'
    };
  }

  // На рейде, никто не готовится и не READY (B)
  if (onRaid) {
    return {
      canCall: false,
      red: false,
      title: '🚨 Рейд',
      lines: [],
      cost: null,
      reason: 'raid'
    };
  }

  return {
    canCall: false,
    red: false,
    title: '🚨 ГБР',
    lines: [],
    cost: null,
    reason: 'blocked'
  };
}

/** Компактный текст кнопки (legacy + HUD) */
export function gbrButtonSub(fmtCost) {
  const st = getGbrButtonState(fmtCost);
  if (st.reason === 'ready') return st.lines.join('\n');
  if (st.reason === 'raid') return st.lines.length ? st.lines.join('\n') : '—';
  return st.lines.join('\n') || '—';
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
  unit.state = FleetState.READY;
  unit.prepT = 0;
  L.departCd = 0;
}

export function gbrBaseUpgradeCost() {
  return Game.gbrBase.level >= GBR_FLEET_MAX
    ? null : CONFIG.gbrBase.upgradeCosts[Game.gbrBase.level - 1];
}

export { gbrFleetSize, findUnit, GBR_FLEET_MAX };
