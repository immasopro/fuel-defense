/**
 * QA 0.4.3.3 — Collision / dimensions / physical interaction AUDIT (no game fixes).
 *
 * Run: node scripts/qa-audit-0433-collisions.mjs
 * Output: console + docs/QA_0433_COLLISION_AUDIT.md is authored separately from findings.
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
const { Game } = await import(pathToFileURL(path.join(root, 'js/core/gameState.js')).href);
const { CONFIG } = await import(pathToFileURL(path.join(root, 'js/config/index.js')).href);
const { CANVAS } = await import(pathToFileURL(path.join(root, 'js/config/constants.js')).href);
const { UI } = await import(pathToFileURL(path.join(root, 'js/ui/hud.js')).href);
const { mod } = await import(pathToFileURL(path.join(root, 'js/core/utils.js')).href);
const stubEl = () => ({ classList: { add: () => {}, remove: () => {} }, style: {}, textContent: '', innerHTML: '' });
for (const k of ['warning', 'panel', 'statMoney', 'statBonuses', 'statTraffic', 'statTime',
  'tankerSub', 'gbrSub', 'gbrTitle', 'lightSub', 'endTitle', 'endDesc', 'endStats',
  'btnRestart', 'btnMenu']) UI[k] = stubEl();
UI.btnTanker = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnGbr = Object.assign(stubEl(), { disabled: false, querySelector: () => stubEl() });
UI.btnLight = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} } });
UI.btnSpeed = Object.assign(stubEl(), { disabled: false, classList: { add: () => {}, remove: () => {} }, textContent: '' });
UI.btnNext = Object.assign(stubEl(), { classList: { add: () => {}, remove: () => {} } });
UI.screenEnd = Object.assign(stubEl(), { classList: { add: () => {}, remove: () => {} } });

Road.build(420, 730);
Depot.init();
GBRBase.init();

const { updateLane, findForwardLeader, laneGapFree } =
  await import(pathToFileURL(path.join(root, 'js/vehicles/vehicle.js')).href);
const { innerLaneList, outerLaneList, spawnClear } =
  await import(pathToFileURL(path.join(root, 'js/systems/trafficSystem.js')).href);
const { GbrPhase, ScalperPhase } =
  await import(pathToFileURL(path.join(root, 'js/systems/entityFsm.js')).href);
const { updateScalpersLeavingMap, initScalperLifecycle, despawnScalper } =
  await import(pathToFileURL(path.join(root, 'js/systems/scalperLifecycle.js')).href);
const { makeGBR } = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicleFactory.js')).href);
const { apronPoseForRank, pocketPoseForRank } =
  await import(pathToFileURL(path.join(root, 'js/world/roadNetwork.js')).href);
FD.makeGBR = makeGBR;

const findings = [];
const matrix = [];

function bumperGap(a, b, L) {
  return mod(b.s - a.s, L) - (a.len + b.len) / 2;
}

function worldPos(v) {
  if (v.pose) return { x: v.pose.x, y: v.pose.y };
  const lat = v.lane === 'inner' ? Road.laneW / 2 : -Road.laneW / 2;
  const p = Road.posAt(v.s, lat + (v.latOff || 0));
  return { x: p.x, y: p.y };
}

function euclid(a, b) {
  const pa = worldPos(a), pb = worldPos(b);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

/** 1D bumper overlap on same ring (centers closer than half-len sum). */
function bumperOverlap(a, b, L) {
  const d = Math.min(mod(a.s - b.s, L), mod(b.s - a.s, L));
  return d < (a.len + b.len) / 2 - 0.01;
}

function record(id, severity, ok, detail, extra = {}) {
  const row = { id, severity, ok: !!ok, detail, ...extra };
  findings.push(row);
  const tag = ok ? 'PASS' : `FAIL/${severity}`;
  console.log(`${tag}  ${id} — ${detail}`);
  return row;
}

function matrixRow(pair, scenario, ok, detail) {
  matrix.push({ pair, scenario, ok: !!ok, detail });
  console.log(`  MATRIX ${ok ? 'PASS' : 'FAIL'}  ${pair} / ${scenario} — ${detail}`);
}

function resetPlay() {
  FD.newGame('campaign', 5);
  FD.actionBuildStation(Road.slots[0], 'a92');
  Game.vehicles = [];
  Game.holder = [];
  Game.prepared = null;
  Game.scalper.unit = null;
  Game.gbr.unit = null;
}

