import { Game } from '../core/gameState.js';
import { CONFIG } from '../config/index.js';
import { Road } from '../world/roadNetwork.js';
import { GbrPhase, ScalperPhase, TankerPhase } from '../systems/entityFsm.js';
import { fleetDebugLines } from '../systems/tankerLogistics.js';
import { StationApi } from '../systems/stationApi.js';
import { getTankerDebugInfo } from '../systems/tankerSystem.js';
import { drawTankerMapDebug } from './tankerDebug.js';
import {
  pursuitDebugLines, pursuitEventLogLines, gbrDistanceToTarget
} from '../systems/gbrPursuit.js';
import { scalperOwnerLogLines, scalperMovementDebug } from '../systems/scalperLifecycle.js';
import { clamp01, smooth, lerpPose } from '../core/utils.js';

let enabled = false;

export function toggleDebugOverlay() {
  enabled = !enabled;
  return enabled;
}

export function isDebugOverlayEnabled() {
  return enabled;
}

function vehiclePose(v) {
  if (v.kind === 'gbr' && v.pose) return v.pose;
  if (v.state === 'depotDrive' && v.pose) return v.pose;
  if (v.state === 'pullIn' || v.state === 'pullOut' || (v.state === 'pocket' && v.animT < v.animDur))
    return lerpPose(v.animFrom, v.animTo, smooth(clamp01(v.animT / v.animDur)));
  if (v.state === 'station' || v.state === 'block' || v.state === 'waitMerge' || v.state === 'pocket')
    return v.pose;
  const baseLat = v.lane === 'inner' ? Road.laneW / 2 : -Road.laneW / 2;
  const lat = v.lane === 'inner' ? baseLat + (v.latOff || 0) : baseLat;
  const p = Road.posAt(v.s, lat);
  if (v.visualSteer) p.a += v.visualSteer;
  return p;
}

function drawPanel(ctx, lines, x, y, color) {
  if (!lines.length) return y;
  ctx.save();
  ctx.font = '700 9px monospace';
  ctx.textAlign = 'left';
  const lineH = 12;
  const pad = 8;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lineH + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,.78)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  lines.forEach((line, i) => ctx.fillText(line, x + pad, y + pad + 9 + i * lineH));
  ctx.restore();
  return y + h + 6;
}

function drawStationQueuePanel(ctx) {
  drawPanel(ctx, StationApi.stationQueueDebugLines(), 8, 120, '#b3e5fc');
}

function drawTankerFleetPanel(ctx) {
  drawPanel(ctx, fleetDebugLines(), 8, 8, '#fff59d');
}

function gbrLabel(g) {
  const p = g.gbrPhase || GbrPhase.PATROL;
  if (p === GbrPhase.PATROL) return 'PATROL';
  if (p === GbrPhase.CHASE) return 'CHASE';
  if (p === GbrPhase.ENTER_SERVICE_LANE) return 'SERVICE';
  if (p === GbrPhase.ARREST) return 'ARREST';
  if (p === GbrPhase.RETURNING) return 'RETURNING';
  return String(p).toUpperCase();
}

function tankerLabel(v) {
  const p = v.tankerPhase || TankerPhase.MOVING;
  if (p === TankerPhase.SPAWNING) return 'SPAWNING';
  if (p === TankerPhase.REFUELLING) return 'REFUELLING';
  if (p === TankerPhase.MAIN_STORAGE) return 'MAIN_STORAGE';
  if (p === TankerPhase.EXIT) return 'EXIT';
  return 'MOVING';
}

