import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { mod, rand } from '../core/utils.js';
import { currentSpawnInterval } from './spawnSystem.js';
import { addFloat } from './economySystem.js';
import { onTankerDeployed } from './tankerSystem.js';

let holderBusy = false;

function innerLaneList() {
  return Game.vehicles.filter(v =>
    v.lane === 'inner' && (v.state === 'drive' || v.state === 'action' || v.state === 'tow'));
}

function outerLaneList() {
  return Game.vehicles.filter(v =>
    v.lane === 'outer' && v.state === 'drive' &&
    !(v.kind === 'scalper' && v.scalperPhase === 'exiting'));
}

function spawnClear(list, len) {
  const L = Road.length;
  for (const v of list) {
    const rel = mod(v.s - Road.spawnS + L / 2, L) - L / 2;
    if (rel > -((v.len + len) / 2 + 4) && rel < (v.len + len) / 2 + 12) return false;
  }
  return true;
}

function isLightGreen() {
  return Game.light.phase === 'green' && Game.light.redT <= 0;
}

function deployToRing(v) {
  v.state = 'drive';
  v.lane = 'inner';
  v.s = Road.spawnS;
  v.prevS = Road.spawnS;
  v.v = v.maxV * .4;
  v.trip = 0;
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
  let inner = innerLaneList();
  let guard = CONFIG.holder.max + 4;
  while (Game.holder.length > 0 && guard-- > 0) {
    const car = Game.holder[0];
    if (!spawnClear(inner, car.len)) break;
    Game.holder.shift();
    deployToRing(car);
    inner = innerLaneList();
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
  return !spawnClear(innerLaneList(), 20);
}

export { holderBusy, innerLaneList, outerLaneList, spawnClear, isLightGreen, deployToRing, fillHolderSlot, releaseHolderBurst, onHolderChanged, addToHolder, toggleTrafficLight, entryToRingBlocked };