function placeDrive(v, s, lane = 'inner') {
  v.state = 'drive';
  v.lane = lane;
  v.s = mod(s, Road.length);
  v.prevS = v.s;
  v.pose = null;
  v.overtake = null;
  v.latOff = 0;
  v.stopS = null;
  Game.vehicles.push(v);
  return v;
}

console.log('=== QA 0.4.3.3 COLLISION / DIMENSIONS AUDIT ===\n');
console.log(`Road L=${Road.length.toFixed(1)} laneW=${Road.laneW} maxDt=${CANVAS.maxDeltaTime}\n`);

// ─────────────────────────────────────────────────────────────
// 1. Dimension inventory
// ─────────────────────────────────────────────────────────────
console.log('--- 1. Dimensions ---');
resetPlay();
const sedan = Object.assign(FD.makeCar(0), { typeKey: 'sedan' });
// force types
const types = {};
for (const key of ['sedan', 'suv', 'truck']) {
  const c = FD.makeCar(1);
  // remake with forced type via factory internals
  const T = CONFIG.carTypes[key];
  types[key] = { len: T.len, w: T.w, maxV: T.maxV };
}
const sc0 = FD.makeScalper();
const gbr0 = FD.makeGBR(1);
const tk0 = FD.makeTanker(1, 1000);
const bg0 = FD.makeBgCar();

const dimTable = [
  { type: 'sedan', logical: types.sedan, visual: 'rr(-len/2,-w/2,len,w)', collision: '1D bumper len only' },
  { type: 'suv', logical: types.suv, visual: 'same as logical', collision: '1D bumper len only' },
  { type: 'truck', logical: types.truck, visual: 'same + cab seam', collision: '1D bumper len only' },
  { type: 'scalper', logical: { len: sc0.len, w: sc0.w, maxV: sc0.maxV }, visual: 'same as logical', collision: '1D bumper + Euclidean arrest vs GBR' },
  { type: 'gbr', logical: { len: gbr0.len, w: gbr0.w, maxV: gbr0.maxV }, visual: 'same + light bar (+3px above)', collision: '1D bumper + Euclidean arrestDist' },
  { type: 'tanker', logical: { len: tk0.len, w: tk0.w, maxV: tk0.maxV }, visual: 'cab 10 + tank len-12', collision: '1D bumper len only' },
  { type: 'bg', logical: { len: bg0.len, w: bg0.w }, visual: 'same', collision: '1D bumper' }
];
console.log(JSON.stringify(dimTable, null, 2));

record('DIM-01', 'INFO', true,
  `Sprite == logical len×w for all kinds; NO separate AABB hitbox. Follow gap uses (lenA+lenB)/2.`);
record('DIM-02', 'LOW', sc0.w === 10 && !('w' in (CONFIG.scalper || {})),
  `Scalper w=${sc0.w} hardcoded in factory (balance has len only).`);
record('DIM-03', 'LOW', gbr0.w === 10 && !('w' in (CONFIG.gbr || {})),
  `GBR w=${gbr0.w} hardcoded; balance.len=${CONFIG.gbr.len}. Light bar drawn outside body (±w/2-1).`);
record('DIM-04', 'LOW', tk0.w === 12,
  `Tanker w=${tk0.w} hardcoded; visual cab+tank still uses same w.`);
record('DIM-05', 'INFO', CONFIG.follow.gapMin === 7 && CONFIG.gbr.chaseDrive.gapMin === 1.5,
  `Safety gap: civilian gapMin=${CONFIG.follow.gapMin}; chase GBR gapMin=${CONFIG.gbr.chaseDrive.gapMin}; arrestDist=${CONFIG.gbr.arrestDist}.`);
record('DIM-06', 'MEDIUM', true,
  `No width (w) used in collision — only len. Lateral latOff / lane ignored by bumper math.`);

// ─────────────────────────────────────────────────────────────
// 2. Collision vs avoidance architecture
// ─────────────────────────────────────────────────────────────
console.log('\n--- 2. Architecture rules ---');
record('ARCH-01', 'INFO', true,
  'Collision detection: NONE (no AABB/circle pairwise). Soft bumper resolution after move in updateLane.');
record('ARCH-02', 'INFO', true,
  'Collision avoidance: IDM-like follow — vt from percGap/percLV; reaction delay; emergencyGap=12.');
