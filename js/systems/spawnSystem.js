import { CONFIG } from '../config/index.js';
import {
  SPAWN_START_INTERVAL, SPAWN_RAMP_FRAC, ENDLESS_SPAWN, campaignMaxSpawnInterval
} from '../config/levels.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { GBRBase, sortedStationSlots, Depot } from '../world/map.js';
import { clamp01, rand } from '../core/utils.js';
import { makeCar, makeTanker } from '../vehicles/vehicleFactory.js';
import { setTankerPhase, TankerPhase } from './entityFsm.js';
import { addToHolder, onHolderChanged, fillHolderSlot } from './trafficSystem.js';
import { addFloat, tankerDeliveryCost, tankerDeliveryLiters, canOrderTanker } from './economySystem.js';
import { fmtRubDelta, fmtRub } from '../core/currency.js';
import {
  canDispatchTanker, findReadyTruck, attachVehicleToTruck
} from './tankerLogistics.js';
import {
  canDispatchGbr, gbrCallCost
} from './gbrLogistics.js';
import { manualCallGbr } from './gbrPursuit.js';
import { saveRunEconomy } from './runEconomySave.js';

/** Фазы кампании: SPAWNING → DRAINING → RESULT (win/over). */
const LevelPhase = {
  SPAWNING: 'SPAWNING',
  DRAINING: 'DRAINING'
};

function hasLevelTarget() {
  return Game.mode === 'campaign';
}

function getTargetCars() {
  if (!hasLevelTarget()) return null;
  return Game.modeCfg.targetCars;
}

function getEndSpawnInterval() {
  if (Game.mode === 'endless') return ENDLESS_SPAWN.minInterval;
  return campaignMaxSpawnInterval(Game.levelIdx || 1);
}

function getSpawnBudget() {
  return getTargetCars();
}

function getSpawnedCars() {
  return Game.stats.spawned || 0;
}

/** Клиентский трафик уровня (не GBR / tanker / bg). */
function isLevelTrafficVehicle(v) {
  if (!v) return false;
  if (v.kind === 'car') return true;
  if (v.kind === 'scalper' || v.isScalper) return true;
  if (v.kind === 'corporate') return true;
  return false;
}

/** Автомобили уровня на кольце + в накопителе + prepared. */
function countVehiclesOnMap() {
  let n = 0;
  for (const v of Game.vehicles || []) {
    if (isLevelTrafficVehicle(v)) n++;
  }
  for (const v of Game.holder || []) {
    if (isLevelTrafficVehicle(v)) n++;
  }
  if (Game.holderPriorityWait && isLevelTrafficVehicle(Game.holderPriorityWait)) n++;
  if (Game.prepared?.vehicle && isLevelTrafficVehicle(Game.prepared.vehicle)) n++;
  else if (Game.prepared && !Game.prepared.ready) n++;
  return n;
}

/** Общий бюджет: обычные + Scalper + будущие special. */
function canSpawnMoreCars() {
  const budget = getSpawnBudget();
  if (budget == null) return true;
  return getSpawnedCars() < budget;
}

function canSpawnRegularCar() {
  return canSpawnMoreCars();
}

/** Scalper занимает тот же слот бюджета, что и обычная машина (v0.4.3.3). */
function canSpawnScalper() {
  return canSpawnMoreCars();
}

function registerSpawnedCar() {
  Game.stats.spawned = getSpawnedCars() + 1;
  syncLevelPhase();
}

function syncLevelPhase() {
  if (!hasLevelTarget()) {
    Game.levelPhase = LevelPhase.SPAWNING;
    return Game.levelPhase;
  }
  const target = getTargetCars();
  if (target != null && getSpawnedCars() >= target) {
    Game.levelPhase = LevelPhase.DRAINING;
  } else {
    Game.levelPhase = LevelPhase.SPAWNING;
  }
  return Game.levelPhase;
}

function isLevelDraining() {
  return Game.levelPhase === LevelPhase.DRAINING;
}

/** 0…1 — разгон спавна. Кампания: по spawned; endless: по served. */
function spawnRampProgress() {
  if (Game.mode === 'endless') {
    return clamp01(Game.stats.served / ENDLESS_SPAWN.rampCars);
  }
  const target = getTargetCars();
  if (!target) return 0;
  const p = getSpawnedCars() / target;
  if (p >= SPAWN_RAMP_FRAC) return 1;
  return clamp01(p / SPAWN_RAMP_FRAC);
}

function levelProgress() {
  if (Game.mode === 'endless') {
    return clamp01(Game.stats.served / ENDLESS_SPAWN.rampCars);
  }
  const target = getTargetCars();
  if (!target) return 0;
  return clamp01(getSpawnedCars() / target);
}

function currentDiff() {
  return levelProgress();
}

function currentSpawnInterval() {
  const start = SPAWN_START_INTERVAL;
  const end = getEndSpawnInterval();
  const ramp = spawnRampProgress();
  return start - (start - end) * ramp;
}

/** HUD прогресса: кампания — spawned/target; endless — served. */
function getServedHudText() {
  if (Game.mode === 'endless') {
    return Game.stats.served + ' обслужено';
  }
  const target = getTargetCars();
  const phase = Game.levelPhase === LevelPhase.DRAINING ? ' · слив' : '';
  return getSpawnedCars() + ' / ' + target + phase;
}

function spawnRegularCar(diff) {
  if (!canSpawnRegularCar()) return null;
  const car = makeCar(diff);
  registerSpawnedCar();
  return car;
}

