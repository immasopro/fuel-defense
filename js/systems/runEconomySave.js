/** Снапшот денег/бонусов активного раунда — v0.4.2.1 */

import { Game } from '../core/gameState.js';

const KEY = 'fd_run_economy';
const RESUME_KEY = 'fd_run_resume';

function normalizeBonuses() {
  if (Game.bonuses == null || !Number.isFinite(Game.bonuses)) Game.bonuses = 0;
  Game.bonuses = Math.max(0, Math.round(Game.bonuses));
  return Game.bonuses;
}

export function saveRunEconomy() {
  if (Game.state !== 'play') return;
  normalizeBonuses();
  try {
    localStorage.setItem(KEY, JSON.stringify({
      mode: Game.mode,
      levelIdx: Game.levelIdx,
      money: Game.money,
      bonuses: Game.bonuses,
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

/** Восстановить money/bonuses из снапшота того же mode/level. */
export function tryRestoreRunEconomy() {
  const data = readRunEconomy();
  if (!data) return false;
  if (data.mode !== Game.mode || +data.levelIdx !== +Game.levelIdx) return false;
  Game.money = data.money;
  Game.bonuses = Math.max(0, Math.round(data.bonuses));
  return true;
}
