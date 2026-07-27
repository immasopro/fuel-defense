/**
 * QA 0.4.3.2 — spawn budget / Scalper endgate / fuel crisis / win-lose (read-only audit).
 * Run: node scripts/qa-audit-0432-spawn-endgame.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  documentElement: {
    requestFullscreen: () => {},
    style: { setProperty: () => {} },
    dataset: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} }
  },
  exitFullscreen: () => {}
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
const lsStore = {};
globalThis.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; },
  clear: () => { Object.keys(lsStore).forEach(k => delete lsStore[k]); }
};

const { FD } = await import('../js/main.js');
const { update } = await import('../js/game.js');
const { Road } = await import('../js/world/roadNetwork.js');
const { Depot, GBRBase } = await import('../js/world/map.js');
const { UI } = await import('../js/ui/hud.js');
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
UI.screenEnd = stubEl();
UI.endTitle = stubEl();
UI.endDesc = stubEl();
UI.endStats = stubEl();
UI.btnNext = stubEl();
UI.btnRestart = stubEl();
UI.btnMenu = stubEl();
Road.build(420, 730);
Depot.init();
GBRBase.init();

const { Game, CONFIG } = FD;
const {
  getTargetCars, getSpawnedCars, canSpawnRegularCar, canSpawnScalper,
  getSpecialSpawnLimit, getSpecialSpawnReserve, spawnRegularCar, tickSpawnPipeline
} = await import('../js/systems/spawnSystem.js');
const { tickSpecialSpawns } = await import('../js/systems/specialVehicles.js');
const {
  checkFuelCrisis, hasWaitingClients, isFuelExhausted, isTankerCreditBlocked, endGame
} = await import('../js/systems/defeatSystem.js');
const { canOrderTanker, tankerDeliveryCost, tankerCreditLimit } = await import('../js/systems/economySystem.js');
const { quoteFuelOrder, canAffordFuelOrder } = await import('../js/systems/fuelOrderSystem.js');
const { forceTankerReadyForTests, FleetState, initLogistics } = await import('../js/systems/tankerLogistics.js');
const { ScalperPhase, setScalperPhase } = await import('../js/systems/entityFsm.js');
const { despawnScalper } = await import('../js/systems/scalperLifecycle.js');

function step(n) { for (let i = 0; i < n; i++) update(1 / 60); }

function snap(label) {
  const cars = Game.vehicles.filter(v => v.kind === 'car').length;
  const scalpers = Game.vehicles.filter(v => v.kind === 'scalper').length;
  const tankers = Game.vehicles.filter(v => v.kind === 'tanker').length;
  const gbrs = Game.vehicles.filter(v => v.kind === 'gbr').length;
  const holderCars = Game.holder.filter(v => v.kind === 'car').length;
  const holderScalper = Game.holder.filter(v => v.kind === 'scalper').length;
  const target = getTargetCars();
  return {
    label,
    targetCars: target,
    spawnedCars: getSpawnedCars(),
    servedCars: Game.stats.served,
    vehiclesOnMap: Game.vehicles.length,
    breakdown: { cars, scalpers, tankers, gbrs, holder: Game.holder.length, holderCars, holderScalper },
    canSpawnRegular: canSpawnRegularCar(),
    canSpawnScalper: canSpawnScalper(),
    specialLimit: getSpecialSpawnLimit(),
    specialReserve: getSpecialSpawnReserve(),
    gameState: Game.state,
    defeatReason: Game.defeatReason,
    money: Game.money,
    scalperUnit: !!Game.scalper?.unit
  };
}

function log(title, obj) {
  console.log('\n=== ' + title + ' ===');
  console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

const report = { version: '0.4.3.2', level1: {}, level5: {}, partial: {}, afterFullSpawn: {}, fuelCrisis: {}, winLose: {} };

// ─── Level 1 milestones ───
FD.newGame('campaign', 1);
report.level1.start = snap('L1 start');
log('L1 start', report.level1.start);

// Force spawn until budget exhausted
Game.money = 999999;
FD.actionBuildStation(Road.slots[0], 'a92');
Road.slots[0].station.res = 5000;
Game.depot.res = 50000;
while (canSpawnRegularCar()) {
  const c = spawnRegularCar(0);
  if (!c) break;
  Game.vehicles.push(c);
  c.state = 'drive';
  c.s = 0;
}
report.level1.spawnStopped = snap('L1 spawn stopped (budget full)');
log('L1 spawn stopped', report.level1.spawnStopped);

FD.newGame('campaign', 1);
Game.stats.spawned = 90;
Game.stats.served = 90;
report.level1.at90 = snap('L1 served/spawned 90/100');
log('L1 90/100', report.level1.at90);

Game.stats.spawned = 95;
Game.stats.served = 95;
report.level1.at95 = snap('L1 served/spawned 95/100');
log('L1 95/100', report.level1.at95);

Game.stats.spawned = 100;
Game.stats.served = 100;
Game.money = 10000;
// Leave cars on map
Game.vehicles = [FD.makeCar(0), FD.makeCar(0)];
Game.vehicles.forEach(c => { c.state = 'drive'; c.s = 10; });
report.level1.at100_beforeWinCheck = snap('L1 100/100 before update');
update(1 / 60);
report.level1.at100_afterUpdate = snap('L1 100/100 after update (win?)');
log('L1 100/100', { before: report.level1.at100_beforeWinCheck, after: report.level1.at100_afterUpdate });

// Bankruptcy at 100
FD.newGame('campaign', 1);
Game.stats.spawned = 100;
Game.stats.served = 100;
Game.money = -1000;
update(1 / 60);
report.level1.at100_bankruptcy = snap('L1 100/100 money<0');
log('L1 100 bankruptcy', report.level1.at100_bankruptcy);

// ─── Level 5 Scalper gate ───
FD.newGame('campaign', 5);
FD.actionBuildStation(Road.slots[0], 'a92');
const L5 = {
  target: getTargetCars(),
  reserve: getSpecialSpawnReserve(),
  limit: getSpecialSpawnLimit()
};
report.level5.meta = L5;
log('L5 meta', L5);

Game.stats.spawned = L5.limit - 1;
report.level5.beforeLimit = {
  ...snap('L5 spawned=limit-1'),
  canSpawnScalper: canSpawnScalper()
};
Game.stats.spawned = L5.limit;
report.level5.atLimit = {
  ...snap('L5 spawned=limit'),
  canSpawnScalper: canSpawnScalper()
};
Game.stats.spawned = L5.target - 1;
report.level5.lastRegularOk = {
  ...snap('L5 spawned=target-1'),
  canSpawnRegular: canSpawnRegularCar(),
  canSpawnScalper: canSpawnScalper()
};
log('L5 gate', {
  beforeLimit: report.level5.beforeLimit.canSpawnScalper,
  atLimit: report.level5.atLimit.canSpawnScalper,
  nearEndRegular: report.level5.lastRegularOk.canSpawnRegular,
  nearEndScalper: report.level5.lastRegularOk.canSpawnScalper
});

// Scalper among last cars: spawn scalper then try more while near limit
FD.newGame('campaign', 5);
Game.money = 999999;
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.spawned = L5.limit - 1;
Game.scalperTimer = 0;
Game.scalper.unit = null;
tickSpecialSpawns(0.01, 0);
const scAmong = Game.scalper.unit;
report.level5.scalperAmongLast = {
  spawned: Game.stats.spawned,
  scalperSpawned: !!scAmong,
  spawnedUnchangedByScalper: Game.stats.spawned === L5.limit - 1,
  canSpawnScalperAfter: canSpawnScalper(),
  note: 'Scalper does not increment stats.spawned'
};
log('L5 Scalper among last', report.level5.scalperAmongLast);

// Scalper as "last" special while regulars continue to target
Game.stats.spawned = L5.limit;
Game.scalperTimer = 0;
const beforeSc2 = !!Game.scalper.unit;
tickSpecialSpawns(0.01, 0);
report.level5.scalperBlockedAtLimit = {
  hadExisting: beforeSc2,
  stillOnlyOneOrNone: !Game.scalper.unit || Game.scalper.unit === scAmong,
  canSpawnScalper: canSpawnScalper(),
  newScalperCreated: Game.scalper.unit && Game.scalper.unit !== scAmong && !beforeSc2
};
// Clear and confirm no new at limit
FD.newGame('campaign', 5);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.spawned = L5.limit;
Game.scalperTimer = 0;
Game.scalper.unit = null;
tickSpecialSpawns(0.01, 0);
report.level5.noNewScalperAtLimit = {
  spawned: Game.stats.spawned,
  scalperUnit: !!Game.scalper.unit,
  canSpawnScalper: canSpawnScalper()
};
log('L5 no Scalper at limit', report.level5.noNewScalperAtLimit);

// Existing Scalper survives past limit; caught by GBR / leaves map
FD.newGame('campaign', 5);
Game.money = 999999;
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.spawned = L5.limit; // past gate
const scKeep = FD.makeScalper();
Game.scalper.unit = scKeep;
Game.vehicles = [scKeep];
scKeep.state = 'drive';
scKeep.s = 100;
report.level5.existingPastLimit = {
  spawned: Game.stats.spawned,
  scalperOnMap: Game.vehicles.some(v => v.kind === 'scalper'),
  canSpawnScalper: canSpawnScalper(),
  existingKept: !!Game.scalper.unit
};
const rem = new Set();
despawnScalper(scKeep, rem);
Game.vehicles = Game.vehicles.filter(v => !rem.has(v));
report.level5.afterDespawn = {
  scalperUnit: !!Game.scalper.unit,
  vehiclesOnMap: Game.vehicles.length,
  canSpawnScalper: canSpawnScalper(),
  note: 'After despawn past limit, new Scalper still blocked'
};
log('L5 existing Scalper past limit + despawn', {
  keep: report.level5.existingPastLimit,
  after: report.level5.afterDespawn
});

// Several Scalper in a row (while under limit)
FD.newGame('campaign', 5);
Game.money = 999999;
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.spawned = 50;
let sequential = 0;
for (let i = 0; i < 5; i++) {
  Game.scalper.unit = null;
  Game.scalperTimer = 0;
  tickSpecialSpawns(0.01, 0);
  if (Game.scalper.unit) {
    sequential++;
    const rem2 = new Set();
    despawnScalper(Game.scalper.unit, rem2);
    Game.vehicles = Game.vehicles.filter(v => !rem2.has(v));
    Game.scalper.unit = null;
  }
}
report.level5.sequentialScalpers = {
  spawnedUnderLimit: 50,
  sequentialSpawns: sequential,
  note: 'Only one Scalper at a time (Game.scalper.unit gate); sequential after despawn OK while under limit'
};
log('L5 sequential Scalper', report.level5.sequentialScalpers);

// ─── Partial spawn spawned=95 served=95 ───
FD.newGame('campaign', 1);
Game.stats.spawned = 95;
Game.stats.served = 95;
report.partial.l1_95_95 = {
  ...snap('partial 95/95'),
  expectRegularContinue: true,
  expectScalperBlocked: true,
  actualRegular: canSpawnRegularCar(),
  actualScalper: canSpawnScalper()
};
log('Partial 95/95', report.partial.l1_95_95);

// ─── After full spawn, cars still on map ───
FD.newGame('campaign', 1);
Game.stats.spawned = 100;
Game.stats.served = 80;
Game.vehicles = [FD.makeCar(0), FD.makeCar(0), FD.makeCar(0)];
Game.vehicles.forEach(c => { c.state = 'drive'; });
report.afterFullSpawn = {
  ...snap('spawned=target served=80 cars on map'),
  canSpawnRegular: canSpawnRegularCar(),
  winNotYet: Game.stats.served < getTargetCars(),
  note: 'Spawn stopped; win waits for served>=target; cars may remain on map'
};
log('After full spawn', report.afterFullSpawn);

// ─── Fuel crisis matrix ───
function crisisCase(name, setup) {
  FD.newGame('campaign', 1);
  Game.money = 50000;
  setup();
  const waiting = hasWaitingClients();
  const exhausted = isFuelExhausted();
  const creditBlocked = isTankerCreditBlocked();
  const wouldCrisis = waiting && exhausted && creditBlocked;
  const before = Game.state;
  checkFuelCrisis();
  return {
    name,
    waiting,
    exhausted,
    creditBlocked,
    wouldCrisis,
    triggered: Game.state === 'over' && Game.defeatReason === 'fuel_crisis',
    state: Game.state,
    money: Game.money,
    depotRes: Game.depot.res,
    stations: Road.slots.filter(s => s.station).map(s => ({ i: s.i, res: s.station.res, fuel: s.station.fuelKey })),
    hasReadyTanker: !!Game.logistics?.trucks?.some(t => t.state === 'READY'),
    minQuote20: (() => { try { return quoteFuelOrder(20); } catch { return null; } })(),
    canAffordMin: (() => { try { return canAffordFuelOrder(quoteFuelOrder(20)); } catch { return null; } })(),
    canOrder: canOrderTanker()
  };
}

const minCost = tankerDeliveryCost();
const creditFloor = tankerCreditLimit(minCost);

report.fuelCrisis.policy = {
  minDeliveryCost: minCost,
  creditLimitRule: 'bal - cost >= tankerCreditLimit(cost)',
  creditFloorForMin: creditFloor,
  note: 'Crisis needs: waiting clients + all fuel empty + cannot order min 20% tanker'
};

report.fuelCrisis.cases = [];

// Fuel insufficient, stations exist, waiting clients, tanker ready, can pay
report.fuelCrisis.cases.push(crisisCase('fuel empty, tanker ready, can pay → NO crisis', () => {
  FD.actionBuildStation(Road.slots[0], 'a92');
  Road.slots[0].station.res = 0;
  Game.depot.res = 0;
  Game.stats.served = 10;
  Game.money = 100000;
  forceTankerReadyForTests();
  const car = FD.makeCar(0);
  car.fuelKey = 'a92';
  car.served = false;
  Game.vehicles.push(car);
}));

// Fuel empty, tanker ready, credit ok (slightly negative ok)
report.fuelCrisis.cases.push(crisisCase('fuel empty, ready, credit OK (money=cost+floor)', () => {
  FD.actionBuildStation(Road.slots[0], 'a92');
  Road.slots[0].station.res = 0;
  Game.depot.res = 0;
  Game.stats.served = 10;
  forceTankerReadyForTests();
  const q = quoteFuelOrder(20);
  Game.money = q.cost + creditFloor; // exactly at limit edge — canOrder uses bal-c >= floor
  // actually canOrder: bal - c >= floor → money >= c + floor
  const car = FD.makeCar(0);
  car.served = false;
  Game.vehicles.push(car);
}));

// Fuel empty, tanker ready, credit exhausted
report.fuelCrisis.cases.push(crisisCase('fuel empty, ready, credit EXHAUSTED → crisis', () => {
  FD.actionBuildStation(Road.slots[0], 'a92');
  Road.slots[0].station.res = 0;
  Game.depot.res = 0;
  Game.stats.served = 10;
  forceTankerReadyForTests();
  Game.money = -80000; // below credit
  const car = FD.makeCar(0);
  car.served = false;
  Game.vehicles.push(car);
}));

// Fuel empty, NO ready tanker (still preparing), credit exhausted
report.fuelCrisis.cases.push(crisisCase('fuel empty, tanker PREPARING, credit exhausted → crisis', () => {
  FD.actionBuildStation(Road.slots[0], 'a92');
  Road.slots[0].station.res = 0;
  Game.depot.res = 0;
  Game.stats.served = 10;
  Game.money = -80000;
  // default logistics: truck PREPARING at start
  const car = FD.makeCar(0);
  car.served = false;
  Game.vehicles.push(car);
}));

// Fuel empty, no waiting (served already done) → no crisis
report.fuelCrisis.cases.push(crisisCase('fuel empty, served>=target, no waiting cars → NO crisis', () => {
  FD.actionBuildStation(Road.slots[0], 'a92');
  Road.slots[0].station.res = 0;
  Game.depot.res = 0;
  Game.stats.served = 100;
  Game.stats.spawned = 100;
  Game.money = -80000;
  forceTankerReadyForTests();
  // no unserved cars
}));

// Fuel NOT empty → no crisis
report.fuelCrisis.cases.push(crisisCase('depot has fuel → NO crisis', () => {
  FD.actionBuildStation(Road.slots[0], 'a92');
  Road.slots[0].station.res = 0;
  Game.depot.res = 100;
  Game.stats.served = 10;
  Game.money = -80000;
  forceTankerReadyForTests();
  const car = FD.makeCar(0);
  car.served = false;
  Game.vehicles.push(car);
}));

// Multi fuel types on map, station only a92 empty, diesel car waiting, depot empty
report.fuelCrisis.cases.push(crisisCase('multi fuel cars, all station+depot empty, credit dead → crisis', () => {
  FD.actionBuildStation(Road.slots[0], 'a92');
  Road.slots[0].station.res = 0;
  Game.depot.res = 0;
  Game.stats.served = 10;
  Game.money = -80000;
  forceTankerReadyForTests();
  const c1 = FD.makeCar(0); c1.fuelKey = 'a92'; c1.served = false;
  const c2 = FD.makeCar(0); c2.fuelKey = 'diesel'; c2.served = false;
  Game.vehicles.push(c1, c2);
}));

// Min tanker unavailable? — if no trucks at all
report.fuelCrisis.cases.push(crisisCase('no logistics trucks (edge) + empty + waiting', () => {
  FD.actionBuildStation(Road.slots[0], 'a92');
  Road.slots[0].station.res = 0;
  Game.depot.res = 0;
  Game.stats.served = 10;
  Game.money = -80000;
  Game.logistics = { trucks: [], prepSlot: null };
  const car = FD.makeCar(0);
  car.served = false;
  Game.vehicles.push(car);
}));

log('Fuel crisis policy', report.fuelCrisis.policy);
log('Fuel crisis cases', report.fuelCrisis.cases);

// ─── Win/Lose summary from code ───
report.winLose = {
  win: {
    where: 'js/game.js update()',
    condition: 'campaign && served >= targetCars && money >= 0 → endGame(true)',
    bankruptcy: 'served >= target && money < 0 → endGame(false, bankruptcy)'
  },
  lose_traffic: {
    where: 'js/systems/defeatSystem.js updateDefeatTimer',
    condition: 'green light + holder full + entry blocked for CONFIG.defeatTime'
  },
  lose_fuel_crisis: {
    where: 'js/systems/defeatSystem.js checkFuelCrisis',
    condition: 'hasWaitingClients && isFuelExhausted && isTankerCreditBlocked'
  },
  spawnBudget: {
    regular: 'spawned < targetCars',
    scalper: 'spawned < target - reserve (≤1000→10, >1000→20)',
    scalperCountsSpawned: false
  },
  servedIncrement: 'stationSystem: when car leaves after fuel (kind===car && served)'
};
log('Win/Lose', report.winLose);

console.log('\n========== QA 0.4.3.2 AUDIT COMPLETE ==========');
console.log(JSON.stringify({
  L1_target: report.level1.start.targetCars,
  L1_specialLimit: report.level1.start.specialLimit,
  L5_target: report.level5.meta.target,
  L5_specialLimit: report.level5.meta.limit,
  winAt100: report.level1.at100_afterUpdate.gameState,
  bankruptcyAt100: report.level1.at100_bankruptcy.gameState,
  partial95_regular: report.partial.l1_95_95.actualRegular,
  partial95_scalper: report.partial.l1_95_95.actualScalper,
  crisisTriggered: report.fuelCrisis.cases.filter(c => c.triggered).map(c => c.name)
}, null, 2));
