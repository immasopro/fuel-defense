import { CONFIG } from '../config/index.js';
import { Road, pumpPose } from './roadNetwork.js';
import { mod } from '../core/utils.js';
import { Game } from '../core/gameState.js';
import { serviceLane, exitLane, laneLat, laneCount } from './lanes.js';

const Depot = {
  pos: null, accessS: 0, unloadStopS: 0, unloadPose: null, routeToUnload: [],
  ringJoinS: 0, ringJoin: null, driveToDepot: [], driveFromDepot: [], branchWidth: 30,
  exitS: 0,
  init() {
    const cx = (Road.rect.x0 + Road.rect.x1) / 2;
    const cy = (Road.rect.y0 + Road.rect.y1) / 2;
    this.pos = { x: cx, y: cy };

    const spot7 = Road.slots[6];
    this.ringJoinS = mod(spot7.s + 34, Road.length);
    const ringJoin = Road.posAt(this.ringJoinS, laneLat(serviceLane()));
    this.ringJoin = { x: ringJoin.x, y: ringJoin.y, a: ringJoin.a };

    const unloadY = cy + 22;
    this.unloadStop = { x: cx, y: unloadY, a: Math.PI / 2 };
    this.unloadPose = { x: cx, y: unloadY, a: Math.PI / 2 };
    this.unloadStopS = this.ringJoinS;
    this.accessS = this.ringJoinS;
    this.exitS = Road.spawnS;
    this.branchWidth = Road.laneW * Math.max(2, laneCount());

    const midY = ringJoin.y + (unloadY - ringJoin.y) * 0.42;
    this.driveToDepot = [
      { x: ringJoin.x, y: ringJoin.y, a: Math.PI / 2 },
      { x: ringJoin.x, y: midY, a: Math.PI / 2 },
      { x: cx, y: unloadY - 32, a: Math.PI / 2 },
      { x: cx, y: unloadY, a: Math.PI / 2 }
    ];
    this.driveFromDepot = [
      { x: cx, y: unloadY, a: -Math.PI / 2 },
      { x: cx, y: unloadY - 32, a: -Math.PI / 2 },
      { x: ringJoin.x, y: midY, a: -Math.PI / 2 },
      { x: ringJoin.x, y: ringJoin.y, a: -Math.PI / 2 }
    ];
    this.routeToUnload = [];
  },
  cap() { return CONFIG.depot.levels[Game.depot.level - 1]; },
  deliveryRate() { return this.cap() * CONFIG.depot.deliveryFrac; },
  upgradeCost() {
    return Game.depot.level >= CONFIG.depot.levels.length ? null : CONFIG.depot.upgradeCosts[Game.depot.level - 1];
  }
};

const GBRBase = {
  pos: null, spawnS: 0,
  init() {
    // Прямо напротив точки въезда (середина противоположной стороны кольца).
    // Не привязывать к spot 4 — якорь только Road.spawnS.
    const L = Road.length;
    this.spawnS = mod(Road.spawnS + L * 0.5, L);
    this.pos = Road.posAt(this.spawnS, laneLat(exitLane()) * 0.9);
  }
};

function hitGBRBase(lx, ly) {
  if (!GBRBase.pos) return false;
  return Math.hypot(lx - GBRBase.pos.x, ly - GBRBase.pos.y) < 32;
}

/** Якорь компактного HUD резервуара (верхний левый угол апронa) */
function stationReservoirHud(slot, st) {
  const C = CONFIG.road;
  const n = st ? st.pumps.length : 1;
  const latMax = C.serviceLat + (n - 1) * C.pumpDepth + 9;
  const sA = slot.s - (C.queueGap * 3 + 16);
  const corner = Road.posAt(sA, latMax);
  const off = 10;
  return { x: corner.x - off, y: corner.y - off, w: 140, h: 24 };
}

function stationTankPos(slot) {
  return stationReservoirHud(slot, slot.station);
}

function hitStationTank(slot, lx, ly) {
  const st = slot.station;
  if (!st) return false;
  const hud = stationReservoirHud(slot, st);
  return lx >= hud.x && lx <= hud.x + hud.w && ly >= hud.y - 6 && ly <= hud.y + hud.h + 14;
}

function hitDepot(lx, ly) {
  if (!Depot.pos) return false;
  return Math.hypot(lx - Depot.pos.x, ly - Depot.pos.y) < 40;
}

function sortedStationSlots() {
  return Road.slots.filter(s => s.station);
}

function findFreePump(st) {
  for (let j = 0; j < st.pumps.length; j++) {
    const p = st.pumps[j];
    if (!p.blocked && !p.claimed && p.cars.length === 0) return j;
  }
  return -1;
}

export { Depot, GBRBase, hitGBRBase, stationTankPos, stationReservoirHud, hitStationTank, hitDepot,
  sortedStationSlots, findFreePump };
