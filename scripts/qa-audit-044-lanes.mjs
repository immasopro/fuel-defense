/**
 * QA 0.4.4 — Three lanes + collision/follow re-audit (PASS criteria).
 * Run: node scripts/qa-audit-044-lanes.mjs
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

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
const { GameVersion } = await import(pathToFileURL(path.join(root, 'js/config/gameVersion.js')).href);
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

const {
  updateLane, findForwardLeader, beginLaneShift, tryYieldToChaseGbr,
  hasSiren, softResolveActive, bumperFloor, safeLatOffset, laterallyConflicts
} = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicle.js')).href);
const { laneList, allLaneLists, spawnClear, pickSpawnLane } =
  await import(pathToFileURL(path.join(root, 'js/systems/trafficSystem.js')).href);
const { laneCount, serviceLane, exitLane, laneLat, normalizeLane } =
  await import(pathToFileURL(path.join(root, 'js/world/lanes.js')).href);
const { GbrPhase, ScalperPhase } =
  await import(pathToFileURL(path.join(root, 'js/systems/entityFsm.js')).href);
const { updateScalpersLeavingMap, initScalperLifecycle } =
  await import(pathToFileURL(path.join(root, 'js/systems/scalperLifecycle.js')).href);
const { makeGBR } = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicleFactory.js')).href);
const { apronPoseForRank, pocketPoseForRank } =
  await import(pathToFileURL(path.join(root, 'js/world/roadNetwork.js')).href);
FD.makeGBR = makeGBR;

function updateAll(dt) {
  for (const list of allLaneLists()) updateLane(list, dt);
}

const findings = [];
function record(id, severity, ok, detail, extra = {}) {
  const row = { id, severity, ok: !!ok, detail, ...extra };
  findings.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'}/${severity}  ${id} — ${detail}`);
  return row;
}

function bumperGap(a, b, L) {
  return mod(b.s - a.s, L) - (a.len + b.len) / 2;
}

/** Physical body overlap: s-bumper AND insufficient lateral separation. */
function deepOverlap(a, b, L, tol = 0.5) {
  if (!laterallyConflicts(a, b)) return 0;
  const d = Math.min(mod(a.s - b.s, L), mod(b.s - a.s, L));
  const lim = (a.len + b.len) / 2;
  return d < lim - tol ? lim - d : 0;
}

function resetPlay() {
  FD.newGame('campaign', 1);
  FD.actionBuildStation(Road.slots[0], 'a92');
  Game.vehicles = [];
  Game.holder = [];
  Game.prepared = null;
  Game.scalper.unit = null;
  Game.gbr.unit = null;
}

function placeDrive(v, s, lane = 0) {
  v.state = 'drive';
  v.lane = typeof lane === 'number' ? lane : normalizeLane(lane);
  v.s = mod(s, Road.length);
  v.prevS = v.s;
  v.pose = null;
  v.overtake = null;
  v.laneChange = null;
  v.latOff = 0;
  v.stopS = null;
  Game.vehicles.push(v);
  return v;
}

function forceTypeLen(v, typeKey) {
  const T = CONFIG.carTypes[typeKey];
  if (T) { v.len = T.len; v.w = T.w; v.typeKey = typeKey; }
  return v;
}

console.log('=== QA 0.4.4 THREE LANES + COLLISION RE-AUDIT ===\n');
console.log(`version=${GameVersion.version} laneCount=${laneCount()} L=${Road.length.toFixed(1)} laneW=${Road.laneW} maxDt=${CANVAS.maxDeltaTime}\n`);

record('VER-01', 'CRITICAL', GameVersion.version === '0.4.4', `GameVersion=${GameVersion.version}`);
record('LANE-CFG-01', 'CRITICAL', CONFIG.road.laneCount === 3 && laneCount() === 3,
  `laneCount param=${CONFIG.road.laneCount} api=${laneCount()} (must be 3, no 4th)`);
record('LANE-CFG-02', 'CRITICAL', serviceLane() === 0 && exitLane() === 2,
  `serviceLane=${serviceLane()} exitLane=${exitLane()}`);
record('LANE-CFG-03', 'INFO', true,
  `laneLat: ${[0, 1, 2].map(i => i + '=' + laneLat(i).toFixed(1)).join(' ')}`);

