import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { fmtRub } from '../core/currency.js';
import { Road } from '../world/roadNetwork.js';
import { hitDepot, hitStationTank, hitGBRBase, Depot, GBRBase } from '../world/map.js';
import {
  resUpgradeCost, pumpUpgradeCost, fuelUnlockCost, addPumpCost,
  tankerTruckUpgradeCost, fleetUpgradeCost, gbrBaseUpgradeCost,
  actionBuyGbrAutoCall, actionUpgradeGbrBase,
  applyBuildStation, applyUpgradeReservoir, applyUpgradePump, applyUnlockFuel,
  applyAddPump, applyBuyCanisterReserve, applyUpgradeDepot,
  applyUpgradeTankerTruck, applyUpgradeFleet, canAffordUpgrade
} from '../systems/upgradeSystem.js';
import { tankerDeliveryCost, tankerTruckCapacity } from '../systems/economySystem.js';
import { gbrPatrolSpeed, gbrCallCost, gbrFleetPanelLines } from '../systems/gbrLogistics.js';
import { quoteFuelOrder } from '../systems/fuelOrderSystem.js';
import { requestUpgradePurchase } from './upgradePaymentMenu.js';
import { UI } from './hud.js';

function canPayStation(c) {
  return c != null && canAffordUpgrade(c);
}
function canPayDepot(c) {
  return c != null && canAffordUpgrade(c);
}
function canPayCash(c) {
  return c != null && Game.money >= c;
}

function handleTap(clientX, clientY) {
  if (Game.state !== 'play') return;
  const rect = UI.cv.getBoundingClientRect();
  const lx = (clientX - rect.left - UI.ox) / UI.scale;
  const ly = (clientY - rect.top - UI.oy) / UI.scale;

  if (hitDepot(lx, ly)) {
    Game.depotLabel = CONFIG.ui.tankLabelTime;
    openDepotPanel();
    return;
  }

  if (hitGBRBase(lx, ly)) {
    openGbrBasePanel();
    return;
  }

  let tankHit = null;
  for (const slot of Road.slots) {
    if (slot.station && hitStationTank(slot, lx, ly)) {
      tankHit = slot;
      Game.tankLabels[slot.i] = CONFIG.ui.tankLabelTime;
    }
  }

  let best = null, bd = CONFIG.ui.tapRadius;
  for (const slot of Road.slots) {
    if (tankHit === slot) continue;
    const d = Math.hypot(slot.pos.x - lx, slot.pos.y - ly);
    if (d < bd) { bd = d; best = slot; }
  }
  if (best) {
    if (best.station) openStationPanel(best, null);
    else openBuildPanel(best);
  } else if (!tankHit && !hitDepot(lx, ly) && !hitGBRBase(lx, ly)) {
    closePanel();
  }
}

function openDepotPanel() {
  UI.panelRef = { type: 'depot' };
  const uc = Depot.upgradeCost();
  const tuc = tankerTruckUpgradeCost();
  const fuc = fleetUpgradeCost();
  let html = '<div class="p-title">Нефтебаза · ур. ' + Game.depot.level + '</div>';
  html += '<div class="p-info">Запас: <b><span id="p-depot-res">' + Math.round(Game.depot.res) +
    '</span> / ' + Game.depot.cap + ' л</b><br>Отдача: <b>' + Math.round(Depot.deliveryRate()) +
    ' л/с</b> (делится между АЗС)<br>Рейс (100%): <b><span id="p-next-delivery">' +
    fmtRub(quoteFuelOrder(100).cost) + '</span></b> · ' + tankerTruckCapacity() + ' л</div>';
  if (uc != null) {
    html += '<div class="p-row"><button class="p-btn" data-act="depot-up"' +
      (!canPayDepot(uc) ? ' disabled' : '') + '>⬆ Нефтебаза<span class="cost">' + fmtRub(uc) +
      ' → ' + CONFIG.depot.levels[Game.depot.level] + ' л</span></button></div>';
  }
  html += '<div class="p-info">Бензовоз · ур. ' + Game.tankerTruck.level + ' · ' +
    tankerTruckCapacity() + ' л/рейс</div>';
  if (tuc != null) {
    html += '<div class="p-row"><button class="p-btn" data-act="tanker-up"' +
      (!canPayDepot(tuc) ? ' disabled' : '') + '>⬆ Бензовоз<span class="cost">' + fmtRub(tuc) +
      ' → ' + CONFIG.tankerTruck.levels[Game.tankerTruck.level] + ' л</span></button></div>';
  }
  html += '<div class="p-info">Автопарк · ' + CONFIG.fleet.maxCount[Game.fleet.level - 1] + ' маш.</div>';
  if (fuc != null) {
    html += '<div class="p-row"><button class="p-btn" data-act="fleet-up"' +
      (!canPayDepot(fuc) ? ' disabled' : '') + '>⬆ Автопарк<span class="cost">' + fmtRub(fuc) +
      ' → ' + CONFIG.fleet.maxCount[Game.fleet.level] + ' маш.</span></button></div>';
  }
  html += '<button class="p-btn ghost" data-act="close">Закрыть</button>';
  UI.panel.innerHTML = html;
  UI.panel.classList.remove('hidden');
}