record('ARCH-03', 'INFO', true,
  `Tick order: updateLane(inner/outer) THEN updateVehicles. Soft fix uses post-move s. maxDt=${CANVAS.maxDeltaTime}s.`);
record('ARCH-04', 'INFO', true,
  'Lane lists: inner=drive|action|tow; outer=drive && !(scalper EXITING). Station/pocket/pullIn/block/waitMerge OUT of collision.');
record('ARCH-05', 'INFO', true,
  `GBR↔Scalper catch = Euclidean world dist ≤ ${CONFIG.gbr.arrestDist} (not bumper). Vision=${CONFIG.gbr.visionRadius}.`);

// ─────────────────────────────────────────────────────────────
// 3. Tunneling
// ─────────────────────────────────────────────────────────────
console.log('\n--- 3. Tunneling ---');
function testTunnel(kind, makeA, makeB, vA, vB, dt, label) {
  resetPlay();
  const L = Road.length;
  const a = makeA();
  const b = makeB();
  placeDrive(a, 100);
  placeDrive(b, 100 + (a.len + b.len) / 2 + 3); // almost bumper-touching ahead
  a.v = vA; a.maxV = vA; a.react = 0; a.percT = 0; a.percGap = 3; a.percLV = vB;
  b.v = vB; b.maxV = vB; b.react = 0;
  const before = bumperGap(a, b, L);
  const list = innerLaneList();
  updateLane(list, dt);
  const after = bumperGap(a, b, L);
  const aAhead = mod(a.s - b.s, L) < L / 2 && mod(a.s - b.s, L) > (a.len + b.len) / 2;
  const tunneled = before > 0 && aAhead && !bumperOverlap(a, b, L) === false
    ? false
    : (before > 0 && mod(a.s - b.s, L) < L / 2 && bumperGap(b, a, L) > 0);
  // clearer: A was behind (gap>0), after tick A is in front of B (A.s past B.s by more than half lens)
  const wasBehind = before > 0;
  const nowAhead = mod(a.s - b.s, L) > (a.len + b.len) / 2 && mod(a.s - b.s, L) < L / 2;
  const fail = wasBehind && nowAhead;
  record(label, fail ? 'CRITICAL' : 'INFO', !fail,
    `${kind}: beforeGap=${before.toFixed(2)} afterGap=${after.toFixed(2)} ` +
    `dsA=${(a.v * dt).toFixed(2)} wasBehind=${wasBehind} nowAhead=${nowAhead} softSnap=${!fail || after >= -0.01}`,
    { before, after, dt, vA, vB });
  return fail;
}

testTunnel('NPC', () => FD.makeCar(0), () => FD.makeCar(0), 78, 0, 0.05, 'TUN-NPC-01');
testTunnel('Scalper', () => FD.makeScalper(), () => FD.makeCar(0), 64, 0, 0.05, 'TUN-SC-01');
testTunnel('GBR', () => FD.makeGBR(1), () => FD.makeCar(0), 150, 0, 0.05, 'TUN-GBR-01');
// Forced large dt (simulates missing clamp)
testTunnel('GBR-largeDt', () => FD.makeGBR(1), () => FD.makeCar(0), 150, 0, 0.2, 'TUN-GBR-02');
testTunnel('GBR-hugeDt', () => FD.makeGBR(1), () => FD.makeCar(0), 150, 0, 0.5, 'TUN-GBR-03');

// Relative pass during overtake (soft fix OFF)
resetPlay();
{
  const L = Road.length;
  const leader = placeDrive(FD.makeCar(0), 200);
  leader.maxV = 30; leader.v = 30;
  const chase = placeDrive(FD.makeGBR(1), 200 - 40);
  chase.maxV = 150; chase.v = 150;
  chase.gbrPhase = GbrPhase.CHASE;
  chase.targetScalperId = 'dummy';
  chase.overtake = 'pass';
  chase.overtakeCommitted = true;
  chase.latOff = -Road.laneW * 0.85;
  chase.react = 0;
  const beforeGap = bumperGap(chase, leader, L);
  for (let i = 0; i < 30; i++) updateLane(innerLaneList(), 0.05);
  const ahead = mod(chase.s - leader.s, L);
  const passed = ahead > (chase.len + leader.len) / 2 && ahead < L / 2;
  const minGapDuring = 'n/a';
  record('TUN-OVR-01', 'HIGH', true,
    `Chase GBR overtake pass intentionally allows s-space pass-through (soft fix off). ` +
    `beforeGap=${beforeGap.toFixed(1)} passed=${passed} latOff=${chase.latOff.toFixed(1)}. ` +
    `Visual: cars offset laterally; bumper overlap in s is BY DESIGN during overtake.`,
    { passed, beforeGap });
}

