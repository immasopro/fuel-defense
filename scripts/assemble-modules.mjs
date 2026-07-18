/**
 * Assembles extracted chunks into ES modules with imports/exports.
 * Run: node scripts/assemble-modules.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const chunksDir = path.join(__dirname, 'chunks');
const monolithPath = path.join(root, '..', 'fuel-defense.html');

function read(name) {
  return fs.readFileSync(path.join(chunksDir, name + '.js'), 'utf8').trimEnd();
}

function w(rel, body) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body.endsWith('\n') ? body : body + '\n');
}

function extractFn(code, name) {
  if (name === 'holderBusy') {
    return code.includes('let holderBusy = false') ? 'let holderBusy = false;' : '';
  }
  const re = new RegExp(`function ${name}\\(`);
  const start = code.search(re);
  if (start < 0) throw new Error('missing function: ' + name);
  let i = code.indexOf('{', start);
  let depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function: ' + name);
}

function extractFns(code, names) {
  return names.map(n => extractFn(code, n)).join('\n\n');
}

function exportFns(code, names) {
  return names.map(n => n).join(', ');
}

// --- read chunks ---
const configRaw = read('config');
const gamechunk = read('gamechunk');
const veh = read('vehicles');
const hits = read('hits');
const roadChunk = read('road');
const renderChunk = read('render');
const uiChunk = read('ui');
const bootChunk = read('boot');

// --- config ---
const levelsMatch = configRaw.match(/\/\* ---- КАМПАНИЯ[\s\S]*?levels:\s*\[([\s\S]*?)\],\s*\n\s*\/\*/);
const endlessMatch = configRaw.match(/\/\* ---- БЕСКОНЕЧНЫЙ[\s\S]*?endless:\s*(\{[\s\S]*\})\s*$/);
if (!levelsMatch || !endlessMatch) throw new Error('config parse failed');

let balanceInner = configRaw.replace(/^const CONFIG = /, '');
balanceInner = balanceInner.replace(
  /,\s*\n\s*\/\* ---- КАМПАНИЯ[\s\S]*?levels:\s*\[[\s\S]*?\],?\s*\n\s*\/\* ---- БЕСКОНЕЧНЫЙ[\s\S]*?endless:\s*\{[\s\S]*\}\s*$/,
  '\n}'
).trim();
if (!balanceInner.endsWith('}')) balanceInner += '\n}';

balanceInner = balanceInner.replace(
  /\s*bufferMax\(\)\s*\{[^}]*\},?\s*\n/,
  '\n'
).trim();

w('js/config/levels.js', `/** Campaign and endless mode definitions */
export const levels = [${levelsMatch[1].trim()}];

export const endless = ${endlessMatch[1].trim()};
`);

w('js/config/balance.js', `/** Numeric balance parameters */
export const balance = ${balanceInner};
`);

w('js/config/constants.js', `export const Events = {
  VehicleSpawned: 'VehicleSpawned',
  VehicleDestroyed: 'VehicleDestroyed',
  PumpReleased: 'PumpReleased',
  StationRefilled: 'StationRefilled',
  FuelTruckArrived: 'FuelTruckArrived',
  GameLost: 'GameLost',
  GameWon: 'GameWon'
};

export const COLORS = {
  bg: '#1d232c', road: '#454c58', roadEdge: '#2a2f38',
  marking: 'rgba(230,237,243,.45)', slot: '#5a6472',
  stub: '#3a404b', apron: 'rgba(90,100,114,.22)'
};

export const CANVAS = {
  designWidth: 420,
  minHeight: 560,
  maxHeight: 940,
  maxDeltaTime: 0.05,
  maxDevicePixelRatio: 2.5
};
`);

w('js/config/index.js', `import { balance } from './balance.js';
import { levels, endless } from './levels.js';

export const CONFIG = { ...balance, levels, endless };
CONFIG.pump.bufferMax = function () {
  return CONFIG.station.resLevels[CONFIG.station.resLevels.length - 1] * this.bufferFrac;
};
`);

// --- core ---
w('js/core/utils.js', `${read('utils')}

export { clamp, clamp01, lerp, rand, mod, smooth, weightedPick, lerpMix, fmtTime, shortAngle, lerpPose };
`);

w('js/core/eventBus.js', `export class EventBus {
  constructor() { this._handlers = new Map(); }
  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this._handlers.get(event).delete(fn);
  }
  emit(event, payload) {
    const set = this._handlers.get(event);
    if (set) for (const fn of set) fn(payload);
  }
}
`);

