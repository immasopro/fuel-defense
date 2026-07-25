/** Меню бонусного счёта + аварийный обмен — v0.4.2.1 */

import { Game } from '../core/gameState.js';
import { fmtRub } from '../core/currency.js';
import { ensureBonusBalance } from '../systems/fuelOrderSystem.js';
import {
  getExchangeRate, listExchangePacks, exchangeBonusPack, getExchangePack, canExchangePack
} from '../systems/bonusExchange.js';
import { saveRunEconomy } from '../systems/runEconomySave.js';
import { updateHUD } from './hud.js';

let pendingPackId = null;
let els = null;

function ensureEls() {
  if (els) return els;
  els = {
    root: document.getElementById('bonus-account'),
    dim: document.getElementById('bonus-account-dim'),
    bal: document.getElementById('bonus-account-bal'),
    packs: document.getElementById('bonus-account-packs'),
    close: document.getElementById('bonus-account-close'),
    confirm: document.getElementById('bonus-exchange-confirm'),
    confirmDim: document.getElementById('bonus-exchange-confirm-dim'),
    spend: document.getElementById('bonus-exchange-spend'),
    gain: document.getElementById('bonus-exchange-gain'),
    rate: document.getElementById('bonus-exchange-rate'),
    yes: document.getElementById('bonus-exchange-yes'),
    no: document.getElementById('bonus-exchange-no'),
    err: document.getElementById('bonus-account-error')
  };
  return els;
}

function fmtBonuses(n) {
  return Math.round(n || 0).toLocaleString('ru-RU');
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

function renderPacks() {
  const e = ensureEls();
  if (!e.packs) return;
  ensureBonusBalance();
  if (e.bal) e.bal.textContent = fmtBonuses(Game.bonuses);
  const packs = listExchangePacks();
  let html = '';
  for (const p of packs) {
    html += '<button type="button" class="bonus-pack-btn' + (p.available ? '' : ' locked') +
      '" data-pack="' + p.id + '"' + (p.available ? '' : ' disabled') + '>' +
      '<span class="bonus-pack-label">' + p.label + '</span>' +
      '<span class="bonus-pack-line">' + fmtBonuses(p.bonuses) + ' бонусов → ' + fmtRub(p.money) + '</span>' +
      '</button>';
  }
  e.packs.innerHTML = html;
}

export function isBonusAccountOpen() {
  const e = ensureEls().root;
  return !!(e && !e.classList.contains('hidden'));
}

export function closeBonusAccount() {
  closeExchangeConfirm();
  const e = ensureEls();
  if (e.root) e.root.classList.add('hidden');
  if (e.dim) e.dim.classList.add('hidden');
  hideError();
}

export function openBonusAccount() {
  if (Game.state !== 'play') return false;
  const e = ensureEls();
  if (!e.root) return false;
  hideError();
  closeExchangeConfirm();
  e.root.classList.remove('hidden');
  if (e.dim) e.dim.classList.remove('hidden');
  renderPacks();
  return true;
}

function closeExchangeConfirm() {
  pendingPackId = null;
  const e = ensureEls();
  if (e.confirm) e.confirm.classList.add('hidden');
  if (e.confirmDim) e.confirmDim.classList.add('hidden');
}

function openExchangeConfirm(packId) {
  const pack = getExchangePack(packId);
  if (!pack || !canExchangePack(pack)) return;
  pendingPackId = packId;
  const e = ensureEls();
  if (e.spend) e.spend.textContent = fmtBonuses(pack.bonuses) + ' бонусов';
  if (e.gain) e.gain.textContent = fmtRub(pack.money);
  if (e.rate) e.rate.textContent = getExchangeRate() + ':1';
  if (e.confirm) e.confirm.classList.remove('hidden');
  if (e.confirmDim) e.confirmDim.classList.remove('hidden');
}

function confirmExchange() {
  if (!pendingPackId) return false;
  const result = exchangeBonusPack(pendingPackId);
  if (!result.ok) {
    showError(result.error === 'insufficient_bonuses'
      ? 'Недостаточно бонусов'
      : 'Обмен не выполнен');
    closeExchangeConfirm();
    renderPacks();
    return false;
  }
  saveRunEconomy();
  updateHUD();
  closeExchangeConfirm();
  renderPacks();
  return true;
}

export function initBonusAccountUi(bindTap) {
  const e = ensureEls();
  if (!e.root || e.root.dataset.bound) return;
  e.root.dataset.bound = '1';

  if (e.packs) {
    e.packs.addEventListener('click', ev => {
      const btn = ev.target.closest ? ev.target.closest('[data-pack]') : null;
      if (!btn || btn.disabled) return;
      ev.preventDefault();
      hideError();
      openExchangeConfirm(btn.dataset.pack);
    });
  }
  if (e.close) {
    e.close.addEventListener('click', ev => { ev.preventDefault(); closeBonusAccount(); });
  }
  if (e.dim) {
    e.dim.addEventListener('click', ev => { ev.preventDefault(); closeBonusAccount(); });
  }
  if (e.yes) {
    e.yes.addEventListener('click', ev => { ev.preventDefault(); confirmExchange(); });
  }
  if (e.no) {
    e.no.addEventListener('click', ev => { ev.preventDefault(); closeExchangeConfirm(); });
  }
  if (e.confirmDim) {
    e.confirmDim.addEventListener('click', ev => { ev.preventDefault(); closeExchangeConfirm(); });
  }

  const hudBonus = document.getElementById('stat-bonuses');
  if (hudBonus && bindTap) {
    hudBonus.classList.add('stat-bonus-clickable');
    hudBonus.title = 'Бонусный счёт';
    bindTap(hudBonus, () => {
      if (Game.state === 'play') openBonusAccount();
    });
  }
}
