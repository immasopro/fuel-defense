import { CONFIG } from '../config/index.js';
import { Game } from '../core/gameState.js';
import { GameVersion } from '../config/gameVersion.js';
import { Road } from '../world/roadNetwork.js';
import { Station } from '../stations/station.js';
import {
  drawVehicle, drawDepot, drawGBRBase, drawTrafficLightIndicator,
  drawSlot, roadPath, rr
} from './renderer.js';
import { COLORS } from '../config/constants.js';
import { makeCar, makeScalper, makeTanker, makeGBR } from '../vehicles/vehicleFactory.js';

import { resumeFromMenuAfterManual } from './gameMenu.js';

let built = false;

export function isManualOpen() {
  const el = document.getElementById('manual');
  return el && !el.classList.contains('hidden');
}

export function openManual(opts) {
  opts = opts || {};
  if (!opts.fromMenu && Game.state !== 'play') return;
  buildManualOnce();
  Game.paused = true;
  document.getElementById('manual').classList.remove('hidden');
  paintAllPreviews();
}

export function closeManual() {
  const el = document.getElementById('manual');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  if (Game.menuReturnAfterManual) {
    Game.menuReturnAfterManual = false;
    resumeFromMenuAfterManual();
    return;
  }
  if (Game.menuOpen) return;
  Game.paused = false;
}

export function toggleManual() {
  if (isManualOpen()) closeManual();
  else openManual();
}

function paintCanvas(canvas, drawFn) {
  if (!canvas) return;
  const w = canvas.clientWidth || 120;
  const h = canvas.clientHeight || 72;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawFn(ctx, w, h);
}

function carPreview(typeKey, fuelKey) {
  const v = makeCar(0);
  v.typeKey = typeKey;
  v.fuelKey = fuelKey;
  v.kind = 'car';
  v.len = CONFIG.carTypes[typeKey].len;
  v.w = CONFIG.carTypes[typeKey].w;
  return v;
}

function paintAllPreviews() {
  paintCanvas(document.getElementById('man-map'), (ctx, w, h) => {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    const sc = Math.min(w / Road.rect.x1, h / Road.rect.y1) * 0.88;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(sc, sc);
    ctx.translate(-(Road.rect.x0 + Road.rect.x1) / 2, -(Road.rect.y0 + Road.rect.y1) / 2);
    roadPath(ctx);
    ctx.lineWidth = Road.laneW * 2;
    ctx.strokeStyle = COLORS.road;
    ctx.stroke();
    const cx = (Road.rect.x0 + Road.rect.x1) / 2;
    const cy = (Road.rect.y0 + Road.rect.y1) / 2;
    drawDepot(ctx, cx, cy);
    ctx.restore();
  });

  paintCanvas(document.getElementById('man-entry'), (ctx, w, h) => {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    const sp = Road.posAt(Road.spawnS, 0);
    ctx.save();
    ctx.translate(w / 2 - sp.x * 0.35, h * 0.55 - sp.y * 0.35);
    ctx.scale(0.35, 0.35);
    ctx.fillStyle = COLORS.stub;
    ctx.fillRect(sp.x - 24, sp.y, 48, 120);
    drawTrafficLightIndicator(ctx, sp.x, sp.y + 4);
    ctx.fillStyle = '#ef5350';
    ctx.font = '800 20px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('5с', sp.x, sp.y + 70);
    ctx.restore();
  });

  ['sedan', 'suv', 'truck'].forEach((t, i) => {
    const fuel = t === 'truck' ? 'diesel' : (t === 'suv' ? 'a95' : 'a92');
    paintCanvas(document.getElementById('man-car-' + t), (ctx, w, h) => {
      ctx.fillStyle = '#1c222b';
      ctx.fillRect(0, 0, w, h);
      const v = carPreview(t, fuel);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 2);
      drawVehicle(ctx, v);
      ctx.restore();
    });
  });

  paintCanvas(document.getElementById('man-station'), (ctx, w, h) => {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    const st = new Station('a92');
    st.slot = Road.slots[0];
    const slot = { i: 0, s: Road.slots[0].s, station: st, pos: Road.slots[0].pos };
    ctx.save();
    ctx.translate(w / 2 - slot.pos.x, h / 2 - slot.pos.y);
    ctx.scale(0.55, 0.55);
    drawSlot(ctx, slot);
    ctx.restore();
  });

  paintCanvas(document.getElementById('man-depot'), (ctx, w, h) => {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);
    drawDepot(ctx, w / 2, h / 2 + 4);
  });

  paintCanvas(document.getElementById('man-tanker'), (ctx, w, h) => {
    ctx.fillStyle = '#1c222b';
    ctx.fillRect(0, 0, w, h);
    const v = makeTanker();
    v.load = v.capacity * 0.7;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 2);
    drawVehicle(ctx, v);
    ctx.restore();
  });

  paintCanvas(document.getElementById('man-scalper'), (ctx, w, h) => {
    ctx.fillStyle = '#1c222b';
    ctx.fillRect(0, 0, w, h);
    const v = makeScalper();
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 2);
    drawVehicle(ctx, v);
    ctx.restore();
  });

  paintCanvas(document.getElementById('man-gbr'), (ctx, w, h) => {
    ctx.fillStyle = '#1c222b';
    ctx.fillRect(0, 0, w, h);
    const v = makeGBR();
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 2);
    drawVehicle(ctx, v);
    ctx.restore();
    ctx.save();
    ctx.translate(w * 0.78, h * 0.3);
    ctx.scale(0.5, 0.5);
    drawGBRBase(ctx);
    ctx.restore();
  });

  paintCanvas(document.getElementById('man-can-red'), (ctx, w, h) => {
    ctx.fillStyle = '#1c222b';
    ctx.fillRect(0, 0, w, h);
    const v = carPreview('sedan', 'a92');
    v.canister = true;
    v.canisterColor = 'red';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    drawVehicle(ctx, v);
    ctx.restore();
  });

  paintCanvas(document.getElementById('man-can-green'), (ctx, w, h) => {
    ctx.fillStyle = '#1c222b';
    ctx.fillRect(0, 0, w, h);
    const v = carPreview('suv', 'a95');
    v.canister = true;
    v.canisterColor = 'green';
    ctx.save();
    ctx.translate(w / 2, h / 2);
    drawVehicle(ctx, v);
    ctx.restore();
  });
}