w('js/core/timer.js', `import { CANVAS } from '../config/constants.js';

export class FrameTimer {
  constructor() { this.lastTs = null; }
  step(ts) {
    if (this.lastTs == null) { this.lastTs = ts; return 0; }
    const dt = Math.min((ts - this.lastTs) / 1000, CANVAS.maxDeltaTime);
    this.lastTs = ts;
    return dt;
  }
}
`);

w('js/core/gameState.js', `export const Game = ${read('gamestate').replace(/^const Game = /, '')}\n};\n`);

// --- world ---
const roadObjEnd = roadChunk.indexOf('};') + 2;
const roadObj = roadChunk.slice(0, roadObjEnd);
const roadFns = roadChunk.slice(roadObjEnd);

w('js/world/roadNetwork.js', `import { CONFIG } from '../config/index.js';
import { mod } from '../core/utils.js';

export ${roadObj}

${roadFns}

export {
  pumpPose, apronPoseForRank, approachStopS, pocketEntryS, decelStopS,
  pocketPoseForRank, holderPose, distAhead, pumpNozzleBusy, findTankerPump
};
`);

const mapHitFns = extractFns(hits, [
  'hitGBRBase', 'stationTankPos', 'hitStationTank', 'hitDepot',
  'sortedStationSlots', 'findFreePump'
]);

w('js/world/map.js', `import { CONFIG } from '../config/index.js';
import { Road, pumpPose } from './roadNetwork.js';
import { mod } from '../core/utils.js';
import { Game } from '../core/gameState.js';

${read('depot')}

${read('gbrbase')}

${mapHitFns}

export { Depot, GBRBase, hitGBRBase, stationTankPos, hitStationTank, hitDepot,
  sortedStationSlots, findFreePump };
`);

// --- stations ---
w('js/stations/pump.js', `import { CONFIG } from '../config/index.js';

${read('station').split('class Station')[0].trim()}

export { Pump };
`);

w('js/stations/station.js', `import { CONFIG } from '../config/index.js';
import { Pump } from './pump.js';

class Station${read('station').split('class Station')[1].trim()}

export { Station };
`);

const reservoirFns = extractFns(hits, ['distributeDepotFuel', 'refillCanisterReserve']);

w('js/stations/reservoir.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { Depot } from '../world/map.js';

${reservoirFns}

export { distributeDepotFuel, refillCanisterReserve };
`);

const stationQueueNames = [
  'cleanupVehicle', 'repositionPocket', 'releasePocket', 'promotePocket', 'processStationPocket',
  'scanForStation', 'assignToPocket', 'releaseReservation', 'poseForRank',
  'wakePumpQueue', 'tryApproachPullIn', 'tryApproachPocket', 'beginPocketPullIn',
  'beginPullIn', 'beginTankerPullIn', 'beginPullOut', 'beginLaneChange'
];

w('js/stations/stationQueue.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { mod } from '../core/utils.js';
import { Road, pumpPose, apronPoseForRank, approachStopS, pocketEntryS,
  pocketPoseForRank, distAhead } from '../world/roadNetwork.js';

${extractFns(gamechunk, stationQueueNames)}

export { ${stationQueueNames.join(', ')} };
`);

// --- vehicles ---
const factoryEnd = veh.indexOf('function findForwardLeader');
const factoryCode = veh.slice(0, factoryEnd).trim();
const motionCode = veh.slice(factoryEnd).trim();

w('js/vehicles/vehicle.js', `import { CONFIG } from '../config/index.js';
import { Road, pocketEntryS, distAhead } from '../world/roadNetwork.js';
import { mod, clamp, clamp01, lerp, smooth, rand } from '../core/utils.js';
import { outerLaneList } from '../systems/trafficSystem.js';
import { releasePocket } from '../stations/stationQueue.js';

function baseVehicle(kind, p) {
  const F = CONFIG.follow;
  return Object.assign({
    kind, lane: 'inner', state: 'drive',
    s: Road.spawnS, prevS: Road.spawnS, v: 0, trip: 0,
    len: 18, w: 9, maxV: 60, accel: 45, brake: 100,
    react: rand(F.reactMin, F.reactMax), percT: 0, percGap: 1e9, percLV: 0,
    stopS: null, targetSlot: null, station: null, pump: null, pumpJ: 0,
    angry: false, scanT: rand(0, .2), mergeT: 0,
    animT: 0, animDur: 0, animFrom: null, animTo: null, exitS: 0,
    pose: null,
    latOff: 0, overtake: null, overtakeT: 0, overtakeCommitted: false,
    missedStation: false, visualSteer: 0,
    countsForDefeat: true, holderPriority: 0, pocketWaitT: 0,
    served: false
  }, p);
}

${motionCode}

export { baseVehicle, findForwardLeader, outerClearForOvertake, canStartOvertake,
  updateLane, laneGapFree, crossed };
`);

