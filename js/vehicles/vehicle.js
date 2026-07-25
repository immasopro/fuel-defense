import { CONFIG } from '../config/index.js';
import { Road, pocketEntryS, distAhead } from '../world/roadNetwork.js';
import { mod, clamp, clamp01, lerp, smooth, rand } from '../core/utils.js';
import { outerLaneList } from '../systems/trafficSystem.js';
import { releasePocket } from '../stations/stationQueue.js';
import { GbrPhase } from '../systems/entityFsm.js';

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
    missedStation: false, visualSteer: 0,
    countsForDefeat: true, holderPriority: 0, pocketWaitT: 0,
    served: false
  }, p);
}

/** ГБР в CHASE — абсолютный приоритет движения. */
function isChasePriorityGbr(v) {
  return v && v.kind === 'gbr' && v.gbrPhase === GbrPhase.CHASE && v.state === 'drive';
}

function chaseDriveCfg() {
  return CONFIG.gbr.chaseDrive;
}

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

/** Ослабленная проверка встречной для chase-обгона. */
function outerClearForChaseOvertake(v, L) {
  const CD = chaseDriveCfg();
  const outer = outerLaneList();
  const testS = mod(v.s + v.len * 0.6, L);
  for (const o of outer) {
    if (o === v) continue;
    // Не блокировать из-за самой цели преследования
    if (o.kind === 'scalper' && v.targetScalperId != null && o.scalperId === v.targetScalperId) continue;
    const rel = mod(o.s - testS + L / 2, L) - L / 2;
    if (rel >= 0) {
      if (rel < (o.len + v.len) / 2 + CD.outerAheadPad) return false;
    } else {
      if (-rel < (o.len + v.len) / 2 + CD.outerBehindPad) return false;
    }
  }
  return true;
}

function isAssignedChaseTarget(gbr, other) {
  if (!gbr || !other || gbr.targetScalperId == null) return false;
  return other.kind === 'scalper' && other.scalperId === gbr.targetScalperId;
}

function canStartOvertake(v, leader, gapNow, F) {
  if (v.overtake || v.overtakeCommitted) return false;
  if (v.state !== 'drive') return false;
  if (v.kind !== 'car' && v.kind !== 'gbr') return false;
  if (!leader) return false;

  if (isChasePriorityGbr(v)) {
    // Цель преследования не обгоняем — к ней сближаемся
    if (isAssignedChaseTarget(v, leader)) return false;
    const CD = chaseDriveCfg();
    if (gapNow <= CD.gapMin) return false;
    if (gapNow >= CD.overtakeTrigger) return false;
    // Любой более медленный гражданский — обгон
    if (leader.v >= v.maxV * 0.95 && leader.maxV >= v.maxV - 2) return false;
    if (outerClearForChaseOvertake(v, Road.length)) return true;
    // Плотный поток / уже на outer: форсировать обгон при блокировке
    return gapNow < 40 && leader.v < v.maxV * 0.9;
  }

  if (v.maxV <= leader.maxV + 8) return false;
  if (gapNow >= F.overtakeTrigger || gapNow <= F.gapMin) return false;
  if (leader.v >= v.maxV * 0.72) return false;
  if (!outerClearForOvertake(v, Road.length)) return false;
  if (v.kind === 'gbr') return true;
  return Math.random() < CONFIG.overtake.chance;
}

function overtakeDuration(v, F) {
  if (isChasePriorityGbr(v)) return chaseDriveCfg().overtakeDur;
  return F.overtakeDur;
}

function followGapMin(v, F) {
  if (isChasePriorityGbr(v)) return chaseDriveCfg().gapMin;
  return F.gapMin;
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
    const dur = overtakeDuration(v, F);
    if (v.overtake) {
      v.overtakeT += dt;
      const chase = isChasePriorityGbr(v);
      // Chase: быстрее выход / pass / возврат в полосу
      const tOut = chase ? 0.28 : 0.4;
      const tPass = chase ? 0.55 : 0.7;
      if (v.overtake === 'out') {
        targetSteer = -0.22;
        v.latOff = lerp(0, -lw * 0.85, smooth(clamp01(v.overtakeT / (dur * tOut))));
        if (v.overtakeT >= dur * tOut) v.overtake = 'pass';
      } else if (v.overtake === 'pass') {
        targetSteer = -0.12;
        v.latOff = -lw * 0.85;
        // Chase: вернуться сразу, как только обогнали лидера по s
        let passDone = v.overtakeT >= dur * tPass;
        if (chase && leader) {
          const ahead = mod(v.s - leader.s, L);
          if (ahead > (leader.len + v.len) / 2 + 4 && ahead < L / 2) passDone = true;
        } else if (chase && !leader) {
          passDone = true;
        }
        if (passDone) {
          v.overtake = 'in';
          if (chase) v.overtakeT = dur * tPass;
        }
      } else if (v.overtake === 'in') {
        const t = clamp01((v.overtakeT - dur * tPass) / (dur * (1 - tPass)));
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

    const gapMin = followGapMin(v, F);
    let vt;
    if (v.percGap <= gapMin && !v.overtake) {
      // Chase: не стоять в потоке — тянуться к обгону на минимальной скорости
      vt = isChasePriorityGbr(v) ? Math.min(v.maxV * 0.35, Math.max(8, leadV + 4)) : 0;
    } else if (v.overtake) vt = v.maxV;
    else vt = Math.min(v.maxV, Math.max(0, v.percLV) + (v.percGap - gapMin) * F.gapK);
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
      if (isChasePriorityGbr(v) && !isAssignedChaseTarget(v, leader)) {
        // Гражданских можно «поджимать» — обгон стартует отдельно
        if (g < -2) {
          v.s = mod(leader.s - (leader.len + v.len) / 2 + 2, L);
          v.v = Math.max(v.v, leader.v + 6);
        }
      } else if (g < 0) {
        v.s = mod(leader.s - (leader.len + v.len) / 2, L);
        v.v = Math.min(v.v, leader.v);
      }
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

export { baseVehicle, findForwardLeader, outerClearForOvertake, canStartOvertake,
  updateLane, laneGapFree, crossed, isChasePriorityGbr };