function section(title, bodyHtml) {
  return '<section class="man-sec"><h3>' + title + '</h3>' + bodyHtml + '</section>';
}

function buildManualOnce() {
  if (built) return;
  built = true;
  const root = document.getElementById('manual-body');
  if (!root) return;

  const upgrades = [
    ['Объём резервуара', 'Больше топлива на АЗС — меньше вызовов бензовоза.'],
    ['Скорость колонок', 'Быстрее заправка клиентов.'],
    ['Разблокировать топливо', 'АИ-92, АИ-95 или дизель для новых колонок.'],
    ['Добавить колонку', 'Ещё одна очередь на той же АЗС.']
  ];

  let html = '';
  html += section('Цель игры',
    '<div class="man-row"><canvas class="man-cv" id="man-map"></canvas>' +
    '<p>Обслуживайте поток машин на кольцевой дороге. Стройте АЗС, следите за нефтебазой и не допускайте переполнения накопителя у въезда.</p></div>');

  html += section('Поражение',
    '<div class="man-row"><canvas class="man-cv" id="man-entry"></canvas>' +
    '<p>Если накопитель перед въездом полон и машины не могут выехать на кольцо, начинается таймер поражения (~5 с). Остановите поток светофором или освободите кольцо.</p></div>');

  html += '<section class="man-sec"><h3>Автомобили</h3><div class="man-grid3">';
  html += '<div class="man-card"><canvas class="man-cv sm" id="man-car-sedan"></canvas><b>Sedan</b><span>' +
    CONFIG.fuels.a92.name + ' / ' + CONFIG.fuels.a95.name + '</span></div>';
  html += '<div class="man-card"><canvas class="man-cv sm" id="man-car-suv"></canvas><b>SUV</b><span>' +
    CONFIG.fuels.a92.name + ' / ' + CONFIG.fuels.a95.name + '</span></div>';
  html += '<div class="man-card"><canvas class="man-cv sm" id="man-car-truck"></canvas><b>Truck</b><span>только ' +
    CONFIG.fuels.diesel.name + '</span></div></div></section>';

  html += section('АЗС',
    '<div class="man-row"><canvas class="man-cv" id="man-station"></canvas>' +
    '<p>Тап по площадке — постройка и улучшения. До ' + CONFIG.station.maxPumps + ' колонок, карман ожидания, резервуар АЗС.</p></div>' +
    '<div class="man-upgrades">' + upgrades.map(([t, d]) =>
      '<div class="man-upg"><span class="man-upg-icon">⬆</span><div><b>' + t + '</b><p>' + d + '</p></div></div>'
    ).join('') + '</div>');

  html += section('Главный резервуар',
    '<div class="man-row"><canvas class="man-cv" id="man-depot"></canvas>' +
    '<p>Нефтебаза в центре карты. Питает все АЗС. Бензовоз сливает сюда остатки после объезда.</p></div>');

  html += section('Бензовоз',
    '<div class="man-row"><canvas class="man-cv" id="man-tanker"></canvas>' +
    '<p>Кнопка <span class="man-chip">🛢 Бензовоз</span> — вызывает машину с полным баком. Маршрутный лист по 7 спотам: заправляет пустые АЗС, затем сливает на нефтебазу.</p></div>');

  html += section('Перекуп',
    '<div class="man-row"><canvas class="man-cv" id="man-scalper"></canvas>' +
    '<p>Фиолетовый автомобиль объезжает АЗС и покупает топливо из резерва канистр, блокируя колонку. Может долго стоять в ожидании.</p></div>');

  html += section('ГБР',
    '<div class="man-row"><canvas class="man-cv wide" id="man-gbr"></canvas>' +
    '<p>Кнопка <span class="man-chip red">🚨 ГБР</span> — задерживает перекупа на АЗС (5 с), сопровождает при выезде. 20% шанс повторной попытки перекупа на следующей АЗС.</p></div>');

  html += '<section class="man-sec"><h3>Резерв канистр</h3><div class="man-grid2">' +
    '<div class="man-card"><canvas class="man-cv sm" id="man-can-red"></canvas><b>Красная · 10 л</b></div>' +
    '<div class="man-card"><canvas class="man-cv sm" id="man-can-green"></canvas><b>Зелёная · 20 л</b></div>' +
    '</div><p class="man-note">Улучшение «Резерв канистр» на АЗС — источник для перекупа. Клиенты с канистрами тоже используют этот резерв.</p></section>';

  html += section('Светофор',
    '<p>Кнопка <span class="man-chip green">🚦 Светофор</span> — красный на ' +
    CONFIG.trafficLight.redDur + ' с, блокирует въезд с накопителя. Перезарядка ' +
    CONFIG.trafficLight.cooldown + ' с. Сбрасывает таймер поражения.</p>');

  html += section('Экономика',
    '<p><span class="man-chip">💰</span> Доход за литры, проданные клиентам. Перекуп и канистры уменьшают баланс. Улучшения и постройки стоят денег.</p>');

  html += section('Полезные советы', '<ul class="man-tips">' +
    '<li>Следите за уровнем нефтебазы — без неё АЗС пустеют.</li>' +
    '<li>Несколько сильных АЗС лучше множества слабых.</li>' +
    '<li>Не откладывайте вызов бензовоза при пустых резервуарах.</li>' +
    '<li>Truck требуют только дизельную колонку.</li>' +
    '<li>Перекуп способен надолго заблокировать колонку — вызывайте ГБР.</li>' +
    '</ul>');

  root.innerHTML = html;

  const ver = document.getElementById('manual-version');
  const notes = document.getElementById('manual-changelog');
  if (ver) ver.textContent = 'Fuel Defense  Version ' + GameVersion.version;
  if (notes) {
    notes.innerHTML = '<b>Что нового</b><ul>' +
      GameVersion.changes.map(c => '<li>' + c + '</li>').join('') + '</ul>';
  }
}

export function initManualUi(bindTap) {
  buildManualOnce();
  const btn = document.getElementById('btn-help');
  const close = document.getElementById('manual-close');
  const backdrop = document.getElementById('manual-backdrop');
  if (btn) bindTap(btn, () => toggleManual());
  if (close) bindTap(close, () => closeManual());
  if (backdrop) bindTap(backdrop, () => closeManual());
}
