import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { Depot } from '../world/map.js';

function distributeDepotFuel(dt) {
  const requesters = Road.slots.filter(s => s.station && s.station.res < s.station.cap - 0.5);
  if (!requesters.length || Game.depot.res <= 0) return;
  const totalRate = Depot.deliveryRate();
  const perSt = totalRate / requesters.length;
  for (const slot of requesters) {
    const st = slot.station;
    const amt = Math.min(perSt * dt, Game.depot.res, st.cap - st.res);
    if (amt > 0) { st.res += amt; Game.depot.res -= amt; }
  }
}

function refillCanisterReserve(st, dt) {
  if (!st.canisterUp) return;
  if (st.canCd > 0) { st.canCd -= dt; return; }
  if (st.canRes >= st.canCap - 0.01) return;
  const amt = Math.min(CONFIG.canisterReserve.refillRate * dt, st.canCap - st.canRes, st.res);
  if (amt > 0) { st.canRes += amt; st.res -= amt; }
}

export { distributeDepotFuel, refillCanisterReserve };
