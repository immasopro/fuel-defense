function newGame(mode, levelIdx) {
  Game.mode = mode;
  Game.levelIdx = levelIdx || 1;
  Game.modeCfg = mode === 'endless' ? CONFIG.endless : CONFIG.levels[Game.levelIdx - 1];
  Game.state = 'play';
  Game.money = Game.modeCfg.startMoney;
  Game.time = 0;
  Game.depot = { level: 1, res: CONFIG.depot.levels[0], cap: CONFIG.depot.levels[0] };
  Game.vehicles = [];
  Game.holder = [];
  Game.holderPriorityWait = null;
  Game.prepared = null;
  Game.floats = [];
  Game.spawnTimer = 0.8;
  Game.defeatT = 0;
  Game.light = { phase: 'green', redT: 0, cd: 0 };
  Game.scalperTimer = Game.modeCfg.scalper.firstAt;
  Game.tanker = { cd: 0, unit: null };
  Game.gbr = { cd: 0, unit: null };
  Game.scalper = { unit: null };
  Game.stats = { served: 0, earned: 0, liters: 0 };
  Game.tankLabels = {};
  Game.depotLabel = 0;
  for (const slot of Road.slots) slot.station = null;
  closePanel();
  UI.warning.classList.add('hidden');
}

// сложность 0..1 (в бесконечном режиме — доля разгона, поток растёт и дальше)
function currentDiff() {
  const cfg = Game.modeCfg;
  if (Game.mode === 'endless') return clamp01(Game.time / cfg.rampTime);
  return clamp01(Game.time / cfg.duration);
}
function currentSpawnInterval() {
  const cfg = Game.modeCfg;
  if (Game.mode === 'endless') {
    const k = Game.time / cfg.rampTime;   // без ограничения: поток растёт вечно
    return Math.max(cfg.minInterval, lerp(cfg.spawn[0], cfg.spawn[1], k));
  }
  return lerp(cfg.spawn[0], cfg.spawn[1], currentDiff());
}

function addFloat(x, y, txt, color) {
  Game.floats.push({ x, y, txt, color, t: 0, life: 1.3 });
}

function innerLaneList() {
  return Game.vehicles.filter(v =>
    v.lane === 'inner' && (v.state === 'drive' || v.state === 'action' || v.state === 'tow'));
}
function outerLaneList() {
  return Game.vehicles.filter(v => v.lane === 'outer' && v.state === 'drive');
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

let holderBusy = false;
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

function tickSpawnPipeline(dt, diff) {
  if (Game.prepared && !Game.prepared.ready) {
    Game.prepared.t -= dt;
    if (Game.prepared.t <= 0) {
      Game.prepared.ready = true;
      Game.prepared.vehicle = Game.prepared.factory();
      if (Game.holder.length < CONFIG.holder.max && !Game.holderPriorityWait) fillHolderSlot();
      onHolderChanged();
    }
  }
  Game.spawnTimer -= dt;
  if (Game.spawnTimer > 0) return;
  const iv = currentSpawnInterval() * rand(.75, 1.25);
  if (Game.holder.length < CONFIG.holder.max) {
    if (Game.holderPriorityWait) {
      Game.holder.unshift(Game.holderPriorityWait);
      Game.holderPriorityWait = null;
    } else {
      Game.holder.push(makeCar(diff));
    }
    Game.spawnTimer = iv;
    onHolderChanged();
    return;
  }
  if (!Game.prepared) {
    Game.prepared = { t: iv, ready: false, factory: () => makeCar(diff) };
  }
}

function updateDefeatTimer(dt) {
  if (!isLightGreen()) { Game.defeatT = 0; return; }
  if (Game.holder.length < CONFIG.holder.max) { Game.defeatT = 0; return; }
  const first = Game.holder[0];
  if (!first || first.countsForDefeat === false) { Game.defeatT = 0; return; }
  if (spawnClear(innerLaneList(), first.len)) { Game.defeatT = 0; return; }
  Game.defeatT += dt;
  if (Game.defeatT >= CONFIG.defeatTime) { endGame(false); return true; }
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

function cleanupVehicle(v) {
  if (v.pump) {
    const i = v.pump.cars.indexOf(v);
    if (i >= 0) v.pump.cars.splice(i, 1);
  }
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st) continue;
    const pi = st.pocket.indexOf(v);
    if (pi >= 0) { st.pocket.splice(pi, 1); repositionPocket(st); }
  }
  v.pump = null; v.pocketSlot = null; v.station = null;
  v.targetSlot = null; v.stopS = null;
}