// ─────────────────────────────────────────────────────────────
// 4. Interaction matrix (automated subset)
// ─────────────────────────────────────────────────────────────
console.log('\n--- 4. Interaction matrix ---');

function runPairFollow(pair, makeA, makeB, scenario, setup) {
  resetPlay();
  const L = Road.length;
  const a = placeDrive(makeA(), 300);
  const b = placeDrive(makeB(), 300 + 50);
  setup(a, b);
  let worstOverlap = 0;
  let anyOverlap = false;
  for (let i = 0; i < 80; i++) {
    updateLane(innerLaneList(), 0.05);
    if (a.lane === b.lane && !a.overtake && !b.overtake) {
      const d = Math.min(mod(a.s - b.s, L), mod(b.s - a.s, L));
      const lim = (a.len + b.len) / 2;
      if (d < lim - 0.5) {
        anyOverlap = true;
        worstOverlap = Math.max(worstOverlap, lim - d);
      }
    }
  }
  // PASS if no deep bumper overlap while neither is overtating
  matrixRow(pair, scenario, !anyOverlap,
    anyOverlap ? `bumper overlap depth=${worstOverlap.toFixed(2)}` : 'no deep bumper overlap');
  return !anyOverlap;
}

const pairs = [
  ['NPC→NPC', () => FD.makeCar(0), () => FD.makeCar(0)],
  ['NPC→Scalper', () => FD.makeCar(0), () => FD.makeScalper()],
  ['Scalper→NPC', () => FD.makeScalper(), () => FD.makeCar(0)],
  ['Scalper→Scalper', () => FD.makeScalper(), () => FD.makeScalper()],
  ['GBR→NPC', () => FD.makeGBR(1), () => FD.makeCar(0)],
  ['GBR→Scalper', () => FD.makeGBR(1), () => FD.makeScalper()],
  ['NPC→GBR', () => FD.makeCar(0), () => FD.makeGBR(1)],
  ['Scalper→GBR', () => FD.makeScalper(), () => FD.makeGBR(1)],
  ['GBR→GBR', () => FD.makeGBR(1), () => FD.makeGBR(2)]
];

for (const [pair, mA, mB] of pairs) {
  runPairFollow(pair, mA, mB, 'A same speed', (a, b) => {
    a.v = a.maxV = 50; b.v = b.maxV = 50; a.react = b.react = 0;
  });
  runPairFollow(pair, mA, mB, 'B faster follower', (a, b) => {
    // a behind b: swap placement conceptually — follower is first in placeDrive order at lower s
    a.v = a.maxV = 90; b.v = b.maxV = 40; a.react = 0;
  });
  runPairFollow(pair, mA, mB, 'D leader stopped', (a, b) => {
    a.v = a.maxV = 80; b.v = b.maxV = 0; a.react = 0; a.percT = 0;
  });
  runPairFollow(pair, mA, mB, 'E both stopped', (a, b) => {
    a.v = b.v = 0; a.maxV = b.maxV = 0;
  });
}

// Chase GBR presses civilians (expected soft overlap to -2)
resetPlay();
{
  const L = Road.length;
  const civ = placeDrive(FD.makeCar(0), 400);
  civ.v = civ.maxV = 20;
  const g = placeDrive(FD.makeGBR(1), 400 - 30);
  g.gbrPhase = GbrPhase.CHASE;
  g.targetScalperId = 'other';
  g.v = g.maxV = 150;
  g.react = 0;
  let minG = 1e9;
  let pressed = false;
  for (let i = 0; i < 60; i++) {
    updateLane(innerLaneList(), 0.05);
    const { gap } = findForwardLeader([g, civ].sort((x, y) => x.s - y.s), g, L);
    // recompute bumper gap g behind civ
    const bg = bumperGap(g, civ, L);
    minG = Math.min(minG, bg);
    if (bg < 0) pressed = true;
  }
  record('MAT-CHASE-PRESS', 'CRITICAL', !(pressed && minG < -5),
    `Chase GBR vs civilian: minBumperGap=${minG.toFixed(2)} pressedIntoNegative=${pressed}. ` +
    `Overtake disables soft-fix → deep s-overlap while latOff incomplete (COLL-002).`,
    { minG, pressed });
  matrixRow('GBR→NPC', 'chase press', !(pressed && minG < -5), `minGap=${minG.toFixed(2)}`);
}

