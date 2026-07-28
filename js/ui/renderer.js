import { CONFIG } from '../config/index.js';
import { COLORS } from '../config/constants.js';
import { Game } from '../core/gameState.js';
import { Road, pumpPose, apronPoseForRank, approachStopS, pocketEntryS,
  holderPose, distAhead } from '../world/roadNetwork.js';
import { Depot, GBRBase, stationReservoirHud } from '../world/map.js';
import { TankerPhase, ScalperPhase } from '../systems/entityFsm.js';
import { clamp, clamp01, fmtTime, lerpPose, smooth, mod } from '../core/utils.js';
import { isLightGreen } from '../systems/trafficSystem.js';
import { getServedHudText } from '../systems/spawnSystem.js';
import { UI } from './hud.js';
import { drawDebugOverlay } from '../debug/debugOverlay.js';
import { laneLat, normalizeLane, serviceLane, exitLane, isExitLane, roadStrokeWidth, laneCount } from '../world/lanes.js';
import { hasSiren } from '../vehicles/vehicle.js';
import { stationNeedsGbrCall } from '../systems/gbrPursuit.js';

function vehiclePose(v) {
  if (v.kind === 'gbr' && v.pose) return v.pose;
  if (v.state === 'depotDrive' && v.pose) return v.pose;
  if (v.state === 'pullIn' || v.state === 'pullOut' || (v.state === 'pocket' && v.animT < v.animDur))
    return lerpPose(v.animFrom, v.animTo, smooth(clamp01(v.animT / v.animDur)));
  if (v.state === 'station' || v.state === 'block' || v.state === 'waitMerge' || v.state === 'pocket')
    return v.pose;
  const baseLat = laneLat(normalizeLane(v.lane));
  // visualRoll: лёгкий «крен» как доп. lat-смещение к центру поворота
  const roll = v.visualRoll || 0;
  const lat = baseLat + (v.latOff || 0) + roll * 2.2;
  const p = Road.posAt(v.s, lat);
  if (v.visualSteer) p.a += v.visualSteer;
  return p;
}

function roadPath(ctx) {
  const { x0, y0, x1, y1, r } = Road.rect;
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x1 - r, y0);
  ctx.arc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x1, y1 - r);
  ctx.arc(x1 - r, y1 - r, r, 0, Math.PI / 2);
  ctx.lineTo(x0 + r, y1);
  ctx.arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x0, y0 + r);
  ctx.arc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

function reservoirFillColor(frac) {
  if (frac > 0.25) return '#8bc34a';
  if (frac >= 0.1) return '#ffb300';
  return '#ef5350';
}

function drawDepotBranchRoad(ctx) {
  const tk = Game.tanker.unit;
  if (!tk || tk.tankerPhase !== TankerPhase.MAIN_STORAGE) return;
  if (!tk.depotPathMode && tk.state !== 'depotDrive' && tk.state !== 'tankerDepot' &&
      tk.state !== 'pullIn' && tk.state !== 'pullOut') return;
  const path = tk.depotPathMode === 'fromDepot' ? Depot.driveFromDepot : Depot.driveToDepot;
  if (!path || path.length < 2) return;
  const bw = Depot.branchWidth || Road.laneW * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.road;
  ctx.lineWidth = bw;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = 'rgba(255,235,59,.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawReservoirIcon(ctx, x, y) {
  ctx.strokeStyle = '#90a4ae';
  ctx.lineWidth = 1.2;
  ctx.fillStyle = '#1a2030';
  rr(ctx, x, y, 14, 16, 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 7, y + 5, 3, 0, Math.PI * 2);
  ctx.stroke();
}

function drawMiniTankerIcon(ctx, x, y) {
  ctx.fillStyle = '#fdd835';
  rr(ctx, x, y, 16, 8, 2);
  ctx.fill();
  ctx.fillStyle = '#5d4037';
  rr(ctx, x + 10, y - 2, 5, 5, 1);
  ctx.fill();
}