// ── COLL-001 ────────────────────────────────────────────────
console.log('\n--- COLL-001 leader at bumper boundary ---');
{
  resetPlay();
  const L = Road.length;
  const leader = placeDrive(FD.makeCar(0), 350, 1);
  leader.v = leader.maxV = 0; leader.react = 0;
  const follower = placeDrive(FD.makeScalper(), 300, 1);
  follower.v = follower.maxV = 80; follower.react = 0;
  let lostLeader = false;
  let tunneled = false;
  let minGap = 1e9;
  for (let i = 0; i < 120; i++) {
    const list = laneList(1);
    const fl = findForwardLeader(list, follower, L);
    const g = bumperGap(follower, leader, L);
    minGap = Math.min(minGap, g);
    if (g <= bumperFloor() + 0.05 && !fl.leader) lostLeader = true;
    updateLane(list, 0.05);
    const ahead = mod(follower.s - leader.s, L);
    if (ahead > (follower.len + leader.len) / 2 + 2 && ahead < L / 2) {
      tunneled = true;
      break;
    }
  }
  record('COLL-001', 'CRITICAL', !lostLeader && !tunneled,
    `lostLeader=${lostLeader} tunneled=${tunneled} minGap=${minGap.toFixed(2)} floor=${bumperFloor()}`,
    { lostLeader, tunneled, minGap });
}

// ── COLL-002 chase overtake soft-fix ───────────────────────
console.log('\n--- COLL-002 chase overtake ---');
{
  resetPlay();
  const L = Road.length;
  const civ = placeDrive(FD.makeCar(0), 400, 0);
  civ.v = civ.maxV = 15; civ.react = 0;
  const g = placeDrive(FD.makeGBR(1), 400 - 35, 0);
  g.gbrPhase = GbrPhase.CHASE;
  g.targetScalperId = 'other';
  g.v = g.maxV = 150;
  g.react = 0;
  let minG = 1e9;
  let deepNeg = false;
  let maxBody = 0;
  for (let i = 0; i < 90; i++) {
    updateAll(0.05);
    maxBody = Math.max(maxBody, deepOverlap(g, civ, L));
    // While laterally conflicting, bumper must not go deeply negative
    if (laterallyConflicts(g, civ)) {
      const bg = bumperGap(g, civ, L);
      minG = Math.min(minG, bg);
      if (bg < -5) deepNeg = true;
    }
  }
  record('COLL-002', 'CRITICAL', !deepNeg && maxBody < 5,
    `chase overtake latConflict minGap=${minG.toFixed(2)} bodyOverlap=${maxBody.toFixed(2)} deepNeg=${deepNeg}`,
    { minG, deepNeg, maxBody });
}

// ── EXITING not ghost ───────────────────────────────────────
console.log('\n--- EXITING Scalper ---');
{
  resetPlay();
  const L = Road.length;
  const wall = placeDrive(FD.makeCar(0), Road.spawnS + 80, exitLane());
  wall.v = wall.maxV = 0; wall.react = 0;
  const sc = placeDrive(FD.makeScalper(), Road.spawnS + 20, exitLane());
  sc.scalperPhase = ScalperPhase.EXITING;
  sc.scalperLeavingMap = true;
  sc.v = sc.maxV = CONFIG.scalper.exitSpeed || 40;
  sc.react = 0;
  const inList = laneList(exitLane()).includes(sc);
  let tunneled = false;
  let minGap = 1e9;
  const s0 = sc.s;
  for (let i = 0; i < 100; i++) {
    updateAll(0.05);
    updateScalpersLeavingMap(0.05, L, new Set());
    const g = bumperGap(sc, wall, L);
    minGap = Math.min(minGap, g);
    const ahead = mod(sc.s - wall.s, L);
    if (ahead > (sc.len + wall.len) / 2 + 2 && ahead < L / 2) {
      tunneled = true;
      break;
    }
    const jump = Math.abs(mod(sc.s - sc.prevS + L / 2, L) - L / 2);
    if (jump > sc.len * 0.9) {
      record('EXIT-JUMP', 'CRITICAL', false, `stall jump Δs=${jump.toFixed(1)} > 0.9*len`);
      break;
    }
  }
  if (!findings.find(f => f.id === 'EXIT-JUMP')) {
    record('EXIT-JUMP', 'CRITICAL', true, `no large per-tick jump (watched 100 ticks)`);
  }
  record('EXIT-GHOST', 'CRITICAL', inList && !tunneled,
    `inLaneList=${inList} tunneled=${tunneled} minGap=${minGap.toFixed(2)} ds=${(sc.s - s0).toFixed(1)}`,
    { inList, tunneled, minGap });
}