function openGbrBasePanel() {
  UI.panelRef = { type: 'gbr' };
  const uc = gbrBaseUpgradeCost();
  let html = '<div class="p-title">База ГБР · ур. ' + Game.gbrBase.level + '</div>';
  html += '<div class="p-info">Автопарк: <b>' + Game.gbrBase.level + ' / 10</b> маш.<br>' +
    'Скорость: <b>' + gbrPatrolSpeed() + ' px/с</b><br>' +
    'Следующий вызов: <b><span id="p-gbr-cost">' + fmtRub(gbrCallCost()) + '</span></b></div>';
  html += '<div class="p-fleet" id="p-gbr-fleet">';
  for (const line of gbrFleetPanelLines()) {
    html += '<div class="p-fleet-line">' + line + '</div>';
  }
  html += '</div>';
  if (uc != null) {
    html += '<div class="p-row"><button class="p-btn" data-act="gbr-up"' +
      (Game.money < uc ? ' disabled' : '') + '>⬆ Расширить автопарк<span class="cost">' + fmtRub(uc) +
      ' → ' + (Game.gbrBase.level + 1) + ' маш.</span></button></div>';
  } else {
    html += '<div class="p-info">Максимальный уровень базы</div>';
  }
  html += '<button class="p-btn ghost" data-act="close">Закрыть</button>';
  UI.panel.innerHTML = html;
  UI.panel.classList.remove('hidden');
}

function openBuildPanel(slot) {
  UI.panelRef = { type: 'build', slot };
  let html = '<div class="p-title">Построить АЗС</div>' +
    '<div class="p-info">Выберите исходный вид топлива. Остальные можно открыть позже.</div><div class="p-row">';
  for (const key of Object.keys(CONFIG.fuels)) {
    const f = CONFIG.fuels[key];
    const can = canPayStation(CONFIG.station.cost);
    html += '<button class="p-btn fuel-btn" data-act="build" data-fuel="' + key +
      '" style="--c:' + f.color + '"' + (can ? '' : ' disabled') + '>' + f.name +
      '<span class="cost">' + fmtRub(CONFIG.station.cost) + '</span></button>';
  }
  html += '</div><button class="p-btn ghost" data-act="close">Отмена</button>';
  UI.panel.innerHTML = html;
  UI.panel.classList.remove('hidden');
}