w('js/vehicles/vehicleFactory.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { Depot, sortedStationSlots } from '../world/map.js';
import { rand, weightedPick, lerpMix } from '../core/utils.js';
import { baseVehicle } from './vehicle.js';

${factoryCode.replace(/^function baseVehicle[\s\S]*?^}/m, '').trim()}

export { rollCanister, pickClientType, pickClientFuel, makeCar, makeScalper, makeTanker, makeGBR, makeBgCar };
`);

// --- systems ---
const trafficNames = [
  'innerLaneList', 'outerLaneList', 'spawnClear', 'isLightGreen', 'deployToRing',
  'fillHolderSlot', 'releaseHolderBurst', 'onHolderChanged', 'addToHolder',
  'toggleTrafficLight', 'entryToRingBlocked'
];

w('js/systems/trafficSystem.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { mod, rand } from '../core/utils.js';
import { currentSpawnInterval } from './spawnSystem.js';
import { addFloat } from './economySystem.js';

${extractFn(gamechunk, 'holderBusy')}

${extractFns(gamechunk, trafficNames)}

export { holderBusy, ${trafficNames.join(', ')} };
`);

const spawnNames = ['currentDiff', 'currentSpawnInterval', 'tickSpawnPipeline', 'callTanker', 'callGBR'];

w('js/systems/spawnSystem.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { GBRBase, sortedStationSlots } from '../world/map.js';
import { clamp01, lerp, rand } from '../core/utils.js';
import { makeCar, makeTanker, makeGBR } from '../vehicles/vehicleFactory.js';
import { addToHolder, onHolderChanged, fillHolderSlot } from './trafficSystem.js';
import { addFloat } from './economySystem.js';

${extractFns(gamechunk, spawnNames)}

export { ${spawnNames.join(', ')} };
`);

w('js/systems/defeatSystem.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { fmtTime } from '../core/utils.js';
import { innerLaneList, spawnClear, isLightGreen } from './trafficSystem.js';
import { closePanel } from '../ui/stationPanel.js';
import { UI, getUnlocked, setUnlocked } from '../ui/hud.js';

${extractFns(gamechunk, ['updateDefeatTimer', 'endGame'])}

export { updateDefeatTimer, endGame };
`);

w('js/systems/economySystem.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { wakePumpQueue, promotePocket, cleanupVehicle } from '../stations/stationQueue.js';

${extractFns(gamechunk, ['addFloat', 'finishFuel', 'finishScalperFuel', 'removeScalper'])}

export { addFloat, finishFuel, finishScalperFuel, removeScalper };
`);

const upgradeNames = [
  'resUpgradeCost', 'pumpUpgradeCost', 'fuelUnlockCost', 'addPumpCost',
  'actionBuildStation', 'actionUpgradeReservoir', 'actionUpgradePump',
  'actionUnlockFuel', 'actionAddPump', 'actionBuyCanisterReserve', 'actionUpgradeDepot'
];

w('js/systems/upgradeSystem.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Depot } from '../world/map.js';
import { Station } from '../stations/station.js';
import { Pump } from '../stations/pump.js';
import { addFloat } from './economySystem.js';

${extractFns(hits, upgradeNames)}

export { ${upgradeNames.join(', ')} };
`);

const stationSystemNames = [
  'updateTanker', 'updateTankerUnload', 'updateTankerAtPump', 'updateScalperTour', 'updateGBR'
];

const updateFn = extractFn(gamechunk, 'update');
const updateBody = updateFn.replace(/^function update\(dt\)\s*\{/, '').replace(/\}\s*$/, '');

// Extract vehicle loop and post-station from update body via markers
const vehicleLoopStart = updateBody.indexOf('// --- поведение машин');
const vehicleLoopEnd = updateBody.indexOf('// --- буферы колонок');
const postStationStart = vehicleLoopEnd;
const postStationEnd = updateBody.indexOf('// --- таймеры подписей');

if (vehicleLoopStart < 0 || vehicleLoopEnd < 0) throw new Error('update() split markers not found');

const vehicleLoopBody = updateBody.slice(vehicleLoopStart, vehicleLoopEnd).trim();
const postStationBody = updateBody.slice(postStationStart, postStationEnd).trim();

