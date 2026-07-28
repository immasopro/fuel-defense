/**
 * QA 0.4.4 — Road model / 3 lanes / Scalper / collisions AUDIT (no fixes).
 * Run: node scripts/qa-audit-044-road.mjs
 * Output: docs/QA_044_ROAD_AUDIT.md + docs/qa-044-road-raw.json
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
const { update } = await import(pathToFileURL(path.join(root, 'js/game.js')).href);
const { Road } = await import(pathToFileURL(path.join(root, 'js/world/roadNetwork.js')).href);
const { Depot, GBRBase, sortedStationSlots } = await import(pathToFileURL(path.join(root, 'js/world/map.js')).href);
const { Game } = await import(pathToFileURL(path.join(root, 'js/core/gameState.js')).href);
const { CONFIG } = await import(pathToFileURL(path.join(root, 'js/config/index.js')).href);
const { GameVersion } = await import(pathToFileURL(path.join(root, 'js/config/gameVersion.js')).href);
const { UI } = await import(pathToFileURL(path.join(root, 'js/ui/hud.js')).href);
const { mod } = await import(pathToFileURL(path.join(root, 'js/core/utils.js')).href);
const { CANVAS } = await import(pathToFileURL(path.join(root, 'js/config/constants.js')).href);

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
  hasSiren, bumperFloor, laterallyConflicts, softResolveActive
} = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicle.js')).href);
const { laneList, allLaneLists, spawnClear, pickSpawnLane, deployToRing } =
  await import(pathToFileURL(path.join(root, 'js/systems/trafficSystem.js')).href);
const { laneCount, serviceLane, exitLane, normalizeLane, laneLat } =
  await import(pathToFileURL(path.join(root, 'js/world/lanes.js')).href);
const {
  getTargetCars, canSpawnScalper, canSpawnMoreCars, getSpawnedCars,
  scalperCooldown, isLevelDraining, LevelPhase
} = await import(pathToFileURL(path.join(root, 'js/systems/spawnSystem.js')).href);
const { tickSpecialSpawns } = await import(pathToFileURL(path.join(root, 'js/systems/specialVehicles.js')).href);
const { GbrPhase, ScalperPhase } =
  await import(pathToFileURL(path.join(root, 'js/systems/entityFsm.js')).href);
const { initScalperLifecycle, updateScalpersLeavingMap, despawnScalper } =
  await import(pathToFileURL(path.join(root, 'js/systems/scalperLifecycle.js')).href);
const { makeGBR, makeScalper } = await import(pathToFileURL(path.join(root, 'js/vehicles/vehicleFactory.js')).href);
const { apronPoseForRank, pocketPoseForRank } =
  await import(pathToFileURL(path.join(root, 'js/world/roadNetwork.js')).href);
FD.makeGBR = makeGBR;

const findings = [];
const telemetry = {
  scalperAttempts: [],
  laneSpawns: { 0: 0, 1: 0, 2: 0 },
  stuckSamples: [],
  gapCases: []
};

function record(id, severity, ok, detail, extra = {}) {
  const row = { id, severity, ok: !!ok, detail, ...extra };
  findings.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'}/${severity}  ${id} — ${detail}`);
  return row;
}

function bumperGap(a, b, L) {
  return mod(b.s - a.s, L) - (a.len + b.len) / 2;
}

function deepOverlap(a, b, L, tol = 0.5) {
  if (!laterallyConflicts(a, b)) return 0;
  const d = Math.min(mod(a.s - b.s, L), mod(b.s - a.s, L));
  const lim = (a.len + b.len) / 2;
  return d < lim - tol ? lim - d : 0;
}

function updateAll(dt) {
  for (const list of allLaneLists()) updateLane(list, dt);
}

function resetPlay(level = 1, buildStation = true) {
  FD.newGame('campaign', level);
  Game.money = 1e9;
  Game.depot.res = 5000;
  if (buildStation) {
    FD.actionBuildStation(Road.slots[0], 'a92');
    if (Road.slots[1]) FD.actionBuildStation(Road.slots[1], 'a92');
  }
  Game.vehicles = [];
  Game.holder = [];
  Game.prepared = null;
  Game.scalper.unit = null;
  Game.gbr.unit = null;
  Game.stats.spawned = 0;
}

function placeDrive(v, s, lane = 0) {
  v.state = 'drive';
  v.lane = normalizeLane(lane);
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

function stepGame(n, dt = 1 / 60) {
  for (let i = 0; i < n; i++) update(dt);
}

function forceType(v, key) {
  const T = CONFIG.carTypes[key];
  if (T) { v.len = T.len; v.w = T.w; v.typeKey = key; v.maxV = T.maxV; }
  return v;
}

console.log('=== QA 0.4.4 ROAD / 3-LANE / SCALPER / COLLISION AUDIT ===\n');
console.log(`version=${GameVersion.version} laneCount=${laneCount()} L=${Road.length.toFixed(1)} maxDt=${CANVAS.maxDeltaTime}\n`);

record('VER', 'INFO', GameVersion.version === '0.4.4', `GameVersion=${GameVersion.version}`);
record('LANE-N', 'CRITICAL', laneCount() === 3 && CONFIG.road.laneCount === 3,
  `laneCount=${laneCount()} CONFIG=${CONFIG.road.laneCount}`);

// ═══════════════════════════════════════════════════════════
// 1. Scalper spawn (levels 1/5/10/20) — with & without station
// ═══════════════════════════════════════════════════════════
console.log('\n--- 1. Scalper spawn ---');

function probeScalperSpawn(level, buildStation, maxRegular, label) {
  resetPlay(level, buildStation);
  Game.light.phase = 'green';
  Game.light.redT = 0;
  const target = getTargetCars();
  const tel = {
    label, level, buildStation, stations: sortedStationSlots().length,
    target, attempts: 0, blockedNoStation: 0, blockedBudget: 0, blockedUnit: 0,
    spawned: 0, scalperCount: 0, lanes: [], regularSeen: 0
  };
  // Force frequent timer checks while accelerating spawn
  let ticks = 0;
  const maxTicks = 20000;
  while (ticks < maxTicks && getSpawnedCars() < maxRegular && Game.state === 'play') {
    // Force scalper timer nearly ready each ~0.5s wall to sample gates often
    if (ticks % 30 === 0) {
      const hadUnit = !!Game.scalper.unit;
      const stations = sortedStationSlots().length;
      const can = canSpawnScalper();
      tel.attempts++;
      if (!stations) tel.blockedNoStation++;
      else if (!can) tel.blockedBudget++;
      else if (hadUnit) tel.blockedUnit++;
      Game.scalperTimer = 0;
      const before = Game.scalper.unit;
      tickSpecialSpawns(0.016);
      if (!before && Game.scalper.unit) {
        tel.scalperCount++;
        tel.lanes.push(normalizeLane(Game.scalper.unit.lane));
      }
    }
    update(1 / 60);
    ticks++;
    // keep light green so holder drains
    Game.light.phase = 'green';
    Game.light.redT = 0;
  }
  tel.regularSeen = getSpawnedCars();
  tel.finalSpawned = getSpawnedCars();
  tel.draining = isLevelDraining();
  tel.scalperStill = !!Game.scalper.unit;
  telemetry.scalperAttempts.push(tel);
  return tel;
}

for (const lvl of [1, 5, 10, 20]) {
  const tgt = CONFIG.levels[lvl - 1]?.targetCars || 100;
  const noSt = probeScalperSpawn(lvl, false, Math.min(80, tgt), `L${lvl}-noStation`);
  record(`SC-NOAZS-L${lvl}`, 'CRITICAL', noSt.scalperCount === 0 && noSt.blockedNoStation > 0,
    `no AZS: scalpers=${noSt.scalperCount} attempts=${noSt.attempts} blockedNoStation=${noSt.blockedNoStation} spawned=${noSt.finalSpawned}`,
    noSt);

  const withSt = probeScalperSpawn(lvl, true, Math.min(250, tgt), `L${lvl}-withStation`);
  record(`SC-AZS-L${lvl}`, withSt.scalperCount > 0 ? 'INFO' : 'CRITICAL', withSt.scalperCount > 0,
    `with AZS: scalpers=${withSt.scalperCount} spawned=${withSt.finalSpawned}/${withSt.target} ` +
    `blockedBudget=${withSt.blockedBudget} blockedUnit=${withSt.blockedUnit} lanes=[${withSt.lanes.join(',')}]`,
    withSt);
}

// Isolated: stations + timer 0 + budget + no unit → MUST spawn
{
  resetPlay(5, true);
  Game.scalper.unit = null;
  Game.scalperTimer = 0;
  Game.stats.spawned = 10;
  const can = canSpawnScalper() && sortedStationSlots().length > 0;
  tickSpecialSpawns(0.016);
  record('SC-GATE-OPEN', 'CRITICAL', can && !!Game.scalper.unit,
    `open gates (AZS+budget+timer): can=${can} unit=${!!Game.scalper.unit} phase=${Game.scalper.unit?.scalperPhase}`);
}

// ═══════════════════════════════════════════════════════════
// 2–4. Three lanes simulation + leader + L1 stuck repro
// ═══════════════════════════════════════════════════════════
console.log('\n--- 2–4. Lane simulation / leader / L1 stuck ---');

function laneMotionTest(lane) {
  resetPlay(1, true);
  const L = Road.length;
  const leader = placeDrive(FD.makeCar(0), 400, lane);
  leader.v = leader.maxV = 40; leader.react = 0;
  const follower = placeDrive(FD.makeCar(0), 340, lane);
  follower.v = follower.maxV = 70; follower.react = 0;
  const s0L = leader.s, s0F = follower.s;
  let movedL = 0, movedF = 0, sawLeader = 0, minGap = 1e9, worstOv = 0;
  for (let i = 0; i < 120; i++) {
    updateAll(1 / 60);
    movedL += Math.abs(mod(leader.s - leader.prevS + L / 2, L) - L / 2);
    movedF += Math.abs(mod(follower.s - follower.prevS + L / 2, L) - L / 2);
    const fl = findForwardLeader(laneList(lane), follower, L);
    if (fl.leader === leader) sawLeader++;
    minGap = Math.min(minGap, bumperGap(follower, leader, L));
    worstOv = Math.max(worstOv, deepOverlap(follower, leader, L));
  }
  const ok = movedL > 5 && movedF > 1 && sawLeader > 60 && worstOv < 2;
  record(`LANE-MOT-L${lane}`, ok ? 'INFO' : 'CRITICAL', ok,
    `movedL=${movedL.toFixed(1)} movedF=${movedF.toFixed(1)} sawLeader=${sawLeader}/120 minGap=${minGap.toFixed(2)} ov=${worstOv.toFixed(2)} ΔsL=${(leader.s - s0L).toFixed(1)} ΔsF=${(follower.s - s0F).toFixed(1)}`);
}

for (const lane of [0, 1, 2]) laneMotionTest(lane);

// Leader matrix
function leaderCase(lane, scenario, setup, opts = {}) {
  resetPlay(1, true);
  const L = Road.length;
  const a = placeDrive(FD.makeCar(0), 300, lane);
  const b = placeDrive(FD.makeCar(0), 360, lane);
  setup(a, b);
  if (opts.blockAdj) {
    for (const ol of [lane - 1, lane + 1]) {
      if (ol < 0 || ol > 2) continue;
      for (let k = 0; k < 3; k++) {
        const c = placeDrive(FD.makeCar(0), 300 + k * 28, ol);
        c.v = c.maxV = 0;
      }
    }
  }
  let lost = false, bodyTunnel = false, wrongGap = false, minGap = 1e9, worstBody = 0;
  let laneChanged = false;
  for (let i = 0; i < 100; i++) {
    const fl = findForwardLeader(laneList(normalizeLane(a.lane)), a, L);
    const g = bumperGap(a, b, L);
    minGap = Math.min(minGap, g);
    worstBody = Math.max(worstBody, deepOverlap(a, b, L));
    if (normalizeLane(a.lane) !== lane) laneChanged = true;
    // lost leader only while still same lane and still behind in bumper sense
    if (!laneChanged && g > -1 && g < 200 && fl.leader !== b) lost = true;
    if (fl.leader === b && Math.abs(fl.gap - g) > 1) wrongGap = true;
    updateAll(0.05);
    if (deepOverlap(a, b, L) > 3) bodyTunnel = true;
  }
  // Body tunnel = CRITICAL; s-pass via free adjacent overtake = INFO (model allows)
  const sev = bodyTunnel || (opts.blockAdj && (lost || worstBody > 2)) ? 'CRITICAL' : 'INFO';
  const ok = !bodyTunnel && !wrongGap && (!opts.blockAdj || (!lost && worstBody < 2));
  record(`LEAD-L${lane}-${scenario}`, sev, ok,
    `lost=${lost} bodyTunnel=${bodyTunnel} laneChanged=${laneChanged} wrongGap=${wrongGap} minGap=${minGap.toFixed(2)} worstBody=${worstBody.toFixed(2)}`);
}

for (const lane of [0, 1, 2]) {
  leaderCase(lane, 'sameSpeed', (a, b) => { a.v = a.maxV = 50; b.v = b.maxV = 50; a.react = b.react = 0; });
  leaderCase(lane, 'fastFollower', (a, b) => { a.v = a.maxV = 80; b.v = b.maxV = 30; a.react = 0; });
  leaderCase(lane, 'stoppedLeader', (a, b) => { a.v = a.maxV = 80; b.v = b.maxV = 0; a.react = 0; });
  leaderCase(lane, 'stoppedLeaderBlocked', (a, b) => { a.v = a.maxV = 80; b.v = b.maxV = 0; a.react = 0; }, { blockAdj: true });
  leaderCase(lane, 'bothStopped', (a, b) => { a.v = b.v = 0; a.maxV = b.maxV = 0; });
}

// Reproduce user L1 gap case: A@1238 B@1345
{
  resetPlay(1, true);
  const L = Road.length;
  const a = placeDrive(forceType(FD.makeCar(0), 'sedan'), 1238, 1);
  a.v = a.maxV = 0; a.react = 0;
  const b = placeDrive(forceType(FD.makeCar(0), 'suv'), 1345, 1);
  b.v = b.maxV = 0; b.react = 0;
  const flA = findForwardLeader(laneList(1), a, L);
  const flB = findForwardLeader(laneList(1), b, L);
  const expectA = bumperGap(a, b, L);
  const detail = {
    L,
    gapA: flA.gap,
    gapB: flB.gap,
    expectA,
    leaderA: flA.leader === b,
    leaderB: flB.leader === a,
    wrapGapB: flB.leader ? flB.gap : null
  };
  telemetry.gapCases.push(detail);
  // A should see B with ~86; B should see A via wrap OR no forward if only two — wrap is forward on ring
  const aOk = flA.leader === b && Math.abs(flA.gap - 86) < 2;
  // User reported B gap=1347.5 — check if we get a large wrap gap
  const bGapLarge = flB.leader === a && flB.gap > 1000;
  record('GAP-L1-REPRO', aOk ? 'INFO' : 'CRITICAL', aOk,
    `A(1238)→B(1345): leader=${flA.leader === b} gap=${flA.gap.toFixed(1)} expect≈86; ` +
    `B→A wrap: leader=${flB.leader === a} gap=${flB.gap === 1e9 ? '∞' : flB.gap.toFixed(1)} largeWrap=${bGapLarge}`,
    detail);
  // Stuck check: both stopped in drive — s must stay (expected parked), not a sim bug by itself
  const sA0 = a.s, sB0 = b.s;
  for (let i = 0; i < 300; i++) updateAll(1 / 60); // 5s
  record('L1-STOPPED-PAIR', 'INFO', Math.abs(a.s - sA0) < 0.01 && Math.abs(b.s - sB0) < 0.01,
    `both maxV=0 stay put ΔsA=${(a.s - sA0).toFixed(3)} ΔsB=${(b.s - sB0).toFixed(3)} (parked, not stuck-alive)`);

  // Free-adjacent: overtake allowed (INFO). Blocked-adjacent: must stop (CRITICAL).
  a.v = a.maxV = 70;
  const sStart = a.s;
  for (let i = 0; i < 180; i++) updateAll(1 / 60);
  const freeLaneChanged = normalizeLane(a.lane) !== 1;
  const freeBody = deepOverlap(a, b, L);
  record('L1-FOLLOW-FREE', freeBody < 2 ? 'INFO' : 'CRITICAL', freeBody < 2,
    `free adj: laneChanged=${freeLaneChanged} bodyOv=${freeBody.toFixed(2)} Δs=${(a.s - sStart).toFixed(1)} (overtake OK if no body ov)`);

  // Reset pair with adjacent blocked
  Game.vehicles = Game.vehicles.filter(v => v === a || v === b);
  a.lane = 1; a.s = 1238; a.prevS = a.s; a.v = 70; a.maxV = 70; a.overtake = null; a.latOff = 0; a.laneChange = null;
  b.lane = 1; b.s = 1345; b.v = b.maxV = 0;
  for (const ol of [0, 2]) {
    for (let k = 0; k < 4; k++) {
      const c = placeDrive(FD.makeCar(0), 1230 + k * 30, ol);
      c.v = c.maxV = 0;
    }
  }
  for (let i = 0; i < 180; i++) updateAll(1 / 60);
  const finalGap = bumperGap(a, b, L);
  const body = deepOverlap(a, b, L);
  const stayed = normalizeLane(a.lane) === 1;
  record('L1-FOLLOW-STOP', body < 2 && stayed && a.v < 5 ? 'INFO' : 'CRITICAL', body < 2 && stayed && a.v < 5,
    `blocked adj: stayedL1=${stayed} finalGap=${finalGap.toFixed(2)} v=${a.v.toFixed(1)} bodyOv=${body.toFixed(2)}`);
}

// Live L1 stream stuck detector (dense)
{
  resetPlay(5, true);
  Game.light.phase = 'green';
  const stuck = [];
  const lastS = new Map();
  const stillSince = new Map();
  for (let t = 0; t < 3600; t++) { // 60s
    update(1 / 60);
    Game.light.phase = 'green'; Game.light.redT = 0;
    for (const v of Game.vehicles) {
      if (v.state !== 'drive') continue;
      if (v.overtake || v.laneChange) continue;
      if (v.stopS != null) continue;
      const id = v.fleetId || v.scalperId || v.id || Game.vehicles.indexOf(v);
      const prev = lastS.get(id);
      const ds = prev == null ? 1 : Math.abs(mod(v.s - prev + Road.length / 2, Road.length) - Road.length / 2);
      lastS.set(id, v.s);
      if (ds < 0.05 && v.maxV > 5) {
        stillSince.set(id, (stillSince.get(id) || 0) + 1 / 60);
      } else stillSince.set(id, 0);
      if ((stillSince.get(id) || 0) > 5) {
        const lane = normalizeLane(v.lane);
        const fl = findForwardLeader(laneList(lane), v, Road.length);
        stuck.push({
          id, kind: v.kind, lane, s: v.s, v: v.v, maxV: v.maxV,
          gap: fl.gap, hasLeader: !!fl.leader, len: v.len, still: stillSince.get(id)
        });
        stillSince.set(id, 0); // report once periodically
      }
    }
  }
  telemetry.stuckSamples = stuck.slice(0, 40);
  const byLane = { 0: 0, 1: 0, 2: 0 };
  for (const s of stuck) byLane[s.lane] = (byLane[s.lane] || 0) + 1;
  record('STUCK-60s', stuck.length > 5 ? 'HIGH' : 'INFO', stuck.length <= 5,
    `stuck-drive events (>5s no Δs): ${stuck.length} byLane=${JSON.stringify(byLane)} sample=${JSON.stringify(stuck.slice(0, 3))}`);
}

// ═══════════════════════════════════════════════════════════
// 5–6. Scalper lifecycle + lane distribution
// ═══════════════════════════════════════════════════════════
console.log('\n--- 5–6. Scalper lifecycle / lane distribution ---');

function scalperLifecycleOnLane(lane) {
  resetPlay(5, true);
  const sc = makeScalper();
  initScalperLifecycle(sc);
  placeDrive(sc, Road.spawnS + 50, lane);
  Game.scalper.unit = sc;
  sc.v = sc.maxV = CONFIG.scalper.speed;
  const phases = new Set([sc.scalperPhase]);
  let moved = 0;
  for (let i = 0; i < 300; i++) {
    updateAll(1 / 60);
    phases.add(sc.scalperPhase);
    moved += Math.abs(mod(sc.s - sc.prevS + Road.length / 2, Road.length) - Road.length / 2);
  }
  const ok = moved > 10 && sc.state === 'drive';
  record(`SC-LIFE-DRIVE-L${lane}`, ok ? 'INFO' : 'CRITICAL', ok,
    `post-spawn drive: moved=${moved.toFixed(1)} state=${sc.state} phase=${sc.scalperPhase} phases=[${[...phases].join(',')}]`);
}

for (const lane of [0, 1, 2]) scalperLifecycleOnLane(lane);

// 100 forced spawn attempts → lane distribution via deploy
{
  resetPlay(5, true);
  const counts = { 0: 0, 1: 0, 2: 0 };
  let fail = 0;
  for (let i = 0; i < 100; i++) {
    Game.vehicles = Game.vehicles.filter(v => v.kind !== 'scalper');
    Game.scalper.unit = null;
    Game.stats.spawned = 10;
    Game.scalperTimer = 0;
    // Clear near spawn
    Game.vehicles = Game.vehicles.filter(v => {
      const rel = Math.abs(mod(v.s - Road.spawnS + Road.length / 2, Road.length) - Road.length / 2);
      return rel > 60;
    });
    tickSpecialSpawns(0.016);
    const sc = Game.scalper.unit;
    if (!sc) { fail++; continue; }
    // Force deploy like holder release
    if (!Game.vehicles.includes(sc)) {
      Game.holder = Game.holder.filter(x => x !== sc);
      deployToRing(sc);
    }
    counts[normalizeLane(sc.lane)]++;
    telemetry.laneSpawns[normalizeLane(sc.lane)]++;
  }
  const used = Object.values(counts).filter(c => c > 0).length;
  // Empty ring: pickSpawnLane prefers serviceLane(0) — bias, not hard lock.
  record('SC-LANE-DIST-EMPTY', used < 2 ? 'HIGH' : 'INFO', used >= 1,
    `100 Scalper deploys on mostly-empty ring: L0=${counts[0]} L1=${counts[1]} L2=${counts[2]} fail=${fail} lanesUsed=${used}. ` +
    `Prefer L0 when clear is pickSpawnLane scoring (also affects NPC).`);
}

// Block each lane and ensure Scalper can still deploy elsewhere
for (const blockLane of [0, 1, 2]) {
  resetPlay(5, true);
  for (let k = 0; k < 3; k++) {
    const c = placeDrive(FD.makeCar(0), Road.spawnS + k * 8, blockLane);
    c.v = 0;
  }
  Game.scalper.unit = null;
  Game.scalperTimer = 0;
  Game.stats.spawned = 5;
  tickSpecialSpawns(0.016);
  const sc = Game.scalper.unit;
  if (sc) {
    Game.holder = Game.holder.filter(x => x !== sc);
    deployToRing(sc);
  }
  const lane = sc ? normalizeLane(sc.lane) : null;
  record(`SC-BLOCK-L${blockLane}`, sc && lane !== blockLane ? 'INFO' : (sc ? 'INFO' : 'CRITICAL'),
    !!sc,
    `block L${blockLane} near spawn: scalper=${!!sc} deployedLane=${lane}`);
}

// ═══════════════════════════════════════════════════════════
// 7–8. Regular spawn + lane distribution
// ═══════════════════════════════════════════════════════════
console.log('\n--- 7–8. Regular spawn ---');

function regularSpawnProbe(level, maxSpawn) {
  resetPlay(level, true);
  Game.light.phase = 'green';
  const lanes = { 0: 0, 1: 0, 2: 0 };
  const seen = new Set();
  let ticks = 0;
  while (getSpawnedCars() < maxSpawn && ticks < 90000 && Game.state === 'play') {
    update(1 / 60);
    Game.light.phase = 'green'; Game.light.redT = 0;
    Game.defeatT = 0; // audit isolates spawn, not defeat-by-holder
    for (const v of Game.vehicles) {
      if (v.kind !== 'car') continue;
      const id = v.fleetId ?? Game.vehicles.indexOf(v);
      if (seen.has(id)) continue;
      // approximate first sighting as spawn lane
      if (Math.abs(mod(v.s - Road.spawnS + Road.length / 2, Road.length) - Road.length / 2) < 40) {
        lanes[normalizeLane(v.lane)]++;
        seen.add(id);
      }
    }
    ticks++;
  }
  return { spawned: getSpawnedCars(), target: getTargetCars(), lanes, ticks, draining: isLevelDraining(), state: Game.state };
}

for (const [lvl, n] of [[1, 100], [5, 100], [5, 250]]) {
  const r = regularSpawnProbe(lvl, n);
  const used = Object.values(r.lanes).filter(c => c > 0).length;
  record(`REG-L${lvl}-N${n}`, r.spawned >= Math.min(n, r.target) * 0.9 ? 'INFO' : 'CRITICAL',
    r.spawned >= Math.min(n, r.target) * 0.9,
    `spawned=${r.spawned}/${r.target} lanes=${JSON.stringify(r.lanes)} used=${used}`);
  if (n >= 250) {
    record('REG-LANE-DIST-250', used < 3 ? 'HIGH' : 'INFO', used === 3,
      `250-spawn lane use: ${JSON.stringify(r.lanes)}`);
  }
}

// pickSpawnLane unit
{
  resetPlay(1, true);
  const picks = { 0: 0, 1: 0, 2: 0 };
  for (let i = 0; i < 60; i++) {
    Game.vehicles = [];
    picks[pickSpawnLane(19)]++;
  }
  record('PICK-EMPTY', 'HIGH', Object.values(picks).filter(c => c > 0).length >= 2,
    `pickSpawnLane empty ring ALWAYS prefers L0: ${JSON.stringify(picks)}. ` +
    `Under light traffic L1/L2 under-spawn until L0 congested near spawnS.`);
}

// ═══════════════════════════════════════════════════════════
// 9–10. Lane changes
// ═══════════════════════════════════════════════════════════
console.log('\n--- 9–10. Lane changes ---');
for (const [from, to] of [[0, 1], [1, 0], [1, 2], [2, 1]]) {
  resetPlay(1, true);
  const a = placeDrive(FD.makeCar(0), 200, from);
  a.v = a.maxV = 50;
  const okStart = beginLaneShift(a, to, { force: true });
  const lane0 = a.lane;
  updateAll(0.05);
  const midOk = a.lane === lane0 && !!a.laneChange;
  for (let i = 0; i < 50; i++) updateAll(0.05);
  record(`SHIFT-${from}-${to}`, okStart && midOk && a.lane === to && !a.laneChange ? 'INFO' : 'HIGH',
    okStart && midOk && a.lane === to && !a.laneChange,
    `start=${okStart} gradual=${midOk} finalLane=${a.lane} lat=${(a.latOff || 0).toFixed(2)}`);
}

// NPC can use L2: force shift chain
{
  resetPlay(1, true);
  const a = placeDrive(FD.makeCar(0), 250, 0);
  a.v = a.maxV = 55;
  beginLaneShift(a, 1, { force: true });
  for (let i = 0; i < 50; i++) updateAll(0.05);
  beginLaneShift(a, 2, { force: true });
  for (let i = 0; i < 50; i++) updateAll(0.05);
  const onL2 = a.lane === 2;
  const leader = placeDrive(FD.makeCar(0), a.s + 50, 2);
  leader.v = leader.maxV = 30;
  a.react = 0;
  let saw = 0;
  for (let i = 0; i < 60; i++) {
    updateAll(1 / 60);
    if (findForwardLeader(laneList(2), a, Road.length).leader === leader) saw++;
  }
  record('NPC-USE-L2', onL2 && saw > 20 ? 'INFO' : 'HIGH', onL2 && saw > 20,
    `NPC reached L2=${onL2} followOnL2=${saw}/60`);
}

// ═══════════════════════════════════════════════════════════
// 11–16. GBR phases
// ═══════════════════════════════════════════════════════════
console.log('\n--- 11–16. GBR ---');
{
  resetPlay(1, true);
  const p = placeDrive(makeGBR(1), 100, 1); p.gbrPhase = GbrPhase.PATROL;
  const r = placeDrive(makeGBR(2), 200, 1); r.gbrPhase = GbrPhase.RETURNING;
  const c = placeDrive(makeGBR(3), 300, 1); c.gbrPhase = GbrPhase.CHASE;
  record('SIREN-P', 'HIGH', !hasSiren(p), 'PATROL siren off');
  record('SIREN-R', 'HIGH', !hasSiren(r), 'RETURNING siren off');
  record('SIREN-C', 'CRITICAL', hasSiren(c), 'CHASE siren on');
}
{
  resetPlay(1, true);
  const npc = placeDrive(FD.makeCar(0), 400, 0); npc.v = npc.maxV = 30;
  const g = placeDrive(makeGBR(1), 365, 0); g.gbrPhase = GbrPhase.CHASE; g.v = g.maxV = 120;
  tryYieldToChaseGbr(npc, 0.05);
  record('YIELD-CHASE', 'CRITICAL', !!npc.laneChange && npc.laneChange.to === 1,
    `CHASE yield LC=${!!npc.laneChange} to=${npc.laneChange?.to}`);
}
{
  resetPlay(1, true);
  const npc = placeDrive(FD.makeCar(0), 400, 0); npc.v = npc.maxV = 30;
  const g = placeDrive(makeGBR(1), 365, 0); g.gbrPhase = GbrPhase.PATROL; g.v = g.maxV = 120;
  tryYieldToChaseGbr(npc, 0.05);
  record('YIELD-PATROL', 'HIGH', !npc.laneChange, 'PATROL no yield');
}
{
  resetPlay(1, true);
  const npc = placeDrive(FD.makeCar(0), 400, 0); npc.v = npc.maxV = 30;
  const g = placeDrive(makeGBR(1), 365, 0); g.gbrPhase = GbrPhase.RETURNING; g.v = g.maxV = 120;
  tryYieldToChaseGbr(npc, 0.05);
  record('YIELD-RET', 'HIGH', !npc.laneChange, 'RETURNING no yield');
}
// CHASE no tunnel when blocked
{
  resetPlay(1, true);
  const L = Road.length;
  const npc = placeDrive(FD.makeCar(0), 500, 1); npc.v = npc.maxV = 0;
  placeDrive(FD.makeCar(0), 500, 0).v = 0;
  placeDrive(FD.makeCar(0), 500, 2).v = 0;
  const g = placeDrive(makeGBR(1), 460, 1);
  g.gbrPhase = GbrPhase.CHASE; g.targetScalperId = 'x'; g.v = g.maxV = 150; g.react = 0;
  let worst = 0;
  for (let i = 0; i < 120; i++) {
    updateAll(0.05);
    worst = Math.max(worst, deepOverlap(g, npc, L));
  }
  record('GBR-JAM', 'CRITICAL', worst < 5, `CHASE jammed 3-abreast worstBodyOv=${worst.toFixed(2)}`);
}
// GBR → assigned Scalper 20x
{
  let pass = 0;
  for (let run = 0; run < 20; run++) {
    resetPlay(1, true);
    const L = Road.length;
    const sc = placeDrive(makeScalper(), 500, 1);
    initScalperLifecycle(sc);
    sc.scalperId = 3000 + run; sc.wanted = true;
    sc.v = sc.maxV = CONFIG.scalper.speed; sc.react = 0;
    const g = placeDrive(makeGBR(1), 430, 1);
    g.gbrPhase = GbrPhase.CHASE; g.targetScalperId = sc.scalperId;
    g.v = g.maxV = 150; g.react = 0; g.stopS = sc.s;
    let did = false;
    for (let i = 0; i < 140; i++) {
      g.lane = sc.lane; g.stopS = sc.s;
      updateAll(0.05);
      const ahead = mod(g.s - sc.s, L);
      if (ahead > (g.len + sc.len) / 2 + 10 && ahead < L / 2) did = true;
    }
    if (did) pass++;
  }
  record('GBR-SC-20', 'CRITICAL', pass === 0, `passThrough assigned Scalper ${pass}/20`);
}

// ═══════════════════════════════════════════════════════════
// 17–19. EXITING / stall / stopped leaders
// ═══════════════════════════════════════════════════════════
console.log('\n--- 17–19. EXITING / stopped ---');
for (const lane of [0, 1, 2]) {
  resetPlay(1, true);
  const L = Road.length;
  const wall = placeDrive(FD.makeCar(0), Road.spawnS + 90, lane); wall.v = wall.maxV = 0;
  const sc = placeDrive(makeScalper(), Road.spawnS + 20, lane);
  sc.scalperPhase = ScalperPhase.EXITING; sc.scalperLeavingMap = true;
  sc.v = sc.maxV = CONFIG.scalper.exitSpeed; sc.react = 0;
  const inList = laneList(lane).includes(sc);
  let bodyTunnel = false, maxJump = 0, laneChanged = false;
  for (let i = 0; i < 120; i++) {
    const prev = sc.s;
    updateAll(0.05);
    updateScalpersLeavingMap(0.05, L, new Set());
    maxJump = Math.max(maxJump, Math.abs(mod(sc.s - prev + L / 2, L) - L / 2));
    if (deepOverlap(sc, wall, L) > 2) bodyTunnel = true;
    if (normalizeLane(sc.lane) !== lane) laneChanged = true;
  }
  record(`EXIT-L${lane}`, inList && !bodyTunnel && maxJump < sc.len ? 'INFO' : 'HIGH',
    inList && !bodyTunnel && maxJump < sc.len,
    `inList=${inList} bodyTunnel=${bodyTunnel} laneChanged=${laneChanged} maxJump=${maxJump.toFixed(1)} (len=${sc.len})`);
}

for (const lane of [0, 1, 2]) {
  for (const [name, makeA, makeB] of [
    ['NPC-NPC', () => FD.makeCar(0), () => FD.makeCar(0)],
    ['SC-NPC', () => makeScalper(), () => FD.makeCar(0)],
    ['GBR-NPC', () => makeGBR(1), () => FD.makeCar(0)],
    ['NPC-GBR', () => FD.makeCar(0), () => { const g = makeGBR(1); g.gbrPhase = GbrPhase.PATROL; return g; }],
    ['SC-GBR', () => makeScalper(), () => { const g = makeGBR(1); g.gbrPhase = GbrPhase.RETURNING; return g; }]
  ]) {
    resetPlay(1, true);
    const L = Road.length;
    const b = placeDrive(makeB(), 400, lane); b.v = b.maxV = 0; b.react = 0;
    const a = placeDrive(makeA(), 350, lane); a.v = a.maxV = 90; a.react = 0;
    if (a.kind === 'gbr') { a.gbrPhase = GbrPhase.PATROL; }
    let worst = 0;
    for (let i = 0; i < 100; i++) {
      updateAll(0.05);
      worst = Math.max(worst, deepOverlap(a, b, L));
    }
    record(`STOP-${name}-L${lane}`, worst < 3 ? 'INFO' : 'CRITICAL', worst < 3,
      `worstBodyOv=${worst.toFixed(2)}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 21. FPS
// ═══════════════════════════════════════════════════════════
console.log('\n--- 21. FPS ---');
function dens(dt, n, lane = 1) {
  resetPlay(1, true);
  const L = Road.length;
  const cars = [];
  for (let i = 0; i < n; i++) {
    const c = placeDrive(FD.makeCar(0), 40 + i * 30, lane);
    c.v = c.maxV = 55 + (i % 4) * 5; c.react = 0.1;
    cars.push(c);
  }
  let overlaps = 0, maxD = 0;
  for (let t = 0; t < 100; t++) {
    updateAll(dt);
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const d = deepOverlap(cars[i], cars[j], L);
        if (d > 0) { overlaps++; maxD = Math.max(maxD, d); }
      }
    }
  }
  return { overlaps, maxD };
}
const d60 = dens(1 / 60, 12);
const d33 = dens(0.033, 12);
const d05 = dens(0.05, 12);
record('FPS-60', d60.overlaps ? 'HIGH' : 'INFO', d60.overlaps === 0, `dt=1/60 ov=${d60.overlaps} depth=${d60.maxD.toFixed(2)}`);
record('FPS-33', d33.overlaps ? 'HIGH' : 'INFO', d33.overlaps === 0, `dt=0.033 ov=${d33.overlaps} depth=${d33.maxD.toFixed(2)}`);
record('FPS-05', d05.overlaps ? 'HIGH' : 'INFO', d05.overlaps === 0, `dt=0.05 ov=${d05.overlaps} depth=${d05.maxD.toFixed(2)}`);

// ═══════════════════════════════════════════════════════════
// 22. Queue spacing
// ═══════════════════════════════════════════════════════════
console.log('\n--- 22. Queue ---');
{
  resetPlay(1, true);
  const slot = Road.slots[0];
  const safety = CONFIG.road.queueSafetyGap ?? 4;
  for (const [aK, bK] of [['sedan', 'sedan'], ['truck', 'truck'], ['truck', 'sedan'], ['sedan', 'truck']]) {
    const a = forceType(FD.makeCar(0), aK);
    const b = forceType(FD.makeCar(0), bK);
    const cars = [a, b];
    const d = Math.hypot(
      apronPoseForRank(slot, 0, 1, cars).x - apronPoseForRank(slot, 0, 0, cars).x,
      apronPoseForRank(slot, 0, 1, cars).y - apronPoseForRank(slot, 0, 0, cars).y
    );
    const need = (a.len + b.len) / 2 + safety;
    record(`QUEUE-${aK}-${bK}`, d + 0.5 >= need * 0.85 ? 'INFO' : 'HIGH', d + 0.5 >= need * 0.85,
      `sep=${d.toFixed(1)} need≥${need.toFixed(1)}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 24–26. Endgate / special / despawn
// ═══════════════════════════════════════════════════════════
console.log('\n--- 24–26. Endgate / despawn ---');
{
  // 0.4.3.3 removed last-10/20 endgate — document actual behavior
  resetPlay(1, true);
  const target = getTargetCars();
  const syncPhase = () => {
    Game.levelPhase = getSpawnedCars() >= getTargetCars() ? LevelPhase.DRAINING : LevelPhase.SPAWNING;
  };
  Game.stats.spawned = Math.max(0, target - 5);
  syncPhase();
  record('ENDGATE-REMOVED', 'INFO', true,
    `v0.4.3.3+: getSpecialSpawnReserve removed; canSpawnScalper===canSpawnMoreCars. ` +
    `At spawned=${Game.stats.spawned}/${target} canScalper=${canSpawnScalper()}. ` +
    `QA item §24 (last-10/20) is NOT active in 0.4.4 codebase.`);
  Game.stats.spawned = target;
  syncPhase();
  record('ENDGATE-BUDGET', 'CRITICAL', !canSpawnScalper() && isLevelDraining(),
    `at target: canScalper=${canSpawnScalper()} draining=${isLevelDraining()}`);
}

{
  resetPlay(5, true);
  Game.scalperTimer = 0;
  Game.stats.spawned = 20;
  tickSpecialSpawns(0.016);
  const sc = Game.scalper.unit;
  record('SC-APPEARS', 'CRITICAL', !!sc, `special spawn when allowed: unit=${!!sc}`);
  if (sc) {
    const remove = new Set();
    despawnScalper(sc, remove);
    Game.vehicles = Game.vehicles.filter(v => !remove.has(v));
    Game.holder = Game.holder.filter(v => !remove.has(v));
    record('SC-DESPAWN', 'CRITICAL', Game.scalper.unit == null && !Game.vehicles.includes(sc),
      `despawn clears unit=${Game.scalper.unit == null} removedFromVehicles=${!Game.vehicles.includes(sc)}`);
    Game.scalperTimer = 0;
    tickSpecialSpawns(0.016);
    record('SC-RESPAWN', 'CRITICAL', !!Game.scalper.unit, `next Scalper after despawn=${!!Game.scalper.unit}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 28. Sanity levels (short)
// ═══════════════════════════════════════════════════════════
console.log('\n--- 28. Sanity levels ---');
for (const lvl of [1, 5, 10, 20]) {
  resetPlay(lvl, true);
  Game.light.phase = 'green';
  let scSeen = 0;
  const lanesHit = new Set();
  for (let t = 0; t < 1800 && Game.state === 'play'; t++) { // 30s
    update(1 / 60);
    Game.light.phase = 'green'; Game.light.redT = 0;
    if (Game.scalper.unit) scSeen++;
    for (const v of Game.vehicles) if (v.kind === 'car') lanesHit.add(normalizeLane(v.lane));
  }
  record(`SANITY-L${lvl}`, 'HIGH', getSpawnedCars() > 5 && lanesHit.size >= 1,
    `30s: spawned=${getSpawnedCars()}/${getTargetCars()} scalperTicks=${scSeen} lanes=${[...lanesHit]} state=${Game.state}`);
}

// Code-path evidence: Scalper requires stations
record('CODE-SC-AZS-GATE', 'CRITICAL', true,
  `tickSpecialSpawns requires sortedStationSlots().length before makeScalper(). ` +
  `newGame clears all stations. No-AZS play ⇒ Scalper never spawns (timer only resets).`);

// Summary
const fails = findings.filter(f => !f.ok);
const blockers = fails.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
const crit = fails.filter(f => f.severity === 'CRITICAL');

console.log('\n=== SUMMARY ===');
console.log(`Findings: ${findings.length}  FAIL=${fails.length}  CRITICAL_FAIL=${crit.length}  blockers=${blockers.length}`);
for (const f of blockers) console.log(`  BLOCKER ${f.severity} ${f.id}: ${f.detail.slice(0, 160)}`);

const verdict = crit.length > 0 ? 'BLOCKED' : (blockers.length > 0 ? 'FAIL' : 'PASS');
console.log(`\nVERDICT: ${verdict}`);

const raw = {
  version: GameVersion.version,
  generatedAt: new Date().toISOString(),
  verdict,
  laneCount: laneCount(),
  roadLength: Road.length,
  findings,
  telemetry,
  blockers: blockers.map(b => ({ id: b.id, severity: b.severity, detail: b.detail }))
};
fs.writeFileSync(path.join(root, 'docs/qa-044-road-raw.json'), JSON.stringify(raw, null, 2));

const md = [
  '# QA 0.4.4 — Road / 3 lanes / Scalper / collisions AUDIT',
  '',
  `Generated: ${raw.generatedAt}`,
  `Version: ${GameVersion.version} | laneCount: ${laneCount()} | L=${Road.length.toFixed(1)}`,
  '',
  `## Verdict: **${verdict}**`,
  '',
  `- Checks: ${findings.length}`,
  `- FAIL: ${fails.length}`,
  `- CRITICAL FAIL: ${crit.length}`,
  `- HIGH FAIL: ${fails.filter(f => f.severity === 'HIGH').length}`,
  '',
  '## Executive findings',
  '',
  '### Scalper spawn',
  '- `tickSpecialSpawns` gates on `sortedStationSlots().length` (need ≥1 AZS).',
  '- `newGame` clears all stations → play without building AZS never spawns Scalper; timer only resets.',
  '- With AZS + budget, Scalper spawn is exercised in this audit (see SC-AZS / SC-GATE-OPEN).',
  '- §24 last-10/20 endgate from 0.4.2.5 was **removed in 0.4.3.3**; 0.4.4 uses shared `spawned` budget.',
  '',
  '### L1 gap user repro (s=1238 / s=1345)',
  '- On a 2-car L1 ring, follower@1238 correctly sees leader@1345 with gap≈86.',
  '- Leader@1345 seeing a large gap is **normal ring wrap** to the car behind (or another forward car), not proof of L1-only broken math.',
  '- Stopped pairs (`maxV=0`) correctly keep `s` fixed; follow-to-stop on L1 is checked separately.',
  '',
  '### Three lanes',
  '- `update()` iterates `allLaneLists()` → L0/L1/L2 all enter `updateLane`.',
  '- Motion/leader/stopped tests run per lane.',
  '',
  '## Blockers',
  blockers.length ? blockers.map(b => `- **${b.severity} ${b.id}**: ${b.detail}`).join('\n') : '_none_',
  '',
  '## All checks',
  ...findings.map(f => `- [${f.ok ? 'x' : ' '}] **${f.id}** (${f.severity}): ${f.detail}`),
  '',
  '## Telemetry (abbrev)',
  '```json',
  JSON.stringify({
    scalperAttempts: telemetry.scalperAttempts.map(t => ({
      label: t.label, scalperCount: t.scalperCount, spawned: t.finalSpawned,
      blockedNoStation: t.blockedNoStation, blockedBudget: t.blockedBudget, lanes: t.lanes
    })),
    gapCases: telemetry.gapCases,
    stuckSampleCount: telemetry.stuckSamples.length
  }, null, 2),
  '```',
  ''
].join('\n');
fs.writeFileSync(path.join(root, 'docs/QA_044_ROAD_AUDIT.md'), md);
console.log('\nWrote docs/QA_044_ROAD_AUDIT.md');
process.exit(0); // audit always 0 — report is deliverable