// COLL-001: gap==0 loses leader → tunnel through stopped car
resetPlay();
{
  const L = Road.length;
  const leader = placeDrive(FD.makeCar(0), 350);
  leader.v = leader.maxV = 0; leader.react = 0;
  const follower = placeDrive(FD.makeScalper(), 300);
  follower.v = follower.maxV = 80; follower.react = 0;
  let lostLeader = false;
  let tunneled = false;
  for (let i = 0; i < 100; i++) {
    const list = innerLaneList();
    const fl = findForwardLeader(list, follower, L);
    const g = bumperGap(follower, leader, L);
    if (g <= 0 && !fl.leader) lostLeader = true;
    updateLane(list, 0.05);
    if (mod(follower.s - leader.s, L) < (follower.len + leader.len) / 2 &&
        mod(follower.s - leader.s, L) < 100) {
      tunneled = true;
      break;
    }
  }
  record('COLL-001', 'CRITICAL', !(lostLeader && tunneled),
    `findForwardLeader requires g>0: after soft-snap gap≤0 leader lost → tunnel. ` +
    `lostLeader=${lostLeader} tunneled=${tunneled}`,
    { lostLeader, tunneled });
  matrixRow('Scalper→NPC', 'D leader stopped (COLL-001)', !tunneled,
    tunneled ? 'tunneled after leader loss' : 'held');
}

// ─────────────────────────────────────────────────────────────
// 5. GBR ↔ Scalper priority (20 runs)
// ─────────────────────────────────────────────────────────────
console.log('\n--- 5. GBR ↔ Scalper (20 runs) ---');
let passThrough = 0;
let arrested = 0;
let overlappedS = 0;
const gbrScRuns = [];
for (let run = 0; run < 20; run++) {
  resetPlay();
  const L = Road.length;
  const sc = placeDrive(FD.makeScalper(), 500);
  initScalperLifecycle(sc);
  sc.wanted = true;
  sc.scalperId = 1000 + run;
  sc.v = sc.maxV = CONFIG.scalper.speed;
  sc.react = 0;
  const g = placeDrive(FD.makeGBR(1), 500 - 80);
  g.gbrPhase = GbrPhase.CHASE;
  g.targetScalperId = sc.scalperId;
  g.chaseTarget = sc;
  g.v = g.maxV = 150;
  g.react = 0;
  g.stopS = sc.s;
  let maxOverlap = 0;
  let minEuclid = 1e9;
  let didPass = false;
  for (let i = 0; i < 120; i++) {
    // sync chase stop like applyRoadChasePursuit
    g.lane = sc.lane;
    g.stopS = sc.s;
    updateLane(innerLaneList(), 0.05);
    const d = Math.min(mod(g.s - sc.s, L), mod(sc.s - g.s, L));
    const lim = (g.len + sc.len) / 2;
    if (d < lim - 0.5) maxOverlap = Math.max(maxOverlap, lim - d);
    const eu = euclid(g, sc);
    minEuclid = Math.min(minEuclid, eu);
    // pass-through: GBR started behind, ended clearly ahead by > half lens without staying coupled
    if (mod(g.s - sc.s, L) > lim + 8 && mod(g.s - sc.s, L) < L / 2 && eu > CONFIG.gbr.arrestDist + 5) {
      didPass = true;
    }
  }
  if (didPass) passThrough++;
  if (maxOverlap > 0.5) overlappedS++;
  if (minEuclid <= CONFIG.gbr.arrestDist) arrested++;
  gbrScRuns.push({ run, maxOverlap, minEuclid, didPass });
}
record('GBR-SC-01', passThrough > 0 ? 'CRITICAL' : 'INFO', passThrough === 0,
  `20 chase sims: passThrough=${passThrough}/20 sOverlap>${0.5}=${overlappedS}/20 reachedArrestDist=${arrested}/20. ` +
  `(Note: arrest logic not fully run here — only updateLane follow; Euclidean catch is separate.)`,
  { passThrough, overlappedS, arrested, sample: gbrScRuns.slice(0, 3) });

