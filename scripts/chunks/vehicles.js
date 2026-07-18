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
    missedStation: false,     visualSteer: 0,
    countsForDefeat: true, holderPriority: 0, pocketWaitT: 0,
    served: false
  }, p);
}

function rollCanister(typeKey) {
  if (Math.random() >= CONFIG.canister.prob) return null;
  if (typeKey === 'sedan') return { liters: CONFIG.canister.red, color: 'red' };
  if (typeKey === 'suv') return Math.random() < 0.5
    ? { liters: CONFIG.canister.red, color: 'red' }
    : { liters: CONFIG.canister.green, color: 'green' };
  return null;
}

function pickClientType(diff) {
  const cfg = Game.modeCfg;
  const mix = lerpMix(cfg.typeMix.start, cfg.typeMix.end, diff);
  if (Game.stats.served < CONFIG.truckUnlockAt) {
    const sum = mix.sedan + mix.suv;
    return weightedPick({ sedan: mix.sedan / sum, suv: mix.suv / sum });
  }
  return weightedPick(mix);
}

function pickClientFuel(typeKey) {
  if (typeKey === 'truck') return 'diesel';
  if (Math.random() < 1 / 3) return 'diesel';
  return Math.random() < 0.67 ? 'a92' : 'a95';
}

function makeCar(diff) {
  const typeKey = pickClientType(diff);
  const fuelKey = pickClientFuel(typeKey);
  const T = CONFIG.carTypes[typeKey];
  const need = T.tank * rand(CONFIG.needMin, CONFIG.needMax);
  const can = rollCanister(typeKey);
  return baseVehicle('car', {
    typeKey, fuelKey,
    canister: !!can, canisterLiters: can ? can.liters : 0, canisterColor: can ? can.color : null,
    canisterGot: 0, canisterPaid: false,
    len: T.len, w: T.w, maxV: T.maxV * rand(.92, 1.08), accel: T.accel, brake: T.brake,
    v: T.maxV * .5, tank: T.tank, need, got: 0
  });
}

function makeScalper() {
  const C = CONFIG.scalper;
  const tour = sortedStationSlots();
  return baseVehicle('scalper', {
    len: C.len, w: 10, maxV: C.speed, accel: C.accel, brake: C.brake, v: C.speed * .4,
    tour, tourIdx: 0, totalGot: 0, canisters: 0,
    targetSlot: null, pump: null, pumpJ: 0, waitReserve: false
  });
}

function makeTanker() {
  const C = CONFIG.tanker;
  const cap = Depot.cap();
  const load = Math.min(Game.depot.res, cap);
  Game.depot.res -= load;
  const tour = sortedStationSlots();
  return baseVehicle('tanker', {
    len: C.len, w: 12, maxV: C.speed, accel: 28, brake: 70, v: C.speed * .4,
    load, capacity: cap, react: .25,
    tour, tourIdx: 0, phase: 'tour', unloadT: 0
  });
}

function makeGBR() {
  const C = CONFIG.gbr;
  return baseVehicle('gbr', {
    lane: 'inner', len: C.len, w: 10, maxV: C.speed, accel: C.accel, brake: C.brake,
    v: C.speed * .4, react: .08,
    target: null, towT: 0, towTotal: C.towTime, towProgress: 0
  });
}

function makeBgCar() {
  const typeKey = weightedPick({ sedan: .5, suv: .35, truck: .15 });
  const T = CONFIG.carTypes[typeKey];
  return baseVehicle('bg', {
    typeKey, laps: 0, exitAfterLap: false,
    len: T.len, w: T.w, maxV: T.maxV * rand(.9, 1.05), accel: T.accel, brake: T.brake,
    v: T.maxV * .45
  });
}

/* ---- движение в полосе: фантомная пробка + обгоны ---- */
function findForwardLeader(list, v, L) {
  let bestG = 1e9, leader = null;
  for (const o of list) {
    if (o === v) continue;
    const g = mod(o.s - v.s, L) - (o.len + v.len) / 2;
    if (g > 0 && g < bestG) { bestG = g; leader = o; }
  }
  return { leader, gap: leader ? bestG : 1e9 };
}

function outerClearForOvertake(v, L) {
  const outer = outerLaneList();
  const testS = mod(v.s + v.len * 0.6, L);
  return laneGapFree(outer, testS, v.len);
}