w('js/systems/stationSystem.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road, pumpPose, apronPoseForRank, approachStopS, distAhead, findTankerPump } from '../world/roadNetwork.js';
import { Depot, sortedStationSlots, findFreePump } from '../world/map.js';
import { mod, lerp, rand, shortAngle } from '../core/utils.js';
import { makeScalper, makeBgCar } from '../vehicles/vehicleFactory.js';
import { laneGapFree, crossed } from '../vehicles/vehicle.js';
import { outerLaneList, onHolderChanged, addToHolder } from './trafficSystem.js';
import { currentSpawnInterval } from './spawnSystem.js';
import { finishFuel, finishScalperFuel, removeScalper } from './economySystem.js';
import { refillCanisterReserve } from '../stations/reservoir.js';
import { cleanupVehicle, scanForStation, tryApproachPocket, tryApproachPullIn,
  beginLaneChange, beginPullOut, processStationPocket, beginPullIn, beginTankerPullIn } from '../stations/stationQueue.js';

${extractFns(gamechunk, stationSystemNames)}

function tickSpecialSpawns(dt, diff) {
  const cfg = Game.modeCfg;
  if (CONFIG.bgTrafficEnabled) {
    Game.bgSpawnTimer = (Game.bgSpawnTimer || 0) - dt;
    if (Game.bgSpawnTimer <= 0 && Game.holder.length < CONFIG.holder.max) {
      Game.holder.push(makeBgCar());
      Game.bgSpawnTimer = currentSpawnInterval() * 2 * rand(.75, 1.25);
      onHolderChanged();
    }
  }
  Game.scalperTimer -= dt;
  if (Game.scalperTimer <= 0 && !Game.scalper.unit) {
    if (sortedStationSlots().length) {
      const sc = makeScalper();
      addToHolder(sc, { priority: false, countsForDefeat: false });
      Game.scalper.unit = sc;
      Game.scalperTimer =
        lerp(cfg.scalper.intervalStart, cfg.scalper.intervalEnd, diff) * rand(.8, 1.25);
    } else {
      Game.scalperTimer = 2.5;
    }
  }
}

export function updateVehicles(dt, L) {
  const outer = outerLaneList();
${vehicleLoopBody.replace(/^\/\/ --- поведение машин[^\n]*\n/, '')}
}

export function postStationMaintenance(dt) {
${postStationBody.replace(/^\/\/ --- буферы колонок[^\n]*\n/, '')}
}

export { tickSpecialSpawns };
`);

// --- ui ---
const renderBody = renderChunk.replace(/^const COLORS = \{[\s\S]*?\};\s*\n/, '');

w('js/ui/renderer.js', `import { CONFIG } from '../config/index.js';
import { COLORS } from '../config/constants.js';
import { Game } from '../core/gameState.js';
import { Road, pumpPose, apronPoseForRank, approachStopS, pocketEntryS,
  holderPose, distAhead } from '../world/roadNetwork.js';
import { Depot, GBRBase, stationTankPos } from '../world/map.js';
import { clamp, clamp01, fmtTime, lerpPose, smooth, mod } from '../core/utils.js';
import { isLightGreen } from '../systems/trafficSystem.js';
import { UI } from './hud.js';

${renderBody}

export { draw, vehiclePose, roadPath, rr };
`);

const uiHudCore = uiChunk.split('function handleTap')[0].trim();
const uiHandleTap = 'function handleTap' + uiChunk.split('function handleTap')[1].split('/* ---------- панели ---------- */')[0].trim();
const uiPanels = uiChunk.split('/* ---------- панели ---------- */')[1].split('/* ---------- HUD ---------- */')[0].trim();
const uiHud = uiChunk.split('/* ---------- HUD ---------- */')[1].split('/* ---------- меню ---------- */')[0].trim();
const uiMenu = uiChunk.split('/* ---------- меню ---------- */')[1].trim();

w('js/ui/hud.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { fmtTime, clamp } from '../core/utils.js';
import { innerLaneList, isLightGreen } from '../systems/trafficSystem.js';

${uiHudCore.replace(/^const UI = \{\};.*/, 'export const UI = {};')}

${uiHud}

${uiMenu}

export { bindTap, getUnlocked, setUnlocked, resize, updateHUD, renderMenu, showMenu };
`);

w('js/ui/stationPanel.js', `import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { hitDepot, hitStationTank, Depot } from '../world/map.js';
import {
  resUpgradeCost, pumpUpgradeCost, fuelUnlockCost, addPumpCost,
  actionBuildStation, actionUpgradeReservoir, actionUpgradePump,
  actionUnlockFuel, actionAddPump, actionBuyCanisterReserve, actionUpgradeDepot
} from '../systems/upgradeSystem.js';
import { UI } from './hud.js';

${uiHandleTap}

${uiPanels}

export { openDepotPanel, openBuildPanel, openStationPanel, closePanel,
  updatePanelLive, handlePanelAction, handleTap };
`);

