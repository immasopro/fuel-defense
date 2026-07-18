import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';

export function initScalperEvolution() {
  Game.scalperEvolution = { notifiedTier: 0 };
}

/** Вместимость тары для новых перекупов на текущем уровне */
export function currentScalperMaxLiters() {
  const stolen = Game.stats?.stolenLiters || 0;
  const tier = Math.floor(stolen / CONFIG.scalper.evolutionStep);
  return CONFIG.scalper.baseMaxLiters + tier * CONFIG.scalper.evolutionBonus;
}

export function scalperEvolutionTier() {
  return Math.floor((Game.stats?.stolenLiters || 0) / CONFIG.scalper.evolutionStep);
}

function ensureToastEl() {
  let el = document.getElementById('scalper-evolution-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'scalper-evolution-toast';
    el.className = 'scalper-evolution-toast hidden';
    const stage = document.getElementById('stage');
    if (stage) stage.appendChild(el);
    else document.body.appendChild(el);
  }
  return el;
}

let toastTimer = null;

export function showScalperUpgradeToast(capacity) {
  if (typeof document === 'undefined') return;
  const el = ensureToastEl();
  el.innerHTML =
    '<div class="se-title">Перекупщики усилились!</div>' +
    '<div class="se-body">Теперь они используют тару объёмом <b>' + capacity + ' л</b>.</div>';
  el.classList.remove('hidden', 'fade-out');
  el.classList.add('fade-in');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('fade-in');
    el.classList.add('fade-out');
    setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('fade-out');
    }, 500);
  }, 4500);
}

/** Проверить порог после кражи; уведомление — один раз на тир */
export function checkScalperEvolutionThreshold() {
  const tier = scalperEvolutionTier();
  const evo = Game.scalperEvolution;
  if (!evo || tier <= evo.notifiedTier) return;
  evo.notifiedTier = tier;
  showScalperUpgradeToast(currentScalperMaxLiters());
}

export function _resetScalperEvolutionForTest() {
  if (Game.scalperEvolution) Game.scalperEvolution.notifiedTier = 0;
  if (typeof document !== 'undefined') {
    const el = document.getElementById('scalper-evolution-toast');
    if (el) el.classList.add('hidden');
  }
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
}