function scalperLines(v) {
  const d = scalperMovementDebug(v);
  const wanted = v.wanted ? 'Y' : 'N';
  const pursued = v.pursuedBy ?? '—';
  const target = v.scalperPhase === ScalperPhase.EXITING || v.scalperPhase === ScalperPhase.ESCAPING
    ? 'EXIT' : (v.targetSlot ? 'st#' + v.targetSlot.i : '—');
  const fill = Math.round(v.totalGot || 0) + '/' + (v.maxLiters || CONFIG.scalper.baseMaxLiters);
  return [
    'SC#' + (v.scalperId || '?') + ' T:' + target + ' ' + fill + 'L',
    'PHASE:' + d.phase + ' STATE:' + d.state,
    'LANE:' + d.lane + ' OWNER:' + d.owner,
    'MOVE:' + d.move + ' V:' + d.v + ' dS:' + d.ds,
    'W:' + wanted + ' P:' + pursued
  ];
}

function scalperLabel(v) {
  const d = scalperMovementDebug(v);
  return 'SC#' + (v.scalperId || '?') + ' PHASE:' + d.phase + ' STATE:' + d.state +
    ' MOVE:' + d.move + ' V:' + d.v;
}

function unitLabel(v) {
  if (v.kind === 'gbr') return gbrLabel(v);
  if (v.kind === 'tanker') return tankerLabel(v);
  if (v.kind === 'scalper') return scalperLabel(v);
  return null;
}

function tankerLines(v) {
  return getTankerDebugInfo(v).lines;
}

function unitLines(v) {
  if (v.kind === 'tanker') return tankerLines(v);
  if (v.kind === 'gbr') {
    const label = gbrLabel(v);
    const target = v.targetScalperId != null ? 'sc#' + v.targetScalperId : 'sc#—';
    const dist = gbrDistanceToTarget(v);
    const distStr = dist != null ? Math.round(dist) + 'px' : '—';
    return [label, 'gbr#' + (v.fleetId || '?'), target, 'dist:' + distStr];
  }
  if (v.kind === 'scalper') return scalperLines(v);
  const label = unitLabel(v);
  return label ? [label] : null;
}

function drawStationGuardPanel(ctx) {
  const lines = [];
  for (const slot of Road.slots) {
    const st = slot.station;
    if (!st) continue;
    const guard = st.gbrAutoCall ? 'Подключена' : 'Нет';
    const auto = st.gbrAutoCall ? (st.gbrAutoCallOn ? 'Вкл' : 'Выкл') : '—';
    const alarm = st.gbrAlarm > 0 ? 'Да' : 'Нет';
    lines.push('AZS#' + slot.i + ' guard:' + guard + ' auto:' + auto + ' alarm:' + alarm);
  }
  drawPanel(ctx, lines, 8, 200, '#ffcc80');
}

export function drawDebugOverlay(ctx) {
  if (!enabled) return;
  drawTankerMapDebug(ctx);
  drawTankerFleetPanel(ctx);
  drawStationQueuePanel(ctx);
  drawStationGuardPanel(ctx);
  let y = 280;
  y = drawPanel(ctx, pursuitDebugLines(), 8, y, '#a5d6a7');
  y = drawPanel(ctx, scalperOwnerLogLines(), 8, y, '#ffab91');
  drawPanel(ctx, pursuitEventLogLines(), 8, y, '#e1bee7');
  ctx.save();
  ctx.font = '700 9px system-ui';
  ctx.textAlign = 'center';
  for (const v of Game.vehicles) {
    const lines = unitLines(v);
    if (!lines || !lines.length) continue;
    const pose = vehiclePose(v);
    if (!pose) continue;
    const lineH = 13;
    const pad = 4;
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 10;
    const h = lines.length * lineH + pad;
    const x = pose.x - w / 2;
    const y2 = pose.y - 34 - (lines.length - 1) * lineH;
    ctx.fillStyle = 'rgba(0,0,0,.72)';
    ctx.fillRect(x, y2, w, h);
    ctx.fillStyle = v.kind === 'gbr' ? '#81d4fa' : v.kind === 'tanker' ? '#fff59d' : '#ce93d8';
    lines.forEach((line, i) => ctx.fillText(line, pose.x, y2 + pad + 9 + i * lineH));
  }
  ctx.restore();
}