function openStationPanel(slot, sub) {
  UI.panelRef = { type: 'station', slot, sub: sub || null };
  const st = slot.station;
  const names = st.unlocked.map(k => CONFIG.fuels[k].short).join(' / ');
  let html = '<div class="p-title">АЗС · ' + names + '</div>';
  if (st.pumps.some(p => p.blocked))
    html += '<div class="p-alert">🚫 Колонка заблокирована перекупом! Вызовите ГБР</div>';
  html += '<div class="p-info">Резервуар: <b><span id="p-res">' + Math.round(st.res) +
    '</span> / ' + st.cap + ' л</b> (ур. ' + st.resLevel + '/5) · Колонок: <b>' +
    st.pumps.length + '/' + CONFIG.pump.maxPerStation + '</b>';
  if (st.canisterUp) html += '<br>Канистры: <b><span id="p-can">' + Math.round(st.canRes) +
    '</span> / ' + st.canCap + ' л</b>' + (st.canCd > 0 ? ' ⏳' + Math.ceil(st.canCd) + 'с' : '');
  html += '<br>Обслужено: <b><span id="p-served">' + st.served + '</span></b></div>';

  if (!sub) {
    const rc = resUpgradeCost(st);
    const fc = fuelUnlockCost(st);
    const ac = addPumpCost(st);
    html += '<div class="p-grid">';
    html += '<button class="p-btn" data-act="res"' +
      (rc == null || !canPayStation(rc) ? ' disabled' : '') + '>🛢 Увеличить резервуар<span class="cost">' +
      (rc == null ? 'MAX' : fmtRub(rc)) + '</span></button>';
    html += '<button class="p-btn" data-act="sub" data-sub="pump">⚡ Улучшить колонку<span class="cost">выбрать…</span></button>';
    html += '<button class="p-btn" data-act="sub" data-sub="fuel"' +
      (fc == null ? ' disabled' : '') + '>🔓 Разблокировать топливо<span class="cost">' +
      (fc == null ? 'все открыты' : 'от ' + fmtRub(fc)) + '</span></button>';
    html += '<button class="p-btn" data-act="sub" data-sub="add"' +
      (ac == null ? ' disabled' : '') + '>➕ Добавить колонку<span class="cost">' +
      (ac == null ? 'MAX' : fmtRub(ac)) + '</span></button>';
    const cc = CONFIG.canisterReserve.cost;
    html += '<button class="p-btn" data-act="canres"' +
      (st.canisterUp || !canPayStation(cc) ? ' disabled' : '') + '>🧴 Резерв канистр<span class="cost">' +
      (st.canisterUp ? 'куплено' : fmtRub(cc)) + '</span></button>';

    const gac = CONFIG.gbrAutoCall.cost;
    if (st.gbrAutoCall) {
      html += '<div class="p-info" style="margin-top:6px"><b>Охрана</b><br>Статус: Подключена<br>Автовызов: ' +
        '<button class="p-btn small" data-act="gbr-auto-on"' + (st.gbrAutoCallOn ? ' disabled' : '') + '>ВКЛ</button>' +
        '<button class="p-btn small" data-act="gbr-auto-off"' + (!st.gbrAutoCallOn ? ' disabled' : '') + '>ВЫКЛ</button></div>';
    } else {
      html += '<button class="p-btn" data-act="gbr-auto"' +
        (!canPayCash(gac) ? ' disabled' : '') + '>🚓 Автовызов ГБР<span class="cost">' + fmtRub(gac) + '</span></button>';
    }
    html += '</div>';
  } else if (sub === 'pump') {
    html += '<div class="p-info">Каждая колонка прокачивается отдельно (скорость заправки).</div>';
    st.pumps.forEach((pump, j) => {
      const f = CONFIG.fuels[pump.fuel];
      const c = pumpUpgradeCost(pump);
      html += '<div class="p-row"><button class="p-btn" data-act="uppump" data-j="' + j + '"' +
        (c == null || !canPayStation(c) ? ' disabled' : '') +
        ' style="border-left:4px solid ' + f.color + '">Колонка ' + (j + 1) + ' · ' + f.short +
        ' · ур.' + pump.level + '/5 · ' + pump.rate + ' л/с<span class="cost">' +
        (c == null ? 'MAX' : fmtRub(c) + ' → ' + CONFIG.pump.rates[pump.level] + ' л/с') +
        '</span></button></div>';
    });
    html += '<button class="p-btn ghost" data-act="back">← Назад</button>';
  } else if (sub === 'fuel') {
    const fc = fuelUnlockCost(st);
    html += '<div class="p-info">Новое топливо позволит строить колонки этого типа.<br>Каждая следующая разблокировка дороже.</div><div class="p-row">';
    for (const key of Object.keys(CONFIG.fuels)) {
      if (st.unlocked.includes(key)) continue;
      const f = CONFIG.fuels[key];
      html += '<button class="p-btn fuel-btn" data-act="unlock" data-fuel="' + key +
        '" style="--c:' + f.color + '"' + (fc == null || !canPayStation(fc) ? ' disabled' : '') +
        '>' + f.name + '<span class="cost">' + fmtRub(fc) + '</span></button>';
    }
    html += '</div><button class="p-btn ghost" data-act="back">← Назад</button>';
  } else if (sub === 'add') {
    const ac = addPumpCost(st);
    html += '<div class="p-info">Топливо новой колонки (доступны только открытые виды):</div><div class="p-row">';
    for (const key of st.unlocked) {
      const f = CONFIG.fuels[key];
      html += '<button class="p-btn fuel-btn" data-act="addpump" data-fuel="' + key +
        '" style="--c:' + f.color + '"' + (ac == null || !canPayStation(ac) ? ' disabled' : '') +
        '>' + f.name + '<span class="cost">' + fmtRub(ac) + '</span></button>';
    }
    html += '</div><button class="p-btn ghost" data-act="back">← Назад</button>';
  }
  html += '<button class="p-btn ghost" data-act="close">Закрыть</button>';
  UI.panel.innerHTML = html;
  UI.panel.classList.remove('hidden');
}

function closePanel() {
  UI.panelRef = null;
  if (UI.panel) UI.panel.classList.add('hidden');
}

