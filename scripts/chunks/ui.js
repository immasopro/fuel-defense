const UI = {};   // ссылки на DOM, canvas, панель — заполняется в boot()

function bindTap(el, fn) {
  // touchend + preventDefault: без 300мс-задержки и без "призрачного" click
  el.addEventListener('touchend', e => { e.preventDefault(); fn(e); }, { passive: false });
  el.addEventListener('click', e => fn(e));
}

function getUnlocked() {
  try { return clamp(parseInt(localStorage.getItem('fd_unlocked')) || 1, 1, CONFIG.levels.length); }
  catch (e) { return 1; }
}
function setUnlocked(n) {
  try { localStorage.setItem('fd_unlocked', String(n)); } catch (e) { }
}

function resize() {
  const rect = UI.stage.getBoundingClientRect();
  UI.cssW = Math.max(1, rect.width);
  UI.cssH = Math.max(1, rect.height);
  UI.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  UI.cv.width = Math.round(UI.cssW * UI.dpr);
  UI.cv.height = Math.round(UI.cssH * UI.dpr);
  UI.scale = Math.min(UI.cssW / UI.LW, UI.cssH / UI.LH);
  UI.ox = (UI.cssW - UI.LW * UI.scale) / 2;
  UI.oy = (UI.cssH - UI.LH * UI.scale) / 2;
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
  } else if (!tankHit && !hitDepot(lx, ly)) {
    closePanel();
  }
}

/* ---------- панели ---------- */
function openDepotPanel() {
  UI.panelRef = { type: 'depot' };
  const uc = Depot.upgradeCost();
  let html = '<div class="p-title">Нефтебаза · ур. ' + Game.depot.level + '</div>';
  html += '<div class="p-info">Запас: <b>' + Math.round(Game.depot.res) + ' / ' + Game.depot.cap +
    ' л</b><br>Отдача: <b>' + Math.round(Depot.deliveryRate()) + ' л/с</b> (делится между АЗС)</div>';
  if (uc != null) {
    html += '<div class="p-row"><button class="p-btn" data-act="depot-up"' +
      (Game.money < uc ? ' disabled' : '') + '>⬆ Улучшить нефтебазу<span class="cost">$' + uc +
      ' → ' + CONFIG.depot.levels[Game.depot.level] + ' л</span></button></div>';
  } else {
    html += '<div class="p-info">Максимальный уровень</div>';
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
    const can = Game.money >= CONFIG.station.cost;
    html += '<button class="p-btn fuel-btn" data-act="build" data-fuel="' + key +
      '" style="--c:' + f.color + '"' + (can ? '' : ' disabled') + '>' + f.name +
      '<span class="cost">$' + CONFIG.station.cost + '</span></button>';
  }
  html += '</div><button class="p-btn ghost" data-act="close">Отмена</button>';
  UI.panel.innerHTML = html;
  UI.panel.classList.remove('hidden');
}

