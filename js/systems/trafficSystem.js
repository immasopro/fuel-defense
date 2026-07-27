import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { mod, rand } from '../core/utils.js';
import { currentSpawnInterval } from './spawnSystem.js';
import { addFloat } from './economySystem.js';
import { onTankerDeployed } from './tankerSystem.js';
import {
  laneCount, serviceLane, exitLane, normalizeLane, clampLane
} from '../world/lanes.js';
import { ScalperPhase } from './entityFsm.js';

let holderBusy = false;

function isDriveParticipant(v) {
  if (!v) return false;
  if (v.state === 'drive' || v.state === 'action' || v.state === 'tow') return true;
  return false;
}

/**
 * Список участников полосы i.
 * EXITING Scalper включён (v0.4.4 COLL-003) — больше не ghost.
 */
function laneList(laneIdx) {
  const lane = clampLane(laneIdx);
  return Game.vehicles.filter(v => {
    if (normalizeLane(v.lane) !== lane) return false;
    // EXITING scalper: всегда участник своей полосы
    if (v.kind === 'scalper' && v.scalperPhase === ScalperPhase.EXITING) {
      return true;
    }
    if (v.state === 'drive') return true;
    if (lane === serviceLane() && (v.state === 'action' || v.state === 'tow')) return true;
    return false;
  });
}

/** @deprecated use laneList(serviceLane()) */
function innerLaneList() {
  return laneList(serviceLane());
}

/** @deprecated use laneList(exitLane()) */
function outerLaneList() {
  return laneList(exitLane());
}

function allLaneLists() {
  const n = laneCount();
  const lists = [];
  for (let i = 0; i < n; i++) lists.push(laneList(i));
  return lists;
}

function spawnClear(list, len) {
  const L = Road.length;
  for (const v of list) {
    const rel = mod(v.s - Road.spawnS + L / 2, L) - L / 2;
    if (rel > -((v.len + len) / 2 + 4) && rel < (v.len + len) / 2 + 12) return false;
  }
  return true;
}

function pickSpawnLane(len) {
  const n = laneCount();
  // Предпочитаем свободную полосу с меньшей плотностью у спавна
  let best = serviceLane();
  let bestScore = -1e9;
  for (let i = 0; i < n; i++) {
    const list = laneList(i);
    if (!spawnClear(list, len)) continue;
    const near = list.filter(v => {
      const rel = Math.abs(mod(v.s - Road.spawnS + Road.length / 2, Road.length) - Road.length / 2);
      return rel < 80;
    }).length;
    const score = 100 - near * 10 - Math.abs(i - serviceLane());
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function isLightGreen() {
  return Game.light.phase === 'green' && Game.light.redT <= 0;
}

function deployToRing(v) {
  v.state = 'drive';
  // Танкер и ГБР стартуют с сервисной полосы (подъезд к АЗС / базе)
  if (v.kind === 'tanker' || v.kind === 'gbr') v.lane = serviceLane();
  else v.lane = pickSpawnLane(v.len || 20);
  v.s = Road.spawnS;
  v.prevS = Road.spawnS;
  v.v = v.maxV * .4;
  v.trip = 0;
  v.latOff = 0;
  v.overtake = null;
  v.laneChange = null;
  if (v.kind === 'tanker') onTankerDeployed(v);
  Game.vehicles.push(v);
}

function fillHolderSlot() {
  const max = CONFIG.holder.max;
  if (Game.holder.length >= max) return;
  if (Game.holderPriorityWait) {
    Game.holder.unshift(Game.holderPriorityWait);
    Game.holderPriorityWait = null;
    return;
  }
  if (Game.prepared && Game.prepared.ready) {
    Game.holder.push(Game.prepared.vehicle);
    Game.prepared = null;
    Game.spawnTimer = currentSpawnInterval() * rand(.75, 1.25);
  }
}

function releaseHolderBurst() {
  if (!isLightGreen()) return;
  let guard = CONFIG.holder.max + 4;
  while (Game.holder.length > 0 && guard-- > 0) {
    const car = Game.holder[0];
    const lane = pickSpawnLane(car.len || 20);
    if (!spawnClear(laneList(lane), car.len)) {
      // попробовать любую полосу
      let ok = false;
      for (let i = 0; i < laneCount(); i++) {
        if (spawnClear(laneList(i), car.len)) { ok = true; break; }
      }
      if (!ok) break;
    }
    Game.holder.shift();
    deployToRing(car);
    Game.defeatT = 0;
    if (Game.holder.length < CONFIG.holder.max) fillHolderSlot();
  }
}

function onHolderChanged() {
  if (holderBusy) return;
  holderBusy = true;
  fillHolderSlot();
  releaseHolderBurst();
  holderBusy = false;
}

function addToHolder(vehicle, opts) {
  opts = opts || {};
  vehicle.countsForDefeat = opts.countsForDefeat !== false;
  vehicle.holderPriority = opts.priority ? 1 : 0;
  const max = CONFIG.holder.max;
  if (vehicle.holderPriority && Game.holder.length < max) {
    Game.holder.unshift(vehicle);
    onHolderChanged();
    return true;
  }
  if (!vehicle.holderPriority && Game.holder.length < max) {
    Game.holder.push(vehicle);
    onHolderChanged();
    return true;
  }
  if (vehicle.holderPriority) {
    Game.holderPriorityWait = vehicle;
    return true;
  }
  return false;
}

function toggleTrafficLight() {
  const L = CONFIG.trafficLight;
  if (Game.light.cd > 0 || Game.light.phase === 'red') return false;
  Game.light.phase = 'red';
  Game.light.redT = L.redDur;
  Game.defeatT = 0;
  addFloat(Road.posAt(Road.spawnS, 0).x, Road.posAt(Road.spawnS, 0).y - 22, '🔴 СТОП 10с', '#ef5350');
  return true;
}

function entryToRingBlocked() {
  if (!isLightGreen()) return true;
  for (let i = 0; i < laneCount(); i++) {
    if (spawnClear(laneList(i), 20)) return false;
  }
  return true;
}

export {
  holderBusy, laneList, allLaneLists, innerLaneList, outerLaneList,
  spawnClear, pickSpawnLane, isLightGreen, deployToRing, fillHolderSlot,
  releaseHolderBurst, onHolderChanged, addToHolder, toggleTrafficLight,
  entryToRingBlocked
};
