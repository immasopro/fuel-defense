import { CONFIG } from '../config/index.js';
import { SPAWN_START_INTERVAL } from '../config/levels.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { GBRBase, sortedStationSlots, Depot } from '../world/map.js';
import { clamp01, lerp, rand } from '../core/utils.js';
import { makeCar, makeTanker } from '../vehicles/vehicleFactory.js';
import { setTankerPhase, TankerPhase } from './entityFsm.js';
import { addToHolder, onHolderChanged, fillHolderSlot } from './trafficSystem.js';
import { addFloat, tankerDeliveryCost, canOrderTanker } from './economySystem.js';
import { fmtRubDelta, fmtRub } from '../core/currency.js';
import {
  canDispatchTanker, findReadyTruck, attachVehicleToTruck
} from './tankerLogistics.js';
import {
  canDispatchGbr, gbrCallCost
} from './gbrLogistics.js';
import { manualCallGbr } from './gbrPursuit.js';

function getTargetCars() {
  const cfg = Game.modeCfg;
  if (Game.mode === 'endless') {
    const lvl = Math.max(11, Game.levelIdx || 11);
    return cfg.baseTarget + (lvl - 10) * cfg.targetStep;
  }
  return cfg.targetCars;
}

function getEndSpawnInterval() {
  if (Game.mode === 'endless') {
    const lvl = Math.max(11, Game.levelIdx || 11);
    return Math.max(0.60, 1.0 - (lvl - 10) * 0.03);
  }
  return Game.modeCfg.endInterval;
}

function levelProgress() {
  const target = getTargetCars();
  if (target <= 0) return 0;
  return clamp01(Game.stats.served / target);
}

function currentDiff() {
  return levelProgress();
}

function currentSpawnInterval() {
  const start = SPAWN_START_INTERVAL;
  const end = getEndSpawnInterval();
  const progress = levelProgress();
  return start - (start - end) * progress;
}

function tickSpawnPipeline(dt, diff) {
  if (Game.prepared && !Game.prepared.ready) {
    Game.prepared.t -= dt;
    if (Game.prepared.t <= 0) {
      Game.prepared.ready = true;
      Game.prepared.vehicle = Game.prepared.factory();
      if (Game.holder.length < CONFIG.holder.max && !Game.holderPriorityWait) fillHolderSlot();
      onHolderChanged();
    }
  }
  Game.spawnTimer -= dt;
  if (Game.spawnTimer > 0) return;
  const iv = currentSpawnInterval() * rand(.75, 1.25);
  if (Game.holder.length < CONFIG.holder.max) {
    if (Game.holderPriorityWait) {
      Game.holder.unshift(Game.holderPriorityWait);
      Game.holderPriorityWait = null;
    } else {
      Game.holder.push(makeCar(diff));
    }
    Game.spawnTimer = iv;
    onHolderChanged();
    return;
  }
  if (!Game.prepared) {
    Game.prepared = { t: iv, ready: false, factory: () => makeCar(diff) };
  }
}

function scalperCooldown() {
  return currentSpawnInterval() * CONFIG.scalper.spawnIntervalMult;
}

function callTanker() {
  if (Game.state !== 'play') return;
  if (!sortedStationSlots().length) return;
  if (!canDispatchTanker()) {
    const p = Depot.pos || Road.posAt(Road.spawnS, 0);
    if (!findReadyTruck()) {
      addFloat(p.x, p.y - 30, 'Нет готовых бензовозов', '#ef5350');
    } else if (!canOrderTanker()) {
      addFloat(p.x, p.y - 30, 'Недостаточно кредитного лимита для закупки топлива', '#ef5350');
    }
    return;
  }
  const truck = findReadyTruck();
  const cost = tankerDeliveryCost();
  if (!canOrderTanker()) {
    const p = Depot.pos || Road.posAt(Road.spawnS, 0);
    addFloat(p.x, p.y - 30, 'Недостаточно кредитного лимита для закупки топлива', '#ef5350');
    return;
  }
  Game.money -= cost;
  const t = makeTanker(truck.id);
  setTankerPhase(t, TankerPhase.SPAWNING);
  addToHolder(t, { priority: true, countsForDefeat: false });
  attachVehicleToTruck(truck, t);
  Game.tanker.unit = t;
  const spawnP = Road.posAt(Road.spawnS, 0);
  addFloat(spawnP.x, spawnP.y - 18, fmtRubDelta(-cost) + ' топливо', '#fdd835');
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
  getTargetCars, getEndSpawnInterval, levelProgress,
  currentDiff, currentSpawnInterval, scalperCooldown,
  tickSpawnPipeline, callTanker, callGBR
};