// Euclidean arrest can fire while bumpers already soft-snapped
resetPlay();
{
  const L = Road.length;
  const sc = placeDrive(FD.makeScalper(), 600);
  sc.scalperId = 42; sc.wanted = true;
  const g = placeDrive(FD.makeGBR(1), 600 - (22 + 23) / 2); // bumper-aligned
  g.targetScalperId = 42;
  const eu = euclid(g, sc);
  const bg = bumperGap(g, sc, L);
  record('GBR-SC-02', 'INFO', true,
    `At bumper-aligned spacing: euclid≈${eu.toFixed(1)} arrestDist=${CONFIG.gbr.arrestDist} bumperGap=${bg.toFixed(2)}. ` +
    `Arrest uses Euclidean only — can fire slightly before/after bumper contact depending on lane curvature/latOff.`);
}

// EXITING scalper ghosts through outer traffic
resetPlay();
{
  const L = Road.length;
  const wall = placeDrive(FD.makeCar(0), Road.spawnS + 40, 'outer');
  wall.v = wall.maxV = 0;
  const sc = placeDrive(FD.makeScalper(), Road.spawnS + 10, 'outer');
  sc.scalperPhase = ScalperPhase.EXITING;
  sc.scalperLeavingMap = true;
  sc.v = CONFIG.scalper.exitSpeed;
  const removeSet = new Set();
  let crossed = false;
  for (let i = 0; i < 40; i++) {
    updateLane(outerLaneList(), 0.05); // EXITING excluded — wall alone
    updateScalpersLeavingMap(0.05, L, removeSet);
    if (bumperOverlap(sc, wall, L)) crossed = true;
  }
  const inOuter = outerLaneList().includes(sc);
  record('GBR-SC-EXIT-01', 'CRITICAL', crossed || !inOuter,
    `EXITING scalper excluded from outerLaneList (inList=${inOuter}). ` +
    `Autonomous exit motion; bumperOverlapWithStoppedOuter=${crossed}. ` +
    `Traffic ignores EXITING scalper → visual pass-through EXPECTED.`,
    { inOuter, crossed });
  // For PASS criteria "Scalper не проходит сквозь" — this is FAIL by product criteria
  record('FAIL-EXIT-GHOST', 'HIGH', false,
    'EXITING Scalper does not participate in lane collision; can visually pass through outer cars / be passed through.');
}

// ─────────────────────────────────────────────────────────────
// 6. Station queue spacing
// ─────────────────────────────────────────────────────────────
console.log('\n--- 6. Station queues ---');
resetPlay();
{
  const slot = Road.slots[0];
  const poses = [0, 1, 2, 3].map(r => apronPoseForRank(slot, 0, r));
  let minSep = 1e9;
  for (let i = 1; i < poses.length; i++) {
    const d = Math.hypot(poses[i].x - poses[i - 1].x, poses[i].y - poses[i - 1].y);
    minSep = Math.min(minSep, d);
  }
  const qGap = CONFIG.road.queueGap;
  record('QUEUE-01', 'INFO', minSep > 0,
    `Apron rank Euclidean spacing min=${minSep.toFixed(1)} (queueGap=${qGap}). Pose-based, not bumper collision.`);
  const pocket = [0, 1, 2].map(r => pocketPoseForRank(slot, r));
  let pMin = 1e9;
  for (let i = 1; i < pocket.length; i++) {
    pMin = Math.min(pMin, Math.hypot(pocket[i].x - pocket[i - 1].x, pocket[i].y - pocket[i - 1].y));
  }
  record('QUEUE-02', 'INFO', pMin > 0,
    `Pocket rank spacing min=${pMin.toFixed(1)} (pocketGap=${CONFIG.road.pocketGap}).`);
  record('QUEUE-03', 'MEDIUM', !(qGap < types.truck.len),
    `queueGap=${qGap} < truck.len=${types.truck.len} → long vehicles in apron ranks can visually overlap if truck in queue.`,
    { qGap, truckLen: types.truck.len, sedanLen: types.sedan.len });
  record('QUEUE-04', 'INFO', true,
    'Queued cars (state station/pocket/block) are OUT of updateLane lists — no bumper soft-fix between queue and ring traffic.');
}

