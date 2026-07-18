/**
 * Accelerated stress test for patch 0.2.2 — StationSystem stability.
 * Run: node fuel_defense/scripts/stress-test.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function makeCtx() {
  const store = {};
  return new Proxy({}, {
    get(t, k) { if (k in store) return store[k]; if (k === 'measureText') return () => ({ width: 10 }); return () => {}; },
    set(t, k, v) { store[k] = v; return true; }
  });
}
function makeEl(id) {
  return {
    id, style: {}, dataset: {}, disabled: false, _cls: new Set(['hidden']),
    classList: { add: c => {}, remove: c => {}, contains: () => false },
    innerHTML: '', textContent: '', addEventListener: () => {},
    querySelector: () => makeEl(id + '-c'), querySelectorAll: () => [], closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 730 }),
    getContext: () => makeCtx(), width: 0, height: 0
  };
}
const els = {};
globalThis.__FD_HEADLESS__ = true;
globalThis.window = { devicePixelRatio: 2, addEventListener: () => {}, requestAnimationFrame: () => {} };
globalThis.document = {
  getElementById: id => (els[id] || (els[id] = makeEl(id))),
  documentElement: { requestFullscreen: () => {} }
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

process.chdir(root);

const { FD } = await import('../js/main.js');
const { update } = await import('../js/game.js');
const { Road } = await import('../js/world/roadNetwork.js');
const { Depot, GBRBase } = await import('../js/world/map.js');
const { callTanker, callGBR } = await import('../js/systems/spawnSystem.js');
const { makeScalper } = await import('../js/vehicles/vehicleFactory.js');
const { setScalperPhase, ScalperPhase } = await import('../js/systems/entityFsm.js');
const { addToHolder, deployToRing } = await import('../js/systems/trafficSystem.js');
const { UI } = await import('../js/ui/hud.js');

const stubEl = () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, textContent: '', innerHTML: '' });
for (const k of ['warning', 'panel', 'statMoney', 'statTraffic', 'statTime', 'tankerSub', 'gbrSub', 'lightSub',
  'endTitle', 'endDesc', 'endStats', 'btnNext', 'screenEnd']) {
  UI[k] = stubEl();
}
UI.btnTanker = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnGbr = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnLight = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} } });

Road.build(420, 730);
Depot.init();
GBRBase.init();

const { Game, CONFIG } = FD;
const DT = 1 / 60;
const TIME_SCALE = 120;
const TARGET_GAME_SEC = 30 * 60;
const TARGET_TANKER = 100;
const TARGET_GBR = 100;

let errors = 0;
let upgrades = 0;

function fail(msg) {
  errors++;
  console.error('STRESS FAIL:', msg);
  if (errors > 20) process.exit(1);
}

function flushSpecialFromHolder() {
  if (Game.holderPriorityWait && Game.holder.length < CONFIG.holder.max) {
    Game.holder.unshift(Game.holderPriorityWait);
    Game.holderPriorityWait = null;
  }
  for (const u of [Game.tanker.unit, Game.scalper.unit, Game.gbr.unit]) {
    if (u && Game.holder.includes(u)) deployToRing(u);
  }
}

function keepPlaying() {
  flushSpecialFromHolder();
  Game.defeatT = 0;
  if (Game.state !== 'play') Game.state = 'play';
  while (Game.holder.length >= CONFIG.holder.max) {
    const idx = Game.holder.findIndex(v => v.kind === 'car');
    if (idx < 0) break;
    Game.holder.splice(idx, 1);
  }
  Game.depot.res = Math.max(Game.depot.res, Game.depot.cap * 0.8);
}

function validateState() {
  keepPlaying();
  for (const v of Game.vehicles) {
    if (v.state === 'station' && v.kind === 'car') {
      if (!v.pump) fail('car in station without pump');
      else if (!v.pump.cars.includes(v)) fail('car in station not in pump.cars');
    }
    if (v.pump && v.kind !== 'gbr') {
      if (!v.pump.cars.includes(v)) fail(v.kind + ' has pump ref but not in cars[]');
    }
  }
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st) continue;
    for (const pump of st.pumps) {
      for (const c of pump.cars) {
        if (!c.pump || c.pump !== pump) fail('pump.cars member has wrong pump ref');
      }
    }
  }
}

function tryUpgrade() {
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st) continue;
    Game.money = Math.max(Game.money, 50000);
    if (FD.actionAddPump(st, 'a92')) { upgrades++; return; }
    if (FD.actionBuyCanisterReserve(st)) { upgrades++; return; }
    if (FD.actionUpgradeReservoir(st)) { upgrades++; return; }
  }
  const empty = Road.slots.find(s => !s.station);
  if (empty && FD.actionBuildStation(empty, 'a95')) upgrades++;
}

function setupWorld() {
  FD.newGame('endless', 11);
  Game.money = 100000;
  for (let si = 0; si < Road.slots.length; si++) {
    const slot = Road.slots[si];
    if (!slot.station) FD.actionBuildStation(slot, si % 2 ? 'a95' : 'a92');
  }
  Game.depot.res = Game.depot.cap;
}

function simStep(n) {
  for (let i = 0; i < n; i++) {
    try {
      update(DT);
      validateState();
    } catch (e) {
      fail(e.message || String(e));
      console.error(e.stack);
      return false;
    }
  }
  return true;
}

function purgeUnit(u) {
  if (!u) return;
  Game.vehicles = Game.vehicles.filter(v => v !== u);
  Game.holder = Game.holder.filter(v => v !== u);
  if (Game.holderPriorityWait === u) Game.holderPriorityWait = null;
}

function ensureScalper() {
  if (Game.scalper.unit && (Game.vehicles.includes(Game.scalper.unit) || Game.holder.includes(Game.scalper.unit)))
    return;
  const sc = makeScalper();
  setScalperPhase(sc, ScalperPhase.MOVING);
  addToHolder(sc, { priority: false, countsForDefeat: false });
  Game.scalper.unit = sc;
  if (Game.holder.includes(sc)) deployToRing(sc);
}

setupWorld();
console.log('Phase 1: endless mode', TARGET_GAME_SEC, 'game-seconds');
let gameTime = 0;
let frames = 0;
while (gameTime < TARGET_GAME_SEC && errors === 0) {
  if (!simStep(TIME_SCALE)) break;
  gameTime += TIME_SCALE * DT;
  frames += TIME_SCALE;
  Game.money = Math.max(Game.money, 80000);
  if (frames % (TIME_SCALE * 60) === 0) tryUpgrade();
  if (frames % (TIME_SCALE * 120) === 0) {
    process.stdout.write('\r  endless t=' + Math.floor(gameTime) + 's upgrades=' + upgrades);
  }
}
console.log('\nPhase 1 done: t=' + Math.floor(gameTime) + 's errors=' + errors);

console.log('Phase 2:', TARGET_TANKER, 'tanker calls');
setupWorld();
let tankerCalls = 0;
while (tankerCalls < TARGET_TANKER && errors === 0) {
  purgeUnit(Game.tanker.unit);
  Game.tanker.unit = null;
  Game.tanker.cd = 0;
  callTanker();
  tankerCalls++;
  const t = Game.tanker.unit;
  if (t && Game.holder.includes(t)) deployToRing(t);
  if (!simStep(600)) break;
}
console.log('Phase 2 done: calls=' + tankerCalls);

console.log('Phase 3:', TARGET_GBR, 'GBR calls');
setupWorld();
let gbrCalls = 0;
while (gbrCalls < TARGET_GBR && errors === 0) {
  purgeUnit(Game.gbr.unit);
  Game.gbr.unit = null;
  Game.gbr.cd = 0;
  ensureScalper();
  callGBR();
  gbrCalls++;
  if (!simStep(360)) break;
}
console.log('Phase 3 done: calls=' + gbrCalls);

console.log('\nSummary: errors=' + errors + ' upgrades=' + upgrades +
  ' tanker=' + tankerCalls + ' gbr=' + gbrCalls);
if (errors > 0) process.exit(1);
if (tankerCalls < TARGET_TANKER || gbrCalls < TARGET_GBR) process.exit(1);
console.log('STRESS TEST PASSED');
process.exit(0);