w('js/debug/debugOverlay.js', `/** No debug overlay in original monolith — stub for future use */
export function drawDebugOverlay(ctx) {}
`);

// --- game.js ---
const newGameFn = extractFn(gamechunk, 'newGame');

w('js/game.js', `import { CONFIG } from './config/index.js';
import { Game } from './core/gameState.js';
import { Road } from './world/roadNetwork.js';
import { updateLane } from './vehicles/vehicle.js';
import { innerLaneList, outerLaneList, releaseHolderBurst } from './systems/trafficSystem.js';
import { currentDiff, tickSpawnPipeline } from './systems/spawnSystem.js';
import { updateDefeatTimer, endGame } from './systems/defeatSystem.js';
import { addFloat } from './systems/economySystem.js';
import { distributeDepotFuel } from './stations/reservoir.js';
import { tickSpecialSpawns, updateVehicles, postStationMaintenance } from './systems/stationSystem.js';
import { updateHUD } from './ui/hud.js';
import { updatePanelLive, closePanel } from './ui/stationPanel.js';
import { UI } from './ui/hud.js';

${newGameFn.replace(/^function newGame/, 'export function newGame')}

function updateTrafficLight(dt) {
  if (Game.light.redT > 0) {
    Game.light.redT -= dt;
    Game.defeatT = 0;
    if (Game.light.redT <= 0) {
      Game.light.redT = 0;
      Game.light.phase = 'green';
      Game.light.cd = CONFIG.trafficLight.cooldown;
      addFloat(Road.posAt(Road.spawnS, 0).x, Road.posAt(Road.spawnS, 0).y - 22, '🟢 ПУСК', '#8bc34a');
    }
  } else if (Game.light.cd > 0) {
    Game.light.cd -= dt;
  }
}

function updateTimersAndWarning(dt) {
  for (const k in Game.tankLabels) {
    Game.tankLabels[k] -= dt;
    if (Game.tankLabels[k] <= 0) delete Game.tankLabels[k];
  }
  if (Game.depotLabel > 0) Game.depotLabel -= dt;
  Game.tanker.cd = Math.max(0, Game.tanker.cd - dt);
  Game.gbr.cd = Math.max(0, Game.gbr.cd - dt);
  for (const f of Game.floats) f.t += dt;
  Game.floats = Game.floats.filter(f => f.t < f.life);
  if (Game.defeatT > 0.15) {
    UI.warning.textContent =
      '⚠️ НАКОПИТЕЛЬ ПОЛОН! ' + Math.max(0, CONFIG.defeatTime - Game.defeatT).toFixed(1) + 'с';
    UI.warning.classList.remove('hidden');
  } else {
    UI.warning.classList.add('hidden');
  }
}

export function update(dt) {
  if (Game.state !== 'play') { updateHUD(); return; }
  Game.time += dt;
  const cfg = Game.modeCfg;
  if (Game.mode === 'campaign' && Game.time >= cfg.duration) { endGame(true); return; }
  const diff = currentDiff();
  const L = Road.length;

  const inner = innerLaneList();
  const outer = outerLaneList();
  updateLane(inner, dt);
  updateLane(outer, dt);

  updateTrafficLight(dt);
  tickSpawnPipeline(dt, diff);
  releaseHolderBurst();
  tickSpecialSpawns(dt, diff);
  updateDefeatTimer(dt);
  if (Game.state !== 'play') return;

  distributeDepotFuel(dt);
  updateVehicles(dt, L);
  postStationMaintenance(dt);
  updateTimersAndWarning(dt);

  updateHUD();
  updatePanelLive();
}
`);

w('js/boot.js', `import { Road } from './world/roadNetwork.js';
import { Depot, GBRBase } from './world/map.js';
import { clamp } from './core/utils.js';
import { UI, bindTap, resize, updateHUD, renderMenu, showMenu } from './ui/hud.js';
import { handleTap, handlePanelAction } from './ui/stationPanel.js';
import { newGame } from './game.js';
import { callTanker, callGBR } from './systems/spawnSystem.js';
import { toggleTrafficLight } from './systems/trafficSystem.js';

${bootChunk
  .replace(/^function boot\(\)/, 'export function boot(startFrame)')
  .replace('requestAnimationFrame(frame);', 'startFrame(0);')}
`);

