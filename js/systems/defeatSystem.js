import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { fmtTime } from '../core/utils.js';
import { fmtRub } from '../core/currency.js';
import { getTargetCars } from './spawnSystem.js';
import { canOrderTanker } from './economySystem.js';
import { hasActiveTankerDelivery, hasReadyTanker } from './tankerLogistics.js';
import { sortedStationSlots } from '../world/map.js';
import { innerLaneList, spawnClear, isLightGreen } from './trafficSystem.js';
import { closePanel } from '../ui/stationPanel.js';
import { UI, getUnlocked, setUnlocked } from '../ui/hud.js';

function hasWaitingClients() {
  if (Game.stats.served < getTargetCars()) return true;
  for (const v of Game.holder) {
    if (v.kind === 'car' && !v.served) return true;
  }
  for (const v of Game.vehicles) {
    if (v.kind === 'car' && !v.served) return true;
  }
  if (Game.prepared && !Game.prepared.ready) return true;
  return false;
}

function isFuelExhausted() {
  if (Game.depot.res > 0.01) return false;
  const slots = sortedStationSlots();
  if (!slots.length) return false;
  for (const slot of slots) {
    if (slot.station && slot.station.res > 0.01) return false;
  }
  return true;
}

function isTankerCreditBlocked() {
  if (hasActiveTankerDelivery()) return false;
  if (!sortedStationSlots().length) return true;
  if (hasReadyTanker()) return !canOrderTanker();
  const hasQueued = Game.logistics?.trucks.some(t =>
    t.state === 'PREPARING' || t.state === 'WAIT_PREPARING');
  if (hasQueued) return !canOrderTanker();
  return !canOrderTanker();
}

function checkFuelCrisis() {
  if (Game.state !== 'play') return false;
  if (!hasWaitingClients()) return false;
  if (!isFuelExhausted()) return false;
  if (!isTankerCreditBlocked()) return false;
  endGame(false, 'fuel_crisis');
  return true;
}

function updateDefeatTimer(dt) {
  if (!isLightGreen()) { Game.defeatT = 0; return; }
  if (Game.holder.length < CONFIG.holder.max) { Game.defeatT = 0; return; }
  const first = Game.holder[0];
  if (!first || first.countsForDefeat === false) { Game.defeatT = 0; return; }
  if (spawnClear(innerLaneList(), first.len)) { Game.defeatT = 0; return; }
  Game.defeatT += dt;
  if (Game.defeatT >= CONFIG.defeatTime) { endGame(false, 'traffic'); return true; }
  return false;
}

function endGame(win, reason) {
  const defeatReason = reason || (win ? 'win' : 'traffic');
  Game.state = win ? 'win' : 'over';
  Game.defeatReason = defeatReason;
  closePanel();
  UI.warning.classList.add('hidden');
  const endless = Game.mode === 'endless';
  const target = getTargetCars();

  if (defeatReason === 'bankruptcy') {
    UI.endTitle.textContent = '💥 ИГРА ОКОНЧЕНА';
    UI.endTitle.style.color = '#ef5350';
    UI.endDesc.textContent =
      'Вы завершили уровень, но не смогли рассчитаться за закупленное топливо.';
  } else if (defeatReason === 'fuel_crisis') {
    UI.endTitle.textContent = '💥 ИГРА ОКОНЧЕНА';
    UI.endTitle.style.color = '#ef5350';
    UI.endDesc.textContent = 'Вы не смогли заправить все автомобили.';
    if (UI.btnRestart) UI.btnRestart.textContent = 'Начать заново';
    if (UI.btnMenu) UI.btnMenu.textContent = 'Главное меню';
  } else {
    if (UI.btnRestart) UI.btnRestart.textContent = 'ЕЩЁ РАЗ';
    if (UI.btnMenu) UI.btnMenu.textContent = 'В МЕНЮ';
    UI.endTitle.textContent = win ? '🏆 ПОБЕДА!' : '💥 ИГРА ОКОНЧЕНА';
    UI.endTitle.style.color = win ? '#8bc34a' : '#ef5350';
    UI.endDesc.textContent = win
      ? (endless
        ? 'Уровень ' + Game.levelIdx + ' пройден — обслужено ' + target + ' машин!'
        : 'Уровень ' + Game.levelIdx + ' пройден — обслужено ' + target + ' машин!')
      : (endless
        ? 'Накопитель переполнен — пробка не рассеялась за ' + CONFIG.defeatTime + 'с. Обслужено ' +
          Game.stats.served + ' / ' + target + '.'
        : 'Накопитель переполнен, и въезд остался заблокирован ' + CONFIG.defeatTime +
          ' секунд.');
  }

  UI.endStats.innerHTML =
    '⏱ Время: <b>' + fmtTime(Game.time) + '</b><br>' +
    '⛽ Обслужено машин: <b>' + Game.stats.served + ' / ' + target + '</b><br>' +
    '🛢 Отпущено топлива: <b>' + Math.round(Game.stats.liters) + ' л</b><br>' +
    '🚨 Украдено: <b>' + Math.round(Game.stats.stolenLiters) + ' л</b><br>' +
    '💰 Заработано: <b>' + fmtRub(Game.stats.earned) + '</b><br>' +
    '💳 Баланс: <b>' + fmtRub(Game.money) + '</b>';

  if (win && defeatReason !== 'bankruptcy') {
    if (Game.mode === 'campaign' && Game.levelIdx < CONFIG.levels.length) {
      setUnlocked(Math.max(getUnlocked(), Game.levelIdx + 1));
      UI.btnNext.textContent = 'Уровень ' + (Game.levelIdx + 1);
      UI.btnNext.classList.remove('hidden');
    } else if (Game.mode === 'campaign' && Game.levelIdx === CONFIG.levels.length) {
      UI.btnNext.textContent = '∞ Бесконечный режим';
      UI.btnNext.classList.remove('hidden');
    } else if (Game.mode === 'endless') {
      UI.btnNext.textContent = 'Уровень ' + (Game.levelIdx + 1);
      UI.btnNext.classList.remove('hidden');
    } else {
      UI.btnNext.classList.add('hidden');
    }
  } else {
    UI.btnNext.classList.add('hidden');
  }
  UI.screenEnd.classList.remove('hidden');
}

export {
  updateDefeatTimer, endGame, checkFuelCrisis,
  hasWaitingClients, isFuelExhausted, isTankerCreditBlocked
};