/* Панель АЗС: 4 ветки прокачки + подменю (раздел 9) */
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
    // четыре основные кнопки
    const rc = resUpgradeCost(st);
    const fc = fuelUnlockCost(st);
    const ac = addPumpCost(st);
    html += '<div class="p-grid">';
    html += '<button class="p-btn" data-act="res"' +
      (rc == null || Game.money < rc ? ' disabled' : '') + '>🛢 Увеличить резервуар<span class="cost">' +
      (rc == null ? 'MAX' : '$' + rc) + '</span></button>';
    html += '<button class="p-btn" data-act="sub" data-sub="pump">⚡ Улучшить колонку<span class="cost">выбрать…</span></button>';
    html += '<button class="p-btn" data-act="sub" data-sub="fuel"' +
      (fc == null ? ' disabled' : '') + '>🔓 Разблокировать топливо<span class="cost">' +
      (fc == null ? 'все открыты' : 'от $' + fc) + '</span></button>';
    html += '<button class="p-btn" data-act="sub" data-sub="add"' +
      (ac == null ? ' disabled' : '') + '>➕ Добавить колонку<span class="cost">' +
      (ac == null ? 'MAX' : '$' + ac) + '</span></button>';
  const cc = CONFIG.canisterReserve.cost;
  html += '<button class="p-btn" data-act="canres"' +
    (st.canisterUp || Game.money < cc ? ' disabled' : '') + '>🧴 Резерв канистр<span class="cost">' +
    (st.canisterUp ? 'куплено' : '$' + cc) + '</span></button>';
    html += '</div>';
  } else if (sub === 'pump') {
    // индивидуальная прокачка каждой колонки
    html += '<div class="p-info">Каждая колонка прокачивается отдельно (скорость заправки).</div>';
    st.pumps.forEach((pump, j) => {
      const f = CONFIG.fuels[pump.fuel];
      const c = pumpUpgradeCost(pump);
      html += '<div class="p-row"><button class="p-btn" data-act="uppump" data-j="' + j + '"' +
        (c == null || Game.money < c ? ' disabled' : '') +
        ' style="border-left:4px solid ' + f.color + '">Колонка ' + (j + 1) + ' · ' + f.short +
        ' · ур.' + pump.level + '/5 · ' + pump.rate + ' л/с<span class="cost">' +
        (c == null ? 'MAX' : '$' + c + ' → ' + CONFIG.pump.rates[pump.level] + ' л/с') +
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
        '" style="--c:' + f.color + '"' + (fc == null || Game.money < fc ? ' disabled' : '') +
        '>' + f.name + '<span class="cost">$' + fc + '</span></button>';
    }
    html += '</div><button class="p-btn ghost" data-act="back">← Назад</button>';
  } else if (sub === 'add') {
    // подменю выбора топлива для новой колонки — только открытые виды
    const ac = addPumpCost(st);
    html += '<div class="p-info">Топливо новой колонки (доступны только открытые виды):</div><div class="p-row">';
    for (const key of st.unlocked) {
      const f = CONFIG.fuels[key];
      html += '<button class="p-btn fuel-btn" data-act="addpump" data-fuel="' + key +
        '" style="--c:' + f.color + '"' + (ac == null || Game.money < ac ? ' disabled' : '') +
        '>' + f.name + '<span class="cost">$' + ac + '</span></button>';
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

function updatePanelLive() {   // живое обновление цифр в открытой панели
  if (!UI.panelRef || UI.panelRef.type !== 'station') return;
  const st = UI.panelRef.slot.station;
  if (!st) { closePanel(); return; }
  const res = UI.panel.querySelector('#p-res');
  const served = UI.panel.querySelector('#p-served');
  const can = UI.panel.querySelector('#p-can');
  if (res) res.textContent = Math.round(st.res);
  if (served) served.textContent = st.served;
  if (can) can.textContent = Math.round(st.canRes);
}

function handlePanelAction(ds) {
  const ref = UI.panelRef;
  if (!ref) return;
  if (ds.act === 'close') { closePanel(); return; }
  if (ref.type === 'depot') {
    if (ds.act === 'depot-up' && actionUpgradeDepot()) openDepotPanel();
    return;
  }
  if (ref.type === 'build') {
    if (ds.act === 'build' && actionBuildStation(ref.slot, ds.fuel)) closePanel();
    return;
  }
  if (ref.type !== 'station') return;
  const slot = ref.slot, st = slot.station;
  if (!st) { closePanel(); return; }
  switch (ds.act) {
    case 'back': openStationPanel(slot, null); break;
    case 'sub': openStationPanel(slot, ds.sub); break;
    case 'res': if (actionUpgradeReservoir(st)) openStationPanel(slot, null); break;
    case 'uppump': if (actionUpgradePump(st, +ds.j)) openStationPanel(slot, 'pump'); break;
    case 'unlock': if (actionUnlockFuel(st, ds.fuel)) openStationPanel(slot, null); break;
    case 'addpump': if (actionAddPump(st, ds.fuel)) openStationPanel(slot, null); break;
    case 'canres': if (actionBuyCanisterReserve(st)) openStationPanel(slot, null); break;
  }
}

/* ---------- HUD ---------- */
function updateHUD() {
  UI.statMoney.textContent = '💰 $' + Game.money;
  if (Game.state === 'play') {
    UI.statTime.textContent = '⏱ ' + (Game.mode === 'endless'
      ? fmtTime(Game.time)
      : fmtTime(Game.modeCfg.duration - Game.time));
  } else {
    UI.statTime.textContent = '⏱ —';
  }

  const inner = innerLaneList();
  const stopped = inner.filter(v => v.v < 8).length;
  const holdN = Game.holder.length;
  let txt, col;
  if (Game.defeatT > 0.5) { txt = 'КРИТИЧНО'; col = '#ef5350'; }
  else if (holdN >= CONFIG.holder.max) { txt = 'Накопитель полон'; col = '#ef5350'; }
  else if (stopped >= 6) { txt = 'ПРОБКА'; col = '#ef5350'; }
  else if (stopped >= 3) { txt = 'Плотно'; col = '#ffb300'; }
  else { txt = 'Свободно'; col = '#8bc34a'; }
  UI.statTraffic.textContent = '🚗 ' + inner.length + '+' + holdN + ' · ' + txt;
  UI.statTraffic.style.color = col;

  // бензовоз
  const T = Game.tanker;
  if (T.unit) {
    UI.btnTanker.disabled = true;
    const inHold = Game.holder.includes(T.unit);
    UI.tankerSub.textContent = inHold ? 'в накопителе' : Math.round(T.unit.load) + ' л · в пути';
  }
  else if (T.cd > 0) { UI.btnTanker.disabled = true; UI.tankerSub.textContent = '⏳ ' + Math.ceil(T.cd) + 'с'; }
  else if (Game.money < CONFIG.tanker.cost) { UI.btnTanker.disabled = true; UI.tankerSub.textContent = 'нужно $' + CONFIG.tanker.cost; }
  else { UI.btnTanker.disabled = Game.state !== 'play'; UI.tankerSub.textContent = '$' + CONFIG.tanker.cost; }

  // ГБР
  const G = Game.gbr;
  const hasScalper = !!Game.scalper.unit;
  if (G.unit) { UI.btnGbr.disabled = true; UI.gbrSub.textContent = 'в пути…'; }
  else if (G.cd > 0) { UI.btnGbr.disabled = true; UI.gbrSub.textContent = '⏳ ' + Math.ceil(G.cd) + 'с'; }
  else if (!hasScalper) { UI.btnGbr.disabled = true; UI.gbrSub.textContent = 'нет перекупа'; }
  else { UI.btnGbr.disabled = Game.state !== 'play'; UI.gbrSub.textContent = 'преследовать!'; }

  const Lt = Game.light;
  if (!isLightGreen()) {
    UI.btnLight.disabled = true;
    UI.btnLight.classList.add('red-mode');
    UI.lightSub.textContent = Lt.redT > 0 ? '🔴 ' + Math.ceil(Lt.redT) + 'с' : '—';
  } else if (Lt.cd > 0) {
    UI.btnLight.disabled = true;
    UI.btnLight.classList.remove('red-mode');
    UI.lightSub.textContent = '⏳ ' + Math.ceil(Lt.cd) + 'с';
  } else {
    UI.btnLight.disabled = Game.state !== 'play';
    UI.btnLight.classList.remove('red-mode');
    UI.lightSub.textContent = 'стоп 10с';
  }
}

/* ---------- меню ---------- */
function renderMenu() {
  const unlocked = getUnlocked();
  let html = '';
  for (let i = 1; i <= CONFIG.levels.length; i++) {
    const locked = i > unlocked;
    html += '<button class="lvl-btn" data-lvl="' + i + '"' + (locked ? ' disabled' : '') + '>' +
      (locked ? '🔒' : i) + '</button>';
  }
  UI.levelRow.innerHTML = html;
}

function showMenu() {
  Game.state = 'menu';
  renderMenu();
  UI.screenEnd.classList.add('hidden');
  UI.screenStart.classList.remove('hidden');
}