function repositionPocket(st) {
  for (let i = 0; i < st.pocket.length; i++) {
    const car = st.pocket[i];
    if (car.state === 'pocket' && car.pose && car.animT >= car.animDur)
      car.pose = pocketPoseForRank(st.slot, i);
  }
}

function releasePocket(v) {
  const wasPocketAnim = v.state === 'pocket';
  if (!v.pocketSlot) {
    if (wasPocketAnim) {
      v.state = 'drive';
      v.pose = null;
      v.animT = 0;
      v.v = Math.max(v.v || 0, v.maxV * 0.35);
    }
    return;
  }
  const st = v.pocketSlot.station;
  const i = st.pocket.indexOf(v);
  if (i >= 0) st.pocket.splice(i, 1);
  v.pocketSlot = null;
  v.targetSlot = null;
  v.stopS = null;
  v.pocketWaitT = 0;
  if (wasPocketAnim) {
    v.state = 'drive';
    v.pose = null;
    v.animT = 0;
    v.v = Math.max(v.v || 0, v.maxV * 0.35);
  }
  repositionPocket(st);
}

function promotePocket(st) {
  const slot = st.slot;
  for (let pi = 0; pi < st.pocket.length; pi++) {
    const v = st.pocket[pi];
    if (v.state !== 'pocket' || !v.pose || v.animT < v.animDur) continue;
    let bestJ = -1, bestQ = Infinity;
    for (let j = 0; j < st.pumps.length; j++) {
      const pump = st.pumps[j];
      if (pump.fuel !== v.fuelKey || pump.blocked) continue;
      if (pump.cars.length >= CONFIG.pump.queueMax) continue;
      if (st.res + pump.buffer < CONFIG.station.minReserve) continue;
      const q = pump.cars.length;
      if (q < bestQ) { bestQ = q; bestJ = j; }
    }
    if (bestJ < 0) continue;
    st.pocket.splice(pi, 1);
    const pump = st.pumps[bestJ];
    pump.cars.push(v);
    v.pump = pump; v.pumpJ = bestJ; v.station = st;
    v.pocketSlot = null; v.pocketWaitT = 0;
    v.state = 'pullIn'; v.animT = 0; v.animDur = CONFIG.visual.pullInDur;
    v.animFrom = { ...v.pose };
    v.animTo = apronPoseForRank(slot, bestJ, pump.cars.length - 1);
    v.v = 0; v.stopS = null;
    repositionPocket(st);
    return;
  }
}

function processStationPocket(st, dt) {
  st.pocket = st.pocket.filter(c => Game.vehicles.includes(c) && !c.served);
  for (const v of st.pocket) {
    if (v.state === 'pocket') {
      v.pocketWaitT = (v.pocketWaitT || 0) + dt;
      if (v.pocketWaitT > CONFIG.station.pocketMaxWait) {
        releasePocket(v);
        v.angry = true; v.scanT = 0.2;
      }
    }
  }
  promotePocket(st);
}

function entryToRingBlocked() {
  if (!isLightGreen()) return true;
  return !spawnClear(innerLaneList(), 20);
}

/* ---- выбор АЗС: сначала карман ожидания, затем колонка при освобождении ---- */
function scanForStation(v) {
  if (v.served || v.kind !== 'car') return;
  if (v.pocketSlot || v.pump) return;
  const L = Road.length;
  let bestSlot = null, bestPocket = Infinity, bestD = Infinity;
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st || st.pocket.length >= CONFIG.station.pocketMax) continue;
    const d = mod(slot.s - v.s, L);
    if (d < 50) continue;
    let hasFuel = false;
    for (const pump of st.pumps) {
      if (pump.fuel !== v.fuelKey || pump.blocked) continue;
      if (st.res + pump.buffer < CONFIG.station.minReserve) continue;
      hasFuel = true;
      break;
    }
    if (!hasFuel) continue;
    const q = st.pocket.length;
    if (q < bestPocket || (q === bestPocket && d < bestD)) {
      bestPocket = q; bestD = d; bestSlot = slot;
    }
  }
  if (bestSlot) assignToPocket(v, bestSlot);
}

function assignToPocket(v, slot) {
  if (v.pocketSlot) return;
  slot.station.pocket.push(v);
  v.pocketSlot = slot;
  v.targetSlot = slot;
  v.stopS = pocketEntryS(slot);
  v.approachWait = 0;
}

