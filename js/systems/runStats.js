/**
 * Per-level run statistics ledger (v0.4.4.1).
 * Fed by spawn / economy / upgrade / pursuit hooks; shown on end screen.
 */
import { Game } from '../core/gameState.js';

function blankRunStats() {
  return {
    scalpersSpawned: 0,
    scalpersArrested: 0,
    scalpersEscaped: 0,
    scalpersWanted: 0,
    upgradesBought: 0,
    upgradeSpendCash: 0,
    upgradeSpendBonus: 0,
    fuelOrders: 0,
    fuelBoughtLiters: 0,
    fuelBoughtCash: 0,
    gbrCalls: 0,
    gbrSpendCash: 0,
    peakVehiclesOnRing: 0
  };
}

function ensureRunStats() {
  if (!Game.runStats) Game.runStats = blankRunStats();
  return Game.runStats;
}

function resetRunStats() {
  Game.runStats = blankRunStats();
}

function noteScalperSpawned() {
  ensureRunStats().scalpersSpawned++;
}

function noteScalperWanted() {
  ensureRunStats().scalpersWanted++;
}

function noteScalperArrested() {
  ensureRunStats().scalpersArrested++;
}

function noteScalperEscaped() {
  ensureRunStats().scalpersEscaped++;
}

function noteUpgradePurchase(cash, bonus) {
  const s = ensureRunStats();
  s.upgradesBought++;
  s.upgradeSpendCash += Math.max(0, Math.round(cash || 0));
  s.upgradeSpendBonus += Math.max(0, Math.round(bonus || 0));
}

function noteFuelOrder(liters, cost) {
  const s = ensureRunStats();
  s.fuelOrders++;
  s.fuelBoughtLiters += Math.max(0, Math.round(liters || 0));
  s.fuelBoughtCash += Math.max(0, Math.round(cost || 0));
}

function noteGbrCall(cost) {
  const s = ensureRunStats();
  s.gbrCalls++;
  s.gbrSpendCash += Math.max(0, Math.round(cost || 0));
}

function noteRingPopulation(n) {
  const s = ensureRunStats();
  if (n > s.peakVehiclesOnRing) s.peakVehiclesOnRing = n;
}

function formatExtendedStatsHtml() {
  const s = ensureRunStats();
  const st = Game.stats || {};
  const lines = [
    '<div class="end-ext-block"><b>Перекупы</b><br>' +
      'Заспавнено: <b>' + s.scalpersSpawned + '</b><br>' +
      'Раскрыто (wanted): <b>' + s.scalpersWanted + '</b><br>' +
      'Поймано: <b>' + s.scalpersArrested + '</b><br>' +
      'Ушло / сбежало: <b>' + s.scalpersEscaped + '</b></div>',
    '<div class="end-ext-block"><b>Улучшения</b><br>' +
      'Куплено: <b>' + s.upgradesBought + '</b><br>' +
      'Потрачено ₽: <b>' + s.upgradeSpendCash + '</b><br>' +
      'Потрачено бонусов: <b>' + s.upgradeSpendBonus + '</b></div>',
    '<div class="end-ext-block"><b>Топливо</b><br>' +
      'Заказов бензовоза: <b>' + s.fuelOrders + '</b><br>' +
      'Закуплено: <b>' + s.fuelBoughtLiters + ' л</b><br>' +
      'На закупку: <b>' + s.fuelBoughtCash + ' ₽</b><br>' +
      'Отпущено клиентам: <b>' + Math.round(st.liters || 0) + ' л</b><br>' +
      'Украдено: <b>' + Math.round(st.stolenLiters || 0) + ' л</b></div>',
    '<div class="end-ext-block"><b>ГБР и поток</b><br>' +
      'Вызовов ГБР: <b>' + s.gbrCalls + '</b><br>' +
      'На ГБР: <b>' + s.gbrSpendCash + ' ₽</b><br>' +
      'Пик машин на кольце: <b>' + s.peakVehiclesOnRing + '</b><br>' +
      'Spawned / served: <b>' + (st.spawned || 0) + ' / ' + (st.served || 0) + '</b></div>'
  ];
  return lines.join('');
}

export {
  blankRunStats, ensureRunStats, resetRunStats,
  noteScalperSpawned, noteScalperWanted, noteScalperArrested, noteScalperEscaped,
  noteUpgradePurchase, noteFuelOrder, noteGbrCall, noteRingPopulation,
  formatExtendedStatsHtml
};