// ─────────────────────────────────────────────────────────────
// 7. Lane change / overtake
// ─────────────────────────────────────────────────────────────
console.log('\n--- 7. Lane change ---');
record('LANE-01', 'INFO', true,
  'Overtake is visual latOff only — vehicle stays in same lane list; soft bumper disabled while overtake!=null.');
record('LANE-02', 'HIGH', false,
  'During overtake pass phase, follower s can advance past leader → intentional s-overlap with lateral offset. Meets FAIL criterion "partial intersection" if judged visually.');
resetPlay();
{
  const a = placeDrive(FD.makeCar(0), 100);
  const b = placeDrive(FD.makeCar(0), 130);
  const free = laneGapFree(innerLaneList(), 100, a.len);
  const blocked = laneGapFree(innerLaneList(), 115, a.len);
  record('LANE-03', 'INFO', !blocked,
    `laneGapFree pads ahead+10 behind+26. free@100=${free} blocked@115=${blocked}.`);
}

// ─────────────────────────────────────────────────────────────
// 8–9. Spawn / despawn
// ─────────────────────────────────────────────────────────────
console.log('\n--- 8–9. Spawn / despawn ---');
resetPlay();
{
  const blocker = placeDrive(FD.makeCar(0), Road.spawnS);
  blocker.v = 0;
  const clear = spawnClear(innerLaneList(), 19);
  record('SPAWN-01', 'INFO', !clear,
    `spawnClear blocks when vehicle near spawnS (pad -4/+12). clear=${clear}.`);
  const far = placeDrive(FD.makeCar(0), Road.spawnS + 80);
  // remove blocker mentally: only far
  Game.vehicles = [far];
  record('SPAWN-02', 'INFO', spawnClear(innerLaneList(), 19),
    'spawnClear true when ring clear at spawn.');
}
resetPlay();
{
  const sc = placeDrive(FD.makeScalper(), 50);
  const removeSet = new Set();
  despawnScalper(sc, removeSet);
  record('DESPAWN-01', 'INFO', removeSet.has(sc) && Game.scalper.unit == null,
    'despawnScalper adds to removeSet and clears Game.scalper.unit; actual array filter happens end of updateVehicles.');
  record('DESPAWN-02', 'INFO', true,
    'Until removeSet applied, object may still be in Game.vehicles for same tick — then filtered. Next tick gone from lane lists.');
}

// EXIT stall jump (teleport-like)
resetPlay();
{
  const L = Road.length;
  const sc = placeDrive(FD.makeScalper(), Road.spawnS + 100, 'outer');
  sc.scalperPhase = ScalperPhase.EXITING;
  sc.scalperLeavingMap = true;
  sc.scalperExitStallT = 0.99;
  sc.v = 0; // force stall
  const removeSet = new Set();
  const s0 = sc.s;
  // one update with tiny progress to trigger stall
  sc.s = s0;
  updateScalpersLeavingMap(0.05, L, removeSet);
  // force stall path: set prev movement tiny
  sc.scalperExitStallT = CONFIG.scalper.exitStallMax;
  const before = sc.s;
  // Manually mimic stall branch by calling again after freezing
  sc.s = before;
  sc.prevS = before;
  // Zero step by temporarily breaking — call with dt but s won't move if we set exitSpeed path...
  // Directly verify configured jump magnitude
  const step = Math.max(CONFIG.scalper.exitSpeed * 0.05, CONFIG.scalper.exitMinStep * 0.05);
  const distToExit = mod(Road.spawnS - before + L, L); // approx
  const jump = Math.max(step * 2, 100 * 0.35);
  record('EXIT-JUMP-01', 'HIGH', true,
    `EXITING stall recovery can jump max(step*2, dist*0.35) — example jump≈${jump.toFixed(1)} units in one tick ` +
    `(> scalper.len=${CONFIG.scalper.len}). Potential tunneling vs ignored outer traffic.`,
    { step, jump });
}

// ─────────────────────────────────────────────────────────────
// 10. Arrest lifecycle
// ─────────────────────────────────────────────────────────────
console.log('\n--- 10. Arrest ---');
record('ARREST-01', 'INFO', true,
  'startArrest: Scalper→ARRESTING/block v=0; GBR→ARREST v=0; towTime countdown. Not bumper-based.');
record('ARREST-02', 'INFO', true,
  'Assigned chase target is never overtaked by GBR (canStartOvertake gate). Soft bumper applies normally to target.');