function releaseReservation(v) {
  if (v.pump) {
    const i = v.pump.cars.indexOf(v);
    if (i >= 0) v.pump.cars.splice(i, 1);
  }
  if (v.pocketSlot) releasePocket(v);
  v.pump = null; v.station = null; v.targetSlot = null; v.stopS = null;
}

function poseForRank(v) {
  const rank = Math.max(0, v.pump.cars.indexOf(v));
  return apronPoseForRank(v.targetSlot, v.pumpJ, rank);
}

// Пробуждение очереди после освобождения колонки (FIFO)
function wakePumpQueue(pump) {
  if (!pump || !pump.cars.length) return;
  for (const car of pump.cars) {
    if (car.state === 'drive') {
      car.approachWait = 0;
      car.stopS = approachStopS(car.targetSlot);
    }
  }
}

function tryApproachPullIn(v, L) {
  if (!v.pump || !v.targetSlot || v.overtake) return;
  const stopS = approachStopS(v.targetSlot);
  v.stopS = stopS;
  const d = distAhead(v.s, stopS, L);
  if (d < CONFIG.road.pullInDist) { beginPullIn(v); return; }
  if (d > L - CONFIG.road.passReleaseDist) { releaseReservation(v); return; }
  if (v.v < 1.5) {
    v.approachWait = (v.approachWait || 0) + (1 / 60);
    if (v.approachWait > CONFIG.road.forcePullInTime && d < CONFIG.road.forcePullInDist)
      beginPullIn(v);
  } else {
    v.approachWait = 0;
  }
}

function tryApproachPocket(v, L, dt) {
  if (!v.pocketSlot || v.overtake || v.served) return;
  const entryS = pocketEntryS(v.pocketSlot);
  const d = distAhead(v.s, entryS, L);
  if (d < CONFIG.road.pullInDist) { beginPocketPullIn(v); return; }
  if (d > L - CONFIG.road.passReleaseDist) { releasePocket(v); return; }
  v.stopS = entryS;
}

function beginPocketPullIn(v) {
  const slot = v.pocketSlot;
  const rank = slot.station.pocket.indexOf(v);
  v.state = 'pocket';
  v.animT = 0;
  v.animDur = CONFIG.visual.pocketDur;
  const lat = Road.laneW / 2 + (v.latOff || 0);
  v.animFrom = Road.posAt(v.s, lat);
  v.animTo = pocketPoseForRank(slot, rank);
  v.v = 0; v.stopS = null; v.approachWait = 0;
}

function beginPullIn(v) {
  v.state = 'pullIn';
  v.animT = 0;
  v.animDur = CONFIG.visual.pullInDur + v.pumpJ * 0.06;
  const lat = Road.laneW / 2 + (v.latOff || 0);
  v.animFrom = Road.posAt(v.s, lat);
  v.animTo = poseForRank(v);
  v.v = 0; v.stopS = null; v.approachWait = 0;
}

function beginTankerPullIn(v, slot, pumpJ) {
  v.state = 'pullIn';
  v.animT = 0; v.animDur = 0.75;
  v.animFrom = Road.posAt(v.s, Road.laneW / 2);
  v.animTo = pumpPose(slot, pumpJ);
  v.pumpJ = pumpJ;
  v.unloadSlot = slot;
  v.targetSlot = slot;
  v.v = 0; v.stopS = null;
}

function beginPullOut(v, mergeS) {
  v.state = 'pullOut';
  v.animT = 0;
  v.animDur = CONFIG.visual.pullOutDur + v.pumpJ * 0.06;
  v.animFrom = { ...v.pose };
  v.animTo = Road.posAt(mergeS, -Road.laneW / 2);
  v.exitS = mergeS;
}

function beginLaneChange(v) {
  const exitS = mod(v.s + 14, Road.length);
  v.state = 'pullOut';
  v.animT = 0; v.animDur = CONFIG.visual.pullOutDur;
  v.animFrom = Road.posAt(v.s, Road.laneW / 2);
  v.animTo = Road.posAt(exitS, -Road.laneW / 2);
  v.exitS = exitS;
}