w('js/main.js', `import { CONFIG } from './config/index.js';
import { Game } from './core/gameState.js';
import { Road } from './world/roadNetwork.js';
import { Depot, GBRBase, sortedStationSlots } from './world/map.js';
import { Station } from './stations/station.js';
import { Pump } from './stations/pump.js';
import { FrameTimer } from './core/timer.js';
import { update, newGame } from './game.js';
import { draw } from './ui/renderer.js';
import { boot } from './boot.js';
import { callTanker, callGBR } from './systems/spawnSystem.js';
import { endGame } from './systems/defeatSystem.js';
import { makeCar, makeBgCar, makeScalper, makeTanker, pickClientType, pickClientFuel } from './vehicles/vehicleFactory.js';
import { finishFuel } from './systems/economySystem.js';
import { scanForStation, wakePumpQueue, tryApproachPullIn, tryApproachPocket,
  beginPullIn, beginPocketPullIn, cleanupVehicle, processStationPocket, promotePocket } from './stations/stationQueue.js';
import {
  apronPoseForRank, approachStopS, pocketEntryS, decelStopS, pocketPoseForRank,
  holderPose, findTankerPump, distAhead
} from './world/roadNetwork.js';
import {
  toggleTrafficLight, isLightGreen, entryToRingBlocked,
  addToHolder, deployToRing, releaseHolderBurst
} from './systems/trafficSystem.js';
import {
  actionBuildStation, actionUpgradeReservoir, actionUpgradePump, actionUnlockFuel,
  actionAddPump, actionBuyCanisterReserve, actionUpgradeDepot,
  resUpgradeCost, pumpUpgradeCost, fuelUnlockCost, addPumpCost
} from './systems/upgradeSystem.js';
import { handlePanelAction } from './ui/stationPanel.js';

export const FD = {
  Game, Road, Depot, GBRBase, CONFIG, update, newGame, callTanker, callGBR, handlePanelAction,
  Station, Pump, makeCar, makeBgCar, makeScalper, makeTanker, endGame, scanForStation,
  actionBuildStation, actionUpgradeReservoir, actionUpgradePump, actionUnlockFuel,
  actionAddPump, actionBuyCanisterReserve, actionUpgradeDepot,
  resUpgradeCost, pumpUpgradeCost, fuelUnlockCost, addPumpCost, sortedStationSlots,
  wakePumpQueue, tryApproachPullIn, tryApproachPocket, apronPoseForRank, approachStopS,
  pocketEntryS, decelStopS, pocketPoseForRank, holderPose, findTankerPump, promotePocket,
  finishFuel, beginPullIn, beginPocketPullIn, distAhead, toggleTrafficLight,
  isLightGreen, entryToRingBlocked, pickClientType, pickClientFuel,
  addToHolder, deployToRing, releaseHolderBurst, cleanupVehicle, processStationPocket
};

if (typeof window !== 'undefined') window.FD = FD;

const timer = new FrameTimer();
function frame(ts) {
  const dt = timer.step(ts);
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

if (!globalThis.__FD_HEADLESS__) {
  boot(frame);
}
`);

// --- index.html + css ---
const html = fs.readFileSync(monolithPath, 'utf8');
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1].trim();
const bodyRaw = html.match(/<body>([\s\S]*?)<\/body>/)[1].trim();
const body = bodyRaw.replace(/<script[\s\S]*?<\/script>/gi, '').trim();

w('css/style.css', style);
w('index.html', `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#10141a">
<title>Fuel Defense v0.2.0</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
${body}
<script type="module" src="js/main.js"></script>
</body>
</html>
`);

w('package.json', JSON.stringify({ type: 'module', name: 'fuel-defense', version: '0.2.0' }, null, 2) + '\n');

