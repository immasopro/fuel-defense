import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road, pocketEntryS, distAhead } from '../world/roadNetwork.js';
import {
  laneCount, serviceLane, clampLane, laneLat, normalizeLane
} from '../world/lanes.js';
import { mod, clamp, clamp01, lerp, smooth, rand } from '../core/utils.js';
import { laneList } from '../systems/trafficSystem.js';
import { releasePocket } from '../stations/stationQueue.js';
import { GbrPhase, ScalperPhase } from '../systems/entityFsm.js';

function baseVehicle(kind, p) {
  const F = CONFIG.follow;
  return Object.assign({
    kind, lane: serviceLane(), state: 'drive',
    s: Road.spawnS, prevS: Road.spawnS, v: 0, trip: 0,
    len: 18, w: 9, maxV: 60, accel: 45, brake: 100,
    react: rand(F.reactMin, F.reactMax), percT: 0, percGap: 1e9, percLV: 0,
    stopS: null, targetSlot: null, station: null, pump: null, pumpJ: 0,
    angry: false, scanT: rand(0, .2), mergeT: 0,
    animT: 0, animDur: 0, animFrom: null, animTo: null, exitS: 0,
    pose: null,
    latOff: 0, overtake: null, overtakeT: 0, overtakeCommitted: false,
    overtakeFromLane: null, overtakeToLane: null,
    laneChange: null, // { from, to, t, dur }
    yieldForGbr: false,
    missedStation: false, visualSteer: 0,
    countsForDefeat: true, holderPriority: 0, pocketWaitT: 0,
    served: false
  }, p);
}

function ensureNumericLane(v) {
  if (v && (typeof v.lane !== 'number' || v.lane === 'inner' || v.lane === 'outer')) {
    v.lane = normalizeLane(v.lane);
  }
}

/** ГБР в CHASE — приоритет движения + мигалка. */
function isChasePriorityGbr(v) {
  return v && v.kind === 'gbr' && v.gbrPhase === GbrPhase.CHASE && v.state === 'drive';
}

function hasSiren(v) {
  return isChasePriorityGbr(v);
}

function chaseDriveCfg() {
  return CONFIG.gbr.chaseDrive;
}

function bumperFloor() {
  return CONFIG.follow.bumperFloor ?? 0.75;
}

/**
 * COLL-001: лидер при gap >= -eps (включая bumper boundary / soft-snap 0).
 * Раньше g > 0 терял лидера после snap → разгон сквозь.
 */
function findForwardLeader(list, v, L) {
  let bestG = 1e9, leader = null;
  const eps = -0.05;
  for (const o of list) {
    if (o === v) continue;
    const g = mod(o.s - v.s, L) - (o.len + v.len) / 2;
    if (g >= eps && g < bestG) { bestG = g; leader = o; }
  }
  return { leader, gap: leader ? bestG : 1e9 };
}

function safeLatOffset(v) {
  const frac = chaseDriveCfg().safeLatFrac ?? 0.55;
  return Road.laneW * frac;
}

/** Мировая латераль центра автомобиля (lane center + latOff). */
function effectiveLat(v) {
  ensureNumericLane(v);
  return laneLat(v.lane) + (v.latOff || 0);
}

/**
 * Боковой конфликт: |Δlat| меньше безопасного offset.
 * После достаточного latOff обгон по s разрешён (нет конфликта с исходной полосой).
 */
function laterallyConflicts(a, b) {
  if (!a || !b) return false;
  return Math.abs(effectiveLat(a) - effectiveLat(b)) < safeLatOffset(a);
}

function isRingParticipant(o) {
  if (!o) return false;
  if (o.state === 'drive' || o.state === 'action' || o.state === 'tow') return true;
  if (o.kind === 'scalper' && o.scalperPhase === ScalperPhase.EXITING) return true;
  return false;
}

/**
 * Ближайший впереди автомобиль с боковым конфликтом (любая полоса).
 * COLL-002 / jam: soft-fix не отключается «слишком рано» только по latOff
 * относительно исходного списка — учитывается фактическая геометрия.
 */
function findLateralForwardLeader(v, L) {
  let bestG = 1e9, leader = null;
  const eps = -0.05;
  const vehicles = Game.vehicles || [];
  for (const o of vehicles) {
    if (o === v || !isRingParticipant(o)) continue;
    if (!laterallyConflicts(v, o)) continue;
    if (isAssignedChaseTarget(v, o)) continue;
    const g = mod(o.s - v.s, L) - (o.len + v.len) / 2;
    if (g >= eps && g < bestG) { bestG = g; leader = o; }
  }
  return { leader, gap: leader ? bestG : 1e9 };
}