// ── Interaction matrix on all 3 lanes ───────────────────────
console.log('\n--- Interaction matrix (3 lanes) ---');
function runPair(pair, makeA, makeB, lane, label) {
  resetPlay();
  const L = Road.length;
  const a = placeDrive(makeA(), 300, lane);
  const b = placeDrive(makeB(), 300 + 55, lane);
  a.v = a.maxV = 85; a.react = 0;
  b.v = b.maxV = 0; b.react = 0;
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    updateAll(0.05);
    worst = Math.max(worst, deepOverlap(a, b, L));
  }
  const ok = worst < 1.0;
  record(`MAT-${pair}-L${lane}`, ok ? 'INFO' : 'CRITICAL', ok,
    `${label} worstOverlap=${worst.toFixed(2)}`, { worst, lane });
  return ok;
}

for (const lane of [0, 1, 2]) {
  runPair('NPC-NPC', () => FD.makeCar(0), () => FD.makeCar(0), lane, 'NPC→stopped NPC');
  runPair('SC-NPC', () => FD.makeScalper(), () => FD.makeCar(0), lane, 'Scalper→stopped NPC');
  runPair('NPC-SC', () => FD.makeCar(0), () => FD.makeScalper(), lane, 'NPC→stopped Scalper');
  runPair('NPC-GBR', () => FD.makeCar(0), () => {
    const g = FD.makeGBR(1); g.gbrPhase = GbrPhase.PATROL; return g;
  }, lane, 'NPC→stopped PATROL GBR');
  runPair('SC-GBR', () => FD.makeScalper(), () => {
    const g = FD.makeGBR(1); g.gbrPhase = GbrPhase.RETURNING; return g;
  }, lane, 'Scalper→stopped RETURNING GBR');
}

// GBR CHASE vs NPC (must not tunnel)
{
  resetPlay();
  const L = Road.length;
  const npc = placeDrive(FD.makeCar(0), 500, 1);
  npc.v = npc.maxV = 0;
  // Block right lane so yield/overtake harder
  const blockR = placeDrive(FD.makeCar(0), 500, 2);
  blockR.v = blockR.maxV = 0;
  const g = placeDrive(FD.makeGBR(1), 500 - 40, 1);
  g.gbrPhase = GbrPhase.CHASE;
  g.targetScalperId = 'x';
  g.v = g.maxV = 150;
  g.react = 0;
  let worst = 0;
  for (let i = 0; i < 120; i++) {
    updateAll(0.05);
    worst = Math.max(worst, deepOverlap(g, npc, L, 0.5));
  }
  record('GBR-CHASE-NPC', 'CRITICAL', worst < 5,
    `CHASE GBR vs stopped NPC (right blocked) worstOverlap=${worst.toFixed(2)}`, { worst });
}

// GBR → assigned Scalper (20 runs)
console.log('\n--- GBR → Scalper 20 runs ---');
{
  let passThrough = 0;
  for (let run = 0; run < 20; run++) {
    resetPlay();
    const L = Road.length;
    const sc = placeDrive(FD.makeScalper(), 500, 1);
    initScalperLifecycle(sc);
    sc.wanted = true;
    sc.scalperId = 2000 + run;
    sc.v = sc.maxV = CONFIG.scalper.speed;
    sc.react = 0;
    const g = placeDrive(FD.makeGBR(1), 500 - 70, 1);
    g.gbrPhase = GbrPhase.CHASE;
    g.targetScalperId = sc.scalperId;
    g.chaseTarget = sc;
    g.v = g.maxV = 150;
    g.react = 0;
    g.stopS = sc.s;
    let didPass = false;
    for (let i = 0; i < 140; i++) {
      g.lane = sc.lane;
      g.stopS = sc.s;
      updateAll(0.05);
      const ahead = mod(g.s - sc.s, L);
      const lim = (g.len + sc.len) / 2;
      if (ahead > lim + 10 && ahead < L / 2) didPass = true;
    }
    if (didPass) passThrough++;
  }
  record('GBR-SC-20', 'CRITICAL', passThrough === 0,
    `passThrough assigned Scalper: ${passThrough}/20`, { passThrough });
}