// --- test_headless.js ---
w('test_headless.js', `// Headless regression tests for modular Fuel Defense
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeCtx() {
  const store = {};
  return new Proxy({}, {
    get(t, k) { if (k in store) return store[k]; if (k === 'measureText') return () => ({ width: 10 }); return () => {}; },
    set(t, k, v) { store[k] = v; return true; }
  });
}
function makeEl(id) {
  const el = {
    id, style: {}, dataset: {}, disabled: false, _cls: new Set(['hidden']),
    classList: { add: c => el._cls.add(c), remove: c => el._cls.delete(c), contains: c => el._cls.has(c) },
    innerHTML: '', textContent: '', addEventListener: () => {},
    querySelector: () => makeEl(id + '-c'), querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 730 }),
    getContext: () => makeCtx(), width: 0, height: 0
  };
  return el;
}
const els = {};
let rafCb = null;
globalThis.__FD_HEADLESS__ = true;
globalThis.window = {
  devicePixelRatio: 2,
  addEventListener: () => {},
  requestAnimationFrame: cb => { rafCb = cb; },
  requestFullscreen: () => {}
};
globalThis.document = {
  getElementById: id => (els[id] || (els[id] = makeEl(id))),
  documentElement: { requestFullscreen: () => {} },
  exitFullscreen: () => {}
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { FD } = await import('./js/main.js');
const { update } = await import('./js/game.js');
const { Road } = await import('./js/world/roadNetwork.js');
const { Depot, GBRBase } = await import('./js/world/map.js');
const { UI } = await import('./js/ui/hud.js');
const stubEl = () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, textContent: '', innerHTML: '' });
UI.warning = stubEl();
UI.panel = stubEl();
UI.statMoney = stubEl();
UI.statTraffic = stubEl();
UI.statTime = stubEl();
UI.btnTanker = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnGbr = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnLight = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} } });
UI.tankerSub = stubEl();
UI.gbrSub = stubEl();
UI.lightSub = stubEl();
Road.build(420, 730);
Depot.init();
GBRBase.init();

const { Game, CONFIG } = FD;
function step(n) { for (let i = 0; i < n; i++) update(1 / 60); }
function assert(c, msg) { if (!c) { console.error('FAIL:', msg); process.exit(1); } console.log('ok -', msg); }

FD.newGame('campaign', 1);
const L = Road.length;

const slot4 = Road.slots[3];
const p0 = FD.apronPoseForRank(slot4, 0, 0);
const p3 = FD.apronPoseForRank(slot4, 0, 3);
const roadP0 = Road.posAt(slot4.s, CONFIG.road.serviceLat);
assert(Math.hypot(p0.x - roadP0.x, p0.y - roadP0.y) < 80, 'rank 0 apron pose near station');
assert(Math.hypot(p3.x - roadP0.x, p3.y - roadP0.y) < 120, 'rank 3 apron pose still on station apron, not across map');

FD.newGame('campaign', 1);
Game.money = 5000;
FD.actionBuildStation(Road.slots[1], 'a92');
const slot = Road.slots[1];
const pump = slot.station.pumps[0];
const carA = FD.makeCar(0);
carA.fuelKey = 'a92'; carA.pump = pump; carA.pumpJ = 0; carA.targetSlot = slot;
carA.station = slot.station; pump.cars.push(carA);
carA.state = 'station'; carA.pose = { ...FD.apronPoseForRank(slot, 0, 0) };
carA.got = carA.need - 1;
const carB = FD.makeCar(0);
carB.fuelKey = 'a92'; carB.pump = pump; carB.pumpJ = 0; carB.targetSlot = slot;
carB.station = slot.station; pump.cars.push(carB);
carB.state = 'station'; carB.pose = { ...FD.apronPoseForRank(slot, 0, 1) };
FD.finishFuel(carA);
assert(pump.cars.length === 1 && pump.cars[0] === carB, 'FIFO: carB becomes front after carA leaves');

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[1], 'a92');
Game.money = 10000;
Game.depot.res = 2000;
Game.vehicles = [];
for (let i = 0; i < CONFIG.holder.max; i++) Game.holder.push(FD.makeCar(0));
FD.callTanker();
assert(Game.tanker.unit, 'tanker spawns');
const tanker = Game.tanker.unit;
assert(Game.holderPriorityWait === tanker, 'tanker priority-waits when holder full');
Game.holder.shift();
Game.holder.unshift(tanker);
Game.holderPriorityWait = null;
FD.deployToRing(tanker);
tanker.s = FD.approachStopS(Road.slots[1]);
tanker.v = 0;
step(5);
assert(tanker.state === 'pullIn' || tanker.state === 'station' || tanker.state === 'drive',
  'tanker progresses toward station (not stuck forever)');
assert(tanker.countsForDefeat === false, 'tanker does not count for defeat');

console.log('\\nALL BUG-FIX TESTS PASSED');

FD.newGame('campaign', 1);
assert(Game.holder.length === 0, 'holder starts empty');
for (let i = 0; i < CONFIG.holder.max; i++) Game.holder.push(FD.makeCar(0));
assert(Game.holder.length === CONFIG.holder.max, 'holder max 5');
Game.light.phase = 'red';
Game.light.redT = 5;
assert(FD.entryToRingBlocked(), 'red light blocks ring entry');
Game.defeatT = 8;
step(30);
assert(Game.defeatT === 0, 'defeat timer reset while red');
assert(Game.state === 'play', 'no defeat during red');

FD.newGame('campaign', 1);
for (let i = 0; i < CONFIG.holder.max; i++) Game.holder.push(FD.makeCar(0));
Game.prepared = { ready: true, vehicle: FD.makeCar(0), factory: () => FD.makeCar(0) };
FD.releaseHolderBurst();
assert(Game.holder.length <= CONFIG.holder.max, 'holder never exceeds max');

FD.newGame('campaign', 1);
Game.stats.served = 29;
let sawTruck = false;
for (let i = 0; i < 40; i++) {
  if (FD.pickClientType(0) === 'truck') sawTruck = true;
}
assert(!sawTruck, 'no trucks before 30 served');
assert(FD.pickClientFuel('truck') === 'diesel', 'trucks always diesel');

Game.defeatT = 5;
FD.toggleTrafficLight();
assert(Game.defeatT === 0, 'red light toggling resets defeat timer');

assert(CONFIG.pump.bufferMax() > 0, 'CONFIG.pump.bufferMax() works');

FD.newGame('campaign', 1);
Game.money = 5000;
FD.actionBuildStation(Road.slots[1], 'a92');
const st = Road.slots[1].station;
for (let i = 0; i < CONFIG.station.pocketMax; i++) {
  const c = FD.makeCar(0);
  c.fuelKey = 'a92';
  st.pocket.push(c);
}
const probe = FD.makeCar(0);
probe.fuelKey = 'a92';
const modS = (v, m) => ((v % m) + m) % m;
probe.s = modS(Road.slots[1].s - 80, L);
FD.scanForStation(probe);
assert(!probe.pocketSlot, 'no pocket reservation when station pocket full');

const ghost = FD.makeCar(0);
ghost.fuelKey = 'a92';
st.pocket.push(ghost);
FD.cleanupVehicle(ghost);
assert(st.pocket.indexOf(ghost) < 0, 'cleanupVehicle clears pocket ghosts');

assert(FD.GBRBase.pos && FD.GBRBase.spawnS > 0, 'GBR base exists');
assert(!CONFIG.bgTrafficEnabled, 'neutral traffic disabled');

console.log('\\nALL CRITICAL REGRESSION TESTS PASSED');
`);