/** Восстановить позицию, если оказались внутри другого кузова по s+lat. */
function repairLateralOverlap(v, L, floor) {
  const vehicles = Game.vehicles || [];
  let best = null;
  let bestPen = 0;
  for (const o of vehicles) {
    if (o === v || !isRingParticipant(o)) continue;
    if (!laterallyConflicts(v, o)) continue;
    if (isAssignedChaseTarget(v, o)) continue;
    const d = Math.min(mod(v.s - o.s, L), mod(o.s - v.s, L));
    const lim = (v.len + o.len) / 2;
    const pen = lim - d;
    if (pen > bestPen) { bestPen = pen; best = o; }
  }
  if (!best || bestPen <= 0) return;
  // Поставить позади best (если мы «впереди» по кольцу относительно prev — всё равно сзади по bumper)
  const ahead = mod(v.s - best.s, L);
  if (ahead < L / 2) {
    // v ahead of best → snap behind best? Actually we penetrated; put v behind best
    applySoftSnap(v, best, L, floor);
    v.v = Math.min(v.v, best.v);
  } else {
    applySoftSnap(v, best, L, floor);
    v.v = Math.min(v.v, best.v);
  }
}

/** Soft-fix активен, пока боковой уход недостаточен (COLL-002). */
function softResolveActive(v) {
  if (!v.overtake && !v.laneChange) return true;
  return Math.abs(v.latOff || 0) < safeLatOffset(v);
}

/** Можно ли зафиксировать новую полосу без bumper-overlap на целевой. */
function canCommitOvertakeLane(v, toLane, L) {
  const list = laneList(toLane);
  const floor = bumperFloor();
  for (const o of list) {
    if (o === v) continue;
    if (isAssignedChaseTarget(v, o)) continue;
    const d = Math.min(mod(v.s - o.s, L), mod(o.s - v.s, L));
    if (d < (v.len + o.len) / 2 + floor) return false;
  }
  return true;
}

function overtakeTargetLane(v) {
  if (v.overtakeToLane != null) return clampLane(v.overtakeToLane);
  ensureNumericLane(v);
  // Предпочитаем полосу «наружу» (больший индекс), иначе внутрь
  const right = v.lane + 1;
  if (right < laneCount()) return right;
  const left = v.lane - 1;
  if (left >= 0) return left;
  return v.lane;
}

function adjacentClearForOvertake(v, toLane, L) {
  const list = laneList(toLane);
  const CD = isChasePriorityGbr(v) ? chaseDriveCfg() : null;
  const aheadPad = CD ? CD.outerAheadPad : 22;
  const behindPad = CD ? CD.outerBehindPad : 26;
  const testS = mod(v.s + v.len * 0.6, L);
  for (const o of list) {
    if (o === v) continue;
    if (CD && o.kind === 'scalper' && v.targetScalperId != null && o.scalperId === v.targetScalperId) continue;
    const rel = mod(o.s - testS + L / 2, L) - L / 2;
    if (rel >= 0) {
      if (rel < (o.len + v.len) / 2 + aheadPad) return false;
    } else {
      if (-rel < (o.len + v.len) / 2 + behindPad) return false;
    }
  }
  return true;
}

/** @deprecated name kept — clears adjacent overtake lane */
function outerClearForOvertake(v, L) {
  ensureNumericLane(v);
  const to = overtakeTargetLane(v);
  if (to === v.lane) return false;
  return adjacentClearForOvertake(v, to, L);
}

function outerClearForChaseOvertake(v, L) {
  return outerClearForOvertake(v, L);
}

function isAssignedChaseTarget(gbr, other) {
  if (!gbr || !other || gbr.targetScalperId == null) return false;
  return other.kind === 'scalper' && other.scalperId === gbr.targetScalperId;
}