function finishFuel(v) {
  const F = CONFIG.fuels[v.fuelKey];
  let pay = v.got * F.price;
  if (v.typeKey === 'truck') pay *= CONFIG.truckPayMult;
  pay = Math.round(pay);
  if (pay > 0) {
    Game.money += pay;
    Game.stats.served++;
    Game.stats.earned += pay;
    addFloat(v.pose.x, v.pose.y - 14, '+$' + pay, '#8bc34a');
  }
  Game.stats.liters += v.got;
  if (v.station) v.station.served++;
  // канистра: только из резерва канистр (не задерживает уезд)
  if (v.canister && v.canisterLiters > 0 && v.station && v.station.canisterUp &&
      v.station.canRes > 0.5 && v.station.canCd <= 0) {
    const amt = Math.min(v.canisterLiters, v.station.canRes);
    v.station.canRes -= amt;
    v.canisterGot = amt;
    const cPay = Math.round(amt * CONFIG.canisterReserve.pricePerLiter);
    Game.money += cPay;
    Game.stats.earned += cPay;
    Game.stats.liters += amt;
    addFloat(v.pose.x, v.pose.y - 28, '+$' + cPay + ' 🧴', v.canisterColor === 'green' ? '#8bc34a' : '#ef5350');
    if (v.station.canRes <= 0.01) {
      v.station.canRes = 0;
      v.station.canCd = CONFIG.canisterReserve.cooldown;
    }
  }
  const pump = v.pump;
  const i = pump.cars.indexOf(v);
  if (i >= 0) pump.cars.splice(i, 1);
  wakePumpQueue(pump);
  if (v.station) promotePocket(v.station);
  v.served = true;
  v.pump = null;
  v.pocketSlot = null;
  v.station = null;
  v.stopS = null;
  v.state = 'waitMerge';
  v.mergeT = 0;
}

function finishScalperFuel(v, amt) {
  v.totalGot += amt;
  v.canisters++;
  const pay = Math.round(amt * CONFIG.scalper.payPerLiter);
  Game.money += pay;
  Game.stats.earned += pay;
  Game.stats.liters += amt;
  addFloat(v.pose.x, v.pose.y - 14, '+$' + pay, '#ce93d8');
}

function removeScalper(sc, removeSet, early) {
  const pump = sc.pump;
  cleanupVehicle(sc);
  if (pump) pump.blocked = false;
  if (early && sc.totalGot > 0) {
    const claw = Math.round(sc.totalGot * CONFIG.scalper.payPerLiter);
    Game.money -= claw;
    Game.stats.earned -= claw;
    Game.stats.liters -= sc.totalGot;
    addFloat(sc.pose ? sc.pose.x : 0, sc.pose ? sc.pose.y - 20 : 0, '−$' + claw, '#ef5350');
  }
  removeSet.add(sc);
  if (Game.scalper.unit === sc) Game.scalper.unit = null;
}

function updateTanker(v, dt, L, removeSet) {
  if (v.phase === 'tour') {
    if (v.tourIdx >= v.tour.length) { v.phase = 'to_depot'; v.stopS = null; return; }
    const slot = v.tour[v.tourIdx];
    const st = slot.station;
    v.stopS = approachStopS(slot);
    const d = distAhead(v.s, v.stopS, L);
    if (d < CONFIG.road.pullInDist && v.v < 14) {
      const pj = findTankerPump(st);
      if (pj < 0) return;   // ждём освобождения форсунки
      beginTankerPullIn(v, slot, pj);
    }
  } else if (v.phase === 'to_depot') {
    v.stopS = Depot.accessS;
    const d = distAhead(v.s, v.stopS, L);
    const p = Road.posAt(v.s, 0);
    const dp = Math.hypot(Depot.pos.x - p.x, Depot.pos.y - p.y);
    if (dp < 55 || (d < 10 && v.v < 12)) {
      v.phase = 'dump_depot';
      v.state = 'unload';
      v.v = 0;
    }
  }
}

function updateTankerUnload(v, dt, removeSet) {
  const C = CONFIG.tanker;
  // разгрузка на нефтебазе (на дороге у базы)
  if (v.phase === 'dump_depot') {
    const amt = Math.min(C.depotRate * dt, v.load, Game.depot.cap - Game.depot.res);
    if (amt > 0) { Game.depot.res += amt; v.load -= amt; }
    if (v.load <= 0.01 || Game.depot.res >= Game.depot.cap - 0.5) {
      removeSet.add(v);
      Game.tanker.unit = null;
      Game.tanker.cd = CONFIG.tanker.cooldown;
    }
  }
}