function updatePanelLive() {
  if (!UI.panelRef) return;
  if (UI.panelRef.type === 'depot') {
    const res = UI.panel.querySelector('#p-depot-res');
    const next = UI.panel.querySelector('#p-next-delivery');
    if (res) res.textContent = Math.round(Game.depot.res);
    if (next) next.textContent = fmtRub(tankerDeliveryCost());
    return;
  }
  if (UI.panelRef.type === 'gbr') {
    const cost = UI.panel.querySelector('#p-gbr-cost');
    if (cost) cost.textContent = fmtRub(gbrCallCost());
    const fleet = UI.panel.querySelector('#p-gbr-fleet');
    if (fleet) {
      fleet.innerHTML = gbrFleetPanelLines()
        .map(line => '<div class="p-fleet-line">' + line + '</div>')
        .join('');
    }
    return;
  }
  if (UI.panelRef.type !== 'station') return;
  const st = UI.panelRef.slot.station;
  if (!st) { closePanel(); return; }
  const res = UI.panel.querySelector('#p-res');
  const served = UI.panel.querySelector('#p-served');
  const can = UI.panel.querySelector('#p-can');
  if (res) res.textContent = Math.round(st.res);
  if (served) served.textContent = st.served;
  if (can) can.textContent = Math.round(st.canRes);
}

function buyWithBonusDialog(cost, floatPos, onApply) {
  if (cost == null || !canAffordUpgrade(cost)) return;
  requestUpgradePurchase({ cost, floatPos, onApply });
}

function handlePanelAction(ds) {
  const ref = UI.panelRef;
  if (!ref) return;
  if (ds.act === 'close') { closePanel(); return; }
  if (ref.type === 'gbr') {
    if (ds.act === 'gbr-up' && actionUpgradeGbrBase()) openGbrBasePanel();
    return;
  }
  if (ref.type === 'depot') {
    if (ds.act === 'depot-up') {
      const c = Depot.upgradeCost();
      buyWithBonusDialog(c, { x: Depot.pos.x, y: Depot.pos.y - 30 }, () => {
        if (!applyUpgradeDepot()) return false;
        openDepotPanel();
        return true;
      });
    } else if (ds.act === 'tanker-up') {
      const c = tankerTruckUpgradeCost();
      buyWithBonusDialog(c, { x: Depot.pos.x, y: Depot.pos.y - 30 }, () => {
        if (!applyUpgradeTankerTruck()) return false;
        openDepotPanel();
        return true;
      });
    } else if (ds.act === 'fleet-up') {
      const c = fleetUpgradeCost();
      buyWithBonusDialog(c, { x: Depot.pos.x, y: Depot.pos.y - 30 }, () => {
        if (!applyUpgradeFleet()) return false;
        openDepotPanel();
        return true;
      });
    }
    return;
  }
  if (ref.type === 'build') {
    if (ds.act === 'build') {
      const slot = ref.slot;
      buyWithBonusDialog(CONFIG.station.cost, { x: slot.pos.x, y: slot.pos.y - 18 }, () => {
        if (!applyBuildStation(slot, ds.fuel)) return false;
        closePanel();
        return true;
      });
    }
    return;
  }
  if (ref.type !== 'station') return;
  const slot = ref.slot, st = slot.station;
  if (!st) { closePanel(); return; }
  const pos = { x: st.slot.pos.x, y: st.slot.pos.y - 18 };
  switch (ds.act) {
    case 'back': openStationPanel(slot, null); break;
    case 'sub': openStationPanel(slot, ds.sub); break;
    case 'res':
      buyWithBonusDialog(resUpgradeCost(st), pos, () => {
        if (!applyUpgradeReservoir(st)) return false;
        openStationPanel(slot, null);
        return true;
      });
      break;
    case 'uppump':
      buyWithBonusDialog(pumpUpgradeCost(st.pumps[+ds.j]), pos, () => {
        if (!applyUpgradePump(st, +ds.j)) return false;
        openStationPanel(slot, 'pump');
        return true;
      });
      break;
    case 'unlock':
      buyWithBonusDialog(fuelUnlockCost(st), pos, () => {
        if (!applyUnlockFuel(st, ds.fuel)) return false;
        openStationPanel(slot, null);
        return true;
      });
      break;
    case 'addpump':
      buyWithBonusDialog(addPumpCost(st), pos, () => {
        if (!applyAddPump(st, ds.fuel)) return false;
        openStationPanel(slot, null);
        return true;
      });
      break;
    case 'canres':
      buyWithBonusDialog(CONFIG.canisterReserve.cost, pos, () => {
        if (!applyBuyCanisterReserve(st)) return false;
        openStationPanel(slot, null);
        return true;
      });
      break;
    case 'gbr-auto': if (actionBuyGbrAutoCall(st)) openStationPanel(slot, null); break;
    case 'gbr-auto-on': st.gbrAutoCallOn = true; openStationPanel(slot, null); break;
    case 'gbr-auto-off': st.gbrAutoCallOn = false; openStationPanel(slot, null); break;
  }
}

export { openDepotPanel, openGbrBasePanel, openBuildPanel, openStationPanel, closePanel,
  updatePanelLive, handlePanelAction, handleTap };
