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

/** 0…1 — доля разгона спавна (1 = максимальная скорость). */
function spawnRampProgress() {
  if (Game.mode === 'endless') {
    return clamp01(Game.stats.served / ENDLESS_SPAWN.rampCars);
  }
  const target = getTargetCars();
  if (!target) return 0;
  const p = Game.stats.served / target;
  if (p >= SPAWN_RAMP_FRAC) return 1;
  return clamp01(p / SPAWN_RAMP_FRAC);
}

function levelProgress() {
  if (Game.mode === 'endless') {
    return clamp01(Game.stats.served / ENDLESS_SPAWN.rampCars);
  }
  const target = getTargetCars();
  if (!target) return 0;
  return clamp01(Game.stats.served / target);
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

function getServedHudText() {
  if (Game.mode === 'endless') {
    return Game.stats.served + ' обслужено';
  }
  const target = getTargetCars();
  return Game.stats.served + ' / ' + target;
}

/** Бюджет обычных машин уровня; null = без лимита (endless). */
function getSpawnBudget() {
  return getTargetCars();
}

function getSpawnedCars() {
  return Game.stats.spawned || 0;
}

/** Можно ли создать ещё одного обычного клиента (не Scalper). */
function canSpawnRegularCar() {
  const budget = getSpawnBudget();
  if (budget == null) return true;
  return getSpawnedCars() < budget;
}

/**
 * Запас обычных машин в конце кампании без Scalper (v0.4.2.5).
 * ≤1000 → 10; >1000 → 20. Endless → null (без лимита).
 */
function getSpecialSpawnReserve() {
  const target = getTargetCars();
  if (target == null) return null;
  return target <= 1000 ? 10 : 20;
}

/** Верхняя граница spawned, до которой ещё можно создать Scalper. */
function getSpecialSpawnLimit() {
  const target = getTargetCars();
  if (target == null) return null;
  return Math.max(0, target - getSpecialSpawnReserve());
}

/** Новый Scalper разрешён только пока spawned < specialSpawnLimit (campaign). */
function canSpawnScalper() {
  const limit = getSpecialSpawnLimit();
  if (limit == null) return true;
  return getSpawnedCars() < limit;
}

/**
 * Создать обычный клиентский автомобиль с учётом spawnBudget.
 * @returns {object|null}
 */
function spawnRegularCar(diff) {
  if (!canSpawnRegularCar()) return null;
  const car = makeCar(diff);
  Game.stats.spawned = getSpawnedCars() + 1;
  return car;
}

function tickSpawnPipeline(dt, diff) {
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
  // Единая кредитная политика (legacy + меню): canOrderTanker(money, cost).
  if (!canOrderTanker(undefined, cost)) {
    const p = Depot.pos || Road.posAt(Road.spawnS, 0);
    addFloat(p.x, p.y - 30, 'Недостаточно кредитного лимита для закупки топлива', '#ef5350');
    return false;
  }
  Game.money -= cost;
  if (bonuses > 0) {
    Game.bonuses = (Game.bonuses || 0) + bonuses;
  }
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

export {
  getTargetCars, hasLevelTarget, getEndSpawnInterval, levelProgress, spawnRampProgress,
  currentDiff, currentSpawnInterval, getServedHudText, scalperCooldown,
  getSpawnBudget, getSpawnedCars, canSpawnRegularCar, spawnRegularCar,
  getSpecialSpawnReserve, getSpecialSpawnLimit, canSpawnScalper,
  tickSpawnPipeline, callTanker, callGBR
};