function updateTankerAtPump(v, dt, L) {
  const C = CONFIG.tanker;
  const slot = v.unloadSlot;
  if (!slot) return;
  const st = slot.station;
  const amt = Math.min(C.stationRate * dt, v.load, st.cap - st.res);
  if (amt > 0) {
    st.res += amt;
    v.load -= amt;
    addFloat(slot.pos.x, slot.pos.y - 20, '+' + Math.round(amt) + 'л', '#fdd835');
  }
  const done = v.load <= 0.01 || st.res >= st.cap - 0.5;
  if (!done) return;
  if (v.load <= 0.01) { v.phase = 'to_depot'; v.tourIdx = v.tour.length; }
  else v.tourIdx++;
  v.state = 'pullOut';
  v.animT = 0; v.animDur = 0.65;
  v.animFrom = { ...v.pose };
  const exitS = mod(slot.s + 16, L);
  v.animTo = Road.posAt(exitS, -Road.laneW / 2);
  v.exitS = exitS;
  v.unloadSlot = null;
}

function updateScalperTour(v, dt, L, removeSet) {
  const C = CONFIG.scalper;
  if (v.tourIdx >= v.tour.length) {
    v.state = 'pullOut';
    v.animT = 0; v.animDur = 0.5;
    v.animFrom = v.pose || Road.posAt(v.s, Road.laneW / 2);
    const exitS = mod(v.s + 20, L);
    v.animTo = Road.posAt(exitS, -Road.laneW / 2);
    v.exitS = exitS;
    return;
  }
  const slot = v.tour[v.tourIdx];
  const st = slot.station;
  if (!v.targetSlot) {
    v.targetSlot = slot;
    v.station = st;
    let pj = -1;
    if (st.canisterUp && st.canRes > 0.01 && st.canCd <= 0 &&
        v.totalGot < C.maxLiters && v.canisters < C.maxCanisters) {
      pj = findFreePump(st);
    }
    if (pj < 0) pj = findFreePump(st);   // всё равно едем — если пусто, встанем и заблокируем
    if (pj < 0) {
      for (let j = 0; j < st.pumps.length; j++) {
        if (!st.pumps[j].blocked) { pj = j; break; }
      }
    }
    if (pj < 0) pj = 0;
    v.pump = st.pumps[pj];
    v.pumpJ = pj;
    if (v.pump.cars.length < CONFIG.pump.queueMax) v.pump.cars.push(v);
    else v.waitReserve = true;
  }
  if (v.state === 'drive') {
    const rank = Math.max(0, v.pump.cars.indexOf(v));
    v.stopS = approachStopS(slot);
    const d = distAhead(v.s, v.stopS, L);
    if (d < CONFIG.road.pullInDist && v.v < 12) beginPullIn(v);
  }
}

function updateGBR(g, dt, L, removeSet) {
  const C = CONFIG.gbr;
  const sc = Game.scalper.unit;
  if (!sc) {
    removeSet.add(g);
    Game.gbr.unit = null;
    Game.gbr.cd = CONFIG.gbr.cooldown;
    return;
  }
  if (g.state === 'tow') {
    g.towT -= dt;
    g.towProgress = 1 - g.towT / g.towTotal;
    g.v = C.towSpeed;
    if (sc.state === 'station' || sc.state === 'block') {
      g.pose = sc.pose ? { ...sc.pose, x: sc.pose.x - 8 } : g.pose;
      sc.pose = sc.pose || pumpPose(sc.targetSlot, sc.pumpJ);
    } else {
      g.s = sc.s; g.prevS = sc.s;
      sc.s = mod(sc.s - 6, L);
    }
    if (g.towT <= 0) {
      removeScalper(sc, removeSet, true);
      g.state = 'drive';
      g.target = null;
      removeSet.add(g);
      Game.gbr.unit = null;
      Game.gbr.cd = CONFIG.gbr.cooldown;
      addFloat(g.s ? Road.posAt(g.s, 0).x : 0, g.s ? Road.posAt(g.s, 0).y - 20 : 0, 'Увезён!', '#42a5f5');
    }
    return;
  }
  // преследование
  let targetS = sc.s, targetPose = null;
  if (sc.state === 'station' || sc.state === 'block' || sc.state === 'pullIn') {
    targetPose = sc.pose || (sc.targetSlot ? pumpPose(sc.targetSlot, sc.pumpJ) : null);
    if (targetPose) { g.stopS = null; g.maxV = C.speed; }
  }
  if (sc.state === 'drive') {
    g.stopS = null;
    const d = mod(sc.s - g.s, L);
    if (d < L / 2 && d < 12 && Math.abs(g.v - sc.v) < 15) {
      g.state = 'tow';
      g.towT = g.towTotal;
      g.towProgress = 0;
      g.target = sc;
      g.v = C.towSpeed;
      return;
    }
    if (d < L / 2) g.stopS = mod(sc.s - 8, L);
  } else if (targetPose) {
    const gp = Road.posAt(g.s, Road.laneW / 2);
    const dist = Math.hypot(targetPose.x - gp.x, targetPose.y - gp.y);
    if (dist < 14) {
      g.state = 'tow';
      g.towT = g.towTotal;
      g.towProgress = 0;
      g.target = sc;
      g.pose = { x: targetPose.x - 10, y: targetPose.y, a: targetPose.a };
      g.v = 0;
    } else {
      g.stopS = mod(sc.targetSlot ? sc.targetSlot.s - 6 : sc.s, L);
    }
  }
}