// --- ARCHITECTURE_NOTES.md ---
w('ARCHITECTURE_NOTES.md', `# Fuel Defense Module Split — Architecture Notes

Generated by \`scripts/assemble-modules.mjs\`.

## Circular dependencies (intentional, not fixed)

| Cycle | Modules | Why |
|-------|---------|-----|
| traffic ↔ spawn | \`trafficSystem.js\` ↔ \`spawnSystem.js\` | \`fillHolderSlot\` calls \`currentSpawnInterval\`; \`tickSpawnPipeline\` calls \`onHolderChanged\` / \`fillHolderSlot\` |
| traffic ↔ economy | \`trafficSystem.js\` → \`economySystem.js\` | \`toggleTrafficLight\` uses \`addFloat\` |
| spawn ↔ economy | \`spawnSystem.js\` → \`economySystem.js\` | \`callTanker\` / \`callGBR\` use \`addFloat\` |
| vehicle ↔ traffic | \`vehicle.js\` → \`trafficSystem.js\` | \`updateLane\` / \`outerClearForOvertake\` call \`outerLaneList\` |
| vehicle ↔ stationQueue | \`vehicle.js\` → \`stationQueue.js\` | Overtake completion may \`releasePocket\` |
| economy ↔ stationQueue | \`economySystem.js\` → \`stationQueue.js\` | \`finishFuel\` wakes pump queue / promotes pocket |
| defeat ↔ ui | \`defeatSystem.js\` → \`hud.js\`, \`stationPanel.js\` | \`endGame\` updates DOM via \`UI\` |
| renderer ↔ traffic | \`renderer.js\` → \`trafficSystem.js\` | \`isLightGreen\` for traffic light indicator |
| game ↔ many | \`game.js\` orchestrates all systems | By design |

ES module live bindings resolve these at call time (no top-level circular init).

## Issues found (documented, not fixed)

1. **\`CONFIG.pump.bufferMax()\`** — method body in \`balance.js\` references \`balance.station\` instead of runtime \`CONFIG\`; merged \`CONFIG\` in \`index.js\` preserves behavior.
2. **\`sortedStationSlots\`** — defined in \`world/map.js\`, exposed on \`window.FD\` via \`main.js\` import.
3. **\`update()\` split** — vehicle state machine in \`stationSystem.updateVehicles\`; buffer refill in \`postStationMaintenance\`; orchestration only in \`game.js\`.
4. **No debug overlay in monolith** — \`debug/debugOverlay.js\` is a no-op stub.
5. **\`holderBusy\`** — module-level flag kept in \`trafficSystem.js\` per assignment.
6. **Headless test** — uses \`globalThis.__FD_HEADLESS__\` to skip \`boot()\`; DOM is mocked minimally (no full canvas semantics).

## Module assignment summary

See task spec: traffic/spawn/defeat/economy/upgrade/station systems and stationQueue function lists match \`gamechunk.js\` extraction.
`);

console.log('assemble-modules: wrote all modules, index.html, css, test_headless.js, ARCHITECTURE_NOTES.md');