function tickSpawnPipeline(dt, diff) {
  if (isLevelDraining() || !canSpawnMoreCars()) {
    if (Game.prepared && !Game.prepared.ready) Game.prepared = null;
    Game.spawnTimer = Math.max(Game.spawnTimer, 0.25);
  }

  if (Game.prepared && !Game.prepared.ready) {
    Game.prepared.t -= dt;
    if (Game.prepared.t <= 0) {
      const car = typeof Game.prepared.factory === 'function'
        ? Game.prepared.factory()
        : spawnRegularCar(diff);
      if (!car) {
        Game.prepared = null;
      } else {
        Game.prepared.ready = true;
        Game.prepared.vehicle = car;
        if (Game.holder.length < CONFIG.holder.max && !Game.holderPriorityWait) fillHolderSlot();
        onHolderChanged();
      }
    }
  }
  Game.spawnTimer -= dt;
  if (Game.spawnTimer > 0) return;
  const iv = currentSpawnInterval() * rand(.75, 1.25);
  if (!canSpawnMoreCars()) {
    Game.spawnTimer = iv;
    return;
  }
  if (Game.holder.length < CONFIG.holder.max) {
    if (Game.holderPriorityWait) {
      Game.holder.unshift(Game.holderPriorityWait);
      Game.holderPriorityWait = null;
      Game.spawnTimer = iv;
      onHolderChanged();
      return;
    }
    if (!canSpawnRegularCar()) {
      Game.spawnTimer = iv;
      return;
    }
    const car = spawnRegularCar(diff);
    if (car) Game.holder.push(car);
    Game.spawnTimer = iv;
    onHolderChanged();
    return;
  }
  if (!canSpawnRegularCar()) {
    Game.spawnTimer = iv;
    if (Game.prepared && !Game.prepared.ready) Game.prepared = null;
    return;
  }
  if (!Game.prepared) {
    Game.prepared = { t: iv, ready: false, factory: () => spawnRegularCar(diff) };
  }
}

function scalperCooldown() {
  return currentSpawnInterval() * CONFIG.scalper.spawnIntervalMult;
}

function callTanker(order) {
  if (Game.state !== 'play') return false;
  if (!sortedStationSlots().length) return false;
  if (!canDispatchTanker()) {
    const p = Depot.pos || Road.posAt(Road.spawnS, 0);
    if (!findReadyTruck()) {
      addFloat(p.x, p.y - 30, 'Нет готовых бензовозов', '#ef5350');
    } else if (!canOrderTanker()) {
      addFloat(p.x, p.y - 30, 'Недостаточно кредитного лимита для закупки топлива', '#ef5350');
    }
    return false;
  }
  const truck = findReadyTruck();
  const liters = order?.liters != null ? order.liters : tankerDeliveryLiters();
  const cost = order?.cost != null ? order.cost : tankerDeliveryCost();
  const bonuses = order?.bonuses != null ? order.bonuses : 0;
  if (!canOrderTanker(undefined, cost)) {
    const p = Depot.pos || Road.posAt(Road.spawnS, 0);
    addFloat(p.x, p.y - 30, 'Недостаточно кредитного лимита для закупки топлива', '#ef5350');
    return false;
  }
  Game.money -= cost;
  if (bonuses > 0) {
    Game.bonuses = (Game.bonuses || 0) + bonuses;
  }
  // Заказ бензовоза снимает топливный кризис-таймер.
  Game.fuelCrisisT = 0;
  saveRunEconomy();
  const t = makeTanker(truck.id, liters);
  setTankerPhase(t, TankerPhase.SPAWNING);
  addToHolder(t, { priority: true, countsForDefeat: false });
  attachVehicleToTruck(truck, t);
  Game.tanker.unit = t;
  const spawnP = Road.posAt(Road.spawnS, 0);
  addFloat(spawnP.x, spawnP.y - 18, fmtRubDelta(-cost) + ' топливо', '#fdd835');
  return true;
}

function callGBR() {
  if (Game.state !== 'play') return;
  if (!canDispatchGbr()) {
    addFloat(GBRBase.pos.x, GBRBase.pos.y - 20, 'Нет готового экипажа.', '#ef5350');
    return;
  }
  const cost = gbrCallCost();
  if (Game.money < cost) {
    addFloat(GBRBase.pos.x, GBRBase.pos.y - 20, 'Нужно ' + fmtRub(cost), '#ef5350');
    return;
  }
  manualCallGbr({ x: GBRBase.pos.x, y: GBRBase.pos.y - 20 });
}

/** @deprecated removed in 0.4.3.3 — stub for old imports */
function getSpecialSpawnReserve() {
  return null;
}

/** @deprecated removed in 0.4.3.3 — alias of spawn budget */
function getSpecialSpawnLimit() {
  return getSpawnBudget();
}

export {
  LevelPhase,
  getTargetCars, hasLevelTarget, getEndSpawnInterval, levelProgress, spawnRampProgress,
  currentDiff, currentSpawnInterval, getServedHudText, scalperCooldown,
  getSpawnBudget, getSpawnedCars, canSpawnRegularCar, spawnRegularCar,
  canSpawnMoreCars, canSpawnScalper, registerSpawnedCar,
  isLevelTrafficVehicle, countVehiclesOnMap, syncLevelPhase, isLevelDraining,
  getSpecialSpawnReserve, getSpecialSpawnLimit,
  tickSpawnPipeline, callTanker, callGBR
};