function canStartOvertake(v, leader, gapNow, F) {
  if (v.overtake || v.overtakeCommitted || v.laneChange) return false;
  if (v.state !== 'drive') return false;
  if (v.kind !== 'car' && v.kind !== 'gbr') return false;
  if (!leader) return false;
  ensureNumericLane(v);

  const toLane = overtakeTargetLane(v);
  if (toLane === v.lane) return false;

  if (isChasePriorityGbr(v)) {
    if (isAssignedChaseTarget(v, leader)) return false;
    const CD = chaseDriveCfg();
    if (gapNow <= CD.gapMin) return false;
    if (gapNow >= CD.overtakeTrigger) return false;
    if (leader.v >= v.maxV * 0.95 && leader.maxV >= v.maxV - 2) return false;
    if (adjacentClearForOvertake(v, toLane, Road.length)) {
      v.overtakeToLane = toLane;
      v.overtakeFromLane = v.lane;
      return true;
    }
    // Плотный поток: форсировать только если соседняя полоса хоть чуть свободна сзади/впереди
    if (gapNow < 40 && leader.v < v.maxV * 0.9 && adjacentClearForOvertake(v, toLane, Road.length)) {
      v.overtakeToLane = toLane;
      v.overtakeFromLane = v.lane;
      return true;
    }
    return false;
  }

  if (v.maxV <= leader.maxV + 8) return false;
  if (gapNow >= F.overtakeTrigger || gapNow <= F.gapMin) return false;
  if (leader.v >= v.maxV * 0.72) return false;
  if (!adjacentClearForOvertake(v, toLane, Road.length)) return false;
  if (v.kind === 'gbr') {
    v.overtakeToLane = toLane;
    v.overtakeFromLane = v.lane;
    return true;
  }
  if (Math.random() < CONFIG.overtake.chance) {
    v.overtakeToLane = toLane;
    v.overtakeFromLane = v.lane;
    return true;
  }
  return false;
}

function overtakeDuration(v, F) {
  if (isChasePriorityGbr(v)) return chaseDriveCfg().overtakeDur;
  return F.overtakeDur;
}

function followGapMin(v, F) {
  if (isChasePriorityGbr(v)) return chaseDriveCfg().gapMin;
  return F.gapMin;
}

function maxStep(v, dt) {
  const frac = CONFIG.follow.maxStepLenFrac ?? 0.45;
  // Абсолютный потолок длины шага за tick (не *dt — dt уже в desire=v*dt)
  return Math.max(v.len * frac, 1);
}

function applySoftSnap(v, leader, L, floor) {
  const targetGap = Math.max(0, floor);
  v.s = mod(leader.s - (leader.len + v.len) / 2 - targetGap, L);
  v.v = Math.min(v.v, leader.v);
}

/**
 * Начать плавную смену полосы (не мгновенную).
 * @returns {boolean}
 */
function beginLaneShift(v, toLane, opts = {}) {
  ensureNumericLane(v);
  toLane = clampLane(toLane);
  if (toLane === v.lane || v.laneChange || v.overtake) return false;
  if (Math.abs(toLane - v.lane) !== 1 && !opts.allowSkip) return false;
  if (!adjacentClearForOvertake(v, toLane, Road.length) && !opts.force) return false;
  const dur = opts.dur ?? CONFIG.follow.laneChangeDur ?? 1.1;
  v.laneChange = { from: v.lane, to: toLane, t: 0, dur };
  v.yieldForGbr = !!opts.yieldForGbr;
  return true;
}

function tickLaneChange(v, dt, L) {
  if (!v.laneChange) return;
  const lc = v.laneChange;
  lc.t += dt;
  const u = clamp01(lc.t / lc.dur);
  const fromLat = laneLat(lc.from);
  const toLat = laneLat(lc.to);
  // latOff relative to committed lane (still `from` until complete)
  v.latOff = (toLat - fromLat) * smooth(u);
  v.visualSteer = lerp(v.visualSteer || 0, Math.sign(toLat - fromLat) * -0.15, Math.min(1, dt * 7));
  if (u >= 1) {
    v.lane = lc.to;
    v.latOff = 0;
    v.laneChange = null;
    v.yieldForGbr = false;
    v.visualSteer = 0;
  }
}

