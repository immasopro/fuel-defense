/**
 * QA 0.4.3.1 — GBR teleport after Scalper catch (CHASE → RETURNING).
 * Focus: Euclidean dp<40 vs ring distance relative to GBRBase.spawnS.
 *
 * Run: node scripts/qa-audit-0431-gbr-return.mjs
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
const { Depot, GBRBase } = await import(pathToFileURL(path.join(root, 'js/world/map.js')).href);
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
Road.build(420, 730);
Depot.init();
GBRBase.init();

const { Game, CONFIG } = FD;
const { GbrPhase, setGbrPhase } = await import(pathToFileURL(path.join(root, 'js/systems/entityFsm.js')).href);
const { updateGBR } = await import(pathToFileURL(path.join(root, 'js/systems/specialVehicles.js')).href);
const { distAhead } = await import(pathToFileURL(path.join(root, 'js/world/roadNetwork.js')).href);
const { FleetState } = await import(pathToFileURL(path.join(root, 'js/systems/tankerLogistics.js')).href);
const { onGbrBaseLevelUp } = await import(pathToFileURL(path.join(root, 'js/systems/gbrLogistics.js')).href);
const { makeGBR } = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicleFactory.js')).href);

function mod(a, L) { return ((a % L) + L) % L; }

function euclidToBase(s) {
  const p = Road.posAt(s, 0);
  return Math.hypot(GBRBase.pos.x - p.x, GBRBase.pos.y - p.y);
}

function ringAheadToBase(s) {
  return distAhead(s, GBRBase.spawnS, Road.length);
}

function placeGbrAtOffset(offsetFromBase, { fleetId = 1 } = {}) {
  const L = Road.length;
  const s = mod(GBRBase.spawnS + offsetFromBase, L);
  const g = makeGBR(fleetId);
  g.fleetId = fleetId;
  g.s = s;
  g.prevS = s;
  g.lane = 'outer';
  g.state = 'drive';
  g.v = CONFIG.gbr.returnSpeed;
  g.maxV = CONFIG.gbr.returnSpeed;
  g.pose = null;
  g.stopS = null;
  g.targetScalperId = null;
  g.chaseTarget = null;
  setGbrPhase(g, GbrPhase.CHASE);
  return g;
}

const results = [];

FD.newGame('campaign', 1);
GBRBase.init();
const L = Road.length;

const probe = [-80, -40, -20, -8, 0, 8, 20, 40, 80].map(off => ({
  offset: off,
  euclid: +euclidToBase(mod(GBRBase.spawnS + off, L)).toFixed(1),
  ringAhead: +ringAheadToBase(mod(GBRBase.spawnS + off, L)).toFixed(1),
  triggersDp40: euclidToBase(mod(GBRBase.spawnS + off, L)) < 40,
  triggersAhead8: ringAheadToBase(mod(GBRBase.spawnS + off, L)) < 8
}));

console.log('=== Geometry probe around GBRBase.spawnS ===');
console.log(JSON.stringify({ L: +L.toFixed(1), spawnS: +GBRBase.spawnS.toFixed(1), probe }, null, 2));

const euclidFalsePositives = [];
for (let off = 0; off < L; off += 1) {
  const s = mod(GBRBase.spawnS + off, L);
  const eu = euclidToBase(s);
  const ah = ringAheadToBase(s);
  if (eu < 40 && ah > 30) {
    euclidFalsePositives.push({ off, eu: +eu.toFixed(1), ah: +ah.toFixed(1) });
  }
}
console.log('euclidFalsePositives (dp<40 AND ringAhead>30): count=', euclidFalsePositives.length);
console.log(JSON.stringify(euclidFalsePositives.slice(0, 25), null, 2));

let criticalOffset = euclidFalsePositives[0]?.off ?? null;
console.log('criticalOffsetJustPastBase:', criticalOffset);

function runScenario(name, offset) {
  FD.newGame('campaign', 1);
  Game.money = 999999;
  Game.gbrBase.level = 3;
  onGbrBaseLevelUp();
  for (const u of Game.gbrLogistics.units) {
    u.state = FleetState.READY;
    u.prepT = 0;
    u.vehicle = null;
  }

  const g = placeGbrAtOffset(offset, { fleetId: 1 });
  const unit0 = Game.gbrLogistics.units[0];
  Game.vehicles = [g];
  Game.gbr.unit = g;

  const s0 = g.s;
  const p0 = Road.posAt(s0, 0);
  const eu0 = euclidToBase(s0);
  const ahead0 = ringAheadToBase(s0);

  // CHASE → RETURNING (road arrest path)
  setGbrPhase(g, GbrPhase.RETURNING);
  g.state = 'drive';
  g.stopS = GBRBase.spawnS;
  g.v = CONFIG.gbr.returnSpeed;
  g.maxV = CONFIG.gbr.returnSpeed;
  g.returnPullOut = false;
  unit0.state = FleetState.RETURNING;
  unit0.vehicle = g;

  const sPhase = g.s;
  const pPhase = Road.posAt(sPhase, 0);
  const jumpOnPhase = Math.hypot(pPhase.x - p0.x, pPhase.y - p0.y);

  const dt = 1 / 30;
  let teleported = false;
  let teleportDetail = null;
  let frames = 0;
  let pathLen = 0;
  let maxJump = jumpOnPhase;
  let speedSamples = [];
  let returned = false;

  // First RETURNING tick — catches instant Euclidean complete
  {
    const rem = new Set();
    const aheadBefore = ringAheadToBase(g.s);
    const euBefore = euclidToBase(g.s);
    updateGBR(g, dt, L, rem);
    if (rem.has(g)) {
      Game.vehicles = Game.vehicles.filter(v => v !== g);
      returned = true;
      if (aheadBefore > 30) {
        teleported = true;
        teleportDetail =
          `instant complete on first RETURNING tick; ringAhead=${aheadBefore.toFixed(1)} euclid=${euBefore.toFixed(1)}`;
      }
    }
  }

  const budget = Math.ceil(180 / dt);
  while (!returned && frames < budget) {
    const rem = new Set();
    const pBefore = Road.posAt(g.s, 0);
    g.prevS = g.s;
    const step = CONFIG.gbr.returnSpeed * dt;
    g.s = mod(g.s + step, L);
    g.v = CONFIG.gbr.returnSpeed;
    pathLen += step;
    speedSamples.push(g.v);
    updateGBR(g, dt, L, rem);
    const pNow = Road.posAt(g.s, 0);
    const jump = Math.hypot(pNow.x - pBefore.x, pNow.y - pBefore.y);
    maxJump = Math.max(maxJump, jump);
    if (jump > CONFIG.gbr.returnSpeed * dt * 4 + 20) {
      teleported = true;
      teleportDetail = `coord jump ${jump.toFixed(1)}px`;
    }
    if (rem.has(g)) {
      Game.vehicles = Game.vehicles.filter(v => v !== g);
      returned = true;
      break;
    }
    frames++;
  }

  const unit = Game.gbrLogistics.units[0];
  const prepStarted = unit.state === FleetState.PREPARING;
  const avgSpeed = speedSamples.length
    ? speedSamples.reduce((a, b) => a + b, 0) / speedSamples.length
    : (teleported ? CONFIG.gbr.returnSpeed : 0);
  const traveledEnough = ahead0 <= 25 || pathLen >= ahead0 * 0.85;
  const okSpeed = !speedSamples.length || Math.abs(avgSpeed - CONFIG.gbr.returnSpeed) < 0.01;
  const verdict = (!teleported && returned && prepStarted && traveledEnough && okSpeed)
    ? 'PASS'
    : 'FAIL';

  const row = {
    name,
    verdict,
    offsetFromBase: offset,
    catch: {
      xy: { x: +p0.x.toFixed(1), y: +p0.y.toFixed(1) },
      euclid: +eu0.toFixed(1),
      ringAhead: +ahead0.toFixed(1),
      s: +s0.toFixed(1)
    },
    afterPhaseChange: {
      jump: +jumpOnPhase.toFixed(2),
      phase: g.gbrPhase
    },
    result: {
      teleported,
      teleportDetail,
      frames,
      pathLen: +pathLen.toFixed(1),
      maxJump: +maxJump.toFixed(1),
      avgSpeed: +avgSpeed.toFixed(2),
      returned,
      prepStarted,
      prepT: unit.prepT,
      traveledEnough
    }
  };
  results.push(row);
  console.log(`\n[${verdict}] ${name}`);
  console.log(JSON.stringify(row, null, 2));
  return row;
}

runScenario('1. Catch far before base (offset -400)', -400);
runScenario('2. Catch just before base (offset -25)', -25);
runScenario('3. Catch just after base (offset +25)', +25);
runScenario('4. Critical past-base Euclidean FP', criticalOffset ?? 15);

// 5. Multi GBR
FD.newGame('campaign', 1);
Game.money = 999999;
Game.gbrBase.level = 3;
onGbrBaseLevelUp();
for (const u of Game.gbrLogistics.units) {
  u.state = FleetState.READY;
  u.prepT = 0;
}
const offsets = [-300, criticalOffset ?? 20, 200];
const multi = offsets.map((offset, i) => {
  const g = placeGbrAtOffset(offset, { fleetId: i + 1 });
  const u = Game.gbrLogistics.units[i];
  u.state = FleetState.RETURNING;
  u.vehicle = g;
  setGbrPhase(g, GbrPhase.RETURNING);
  g.state = 'drive';
  g.stopS = GBRBase.spawnS;
  g.v = CONFIG.gbr.returnSpeed;
  g.maxV = CONFIG.gbr.returnSpeed;
  return {
    g, u, offset,
    ahead0: ringAheadToBase(g.s),
    eu0: euclidToBase(g.s),
    pathLen: 0,
    teleported: false,
    detail: null
  };
});
Game.vehicles = multi.map(m => m.g);
const dt = 1 / 30;
let multiFrames = 0;
while (multiFrames < 180 * 30 && multi.some(m => Game.vehicles.includes(m.g))) {
  for (const m of multi) {
    if (!Game.vehicles.includes(m.g)) continue;
    const rem = new Set();
    const aheadBefore = ringAheadToBase(m.g.s);
    if (multiFrames === 0) {
      updateGBR(m.g, dt, L, rem);
      if (rem.has(m.g) && aheadBefore > 30) {
        m.teleported = true;
        m.detail = `instant complete; ahead=${aheadBefore.toFixed(1)} eu=${m.eu0.toFixed(1)}`;
      }
    } else {
      m.g.prevS = m.g.s;
      m.g.s = mod(m.g.s + CONFIG.gbr.returnSpeed * dt, L);
      m.pathLen += CONFIG.gbr.returnSpeed * dt;
      updateGBR(m.g, dt, L, rem);
    }
    if (rem.has(m.g)) Game.vehicles = Game.vehicles.filter(v => v !== m.g);
  }
  multiFrames++;
}
const multiRows = multi.map(m => {
  const traveledEnough = m.ahead0 <= 25 || m.pathLen >= m.ahead0 * 0.85;
  const prep = m.u.state === FleetState.PREPARING;
  const verdict = (!m.teleported && prep && traveledEnough) ? 'PASS' : 'FAIL';
  return {
    fleetId: m.g.fleetId,
    offset: m.offset,
    ahead0: +m.ahead0.toFixed(1),
    eu0: +m.eu0.toFixed(1),
    pathLen: +m.pathLen.toFixed(1),
    teleported: m.teleported,
    detail: m.detail,
    prep,
    verdict
  };
});
console.log('\n[5. Multi GBR]');
console.log(JSON.stringify(multiRows, null, 2));
const multiPass = multiRows.every(r => r.verdict === 'PASS');
results.push({ name: '5. Multi GBR independent return', verdict: multiPass ? 'PASS' : 'FAIL', multiRows });

const overall = results.every(r => r.verdict === 'PASS') ? 'PASS' : 'FAIL';
console.log('\n========== OVERALL VERDICT:', overall, '==========');
console.log('Arrival gate: `dp < 40 || distAhead < 8` in updateGBR RETURNING');
console.log('False-positive Euclidean arrivals on ring:', euclidFalsePositives.length);

if (overall === 'FAIL') process.exitCode = 1;
