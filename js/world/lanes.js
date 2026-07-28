/**
 * Multi-lane ring API (v0.4.4).
 * Lane 0 = service / innermost (+lat, АЗС).
 * Lane laneCount-1 = exit / outermost (−lat).
 * Spacing between adjacent lane centers = Road.laneW.
 */
import { CONFIG } from '../config/index.js';
import { Road } from './roadNetwork.js';

function laneCount() {
  return CONFIG.road.laneCount ?? 3;
}

function serviceLane() {
  return 0;
}

function exitLane() {
  return laneCount() - 1;
}

function clampLane(i) {
  const n = laneCount();
  return Math.max(0, Math.min(n - 1, i | 0));
}

/** Lateral offset of lane center from ring midline. */
function laneLat(i) {
  const n = laneCount();
  const idx = clampLane(i);
  const lw = Road.laneW || CONFIG.road.laneWidth || 15;
  return ((n - 1) / 2 - idx) * lw;
}

function roadStrokeWidth() {
  const n = laneCount();
  const lw = Road.laneW || CONFIG.road.laneWidth || 15;
  return n * lw + 8;
}

function isServiceLane(lane) {
  return clampLane(lane) === serviceLane();
}

function isExitLane(lane) {
  return clampLane(lane) === exitLane();
}

/** Normalize legacy string lanes. */
function normalizeLane(lane) {
  if (lane === 'inner') return serviceLane();
  if (lane === 'outer') return exitLane();
  if (typeof lane === 'number' && Number.isFinite(lane)) return clampLane(lane);
  return serviceLane();
}

function adjacentLanes(lane) {
  const i = clampLane(lane);
  const out = [];
  if (i > 0) out.push(i - 1);
  if (i < laneCount() - 1) out.push(i + 1);
  return out;
}

/** Lateral distance between two lane indices (centers). */
function laneSeparation(a, b) {
  return Math.abs(laneLat(a) - laneLat(b));
}

export {
  laneCount, serviceLane, exitLane, clampLane, laneLat, roadStrokeWidth,
  isServiceLane, isExitLane, normalizeLane, adjacentLanes, laneSeparation
};