function updateLane(list, dt) {
  const L = Road.length, F = CONFIG.follow, lw = Road.laneW;
  const floor = bumperFloor();
  list.sort((a, b) => a.s - b.s);
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const v = list[i];
    ensureNumericLane(v);
    if (v.state === 'action' || v.state === 'tow') {
      v.prevS = v.s; v.v = 0; continue;
    }
    if (v.laneChange) {
      tickLaneChange(v, dt, L);
      // Во время смены полосы всё ещё следуем за лидерами текущей (from) полосы
    }

    const { leader, gap: gapNow } = findForwardLeader(list, v, L);
    const leadV = leader ? leader.v : v.maxV;
    v.percT -= dt;
    if (v.percT <= 0) { v.percGap = gapNow; v.percLV = leadV; v.percT = v.react; }
    if (gapNow < F.emergencyGap) { v.percGap = gapNow; v.percLV = leadV; }

    if (!v.overtake && !v.laneChange && canStartOvertake(v, leader, gapNow, F)) {
      v.overtake = 'out'; v.overtakeT = 0; v.overtakeCommitted = true;
    }

    let targetSteer = 0;
    const dur = overtakeDuration(v, F);
    if (v.overtake && !v.laneChange) {
      v.overtakeT += dt;
      const chase = isChasePriorityGbr(v);
      const tOut = chase ? 0.28 : 0.4;
      const tPass = chase ? 0.55 : 0.7;
      const fromL = v.overtakeFromLane != null ? v.overtakeFromLane : v.lane;
      const toL = v.overtakeToLane != null ? v.overtakeToLane : overtakeTargetLane(v);
      const latSpan = laneLat(toL) - laneLat(fromL);
      if (v.overtake === 'out') {
        targetSteer = Math.sign(latSpan || -1) * -0.22;
        v.latOff = lerp(0, latSpan, smooth(clamp01(v.overtakeT / (dur * tOut))));
        if (v.overtakeT >= dur * tOut) v.overtake = 'pass';
      } else if (v.overtake === 'pass') {
        targetSteer = Math.sign(latSpan || -1) * -0.12;
        v.latOff = latSpan;
        let passDone = v.overtakeT >= dur * tPass;
        if (chase && leader) {
          const ahead = mod(v.s - leader.s, L);
          if (ahead > (leader.len + v.len) / 2 + 4 && ahead < L / 2) passDone = true;
        } else if (chase && !leader) {
          passDone = true;
        }
        if (passDone) {
          // Держим боковой уход, пока не обогнали лидера по s — затем commit полосы
          const pastLeader = !leader || (
            mod(v.s - leader.s, L) > (leader.len + v.len) / 2 + 4 &&
            mod(v.s - leader.s, L) < L / 2
          );
          if (Math.abs(v.latOff) >= safeLatOffset(v) * 0.9 && pastLeader &&
              canCommitOvertakeLane(v, toL, L)) {
            v.lane = clampLane(toL);
            v.latOff = 0;
            v.overtake = null; v.overtakeT = 0; v.overtakeCommitted = false;
            v.overtakeFromLane = null; v.overtakeToLane = null;
          } else if (Math.abs(v.latOff) >= safeLatOffset(v) * 0.9) {
            // Уже в безопасном lat — ждём clear целевой полосы / обгон лидера
            v.latOff = latSpan;
          } else {
            v.overtake = 'in';
            if (chase) v.overtakeT = dur * tPass;
          }
        }
      } else if (v.overtake === 'in') {
        const t = clamp01((v.overtakeT - dur * tPass) / (dur * (1 - tPass)));
        targetSteer = lerp(Math.sign(latSpan || -1) * -0.12, 0, smooth(t));
        v.latOff = lerp(latSpan, 0, smooth(t));
        if (t >= 1) {
          v.overtake = null; v.overtakeT = 0; v.overtakeCommitted = false; v.latOff = 0;
          v.overtakeFromLane = null; v.overtakeToLane = null;
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
    if (!v.laneChange) {
      v.visualSteer = lerp(v.visualSteer || 0, targetSteer, Math.min(1, dt * 7));
    }

    const gapMin = followGapMin(v, F);
    // Латеральный лидер: учитывает целевую полосу при незавершённом latOff (COLL-002 / jam)
    const latLead = findLateralForwardLeader(v, L);
    const followLeader = latLead.leader || leader;
    const followGap = latLead.leader ? latLead.gap : gapNow;
    const followLV = followLeader ? followLeader.v : v.maxV;
    if (latLead.leader && followGap < F.emergencyGap) {
      v.percGap = followGap; v.percLV = followLV;
    }

    let vt;
    if (followGap <= gapMin && (softResolveActive(v) || latLead.leader)) {
      vt = isChasePriorityGbr(v) ? Math.min(v.maxV * 0.35, Math.max(8, followLV + 4)) : 0;
    } else if (v.overtake && Math.abs(v.latOff || 0) >= safeLatOffset(v) && !latLead.leader) {
      vt = v.maxV;
    } else if (v.overtake) {
      // Ещё не ушли вбок / целевая занята — не давим на полной
      vt = Math.min(v.maxV, Math.max(followLV + 2, followGap > 0 ? v.maxV * 0.6 : followLV));
    } else {
      vt = Math.min(v.maxV, Math.max(0, v.percLV) + (v.percGap - gapMin) * F.gapK);
    }
    if (v.stopS != null) {
      const d = mod(v.stopS - v.s, L);
      if (d < L / 2) vt = Math.min(vt, Math.sqrt(2 * v.brake * Math.max(0, d - 1)));
    }
    v.v += clamp(vt - v.v, -v.brake * dt, v.accel * dt);
    if (v.v < 0) v.v = 0;

    // Cap step to avoid tunneling between collision checks
    const stepCap = maxStep(v, dt);
    let desire = v.v * dt;
    // Не перескакивать латерального лидера за один tick (COLL-001/002 / large dt)
    if (latLead.leader) {
      const maxGapStep = Math.max(0, latLead.gap - floor);
      if (desire > maxGapStep) {
        desire = maxGapStep;
        v.v = Math.min(v.v, Math.max(latLead.leader.v, 0));
      }
    }
    const step = Math.min(desire, stepCap);
    if (v.v * dt > stepCap && stepCap > 0 && step === stepCap) v.v = step / Math.max(dt, 1e-6);

    v.prevS = v.s;
    v.s = mod(v.s + step, L);
    v.trip += step;

    // Всегда soft-snap к латерально конфликтующему лидеру (не только list leader)
    {
      const after = findLateralForwardLeader(v, L);
      if (after.leader) {
        const g = after.gap;
        if (isChasePriorityGbr(v) && !isAssignedChaseTarget(v, after.leader)) {
          if (g < floor) {
            applySoftSnap(v, after.leader, L, floor);
            v.v = Math.max(Math.min(v.v, after.leader.v + 6), 0);
          }
        } else if (g < floor) {
          applySoftSnap(v, after.leader, L, floor);
        }
      } else {
        // Если перескочили — починить глубокий overlap с ближайшим конфликтующим
        repairLateralOverlap(v, L, floor);
      }
    }
  }
}

function laneGapFree(list, s, len) {
  const L = Road.length;
  for (const v of list) {
    const rel = mod(v.s - s + L / 2, L) - L / 2;
    if (rel >= 0) { if (rel < (v.len + len) / 2 + 10) return false; }
    else { if (-rel < (v.len + len) / 2 + 26) return false; }
  }
  return true;
}

function crossed(v, s) {
  const L = Road.length;
  const trav = mod(v.s - v.prevS, L);
  if (trav <= 0 || trav > L / 2) return false;
  return mod(s - v.prevS, L) <= trav;
}

/**
 * NPC уступает CHASE GBR: если GBR сзади на той же полосе и справа свободно — сдвиг вправо.
 */
function tryYieldToChaseGbr(v, dt) {
  if (!v || v.kind !== 'car' || v.state !== 'drive') return;
  if (v.overtake || v.laneChange || v.angry || v.pump || v.pocketSlot) return;
  ensureNumericLane(v);
  const right = v.lane + 1;
  if (right >= laneCount()) return;
  const CD = chaseDriveCfg();
  const L = Road.length;
  const list = laneList(v.lane);
  let gbrBehind = null;
  for (const o of list) {
    if (o === v || o.kind !== 'gbr') continue;
    if (!isChasePriorityGbr(o)) continue;
    const behind = mod(v.s - o.s, L);
    if (behind > 0 && behind < (CD.yieldLookBack ?? 70) &&
        behind > (v.len + o.len) / 2 - 2) {
      gbrBehind = o;
      break;
    }
  }
  if (!gbrBehind) return;
  // Конфликт траекторий: GBR догоняет
  if (gbrBehind.v <= v.v + 2 && gbrBehind.maxV <= v.maxV + 5) return;
  beginLaneShift(v, right, { yieldForGbr: true, dur: CONFIG.follow.laneChangeDur ?? 1.1 });
}

export {
  baseVehicle, findForwardLeader, outerClearForOvertake, canStartOvertake,
  updateLane, laneGapFree, crossed, isChasePriorityGbr, hasSiren,
  beginLaneShift, tryYieldToChaseGbr, ensureNumericLane, softResolveActive,
  bumperFloor, safeLatOffset, effectiveLat, laterallyConflicts, findLateralForwardLeader
};
