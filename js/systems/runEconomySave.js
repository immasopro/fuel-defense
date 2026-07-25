/** Снапшот прогресса активного раунда — v0.4.2.3 (деньги, бонусы, spawned/served) */

import { Game } from '../core/gameState.js';

const KEY = 'fd_run_economy';
const RESUME_KEY = 'fd_run_resume';

function normalizeBonuses() {
  if (Game.bonuses == null || !Number.isFinite(Game.bonuses)) Game.bonuses = 0;
  Game.bonuses = Math.max(0, Math.round(Game.bonuses));
  return Game.bonuses;
}

function normalizeSpawnStats() {
  if (!Game.stats) Game.stats = { served: 0, spawned: 0, earned: 0, liters: 0, stolenLiters: 0, stolenDamage: 0 };
  if (!Number.isFinite(Game.stats.spawned) || Game.stats.spawned < 0) Game.stats.spawned = 0;
  if (!Number.isFinite(Game.stats.served) || Game.stats.served < 0) Game.stats.served = 0;
  Game.stats.spawned = Math.round(Game.stats.spawned);
  Game.stats.served = Math.round(Game.stats.served);
}

export function saveRunEconomy() {
  if (Game.state !== 'play') return;
  normalizeBonuses();
  normalizeSpawnStats();
  try {
    localStorage.setItem(KEY, JSON.stringify({
      mode: Game.mode,
      levelIdx: Game.levelIdx,
      money: Game.money,
      bonuses: Game.bonuses,
      spawned: Game.stats.spawned,
      served: Game.stats.served,
      savedAt: Date.now()
    }));
  } catch (e) { /* ignore */ }
}

export function clearRunEconomy() {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(RESUME_KEY);
  } catch (e) { /* ignore */ }
}

export function readRunEconomy() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (!Number.isFinite(data.money) || !Number.isFinite(data.bonuses)) return null;
    return data;
  } catch (e) {
    return null;
  }
}

/** Пометить, что при следующем запуске нужно восстановить раунд. */
export function markResumePending() {
  if (Game.state !== 'play') return;
  saveRunEconomy();
  try { localStorage.setItem(RESUME_KEY, '1'); } catch (e) { /* ignore */ }
}

export function consumeResumePending() {
  try {
    if (localStorage.getItem(RESUME_KEY) !== '1') return null;
    localStorage.removeItem(RESUME_KEY);
    return readRunEconomy();
  } catch (e) {
    return null;
  }
}

/** Восстановить money/bonuses/spawned/served из снапшота того же mode/level. */
export function tryRestoreRunEconomy() {
  const data = readRunEconomy();
  if (!data) return false;
  if (data.mode !== Game.mode || +data.levelIdx !== +Game.levelIdx) return false;
  Game.money = data.money;
  Game.bonuses = Math.max(0, Math.round(data.bonuses));
  if (!Game.stats) Game.stats = { served: 0, spawned: 0, earned: 0, liters: 0, stolenLiters: 0, stolenDamage: 0 };
  if (Number.isFinite(data.spawned) && data.spawned >= 0) {
    Game.stats.spawned = Math.round(data.spawned);
  }
  if (Number.isFinite(data.served) && data.served >= 0) {
    Game.stats.served = Math.round(data.served);
  }
  return true;
}
