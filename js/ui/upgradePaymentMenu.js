/** Окно оплаты улучшения бонусами/деньгами — v0.4.2.4 (макс. 99% бонусами) */

import { Game } from '../core/gameState.js';
import { fmtRub, fmtRubDelta } from '../core/currency.js';
import {
  maxBonusForUpgrade, minCashForUpgrade, payUpgrade, ensureBonusBalance
} from '../systems/fuelOrderSystem.js';
import { addFloat } from '../systems/economySystem.js';
import { updateHUD } from './hud.js';

const CASH_FLOOR_MSG = 'Минимум 1% стоимости нужно оплатить деньгами';

let pending = null;
let bonusSpend = 0;
let els = null;

function ensureEls() {
  if (els) return els;
  els = {
    root: document.getElementById('upgrade-pay'),
    dim: document.getElementById('upgrade-pay-dim'),
    slider: document.getElementById('upgrade-pay-slider'),
    total: document.getElementById('upgrade-pay-total'),
    bonus: document.getElementById('upgrade-pay-bonus'),
    bonusPct: document.getElementById('upgrade-pay-bonus-pct'),
    cash: document.getElementById('upgrade-pay-cash'),
    cashPct: document.getElementById('upgrade-pay-cash-pct'),
    err: document.getElementById('upgrade-pay-error'),
    confirm: document.getElementById('upgrade-pay-confirm'),
    close: document.getElementById('upgrade-pay-close'),
    cancel: document.getElementById('upgrade-pay-cancel')
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

function splitQuote(cost, spend) {
  const maxB = maxBonusForUpgrade(cost);
  const bonus = Math.max(0, Math.min(Math.round(spend), maxB));
  const cash = cost - bonus;
  const minCash = minCashForUpgrade(cost);
  const bonusPct = cost > 0 ? Math.round(bonus * 100 / cost) : 0;
  const cashPct = cost > 0 ? Math.max(0, 100 - bonusPct) : 0;
  return { maxB, bonus, cash, minCash, bonusPct, cashPct };
}

function affordError(cost, cash) {
  const minCash = minCashForUpgrade(cost);
  if (Game.money < cash && cash <= minCash) return CASH_FLOOR_MSG;
  if (Game.money < minCash) return CASH_FLOOR_MSG;
  if (Game.money < cash) return 'Недостаточно средств';
  return null;
}

function refreshQuote() {
  const e = ensureEls();
  if (!pending || !e.root) return;
  const cost = pending.cost;
  const q = splitQuote(cost, bonusSpend);
  bonusSpend = q.bonus;
  if (e.total) e.total.textContent = fmtRub(cost);
  if (e.bonus) e.bonus.textContent = q.bonus.toLocaleString('ru-RU');
  if (e.bonusPct) e.bonusPct.textContent = q.bonusPct + '%';
  if (e.cash) e.cash.textContent = fmtRub(q.cash);
  if (e.cashPct) e.cashPct.textContent = q.cashPct + '%';
  if (e.slider) {
    e.slider.max = String(q.maxB);
    e.slider.value = String(q.bonus);
    e.slider.disabled = q.maxB <= 0;
  }
  const err = affordError(cost, q.cash);
  if (e.confirm) e.confirm.disabled = !!err;
  if (err) showError(err);
  else hideError();
}

export function isUpgradePaymentOpen() {
  const e = ensureEls().root;
  return !!(e && !e.classList.contains('hidden'));
}

export function closeUpgradePayment() {
  const e = ensureEls();
  if (e.root) e.root.classList.add('hidden');
  if (e.dim) e.dim.classList.add('hidden');
  hideError();
  pending = null;
  bonusSpend = 0;
}

/**
 * @param {{ cost: number, title?: string, floatPos?: {x:number,y:number}, onApply: () => boolean|void }} opts
 * onApply вызывается после успешной оплаты; должен применить улучшение.
 */
export function openUpgradePayment(opts) {
  ensureBonusBalance();
  const cost = Math.round(opts.cost);
  if (!(cost > 0)) return false;
  pending = {
    cost,
    floatPos: opts.floatPos || null,
    onApply: opts.onApply
  };
  // По умолчанию — максимум доступных бонусов (≤ 99%)
  bonusSpend = maxBonusForUpgrade(cost);
  const e = ensureEls();
  if (!e.root) return false;
  hideError();
  e.root.classList.remove('hidden');
  if (e.dim) e.dim.classList.remove('hidden');
  refreshQuote();
  return true;
}

export function confirmUpgradePayment() {
  if (!pending) return false;
  const cost = pending.cost;
  const q = splitQuote(cost, bonusSpend);
  const err = affordError(cost, q.cash);
  if (err) {
    showError(err);
    return false;
  }
  const pay = payUpgrade(cost, q.bonus);
  if (!pay.ok) {
    showError(affordError(cost, cost - Math.min(q.bonus, maxBonusForUpgrade(cost))) || 'Недостаточно средств');
    return false;
  }
  const applyOk = pending.onApply ? pending.onApply() : true;
  if (applyOk === false) {
    Game.money += pay.cash;
    Game.bonuses += pay.bonus;
    showError('Не удалось применить улучшение');
    return false;
  }
  if (pending.floatPos) {
    addFloat(
      pending.floatPos.x, pending.floatPos.y,
      fmtRubDelta(-pay.cash) + (pay.bonus ? ' +' + pay.bonus + ' б.' : ''),
      '#ef5350'
    );
  }
  closeUpgradePayment();
  updateHUD();
  return true;
}

/**
 * Если есть бонусы — открыть окно оплаты; иначе оплатить сразу деньгами (0 бонусов).
 * @returns {'dialog'|'paid'|'blocked'}
 */
export function requestUpgradePurchase(opts) {
  ensureBonusBalance();
  const cost = Math.round(opts.cost);
  if (!(cost > 0)) return 'blocked';
  if (Game.bonuses > 0) {
    openUpgradePayment(opts);
    return 'dialog';
  }
  const minCash = minCashForUpgrade(cost);
  if (Game.money < cost || Game.money < minCash) return 'blocked';
  const pay = payUpgrade(cost, 0);
  if (!pay.ok) return 'blocked';
  const applyOk = opts.onApply ? opts.onApply() : true;
  if (applyOk === false) {
    Game.money += pay.cash;
    return 'blocked';
  }
  if (opts.floatPos) {
    addFloat(opts.floatPos.x, opts.floatPos.y, fmtRubDelta(-pay.cash), '#ef5350');
  }
  updateHUD();
  return 'paid';
}

export function initUpgradePaymentUi() {
  const e = ensureEls();
  if (!e.root || e.root.dataset.bound) return;
  e.root.dataset.bound = '1';
  if (e.slider) {
    e.slider.addEventListener('input', () => {
      bonusSpend = Math.round(+e.slider.value) || 0;
      hideError();
      refreshQuote();
    });
  }
  if (e.confirm) {
    e.confirm.addEventListener('click', ev => {
      ev.preventDefault();
      confirmUpgradePayment();
    });
  }
  const close = () => { closeUpgradePayment(); };
  if (e.close) e.close.addEventListener('click', ev => { ev.preventDefault(); close(); });
  if (e.cancel) e.cancel.addEventListener('click', ev => { ev.preventDefault(); close(); });
  if (e.dim) e.dim.addEventListener('click', ev => { ev.preventDefault(); close(); });
}

export function _setBonusSpendForTest(n) {
  bonusSpend = Math.round(n) || 0;
  refreshQuote();
}

export { CASH_FLOOR_MSG };