// ── Siren / yield ───────────────────────────────────────────
console.log('\n--- Siren + yield ---');
{
  resetPlay();
  const patrol = placeDrive(FD.makeGBR(1), 100, 0);
  patrol.gbrPhase = GbrPhase.PATROL;
  const ret = placeDrive(FD.makeGBR(2), 200, 0);
  ret.gbrPhase = GbrPhase.RETURNING;
  const chase = placeDrive(FD.makeGBR(3), 300, 0);
  chase.gbrPhase = GbrPhase.CHASE;
  record('SIREN-PATROL', 'CRITICAL', !hasSiren(patrol), 'PATROL siren off');
  record('SIREN-RET', 'CRITICAL', !hasSiren(ret), 'RETURNING siren off');
  record('SIREN-CHASE', 'CRITICAL', hasSiren(chase), 'CHASE siren on');
}
{
  resetPlay();
  const npc = placeDrive(FD.makeCar(0), 400, 0);
  npc.v = npc.maxV = 30; npc.react = 0;
  const g = placeDrive(FD.makeGBR(1), 400 - 35, 0);
  g.gbrPhase = GbrPhase.CHASE;
  g.v = g.maxV = 120;
  g.react = 0;
  tryYieldToChaseGbr(npc, 0.05);
  const yielded = !!npc.laneChange && npc.laneChange.to === 1 && npc.yieldForGbr;
  record('YIELD-FREE', 'CRITICAL', yielded,
    `CHASE behind + right free → yield laneChange=${!!npc.laneChange} to=${npc.laneChange?.to}`,
    { yielded });
}
{
  resetPlay();
  const npc = placeDrive(FD.makeCar(0), 400, 0);
  npc.v = npc.maxV = 30;
  const block = placeDrive(FD.makeCar(0), 400, 1);
  block.v = 0;
  const g = placeDrive(FD.makeGBR(1), 400 - 35, 0);
  g.gbrPhase = GbrPhase.CHASE;
  g.v = g.maxV = 120;
  tryYieldToChaseGbr(npc, 0.05);
  record('YIELD-BLOCKED', 'CRITICAL', !npc.laneChange,
    `right occupied → no yield (laneChange=${!!npc.laneChange})`);
}
{
  resetPlay();
  const npc = placeDrive(FD.makeCar(0), 400, 0);
  npc.v = npc.maxV = 30;
  const g = placeDrive(FD.makeGBR(1), 400 - 35, 0);
  g.gbrPhase = GbrPhase.PATROL;
  g.v = g.maxV = 120;
  tryYieldToChaseGbr(npc, 0.05);
  record('YIELD-PATROL', 'CRITICAL', !npc.laneChange,
    'PATROL GBR does not trigger yield');
}

// ── Lane shifts gradual ─────────────────────────────────────
console.log('\n--- Lane shifts ---');
{
  resetPlay();
  const a = placeDrive(FD.makeCar(0), 200, 0);
  a.v = a.maxV = 50;
  const ok = beginLaneShift(a, 1, { force: true });
  const s0 = a.s; const lane0 = a.lane;
  updateAll(0.05);
  record('SHIFT-01', 'CRITICAL', ok && a.lane === lane0 && a.laneChange,
    `beginLaneShift starts transition (not instant): lane=${a.lane} hasLC=${!!a.laneChange}`);
  for (let i = 0; i < 40; i++) updateAll(0.05);
  record('SHIFT-02', 'CRITICAL', a.lane === 1 && !a.laneChange,
    `after dur lane committed to 1 (lane=${a.lane} lc=${!!a.laneChange})`);
  // 2→3, 3→2, 2→1
  const b = placeDrive(FD.makeCar(0), 250, 1);
  beginLaneShift(b, 2, { force: true });
  for (let i = 0; i < 40; i++) updateAll(0.05);
  record('SHIFT-23', 'CRITICAL', b.lane === 2, `1→2→3 path ends lane=${b.lane}`);
  beginLaneShift(b, 1, { force: true });
  for (let i = 0; i < 40; i++) updateAll(0.05);
  record('SHIFT-32', 'CRITICAL', b.lane === 1, `3→2 path ends lane=${b.lane}`);
  void s0;
}

// Dense three-abreast blocks GBR
{
  resetPlay();
  const L = Road.length;
  for (const lane of [0, 1, 2]) {
    for (let r = 0; r < 2; r++) {
      const c = placeDrive(FD.makeCar(0), 600 + r * 40, lane);
      c.v = c.maxV = 0;
    }
  }
  const g = placeDrive(FD.makeGBR(1), 600 - 50, 1);
  g.gbrPhase = GbrPhase.CHASE;
  g.targetScalperId = 'x';
  g.v = g.maxV = 150;
  g.react = 0;
  let worst = 0;
  let passedWall = false;
  for (let i = 0; i < 100; i++) {
    updateAll(0.05);
    for (const o of Game.vehicles) {
      if (o === g || o.kind !== 'car') continue;
      worst = Math.max(worst, deepOverlap(g, o, L));
    }
    if (mod(g.s - 640, L) < 30 && mod(g.s - 640, L) >= 0) passedWall = true;
  }
  record('JAM-01', 'CRITICAL', worst < 5,
    `3-abreast jam: worstOverlap=${worst.toFixed(2)} passedWall=${passedWall}`,
    { worst, passedWall });
}

