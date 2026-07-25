/** Меню заказа бензовоза — не ставит игру на паузу (v0.4.1) */

import { Game } from '../core/gameState.js';
import { fmtRub } from '../core/currency.js';
import { quoteFuelOrder, canAffordFuelOrder, normalizeOrderPercent } from '../systems/fuelOrderSystem.js';
import { callTanker } from '../systems/spawnSystem.js';
import { canDispatchTanker } from '../systems/tankerLogistics.js';
import { sortedStationSlots } from '../world/map.js';

let orderPercent = 100;
let els = null;

function ensureEls() {
  if (els) return els;
  els = {
    root: document.getElementById('tanker-order'),
    dim: document.getElementById('tanker-order-dim'),
    slider: document.getElementById('tanker-order-slider'),
    pct: document.getElementById('tanker-order-pct'),
    liters: document.getElementById('tanker-order-liters'),
    price: document.getElementById('tanker-order-price'),
    cost: document.getElementById('tanker-order-cost'),
    cashback: document.getElementById('tanker-order-cashback'),
    bonuses: document.getElementById('tanker-order-bonuses'),
    err: document.getElementById('tanker-order-error'),
    confirm: document.getElementById('tanker-order-confirm'),
    close: document.getElementById('tanker-order-close')
  };
  return els;
}

function hideError() {
  const e = ensureEls().err;
  if (e) {
    e.textContent = '';
    e.classList.add('hidden');
  }
}

function showError(msg) {
  const e = ensureEls().err;
  if (!e) return;
  e.textContent = msg;
  e.classList.remove('hidden');
}

export function refreshTankerOrderQuote() {
  const e = ensureEls();
  if (!e.root || e.root.classList.contains('hidden')) return;
  const q = quoteFuelOrder(orderPercent);
  if (e.pct) e.pct.textContent = q.percent + '%';
  if (e.liters) e.liters.textContent = q.liters + ' л';
  if (e.price) e.price.textContent = q.pricePerLiter + ' ₽/л';
  if (e.cost) e.cost.textContent = fmtRub(q.cost);
  if (e.cashback) e.cashback.textContent = q.cashbackPct + '%';
  if (e.bonuses) e.bonuses.textContent = fmtRub(q.bonuses).replace('₽', '').trim() + ' бонусов';
  if (e.slider && +e.slider.value !== q.percent) e.slider.value = String(q.percent);
}

export function isTankerOrderOpen() {
  const e = ensureEls().root;
  return !!(e && !e.classList.contains('hidden'));
}

export function openTankerOrderMenu() {
  if (Game.state !== 'play') return false;
  if (!canDispatchTanker()) return false;
  if (!sortedStationSlots().length) return false;
  orderPercent = 100;
  const e = ensureEls();
  if (!e.root) return false;
  if (e.slider) e.slider.value = '100';
  hideError();
  e.root.classList.remove('hidden');
  if (e.dim) e.dim.classList.remove('hidden');
  refreshTankerOrderQuote();
  return true;
}

export function closeTankerOrderMenu() {
  const e = ensureEls();
  if (e.root) e.root.classList.add('hidden');
  if (e.dim) e.dim.classList.add('hidden');
  hideError();
}

export function confirmTankerOrder() {
  const q = quoteFuelOrder(orderPercent);
  if (!canDispatchTanker()) {
    showError('Бензовоз недоступен');
    return false;
  }
  if (!canAffordFuelOrder(q)) {
    showError('Недостаточно средств для закупки');
    return false;
  }
  const ok = callTanker({
    liters: q.liters,
    cost: q.cost,
    bonuses: q.bonuses,
    percent: q.percent
  });
  if (!ok) {
    showError('Не удалось вызвать бензовоз');
    return false;
  }
  closeTankerOrderMenu();
  return true;
}

export function initTankerOrderUi() {
  const e = ensureEls();
  if (!e.root || e.root.dataset.bound) return;
  e.root.dataset.bound = '1';
  if (e.slider) {
    e.slider.addEventListener('input', () => {
      orderPercent = normalizeOrderPercent(+e.slider.value);
      hideError();
      refreshTankerOrderQuote();
    });
  }
  if (e.confirm) {
    e.confirm.addEventListener('click', ev => {
      ev.preventDefault();
      confirmTankerOrder();
    });
  }
  if (e.close) {
    e.close.addEventListener('click', ev => {
      ev.preventDefault();
      closeTankerOrderMenu();
    });
  }
  if (e.dim) {
    e.dim.addEventListener('click', ev => {
      ev.preventDefault();
      closeTankerOrderMenu();
    });
  }
}

export function _setOrderPercentForTest(pct) {
  orderPercent = normalizeOrderPercent(pct);
}
