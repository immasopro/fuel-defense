/**
 * Multi-Scalper registry (v0.4.4.1).
 * Budget (spawned) is the only cap — any number of live Scalpers allowed.
 */
import { Game } from '../core/gameState.js';
import { ScalperPhase } from './entityFsm.js';

function ensureRegistry() {
  if (!Game.scalper) Game.scalper = { unit: null, units: [] };
  if (!Array.isArray(Game.scalper.units)) Game.scalper.units = [];
  return Game.scalper;
}

/** Compat: first live unit (tests / legacy). */
function syncCompatUnit() {
  const reg = ensureRegistry();
  const live = reg.units.find(sc => sc && sc.scalperPhase !== ScalperPhase.DESPAWN);
  reg.unit = live || null;
  return reg.unit;
}

function registerScalper(sc) {
  const reg = ensureRegistry();
  if (!reg.units.includes(sc)) reg.units.push(sc);
  syncCompatUnit();
}

function unregisterScalper(sc) {
  const reg = ensureRegistry();
  reg.units = reg.units.filter(u => u !== sc);
  if (reg.unit === sc) reg.unit = null;
  syncCompatUnit();
}

function liveScalpers() {
  const reg = ensureRegistry();
  // Drop despawned ghosts from registry
  reg.units = reg.units.filter(sc =>
    sc && sc.scalperPhase !== ScalperPhase.DESPAWN &&
    (Game.vehicles.includes(sc) || Game.holder.includes(sc) ||
      Game.holderPriorityWait === sc || Game.prepared?.vehicle === sc)
  );
  syncCompatUnit();
  return reg.units.slice();
}

function liveScalperCount() {
  return liveScalpers().length;
}

function resetScalperRegistry() {
  Game.scalper = { unit: null, units: [] };
}

export {
  ensureRegistry, syncCompatUnit, registerScalper, unregisterScalper,
  liveScalpers, liveScalperCount, resetScalperRegistry
};