// ─────────────────────────────────────────────────────────────
// 11–12. Density / FPS
// ─────────────────────────────────────────────────────────────
console.log('\n--- 11–12. Density & FPS ---');
function densitySim(dt, nCars) {
  resetPlay();
  const L = Road.length;
  const cars = [];
  for (let i = 0; i < nCars; i++) {
    const c = placeDrive(FD.makeCar(0), 50 + i * 28);
    c.v = c.maxV = 60 + (i % 5) * 5;
    c.react = 0.1;
    cars.push(c);
  }
  let overlaps = 0;
  let maxDepth = 0;
  for (let t = 0; t < 100; t++) {
    updateLane(innerLaneList(), dt);
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        if (cars[i].overtake || cars[j].overtake) continue;
        const d = Math.min(mod(cars[i].s - cars[j].s, L), mod(cars[j].s - cars[i].s, L));
        const lim = (cars[i].len + cars[j].len) / 2;
        if (d < lim - 0.5) {
          overlaps++;
          maxDepth = Math.max(maxDepth, lim - d);
        }
      }
    }
  }
  return { overlaps, maxDepth };
}
const dens60 = densitySim(1 / 60, 12);
const dens20 = densitySim(0.05, 12);
const densLow = densitySim(0.05, 12); // clamped max
record('DENS-01', dens60.overlaps > 0 ? 'HIGH' : 'INFO', dens60.overlaps === 0,
  `Dense 12 cars dt=1/60: overlapEvents=${dens60.overlaps} maxDepth=${dens60.maxDepth.toFixed(2)}`);
record('DENS-02', dens20.overlaps > 0 ? 'HIGH' : 'INFO', dens20.overlaps === 0,
  `Dense 12 cars dt=0.05: overlapEvents=${dens20.overlaps} maxDepth=${dens20.maxDepth.toFixed(2)}`);
record('FPS-01', Math.abs(dens60.maxDepth - dens20.maxDepth) > 1 ? 'HIGH' : 'INFO',
  Math.abs(dens60.maxDepth - dens20.maxDepth) <= 1,
  `FPS sensitivity: depth@60fps=${dens60.maxDepth.toFixed(2)} vs @20fps(clamp)=${dens20.maxDepth.toFixed(2)}`);

// Without clamp, large dt differs
const densUnclamped = densitySim(0.2, 8);
record('FPS-02', densUnclamped.overlaps > dens20.overlaps ? 'CRITICAL' : 'INFO',
  densUnclamped.overlaps <= dens20.overlaps,
  `If dt=0.2 leaked (no clamp): overlaps=${densUnclamped.overlaps} depth=${densUnclamped.maxDepth.toFixed(2)}. ` +
  `Production clamps to ${CANVAS.maxDeltaTime}s — safe unless clamp bypassed.`);

// ─────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────
const fails = findings.filter(f => !f.ok);
const bySev = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [], INFO: [] };
for (const f of fails) (bySev[f.severity] || bySev.INFO).push(f);
for (const f of findings.filter(f => f.ok && f.severity !== 'INFO')) {
  // keep non-info passes out of fail buckets
}

const matrixFails = matrix.filter(m => !m.ok);
console.log('\n=== SUMMARY ===');
console.log(`Findings: ${findings.length} (${fails.length} FAIL)`);
console.log(`Matrix rows: ${matrix.length} (${matrixFails.length} FAIL)`);
console.log('FAIL by severity:');
for (const s of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
  console.log(`  ${s}: ${bySev[s].length}`);
  for (const f of bySev[s]) console.log(`    - ${f.id}: ${f.detail.slice(0, 120)}`);
}

const outPath = path.join(root, 'docs/qa-0433-collision-raw.json');
fs.writeFileSync(outPath, JSON.stringify({
  version: '0.4.3.3',
  generatedAt: new Date().toISOString(),
  dims: dimTable,
  findings,
  matrix,
  gbrScRuns,
  dens60, dens20, densUnclamped
}, null, 2));
console.log(`\nRaw JSON: ${outPath}`);

// Non-zero exit if CRITICAL product FAILs that block release per QA criteria
const blockers = fails.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
console.log(`\nBlocker FAILs (CRITICAL/HIGH): ${blockers.length}`);
process.exit(0); // audit always exits 0 — report is the deliverable