function callTanker() {
  if (Game.state !== 'play' || Game.tanker.unit || Game.tanker.cd > 0) return;
  if (Game.money < CONFIG.tanker.cost) return;
  if (!sortedStationSlots().length) return;
  Game.money -= CONFIG.tanker.cost;
  const t = makeTanker();
  addToHolder(t, { priority: true, countsForDefeat: false });
  Game.tanker.unit = t;
  addFloat(Road.posAt(Road.spawnS, 0).x, Road.posAt(Road.spawnS, 0).y - 18, 'Бензовоз в очереди', '#fdd835');
}

function callGBR() {
  if (Game.state !== 'play' || Game.gbr.unit || Game.gbr.cd > 0) return;
  if (!Game.scalper.unit) return;
  if (Game.money < CONFIG.gbr.cost) return;
  Game.money -= CONFIG.gbr.cost;
  const g = makeGBR();
  g.s = GBRBase.spawnS;
  g.prevS = g.s;
  g.v = CONFIG.gbr.speed * 0.45;
  Game.vehicles.push(g);
  Game.gbr.unit = g;
  addFloat(GBRBase.pos.x, GBRBase.pos.y - 20, '🚨 ГБР!', '#42a5f5');
}

function endGame(win) {
  Game.state = win ? 'win' : 'over';
  closePanel();
  UI.warning.classList.add('hidden');
  const endless = Game.mode === 'endless';
  UI.endTitle.textContent = win ? '🏆 ПОБЕДА!' : '💥 ИГРА ОКОНЧЕНА';
  UI.endTitle.style.color = win ? '#8bc34a' : '#ef5350';
  UI.endDesc.textContent = win
    ? 'Уровень ' + Game.levelIdx + ' пройден — заправка выдержала поток!'
    : (endless
      ? 'Накопитель переполнен — пробка не рассеялась за ' + CONFIG.defeatTime + 'с. Вы продержались ' + fmtTime(Game.time) + '.'
      : 'Накопитель переполнен, и въезд остался заблокирован ' + CONFIG.defeatTime + ' секунд.');
  UI.endStats.innerHTML =
    '⏱ Время: <b>' + fmtTime(Game.time) + '</b><br>' +
    '⛽ Обслужено машин: <b>' + Game.stats.served + '</b><br>' +
    '🛢 Отпущено топлива: <b>' + Math.round(Game.stats.liters) + ' л</b><br>' +
    '💰 Заработано: <b>$' + Game.stats.earned + '</b>';
  // прогресс кампании
  if (win && Game.mode === 'campaign' && Game.levelIdx < CONFIG.levels.length) {
    setUnlocked(Math.max(getUnlocked(), Game.levelIdx + 1));
    UI.btnNext.classList.remove('hidden');
  } else {
    UI.btnNext.classList.add('hidden');
  }
  UI.screenEnd.classList.remove('hidden');
}