function rr(ctx, x, y, w, h, rad) {   // roundRect с фолбэком
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); return; }
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function draw() {
  const ctx = UI.ctx;
  const dpr = UI.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, UI.cssW, UI.cssH);
  ctx.setTransform(dpr * UI.scale, 0, 0, dpr * UI.scale, dpr * UI.ox, dpr * UI.oy);

  const lw = Road.laneW;

  // --- въезд/выезд ---
  const sp = Road.posAt(Road.spawnS, 0);
  ctx.fillStyle = COLORS.stub;
  ctx.fillRect(sp.x - 24, sp.y, 48, UI.LH - sp.y + 4);
  ctx.strokeStyle = COLORS.marking;
  ctx.setLineDash([8, 8]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sp.x, sp.y + 8);
  ctx.lineTo(sp.x, UI.LH);
  ctx.stroke();
  ctx.setLineDash([]);
  // --- накопитель перед въездом ---
  const hMax = CONFIG.holder.max;
  ctx.fillStyle = 'rgba(90,100,114,.35)';
  ctx.fillRect(sp.x - 28, sp.y + 6, 56, hMax * CONFIG.holder.gap + 28);
  for (let i = 0; i < Game.holder.length; i++) {
    const hp = holderPose(i);
    drawHolderCar(ctx, Game.holder[i], hp);
  }
  if (Game.holder.length >= hMax) {
    ctx.fillStyle = 'rgba(239,83,80,.45)';
    ctx.font = '800 10px system-ui';
    ctx.fillText('ПОЛОН', sp.x, sp.y + hMax * CONFIG.holder.gap + 42);
  }
  if (Game.prepared && Game.prepared.ready) {
    ctx.fillStyle = '#ffb300';
    ctx.font = '700 9px system-ui';
    ctx.fillText('+1', sp.x + 22, sp.y + hMax * CONFIG.holder.gap + 20);
  }

  drawTrafficLightIndicator(ctx, sp.x, sp.y + 4);
  ctx.fillStyle = '#8bc34a';
  ctx.font = '700 15px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('▲', sp.x + 12, UI.LH - 8);
  ctx.fillStyle = '#90a4ae';
  ctx.fillText('▼', sp.x - 12, UI.LH - 8);

  // --- дорога ---
  roadPath(ctx);
  ctx.lineWidth = roadStrokeWidth() + 6;
  ctx.strokeStyle = COLORS.roadEdge;
  ctx.stroke();
  roadPath(ctx);
  ctx.lineWidth = roadStrokeWidth();
  ctx.strokeStyle = COLORS.road;
  ctx.stroke();
  roadPath(ctx);
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.marking;
  ctx.setLineDash([12, 10]);
  ctx.stroke();
  ctx.setLineDash([]);

  // разметка между полосами (v0.4.4)
  const nLanes = laneCount();
  if (nLanes > 1) {
    ctx.strokeStyle = 'rgba(255,235,59,.35)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 12]);
    for (let i = 1; i < nLanes; i++) {
      const lat = (laneLat(i - 1) + laneLat(i)) / 2;
      roadPath(ctx);
      // approximate: stroke full path is centerline; draw offset marks along ring
      for (let s = 0; s < Road.length; s += 28) {
        const p = Road.posAt(s, lat);
        if (s === 0) { ctx.beginPath(); ctx.moveTo(p.x, p.y); }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawDepotBranchRoad(ctx);

  // стрелки направления на внутренней полосе
  ctx.fillStyle = 'rgba(230,237,243,.3)';
  for (let s = 20; s < Road.length; s += 110) {
    const p = Road.posAt(s, laneLat(serviceLane()));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.beginPath();
    ctx.moveTo(5, 0); ctx.lineTo(-3, -4); ctx.lineTo(-3, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // индикатор таймера поражения
  if (Game.defeatT > 0.15 && Math.floor(Game.time * 4) % 2 === 0) {
    const p = Road.posAt(Road.spawnS, laneLat(serviceLane()));
    ctx.fillStyle = 'rgba(239,83,80,.5)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- центр кольца: нефтебаза ---
  const cx = (Road.rect.x0 + Road.rect.x1) / 2;
  const cy = (Road.rect.y0 + Road.rect.y1) / 2;
  drawDepot(ctx, cx, cy);
  if (GBRBase.pos) drawGBRBase(ctx);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(230,237,243,.10)';
  ctx.font = '800 44px system-ui';
  let wm = 'FUEL', wm2 = 'DEFENSE';
  if (Game.state === 'play') {
    wm = getServedHudText();
    wm2 = Game.mode === 'endless' ? 'ENDLESS' : 'КАМПАНИЯ';
  }
  ctx.fillText(wm, cx, cy + 52);
  ctx.font = '700 13px system-ui';
  ctx.fillText(wm2, cx, cy + 74);

  // --- АЗС и площадки ---
  for (const slot of Road.slots) drawSlot(ctx, slot);

  // --- машины ---
  for (const v of Game.vehicles) drawVehicle(ctx, v);

  drawDebugOverlay(ctx);

  // --- всплывающие тексты ---
  ctx.textAlign = 'center';
  ctx.font = '800 13px system-ui';
  for (const f of Game.floats) {
    const k = f.t / f.life;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = f.color;
    ctx.fillText(f.txt, f.x, f.y - k * 22);
  }
  ctx.globalAlpha = 1;
}

function drawDepot(ctx, cx, cy) {
  const cap = Game.depot.cap;
  const frac = clamp01(Game.depot.res / cap);
  const w = 44, h = 56;
  const x = cx - w / 2, y = cy - h / 2 - 8;
  ctx.fillStyle = '#1a2030';
  rr(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = '#5c6bc0';
  ctx.lineWidth = 2;
  rr(ctx, x, y, w, h, 5);
  ctx.stroke();
  const fillH = (h - 6) * frac;
  ctx.fillStyle = frac > .3 ? '#5c6bc0' : (frac > .1 ? '#ffb300' : '#ef5350');
  ctx.fillRect(x + 3, y + h - 3 - fillH, w - 6, fillH);
  ctx.fillStyle = '#aeb8c4';
  ctx.font = '800 9px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('НЕФТЕБАЗА', cx, y - 5);
  ctx.font = '700 10px system-ui';
  ctx.fillText('ур.' + Game.depot.level, cx, y + h + 12);
  if (Game.depotLabel > 0) {
    ctx.fillStyle = '#e6edf3';
    ctx.font = '800 12px system-ui';
    ctx.fillText(Math.round(Game.depot.res) + ' / ' + cap + ' л', cx, y + h + 26);
  }
}

function drawStationTank(ctx, slot, st) {
  const hud = stationReservoirHud(slot, st);
  const frac = clamp01(st.res / st.cap);
  const barX = hud.x + 18;
  const barW = 58;
  const barH = 8;
  const barY = hud.y + 8;

  ctx.fillStyle = 'rgba(12,16,22,.82)';
  rr(ctx, hud.x - 2, hud.y - 2, hud.w, hud.h + 4, 4);
  ctx.fill();
  ctx.strokeStyle = '#39404b';
  ctx.lineWidth = 1;
  rr(ctx, hud.x - 2, hud.y - 2, hud.w, hud.h + 4, 4);
  ctx.stroke();

  drawReservoirIcon(ctx, hud.x + 2, hud.y + 4);

  ctx.fillStyle = '#12161c';
  rr(ctx, barX, barY, barW, barH, 3);
  ctx.fill();
  ctx.fillStyle = reservoirFillColor(frac);
  rr(ctx, barX, barY, Math.max(2, barW * frac), barH, 3);
  ctx.fill();

  const resTxt = Math.round(st.res) + ' / ' + st.cap;
  ctx.fillStyle = '#e6edf3';
  ctx.font = '700 10px system-ui';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(resTxt, barX + barW + 6, hud.y + hud.h / 2);

  const tk = Game.tanker.unit;
  const tkHere = tk && tk.serviceSlot === slot &&
    (tk.state === 'tankerService' || tk.state === 'pullIn');
  const gbrConflict = st.pumps.some(p => p.blocked);
  let extraX = hud.x + hud.w - 4;
  if (tkHere) {
    drawMiniTankerIcon(ctx, extraX - 18, hud.y + 8);
    extraX -= 22;
  }
  if (gbrConflict) {
    ctx.fillStyle = '#ef5350';
    ctx.font = '800 9px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('ГБР?', extraX, hud.y + hud.h + 10);
  }

  if (st.canisterUp) {
    const cx2 = hud.x + hud.w - 8;
    const cy2 = hud.y + hud.h + 18;
    ctx.fillStyle = '#37474f';
    rr(ctx, cx2 - 6, cy2 - 5, 12, 10, 2);
    ctx.fill();
    ctx.fillStyle = '#4dd0e1';
    ctx.fillRect(cx2 - 5, cy2 + 5 - 8 * clamp01(st.canRes / st.canCap), 10,
      8 * clamp01(st.canRes / st.canCap));
  }

  if (Game.tankLabels[slot.i] > 0) {
    ctx.fillStyle = '#fff59d';
    ctx.font = '800 9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('резервуар', hud.x + hud.w / 2, hud.y - 6);
  }
}

function drawSlot(ctx, slot) {
  const st = slot.station;
  const p = slot.pos;
  if (!st) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    ctx.strokeStyle = COLORS.slot;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    rr(ctx, -26, -16, 52, 32, 6);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.fillStyle = Game.money >= CONFIG.station.cost ? '#8bc34a' : '#5a6472';
    ctx.font = '800 18px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('+', p.x, p.y + 6);
    return;
  }
  const C = CONFIG.road;
  const n = st.pumps.length;
  const latMin = 22;
  const latMax = C.serviceLat + (n - 1) * C.pumpDepth + 9;
  const sA = slot.s - (C.queueGap * 3 + 16), sB = slot.s + 22;
  // апрон (территория АЗС)
  const c1 = Road.posAt(sA, latMin), c2 = Road.posAt(sB, latMin);
  const c3 = Road.posAt(sB, latMax), c4 = Road.posAt(sA, latMax);
  ctx.fillStyle = COLORS.apron;
  ctx.beginPath();
  ctx.moveTo(c1.x, c1.y);
  ctx.lineTo(c2.x, c2.y);
  ctx.lineTo(c3.x, c3.y);
  ctx.lineTo(c4.x, c4.y);
  ctx.closePath();
  ctx.fill();

  // полосы торможения / разгона
  const laneW = Road.laneW;
  const entryS = pocketEntryS(slot);
  const decS = mod(entryS - CONFIG.road.decelLen * 0.45, Road.length);
  const accS = mod(slot.s + CONFIG.road.accelLen, Road.length);
  const d0 = Road.posAt(decS, laneLat(serviceLane())), d1 = Road.posAt(entryS, laneLat(serviceLane()) + 5);
  const d2 = Road.posAt(approachStopS(slot), laneLat(serviceLane()) + 8);
  const a1 = Road.posAt(mod(slot.s + 6, Road.length), laneLat(exitLane()) - 3);
  const a2 = Road.posAt(accS, laneLat(exitLane()) - 3);
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(141,198,63,.5)';
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(66,165,245,.5)';
  ctx.beginPath();
  ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const bufMax = CONFIG.pump.bufferMax();
  for (let j = 0; j < n; j++) {
    const pump = st.pumps[j];
    const f = CONFIG.fuels[pump.fuel];
    const lat = C.serviceLat + j * C.pumpDepth;
    const box = Road.posAt(mod(slot.s + 13, Road.length), lat);
    // корпус колонки
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.rotate(box.a);
    ctx.fillStyle = '#2c3440';
    rr(ctx, -5, -5, 10, 10, 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = f.color;
    rr(ctx, -5, -5, 10, 10, 2);
    ctx.stroke();
    // мини-бар буфера колонки
    ctx.fillStyle = '#12161c';
    ctx.fillRect(-5, 6, 10, 2);
    ctx.fillStyle = '#4dd0e1';
    ctx.fillRect(-5, 6, 10 * clamp01(pump.buffer / bufMax), 2);
    ctx.restore();
    // уровень колонки
    ctx.fillStyle = '#e6edf3';
    ctx.font = '800 8px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(pump.level, box.x, box.y + 3);
    // конфликт
    if (pump.blocked) {
      const pulse = 1 + Math.sin(Game.time * 8) * .18;
      ctx.strokeStyle = '#ef5350';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(box.x, box.y, 12 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ef5350';
      ctx.font = '900 14px system-ui';
      ctx.fillText('!', box.x, box.y - 14);
    } else if (pump.claimed) {
      ctx.fillStyle = '#ffb300';
      ctx.font = '800 11px system-ui';
      ctx.fillText('⚠', box.x, box.y - 12);
    }
  }

  drawStationTank(ctx, slot, st);
  drawGbrCallAlarm(ctx, slot);
}

/** Мигающая мигалка у АЗС — нужен вызов ГБР (v0.4.5). */
function drawGbrCallAlarm(ctx, slot) {
  if (!stationNeedsGbrCall(slot)) return;
  const p = slot.pos;
  if (!p) return;
  const blink = Math.floor(Game.time * 6) % 2 === 0;
  const pulse = 1 + Math.sin(Game.time * 9) * 0.12;
  const ox = p.x + Math.cos(p.a - Math.PI / 2) * 28;
  const oy = p.y + Math.sin(p.a - Math.PI / 2) * 28;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.globalAlpha = blink ? 1 : 0.45;
  // «люстра» мигалки
  ctx.fillStyle = '#eceff1';
  rr(ctx, -7 * pulse, -4, 14 * pulse, 8, 2);
  ctx.fill();
  ctx.fillStyle = blink ? '#ef5350' : '#42a5f5';
  ctx.beginPath();
  ctx.arc(-3, 0, 3.2 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = blink ? '#42a5f5' : '#ef5350';
  ctx.beginPath();
  ctx.arc(3, 0, 3.2 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawTrafficLightIndicator(ctx, x, y) {
  const on = isLightGreen();
  ctx.fillStyle = '#263238';
  rr(ctx, x - 8, y - 2, 16, 26, 3);
  ctx.fill();
  ctx.fillStyle = on ? '#4caf50' : '#37474f';
  ctx.beginPath(); ctx.arc(x, y + 6, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = !on ? '#ef5350' : '#37474f';
  ctx.beginPath(); ctx.arc(x, y + 18, 4, 0, Math.PI * 2); ctx.fill();
}

function drawGBRBase(ctx) {
  const p = GBRBase.pos;
  ctx.fillStyle = '#1a237e';
  rr(ctx, p.x - 18, p.y - 12, 36, 24, 4);
  ctx.fill();
  ctx.strokeStyle = '#42a5f5';
  ctx.lineWidth = 2;
  rr(ctx, p.x - 18, p.y - 12, 36, 24, 4);
  ctx.stroke();
  ctx.fillStyle = '#e3f2fd';
  ctx.font = '800 9px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('ГБР', p.x, p.y + 3);
}

function drawHolderCar(ctx, v, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  const gray = v.kind === 'bg';
  ctx.fillStyle = gray ? '#9e9e9e' : (v.fuelKey ? CONFIG.fuels[v.fuelKey].color : '#9e9e9e');
  rr(ctx, -v.len / 2, -v.w / 2, v.len, v.w, 3);
  ctx.fill();
  ctx.restore();
}

function drawVehicle(ctx, v) {
  const p = vehiclePose(v);
  if (!p) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  // v0.4.5: клевок при торможении — сдвиг массы вперёд + лёгкое сжатие
  const dip = clamp01(v.visualBrakeDip || 0);
  if (dip > 0.02) {
    ctx.translate(dip * 1.8, 0);
    ctx.scale(1 - dip * 0.1, 1 + dip * 0.05);
  }
  if (isExitLane(normalizeLane(v.lane)) && v.kind === 'car') ctx.globalAlpha = .85;

  if (v.kind === 'tanker') {
    ctx.fillStyle = '#8d6e63';                       // кабина
    rr(ctx, v.len / 2 - 10, -v.w / 2, 10, v.w, 2);
    ctx.fill();
    ctx.fillStyle = '#fdd835';                       // цистерна
    rr(ctx, -v.len / 2, -v.w / 2, v.len - 12, v.w, 5);
    ctx.fill();
    ctx.fillStyle = '#12161c';                       // уровень топлива
    const k = v.load / (v.capacity || Depot.cap());
    ctx.fillRect(-v.len / 2 + 3, -1.5, (v.len - 18) * k, 3);
  } else if (v.kind === 'gbr') {
    // v0.4.5: белый кузов + чёрная крыша
    ctx.fillStyle = '#f5f7fa';
    rr(ctx, -v.len / 2, -v.w / 2, v.len, v.w, 3);
    ctx.fill();
    ctx.fillStyle = '#1a1d24';
    rr(ctx, -v.len * 0.12, -v.w / 2, v.len * 0.55, v.w, 2);
    ctx.fill();
    // лобовое
    ctx.fillStyle = 'rgba(66,165,245,.35)';
    ctx.fillRect(v.len / 2 - 7, -v.w / 2 + 1.5, 4, v.w - 3);
    if (hasSiren(v)) {
      const blink = Math.floor(Game.time * 10) % 2 === 0;
      ctx.fillStyle = blink ? '#ef5350' : '#42a5f5';
      ctx.fillRect(-3, -v.w / 2 - 1, 6, 3);
    }
  } else {
    const isRevealedScalper = v.kind === 'scalper' && !!v.wanted;
    const color = isRevealedScalper ? CONFIG.scalper.color
      : (v.kind === 'bg' ? '#9e9e9e' : CONFIG.fuels[v.fuelKey].color);
    ctx.fillStyle = color;
    rr(ctx, -v.len / 2, -v.w / 2, v.len, v.w, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(18,22,28,.55)';            // лобовое стекло
    ctx.fillRect(v.len / 2 - 7, -v.w / 2 + 1.5, 4, v.w - 3);
    if (v.typeKey === 'truck') {                     // стык кабины и прицепа
      ctx.strokeStyle = 'rgba(18,22,28,.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(v.len / 2 - 11, -v.w / 2);
      ctx.lineTo(v.len / 2 - 11, v.w / 2);
      ctx.stroke();
    }
    if (v.canister) {
      ctx.fillStyle = v.canisterColor === 'green' ? '#4caf50' : '#e53935';
      ctx.fillRect(-v.len / 2 + 2, -2, 4, 4);
      if (v.canisterColor === 'green') ctx.fillRect(-v.len / 2 + 7, -2, 4, 4);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  if (v.kind === 'tanker') {
    const cap = v.capacity || Depot.cap();
    ctx.font = '800 11px system-ui';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(18,22,28,.85)';
    ctx.strokeText(Math.round(v.load) + ' л', p.x, p.y - 11);
    ctx.fillStyle = '#fdd835';
    ctx.fillText(Math.round(v.load) + ' л', p.x, p.y - 11);
  } else if (v.kind === 'gbr' && v.state === 'tow' && v.towProgress > 0) {
    ctx.strokeStyle = '#42a5f5';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y - 14, 12, -Math.PI / 2, -Math.PI / 2 + v.towProgress * Math.PI * 2);
    ctx.stroke();
  } else if (v.kind === 'scalper' && v.wanted) {
    const fuel = v.fuelKey ? CONFIG.fuels[v.fuelKey].short : '?';
    ctx.fillStyle = '#e1bee7';
    ctx.font = '800 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(v.totalGot) + ' / ' + (v.maxLiters || CONFIG.scalper.baseMaxLiters) + ' L', p.x, p.y - 11);
    ctx.font = '700 9px system-ui';
    ctx.fillStyle = v.fuelKey ? CONFIG.fuels[v.fuelKey].color : '#ce93d8';
    ctx.fillText(fuel, p.x, p.y - 21);
  } else if (v.angry && v.state === 'drive' && normalizeLane(v.lane) === serviceLane()) {
    ctx.fillStyle = '#ef5350';
    ctx.font = '800 12px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('!', p.x, p.y - 9);
  } else if (v.overtake && v.state === 'drive') {
    ctx.fillStyle = '#ffb300';
    ctx.font = '800 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('»', p.x, p.y - 9);
  }
}

export { draw, vehiclePose, roadPath, rr, drawVehicle, drawDepot, drawGBRBase,
  drawTrafficLightIndicator, drawSlot, drawHolderCar };