function canStartOvertake(v, leader, gapNow, F) {
  if (v.overtake || v.overtakeCommitted) return false;
  if (v.state !== 'drive') return false;
  if (v.kind !== 'car' && v.kind !== 'gbr') return false;
  if (!leader || v.maxV <= leader.maxV + 8) return false;
  if (gapNow >= F.overtakeTrigger || gapNow <= F.gapMin) return false;
  if (leader.v >= v.maxV * 0.72) return false;
  if (!outerClearForOvertake(v, Road.length)) return false;
  if (v.kind === 'gbr') return true;
  return Math.random() < CONFIG.overtake.chance;
}

function updateLane(list, dt) {
  const L = Road.length, F = CONFIG.follow, lw = Road.laneW;
  list.sort((a, b) => a.s - b.s);
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const v = list[i];
    if (v.state === 'action' || v.state === 'tow') {
      v.prevS = v.s; v.v = 0; continue;
    }
    const { leader, gap: gapNow } = findForwardLeader(list, v, L);
    const leadV = leader ? leader.v : v.maxV;
    v.percT -= dt;
    if (v.percT <= 0) { v.percGap = gapNow; v.percLV = leadV; v.percT = v.react; }
    if (gapNow < F.emergencyGap) { v.percGap = gapNow; v.percLV = leadV; }

    if (!v.overtake && canStartOvertake(v, leader, gapNow, F)) {
      v.overtake = 'out'; v.overtakeT = 0; v.overtakeCommitted = true;
    }
    let targetSteer = 0;
    if (v.overtake) {
      v.overtakeT += dt;
      const dur = F.overtakeDur;
      if (v.overtake === 'out') {
        targetSteer = -0.22;
        v.latOff = lerp(0, -lw * 0.85, smooth(clamp01(v.overtakeT / (dur * 0.4))));
        if (v.overtakeT >= dur * 0.4) v.overtake = 'pass';
      } else if (v.overtake === 'pass') {
        targetSteer = -0.12;
        v.latOff = -lw * 0.85;
        if (v.overtakeT >= dur * 0.7) v.overtake = 'in';
      } else if (v.overtake === 'in') {
        const t = clamp01((v.overtakeT - dur * 0.7) / (dur * 0.3));
        targetSteer = lerp(-0.12, 0, smooth(t));
        v.latOff = lerp(-lw * 0.85, 0, smooth(t));
        if (t >= 1) {
          v.overtake = null; v.overtakeT = 0; v.overtakeCommitted = false; v.latOff = 0;
          if (v.kind === 'car' && v.pocketSlot) {
            const d = distAhead(v.s, pocketEntryS(v.pocketSlot), L);
            if (d < v.len || d > L - 35) {
              releasePocket(v);
              v.missedStation = true;
              v.scanT = 0.6;
            }
          }
        }
      }
    }
    v.visualSteer = lerp(v.visualSteer || 0, targetSteer, Math.min(1, dt * 7));

    let vt;
    if (v.percGap <= F.gapMin && !v.overtake) vt = 0;
    else if (v.overtake) vt = v.maxV;
    else vt = Math.min(v.maxV, Math.max(0, v.percLV) + (v.percGap - F.gapMin) * F.gapK);
    if (v.stopS != null) {
      const d = mod(v.stopS - v.s, L);
      if (d < L / 2) vt = Math.min(vt, Math.sqrt(2 * v.brake * Math.max(0, d - 1)));
    }
    v.v += clamp(vt - v.v, -v.brake * dt, v.accel * dt);
    if (v.v < 0) v.v = 0;
    v.prevS = v.s;
    v.s = mod(v.s + v.v * dt, L);
    v.trip += v.v * dt;
    if (leader && !v.overtake) {
      const g = mod(leader.s - v.s, L) - (leader.len + v.len) / 2;
      if (g < 0) { v.s = mod(leader.s - (leader.len + v.len) / 2, L); v.v = Math.min(v.v, leader.v); }
    }
  }
}

function laneGapFree(list, s, len) {
  const L = Road.length;
  for (const v of list) {
    const rel = mod(v.s - s + L / 2, L) - L / 2;
    if (rel >= 0) { if (rel < (v.len + len) / 2 + 10) return false; }       // машина впереди
    else { if (-rel < (v.len + len) / 2 + 26) return false; }               // машина сзади
  }
  return true;
}

// пересекла ли машина точку s за последний кадр
function crossed(v, s) {
  const L = Road.length;
  const trav = mod(v.s - v.prevS, L);
  if (trav <= 0 || trav > L / 2) return false;
  return mod(s - v.prevS, L) <= trav;
}