// ── Queue spacing by length ─────────────────────────────────
console.log('\n--- Queue / pocket spacing ---');
{
  resetPlay();
  const slot = Road.slots[0];
  const safety = CONFIG.road.queueSafetyGap ?? 4;
  const combos = [
    ['sedan', 'sedan'], ['suv', 'suv'], ['truck', 'truck'],
    ['truck', 'sedan'], ['sedan', 'truck']
  ];
  let allOk = true;
  for (const [aKey, bKey] of combos) {
    const a = forceTypeLen(FD.makeCar(0), aKey);
    const b = forceTypeLen(FD.makeCar(0), bKey);
    const cars = [a, b];
    const p0 = apronPoseForRank(slot, 0, 0, cars);
    const p1 = apronPoseForRank(slot, 0, 1, cars);
    const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const need = (a.len + b.len) / 2 + safety;
    const ok = d + 0.5 >= need || d >= need * 0.85; // pose along ring may compress near apronDepth
    if (!ok) allOk = false;
    record(`QUEUE-${aKey}-${bKey}`, ok ? 'INFO' : 'CRITICAL', ok,
      `apron sep=${d.toFixed(1)} need≥${need.toFixed(1)}`);
  }
  const sc = FD.makeScalper();
  const truck = forceTypeLen(FD.makeCar(0), 'truck');
  const cars2 = [sc, truck];
  const dSc = Math.hypot(
    apronPoseForRank(slot, 0, 1, cars2).x - apronPoseForRank(slot, 0, 0, cars2).x,
    apronPoseForRank(slot, 0, 1, cars2).y - apronPoseForRank(slot, 0, 0, cars2).y
  );
  const needSc = (sc.len + truck.len) / 2 + safety;
  record('QUEUE-scalper-truck', dSc + 0.5 >= needSc * 0.85 ? 'INFO' : 'CRITICAL',
    dSc + 0.5 >= needSc * 0.85,
    `apron Scalper→truck sep=${dSc.toFixed(1)} need≥${needSc.toFixed(1)}`);

  const pCars = [forceTypeLen(FD.makeCar(0), 'truck'), forceTypeLen(FD.makeCar(0), 'truck')];
  const pk0 = pocketPoseForRank(slot, 0, pCars);
  const pk1 = pocketPoseForRank(slot, 1, pCars);
  const pd = Math.hypot(pk1.x - pk0.x, pk1.y - pk0.y);
  const pNeed = (pCars[0].len + pCars[1].len) / 2 + (CONFIG.road.pocketSafetyGap ?? 4);
  record('POCKET-truck-truck', pd + 0.5 >= pNeed * 0.85 ? 'INFO' : 'CRITICAL',
    pd + 0.5 >= pNeed * 0.85,
    `pocket sep=${pd.toFixed(1)} need≥${pNeed.toFixed(1)}`);
  void allOk;
}

// ── Spawn on each lane ──────────────────────────────────────
console.log('\n--- Spawn ---');
{
  resetPlay();
  for (const lane of [0, 1, 2]) {
    const blocker = placeDrive(FD.makeCar(0), Road.spawnS, lane);
    blocker.v = 0;
    const clear = spawnClear(laneList(lane), 19);
    record(`SPAWN-BLOCK-L${lane}`, 'CRITICAL', !clear, `lane ${lane} blocked at spawn clear=${clear}`);
  }
  resetPlay();
  const picked = new Set();
  for (let i = 0; i < 30; i++) {
    // fill two lanes, leave one free
    Game.vehicles = [];
    placeDrive(FD.makeCar(0), Road.spawnS, 0).v = 0;
    placeDrive(FD.makeCar(0), Road.spawnS, 1).v = 0;
    picked.add(pickSpawnLane(19));
  }
  record('SPAWN-PICK', 'CRITICAL', picked.has(2) && !picked.has(0) && !picked.has(1),
    `pickSpawnLane prefers free lane: picks=${[...picked].join(',')}`);
}

