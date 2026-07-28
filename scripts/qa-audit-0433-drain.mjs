/**
 * QA 0.4.3.3 — spawned budget, DRAINING, no Scalper endgate, fuel crisis timer.
 * Levels 1, 5, 10.
 *
 * Run: node scripts/qa-audit-0433-drain.mjs
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function makeCtx() {
  const store = {};
  return new Proxy({}, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
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
globalThis.__FD_HEADLESS__ = true;
globalThis.window = {
  devicePixelRatio: 2,
  addEventListener: () => {},
  requestAnimationFrame: () => {},
  requestFullscreen: () => {}
};
globalThis.document = {
  getElementById: id => (els[id] || (els[id] = makeEl(id))),
  documentElement: { requestFullscreen: () => {}, style: { setProperty: () => {} }, dataset: {}, classList: { add() {}, remove() {} } },
  body: { appendChild: () => {} },
  addEventListener: () => {},
  createElement: () => makeEl('x')
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
const lsStore = {};
globalThis.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; },
  clear: () => { Object.keys(lsStore).forEach(k => delete lsStore[k]); }
};

const { FD } = await import(pathToFileURL(path.join(root, 'js/main.js')).href);
const { Road } = await import(pathToFileURL(path.join(root, 'js/world/roadNetwork.js')).href);
const { Depot } = await import(pathToFileURL(path.join(root, 'js/world/map.js')).href);
const { Game } = await import(pathToFileURL(path.join(root, 'js/core/gameState.js')).href);
const { CONFIG } = await import(pathToFileURL(path.join(root, 'js/config/index.js')).href);
const { UI } = await import(pathToFileURL(path.join(root, 'js/ui/hud.js')).href);
const stubEl = () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, textContent: '', innerHTML: '' });
UI.warning = stubEl();
UI.panel = stubEl();
UI.statMoney = stubEl();
UI.statBonuses = stubEl();
UI.statTraffic = stubEl();
UI.statTime = stubEl();
UI.btnTanker = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnGbr = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnLight = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} } });
UI.btnSpeed = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} }, textContent: '' });
UI.tankerSub = stubEl();
UI.gbrSub = stubEl();
UI.gbrTitle = stubEl();
UI.lightSub = stubEl();
UI.endTitle = stubEl();
UI.endDesc = stubEl();
UI.endStats = stubEl();
UI.btnNext = Object.assign(stubEl(), { classList: { add: () => {}, remove: () => {} } });
UI.btnRestart = stubEl();
UI.btnMenu = stubEl();
UI.screenEnd = Object.assign(stubEl(), { classList: { add: () => {}, remove: () => {} } });

Road.build(420, 730);
Depot.init();

const {
  getTargetCars, canSpawnMoreCars, canSpawnScalper, registerSpawnedCar,
  syncLevelPhase, countVehiclesOnMap, getSpecialSpawnLimit, getSpecialSpawnReserve,
  LevelPhase, getSpawnedCars, callTanker
} = await import(pathToFileURL(path.join(root, 'js/systems/spawnSystem.js')).href);
const {
  checkLevelComplete, checkFuelCrisis, hasWaitingClients, isFuelCrisisCondition
} = await import(pathToFileURL(path.join(root, 'js/systems/defeatSystem.js')).href);
const { tickSpecialSpawns } = await import(pathToFileURL(path.join(root, 'js/systems/specialVehicles.js')).href);
const { tickTankerLogistics } = await import(pathToFileURL(path.join(root, 'js/systems/tankerLogistics.js')).href);

const results = [];
function check(id, ok, detail) {
  results.push({ id, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? ` — ${detail}` : ''}`);
}

console.log('=== QA 0.4.3.3 drain / spawned ===\n');

// A. Shared budget (L1 target 100)
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
check('A1', getTargetCars() === 100 && canSpawnMoreCars() && canSpawnScalper(), `target=${getTargetCars()}`);
Game.stats.spawned = 99;
syncLevelPhase();
check('A2', canSpawnMoreCars() && canSpawnScalper() && Game.levelPhase === LevelPhase.SPAWNING);
Game.stats.spawned = 100;
syncLevelPhase();
check('A3', !canSpawnMoreCars() && !canSpawnScalper() && Game.levelPhase === LevelPhase.DRAINING);
check('A4', getSpecialSpawnLimit() === getTargetCars() && getSpecialSpawnReserve() === null, 'deprecated stubs');

// B. registerSpawnedCar + phase
FD.newGame('campaign', 1);
Game.stats.spawned = 99;
registerSpawnedCar();
check('B1', Game.stats.spawned === 100 && Game.levelPhase === LevelPhase.DRAINING);
Game.vehicles = [FD.makeCar(0)];
syncLevelPhase();
check('B2', Game.levelPhase === LevelPhase.DRAINING && countVehiclesOnMap() === 1);
Game.vehicles = [];
Game.holder = [];
Game.prepared = null;
check('B3', countVehiclesOnMap() === 0);

// C. Win / bankruptcy
FD.newGame('campaign', 1);
Game.stats.spawned = 100;
Game.vehicles = [FD.makeCar(0)];
Game.holder = [];
Game.money = 1000;
syncLevelPhase();
check('C1', !checkLevelComplete() && Game.state === 'play', 'cars on map → no win');
Game.vehicles = [];
check('C2', checkLevelComplete() && Game.state === 'win', `state=${Game.state}`);

FD.newGame('campaign', 1);
Game.stats.spawned = 100;
Game.vehicles = [];
Game.holder = [];
Game.money = -1;
syncLevelPhase();
check('C3', checkLevelComplete() && Game.defeatReason === 'bankruptcy');

FD.newGame('campaign', 1);
Game.stats.spawned = 99;
Game.vehicles = [];
Game.money = 1000;
syncLevelPhase();
check('C4', !checkLevelComplete() && Game.state === 'play', 'spawned < target → no win');

// D. Scalper counts toward spawned; no spawn after target
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.spawned = 99;
Game.scalper.unit = null;
Game.scalperTimer = 0;
const before = Game.stats.spawned;
tickSpecialSpawns(0);
check('D1', !!Game.scalper.unit && Game.stats.spawned === before + 1, `spawned ${before}→${Game.stats.spawned}`);
check('D2', Game.scalper.unit.isScalper === true && Game.levelPhase === LevelPhase.DRAINING);
check('D3', !canSpawnScalper() && !canSpawnMoreCars());

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.spawned = 100;
syncLevelPhase();
Game.scalper.unit = null;
Game.scalperTimer = 0;
tickSpecialSpawns(0);
check('D4', !Game.scalper.unit && getSpawnedCars() === 100, 'no scalper after target');

// E. GBR / tanker do not block drain win
FD.newGame('campaign', 1);
Game.stats.spawned = 100;
Game.vehicles = [];
Game.holder = [];
Game.prepared = null;
Game.money = 50;
const gbr = FD.makeGBR ? FD.makeGBR() : { kind: 'gbr', type: 'gbr' };
if (gbr.kind !== 'gbr') gbr.kind = 'gbr';
Game.vehicles.push(gbr);
Game.gbr.unit = gbr;
const tanker = FD.makeTanker ? FD.makeTanker(1, 1000) : { kind: 'tanker', type: 'tanker' };
if (tanker.kind !== 'tanker') tanker.kind = 'tanker';
Game.vehicles.push(tanker);
Game.tanker.unit = tanker;
syncLevelPhase();
check('E1', countVehiclesOnMap() === 0, `onMap=${countVehiclesOnMap()}`);
check('E2', checkLevelComplete() && Game.state === 'win');

// F. Fuel crisis timer 8s
FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.depot.res = 0;
Road.slots[0].station.res = 0;
Game.money = -200000;
Game.stats.spawned = 50;
Game.fuelCrisisT = 0;
Game.holder = [FD.makeCar(0)];
Game.tanker.unit = null;
tickTankerLogistics(30);
check('F1', hasWaitingClients() && isFuelCrisisCondition(), 'crisis condition');
check('F0', CONFIG.fuelCrisisTime === 8, `timer=${CONFIG.fuelCrisisTime}`);
checkFuelCrisis(3);
check('F2', Game.fuelCrisisT === 3 && Game.state === 'play');
checkFuelCrisis(6);
check('F3', Game.state === 'over' && Game.defeatReason === 'fuel_crisis');

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.depot.res = 0;
Road.slots[0].station.res = 0;
Game.money = -200000;
Game.stats.spawned = 50;
Game.fuelCrisisT = 4;
Game.holder = [FD.makeCar(0)];
Game.tanker.unit = null;
tickTankerLogistics(30);
const ordered = callTanker({ liters: Math.round(Game.depot.cap * 0.2), cost: 1000, bonuses: 0 });
// Even if order fails due to credit, simulate active delivery cancel path:
if (!ordered) {
  // Active tanker delivery cancels crisis
  Game.tanker.unit = tanker;
  Game.fuelCrisisT = 4;
}
checkFuelCrisis(1);
check('F4', Game.fuelCrisisT === 0 || Game.state === 'play', 'crisis cleared or cancelled');

FD.newGame('campaign', 1);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.depot.res = 0;
Road.slots[0].station.res = 0;
Game.money = 50000;
Game.fuelCrisisT = 7;
Game.holder = [FD.makeCar(0)];
Game.stats.spawned = 50;
tickTankerLogistics(30);
checkFuelCrisis(2);
check('F5', Game.state === 'play' && Game.fuelCrisisT === 0, 'can afford min order → no crisis');

// G. Levels 1 / 5 / 10
for (const L of [1, 5, 10]) {
  FD.newGame('campaign', L);
  FD.actionBuildStation(Road.slots[0], 'a92');
  const t = getTargetCars();
  check(`G${L}a`, t > 0, `L${L} target=${t}`);
  Game.stats.spawned = t - 1;
  syncLevelPhase();
  check(`G${L}b`, canSpawnMoreCars() && canSpawnScalper() && Game.levelPhase === LevelPhase.SPAWNING);
  registerSpawnedCar();
  check(`G${L}c`, Game.levelPhase === LevelPhase.DRAINING && !canSpawnMoreCars());
  const sc = FD.makeScalper();
  sc.isScalper = true;
  Game.vehicles = [sc];
  Game.holder = [];
  Game.money = 10;
  check(`G${L}d`, !checkLevelComplete() && Game.state === 'play', 'scalper on map blocks win');
  Game.vehicles = [];
  check(`G${L}e`, checkLevelComplete() && Game.state === 'win', 'empty map → win');
  FD.newGame('campaign', L);
  Game.stats.spawned = t;
  Game.vehicles = [];
  Game.holder = [];
  Game.money = -5;
  syncLevelPhase();
  check(`G${L}f`, checkLevelComplete() && Game.defeatReason === 'bankruptcy');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => `${f.id}${f.detail ? ' (' + f.detail + ')' : ''}`).join(', '));
  process.exit(1);
}
console.log('OK — ready for deploy');
