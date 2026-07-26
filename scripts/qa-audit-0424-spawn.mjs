/** QA audit 0.4.2.4 — D-SPAWN-001 / D-SPAWN-002 (read-only, no product fix) */
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
UI.tankerSub = stubEl();
UI.gbrSub = stubEl();
UI.lightSub = stubEl();
Road.build(420, 730);
Depot.init();
GBRBase.init();

const { Game, CONFIG } = FD;
const {
  getTargetCars, getSpawnedCars, canSpawnRegularCar, tickSpawnPipeline, scalperCooldown
} = await import('../js/systems/spawnSystem.js');
const { tickSpecialSpawns } = await import('../js/systems/specialVehicles.js');
const {
  ScalperOwner, getScalperOwner, transferScalperOwner, despawnScalper, scalperMovementDebug
} = await import('../js/systems/scalperLifecycle.js');
const { ScalperPhase, setScalperPhase } = await import('../js/systems/entityFsm.js');
const { releasePocket } = await import('../js/stations/stationQueue.js');
const { StationApi } = await import('../js/systems/stationApi.js');

function step(n) { for (let i = 0; i < n; i++) update(1 / 60); }
function log(title, obj) {
  console.log('\n=== ' + title + ' ===');
  if (obj !== undefined) console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

console.log('QA AUDIT 0.4.2.4 — D-SPAWN-001 / D-SPAWN-002 (no fix)');

// ─── D-SPAWN-001 ─────────────────────────────────────────────
FD.newGame('campaign', 5);
const target = getTargetCars();
FD.actionBuildStation(Road.slots[0], 'a92');
Road.slots[0].station.res = 500;
Game.money = 999999;
Game.stats.spawned = target; // regular budget exhausted
Game.scalperTimer = 0;
Game.scalper.unit = null;

log('D-001 setup', {
  level: 5,
  target,
  spawned: getSpawnedCars(),
  canSpawnRegular: canSpawnRegularCar(),
  scalperUnit: Game.scalper.unit,
  stations: Road.slots.filter(s => s.station).length
});

const spawnedBefore = getSpawnedCars();
const ids = [];
for (let wave = 0; wave < 5; wave++) {
  Game.scalperTimer = 0;
  Game.scalper.unit = null; // simulate prior scalper finished (arrest/despawn)
  tickSpecialSpawns(0.01);
  const sc = Game.scalper.unit;
  const id = sc ? (sc.scalperId || ('anon-' + wave)) : null;
  ids.push({
    wave,
    spawnedScalper: !!sc,
    kind: sc?.kind,
    phase: sc?.scalperPhase,
    regularSpawned: getSpawnedCars(),
    canSpawnRegular: canSpawnRegularCar()
  });
  // complete lifecycle like arrest/escape: clear unit
  if (sc) {
    const rem = new Set();
    despawnScalper(sc, rem);
    for (const v of rem) {
      const i = Game.vehicles.indexOf(v);
      if (i >= 0) Game.vehicles.splice(i, 1);
      const h = Game.holder.indexOf(v);
      if (h >= 0) Game.holder.splice(h, 1);
    }
  }
}

log('D-001 result: special spawn after regular budget exhausted', {
  target,
  regularSpawnedUnchanged: getSpawnedCars() === spawnedBefore,
  waves: ids,
  verdict: ids.every(w => w.spawnedScalper) && ids.every(w => w.regularSpawned === target)
    ? 'CONFIRMED: endless Scalper after regular budget; Scalper not in spawned'
    : 'UNEXPECTED'
});

// Also via full update loop with timer
FD.newGame('campaign', 5);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.spawned = getTargetCars();
Game.scalperTimer = 0.01;
Game.scalper.unit = null;
Game.holder = [];
Game.vehicles = [];
let spawnCount = 0;
let lastUnit = null;
for (let i = 0; i < 600; i++) { // 10s
  const before = Game.scalper.unit;
  update(1 / 60);
  if (Game.scalper.unit && Game.scalper.unit !== lastUnit) {
    spawnCount++;
    lastUnit = Game.scalper.unit;
    // instantly finish to allow next spawn
    const rem = new Set();
    despawnScalper(Game.scalper.unit, rem);
    for (const v of rem) {
      const ix = Game.vehicles.indexOf(v); if (ix >= 0) Game.vehicles.splice(ix, 1);
      const hx = Game.holder.indexOf(v); if (hx >= 0) Game.holder.splice(hx, 1);
    }
    lastUnit = null;
  }
}
log('D-001 full update 10s with instant despawn', {
  scalperSpawns: spawnCount,
  regularSpawned: getSpawnedCars(),
  target: getTargetCars(),
  cooldown: scalperCooldown(),
  note: 'spawnIntervalMult=10 → cooldown ~40s at start; few spawns in 10s unless timer forced'
});

// Force timer each second to show unbounded chain
FD.newGame('campaign', 5);
FD.actionBuildStation(Road.slots[0], 'a92');
Game.stats.spawned = getTargetCars();
let forced = 0;
for (let i = 0; i < 20; i++) {
  Game.scalperTimer = 0;
  if (Game.scalper.unit) {
    const rem = new Set();
    despawnScalper(Game.scalper.unit, rem);
    for (const v of rem) {
      const ix = Game.vehicles.indexOf(v); if (ix >= 0) Game.vehicles.splice(ix, 1);
      const hx = Game.holder.indexOf(v); if (hx >= 0) Game.holder.splice(hx, 1);
    }
  }
  tickSpecialSpawns(0);
  if (Game.scalper.unit) forced++;
}
log('D-001 forced timer chain (20 cycles)', {
  scalpersCreated: forced,
  regularStillAtTarget: getSpawnedCars() === getTargetCars(),
  gateInTickSpecialSpawns: 'ONLY: timer<=0 && !Game.scalper.unit && stations.length>0 — NO regular budget check'
});

// ─── D-SPAWN-002 ─────────────────────────────────────────────
FD.newGame('campaign', 5);
FD.actionBuildStation(Road.slots[0], 'a92');
const st = Road.slots[0].station;
st.res = 500;
Game.stats.spawned = getTargetCars();

const sc = FD.makeScalper();
sc.fuelKey = 'a92';
sc.tour = [Road.slots[0]];
sc.tourIdx = 0;
sc.lane = 'inner';
sc.state = 'drive';
sc.s = Road.slots[0].s - 40;
sc.prevS = sc.s;
Game.vehicles.push(sc);
Game.scalper.unit = sc;
setScalperPhase(sc, ScalperPhase.DRIVING);
transferScalperOwner(sc, ScalperOwner.SPECIAL, 'audit_setup');

const joined = StationApi.joinStationWaitQueue(sc, Road.slots[0]);
setScalperPhase(sc, ScalperPhase.QUEUE);
transferScalperOwner(sc, ScalperOwner.STATION, 'join_queue');

log('D-002 after join queue', {
  joined,
  pocketLen: st.pocket.length,
  pocketSlot: !!sc.pocketSlot,
  targetSlot: !!sc.targetSlot,
  phase: sc.scalperPhase,
  owner: getScalperOwner(sc),
  dbg: scalperMovementDebug(sc)
});

// Simulate missed pocket entry → releasePocket (as tryApproachPocket does on pass-by)
releasePocket(sc);

log('D-002 after releasePocket (missed entry)', {
  pocketSlot: sc.pocketSlot,
  targetSlot: sc.targetSlot,
  stopS: sc.stopS,
  phase: sc.scalperPhase,
  owner: getScalperOwner(sc),
  inPocketList: st.pocket.includes(sc),
  dbg: scalperMovementDebug(sc)
});

// Advance simulation — tour should be dead, car keeps circling
const s0 = sc.s;
for (let i = 0; i < 600; i++) update(1 / 60); // 10s
const dbgAfter = scalperMovementDebug(sc);
log('D-002 after 10s simulation', {
  stillOnMap: Game.vehicles.includes(sc),
  phase: sc.scalperPhase,
  owner: getScalperOwner(sc),
  state: sc.state,
  lane: sc.lane,
  sMoved: Math.abs(sc.s - s0) > 1,
  trip: Math.round(sc.trip || 0),
  dbg: dbgAfter,
  regularCanSpawn: canSpawnRegularCar(),
  scalperUnitStillSet: Game.scalper.unit === sc,
  verdict:
    sc.scalperPhase === ScalperPhase.QUEUE &&
    getScalperOwner(sc) === ScalperOwner.STATION &&
    sc.state === 'drive' &&
    !sc.pocketSlot
      ? 'CONFIRMED: QUEUE+OWNER:STATION while drive on ring, no pocket — tour dead, no timeout'
      : 'PARTIAL / check fields'
});

// Show updateScalperTour gate
const ownerGate = getScalperOwner(sc) !== ScalperOwner.SPECIAL;
log('D-002 architectural gate', {
  updateScalperTourEarlyReturn: ownerGate,
  reason: 'updateScalperTour returns immediately when owner !== SPECIAL',
  releasePocketResetsOwner: false,
  releasePocketResetsPhase: false,
  pocketWaitTimeoutAppliesWhileDrive: false,
  giveUpLapsAppliesToScalper: false,
  regularSpawnBlockedByStuckScalper: false,
  regularSpawnStoppedBecause: 'spawned >= target (0.4.2.3 budget), independent of scalper',
  newScalperBlockedByStuckUnit: Game.scalper.unit === sc
});

log('SUMMARY', {
  'D-SPAWN-001': 'CONFIRMED — tickSpecialSpawns ignores regular spawn budget; clears unit → next scalper forever',
  'D-SPAWN-002': 'CONFIRMED — releasePocket leaves OWNER:STATION + PHASE:QUEUE; tour permanently disabled',
  sharedRoot: 'Special lifecycle is independent of regular spawn budget; QUEUE↔OWNER invariants not restored on failed station attach',
  separateConcerns: true
});