/* ---------------- главный апдейт ---------------- */
function update(dt) {
  if (Game.state !== 'play') { updateHUD(); return; }
  Game.time += dt;
  const cfg = Game.modeCfg;
  if (Game.mode === 'campaign' && Game.time >= cfg.duration) { endGame(true); return; }
  const diff = currentDiff();
  const L = Road.length;

  // --- движение по полосам ---
  const inner = innerLaneList();
  const outer = outerLaneList();
  updateLane(inner, dt);
  updateLane(outer, dt);

  // --- светофор ---
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

  tickSpawnPipeline(dt, diff);
  releaseHolderBurst();

  if (CONFIG.bgTrafficEnabled) {
    Game.bgSpawnTimer = (Game.bgSpawnTimer || 0) - dt;
    if (Game.bgSpawnTimer <= 0 && Game.holder.length < CONFIG.holder.max) {
      Game.holder.push(makeBgCar());
      Game.bgSpawnTimer = currentSpawnInterval() * 2 * rand(.75, 1.25);
      onHolderChanged();
    }
  }

  updateDefeatTimer(dt);
  if (Game.state !== 'play') return;

  // --- нефтебаза → АЗС ---
  distributeDepotFuel(dt);

  // --- спавн перекупа (через накопитель) ---
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

  // --- поведение машин / переходы состояний ---
  const removeSet = new Set();
  for (const v of Game.vehicles) {
    if (v.kind === 'gbr') updateGBR(v, dt, L, removeSet);

    if (v.state === 'drive') {
      if (v.lane === 'inner') {
        if (v.kind === 'car') {
          if (!v.served && !v.pump && !v.pocketSlot && !v.angry && !v.overtake) {
            v.scanT -= dt;
            if (v.scanT <= 0) { v.scanT = 0.25; scanForStation(v); }
            if (!v.served && !v.pump && !v.pocketSlot && v.trip > CONFIG.giveUpLaps * L) v.angry = true;
          }
          if (!v.served && v.pocketSlot && !v.pump) tryApproachPocket(v, L, dt);
          if (!v.served && v.pump) tryApproachPullIn(v, L);
          if (v.angry) {
            v.mergeT -= dt;
            if (v.mergeT <= 0) {
              v.mergeT = 0.3;
              if (laneGapFree(outer, mod(v.s + 14, L), v.len)) beginLaneChange(v);
            }
          }
        } else if (v.kind === 'scalper') {
          updateScalperTour(v, dt, L, removeSet);
        } else if (v.kind === 'tanker') {
          updateTanker(v, dt, L, removeSet);
        }
      } else if (v.trip > 30 && crossed(v, Road.spawnS)) {
        removeSet.add(v);
      }
    } else if (v.state === 'unload' && v.kind === 'tanker' && v.phase === 'dump_depot') {
      updateTankerUnload(v, dt, removeSet);
    } else if (v.state === 'pullIn') {
      v.animT += dt;
      if (v.animT >= v.animDur) {
        v.pose = { ...v.animTo };
        v.state = 'station';
      }
    } else if (v.state === 'pocket') {
      if (!v.pocketSlot && v.animT >= v.animDur) {
        v.state = 'drive';
        v.pose = null;
        v.v = Math.max(v.v || 0, v.maxV * 0.35);
      }
      if (!v.pose || v.animT < v.animDur) {
        v.animT += dt;
        if (v.animT >= v.animDur) v.pose = { ...v.animTo };
      }
    } else if (v.state === 'station') {
      const rank = Math.max(0, v.pump.cars.indexOf(v));
      const desired = v.kind === 'tanker'
        ? pumpPose(v.targetSlot, v.pumpJ)
        : apronPoseForRank(v.targetSlot, v.pumpJ, rank);
      const dx = desired.x - v.pose.x, dy = desired.y - v.pose.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 1.5) {
        const step = Math.min(dist, CONFIG.pump.queueSpeed * dt);
        v.pose.x += dx / dist * step;
        v.pose.y += dy / dist * step;
        v.pose.a += shortAngle(desired.a - v.pose.a) * Math.min(1, dt * 6);
      } else if (v.kind === 'tanker') {
        updateTankerAtPump(v, dt, L);
      } else if (rank === 0) {
        if (v.kind === 'scalper') {
          const st = v.station, C = CONFIG.scalper;
          const canTake = st.canisterUp && st.canRes > 0.01 && st.canCd <= 0 &&
            v.totalGot < C.maxLiters && v.canisters < C.maxCanisters;
          if (canTake) {
            const want = Math.min(C.litersPerCanister, C.maxLiters - v.totalGot, st.canRes);
            const amt = Math.min(want, CONFIG.scalper.fillRate * dt);
            if (amt > 0) {
              st.canRes -= amt;
              finishScalperFuel(v, amt);
              if (st.canRes <= 0.01) { st.canRes = 0; st.canCd = CONFIG.canisterReserve.cooldown; }
            }
            if (v.totalGot >= C.maxLiters - 0.01 || v.canisters >= C.maxCanisters ||
                st.canRes <= 0.01) {
              v.pump.blocked = false;
              const i = v.pump.cars.indexOf(v);
              if (i >= 0) v.pump.cars.splice(i, 1);
              v.targetSlot = null; v.station = null; v.pump = null; v.pumpJ = 0;
              v.tourIdx++;
              v.state = 'drive';
            }
          } else {
            v.pump.blocked = true;
            v.state = 'block';
          }
        } else {
          const pump = v.pump, st = v.station;
          pump.serving = true;
          let d;
          if (pump.buffer > 0.01) {
            d = Math.min(pump.rate * CONFIG.pump.fastMult * dt, v.need - v.got, pump.buffer);
            pump.buffer -= d;
          } else {
            d = Math.min(pump.rate * dt, v.need - v.got, st.res);
            st.res -= d;
          }
          v.got += d;
          if (v.got >= v.need - 0.01 || (pump.buffer <= 0.01 && st.res <= 0.01)) finishFuel(v);
        }
      }
    } else if (v.state === 'block' && v.kind === 'scalper') {
      const st = v.station;
      if (st && st.canisterUp && st.canRes > 0.01 && st.canCd <= 0) {
        v.state = 'station';
        v.pump.blocked = false;
      }
    } else if (v.state === 'waitMerge') {
      v.mergeT -= dt;
      if (v.mergeT <= 0) {
        v.mergeT = 0.25;
        const ms = mod(v.targetSlot.s + 16, L);
        if (laneGapFree(outer, ms, v.len)) beginPullOut(v, ms);
      }
    } else if (v.state === 'pullOut') {
      v.animT += dt;
      if (v.animT >= v.animDur) {
        if (v.kind === 'scalper' && v.tourIdx >= v.tour.length) {
          removeSet.add(v);
          Game.scalper.unit = null;
        } else if (v.kind === 'tanker') {
          v.lane = 'inner'; v.state = 'drive';
          v.s = v.exitS; v.prevS = v.s; v.v = 28;
          v.trip = 0; v.stopS = null;
          v.targetSlot = null; v.percGap = 1e9; v.percT = 0;
          if (v.phase === 'to_depot' && v.tourIdx >= v.tour.length) v.stopS = Depot.accessS;
        } else if (v.kind === 'car') {
          v.lane = 'outer';
          v.state = 'drive';
          v.s = v.exitS; v.prevS = v.s; v.v = 25;
          v.trip = 0; v.stopS = null;
          v.targetSlot = null; v.station = null; v.pump = null;
          v.pocketSlot = null;
          v.percGap = 1e9; v.percT = 0;
        } else {
          v.lane = v.tourIdx >= (v.tour ? v.tour.length : 0) ? 'outer' : 'inner';
          v.state = 'drive';
          v.s = v.exitS; v.prevS = v.s; v.v = 25;
          v.trip = 0; v.stopS = null;
          if (v.kind !== 'scalper' || v.tourIdx >= v.tour.length) {
            v.targetSlot = null; v.station = null; v.pump = null;
          }
          v.percGap = 1e9; v.percT = 0;
        }
      }
    }
  }
  for (const v of removeSet) cleanupVehicle(v);
  if (removeSet.size) Game.vehicles = Game.vehicles.filter(v => !removeSet.has(v));

  // --- буферы колонок + резерв канистр ---
  const bufMax = CONFIG.pump.bufferMax();
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st) continue;
    processStationPocket(st, dt);
    refillCanisterReserve(st, dt);
    for (const pump of st.pumps) {
      if (!pump.serving && !pump.blocked && pump.buffer < bufMax - 0.01 && st.res > 0.01) {
        const amt = Math.min(bufMax / CONFIG.pump.bufferFillTime * dt, bufMax - pump.buffer, st.res);
        pump.buffer += amt;
        st.res -= amt;
      }
      pump.serving = false;
    }
  }

  // --- таймеры подписей резервуаров ---
  for (const k in Game.tankLabels) {
    Game.tankLabels[k] -= dt;
    if (Game.tankLabels[k] <= 0) delete Game.tankLabels[k];
  }
  if (Game.depotLabel > 0) Game.depotLabel -= dt;

  // --- кулдауны ---
  Game.tanker.cd = Math.max(0, Game.tanker.cd - dt);
  Game.gbr.cd = Math.max(0, Game.gbr.cd - dt);

  // --- всплывающие тексты ---
  for (const f of Game.floats) f.t += dt;
  Game.floats = Game.floats.filter(f => f.t < f.life);

  // --- предупреждение о блокировке въезда ---
  if (Game.defeatT > 0.15) {
    UI.warning.textContent =
      '⚠️ НАКОПИТЕЛЬ ПОЛОН! ' + Math.max(0, CONFIG.defeatTime - Game.defeatT).toFixed(1) + 'с';
    UI.warning.classList.remove('hidden');
  } else {
    UI.warning.classList.add('hidden');
  }

  updateHUD();
  updatePanelLive();
}