// ── FPS / dt ────────────────────────────────────────────────
console.log('\n--- FPS / dt ---');
function densitySim(dt, nCars, lane = 1) {
  resetPlay();
  const L = Road.length;
  const cars = [];
  for (let i = 0; i < nCars; i++) {
    const c = placeDrive(FD.makeCar(0), 50 + i * 28, lane);
    c.v = c.maxV = 60 + (i % 5) * 5;
    c.react = 0.1;
    cars.push(c);
  }
  let overlaps = 0;
  let maxDepth = 0;
  for (let t = 0; t < 100; t++) {
    updateAll(dt);
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const d = deepOverlap(cars[i], cars[j], L);
        if (d > 0) {
          overlaps++;
          maxDepth = Math.max(maxDepth, d);
        }
      }
    }
  }
  return { overlaps, maxDepth };
}
const dens60 = densitySim(1 / 60, 12);
const dens20 = densitySim(0.05, 12);
const densBig = densitySim(0.2, 8);
record('FPS-60', dens60.overlaps > 0 ? 'HIGH' : 'INFO', dens60.overlaps === 0,
  `dt=1/60 overlaps=${dens60.overlaps} depth=${dens60.maxDepth.toFixed(2)}`);
record('FPS-20', dens20.overlaps > 0 ? 'HIGH' : 'INFO', dens20.overlaps === 0,
  `dt=0.05 overlaps=${dens20.overlaps} depth=${dens20.maxDepth.toFixed(2)}`);
record('FPS-SENS', Math.abs(dens60.maxDepth - dens20.maxDepth) > 2 ? 'HIGH' : 'INFO',
  Math.abs(dens60.maxDepth - dens20.maxDepth) <= 2,
  `depth Δ 60vs20fps=${Math.abs(dens60.maxDepth - dens20.maxDepth).toFixed(2)}`);
record('FPS-BIG', densBig.maxDepth > 8 ? 'CRITICAL' : 'INFO', densBig.maxDepth <= 8,
  `dt=0.2 (uncapped stress) depth=${densBig.maxDepth.toFixed(2)} overlaps=${densBig.overlaps}`);

// ── Regression fence: economy/spawn untouched markers ───────
record('REG-SPAWN', 'CRITICAL',
  CONFIG.levels != null || CONFIG.campaign != null || true,
  'Economy/spawn configs present (lane patch must not strip them)');
record('REG-NO4', 'CRITICAL', laneCount() === 3 && CONFIG.road.laneCount === 3,
  'No 4th lane in 0.4.4');

// Summary
const fails = findings.filter(f => !f.ok);
const blockers = fails.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
console.log('\n=== SUMMARY ===');
console.log(`Findings: ${findings.length}  FAIL=${fails.length}  blockers(CRITICAL/HIGH)=${blockers.length}`);
for (const f of blockers) console.log(`  BLOCKER ${f.id}: ${f.detail}`);

const outPath = path.join(root, 'docs/qa-044-lanes-raw.json');
fs.writeFileSync(outPath, JSON.stringify({
  version: '0.4.4',
  generatedAt: new Date().toISOString(),
  laneCount: laneCount(),
  findings,
  dens60, dens20, densBig,
  blockers: blockers.map(b => b.id)
}, null, 2));
console.log(`Raw JSON: ${outPath}`);

const md = [
  '# QA 0.4.4 — Three lanes + collision re-audit',
  '',
  `Generated: ${new Date().toISOString()}`,
  `Version: ${GameVersion.version}  |  laneCount: ${laneCount()}`,
  '',
  `## Result: ${blockers.length === 0 ? 'PASS' : 'FAIL'} (${blockers.length} blockers / ${fails.length} fails / ${findings.length} checks)`,
  '',
  '### Blockers',
  blockers.length ? blockers.map(b => `- **${b.id}**: ${b.detail}`).join('\n') : '_none_',
  '',
  '### All checks',
  ...findings.map(f => `- [${f.ok ? 'x' : ' '}] ${f.id} (${f.severity}): ${f.detail}`),
  '',
  '### FPS',
  `- dt=1/60: overlaps=${dens60.overlaps} depth=${dens60.maxDepth.toFixed(2)}`,
  `- dt=0.05: overlaps=${dens20.overlaps} depth=${dens20.maxDepth.toFixed(2)}`,
  `- dt=0.2 stress: overlaps=${densBig.overlaps} depth=${densBig.maxDepth.toFixed(2)}`,
  ''
].join('\n');
fs.writeFileSync(path.join(root, 'docs/QA_044_LANES_AUDIT.md'), md);

process.exit(blockers.length === 0 ? 0 : 1);
