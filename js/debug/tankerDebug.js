import { Game } from '../core/gameState.js';
import { Road } from '../world/roadNetwork.js';
import { getTankerRoutePlan, getTankerEventLog } from '../systems/tankerSystem.js';

function spotLabelPos(slot) {
  const p = Road.posAt(slot.s, Road.laneW / 2 + 22);
  return { x: p.x, y: p.y - 28 };
}

function drawSpotDebug(ctx, slot) {
  const st = slot.station;
  const pos = spotLabelPos(slot);
  const lines = [
    'Spot ' + (slot.i + 1),
    'ID: ' + slot.i,
    '',
    'Fuel:',
    st ? Math.round(st.res) + ' / ' + st.cap : '— / —',
    '',
    'Need:',
    st && st.cap - st.res > 0.5 ? 'YES' : 'NO'
  ];
  if (st) {
    lines.push('', 'Exists: YES', 'Current:', Math.round(st.res), 'Capacity:', st.cap);
  } else {
    lines.push('', 'Exists: NO');
  }
  const tanker = Game.tanker.unit;
  const leg = tanker?.routePlan?.find(l => l.spotId === slot.i);
  if (leg) {
    lines.push('', 'NeedFuel:', leg.needFuel ? 'YES' : 'NO', 'Decision:', leg.decision);
  }
  drawDebugBox(ctx, pos.x, pos.y, lines, '#aed581', 8);
}

function drawDebugBox(ctx, cx, cy, lines, color, fontSize) {
  ctx.font = '700 ' + fontSize + 'px system-ui';
  ctx.textAlign = 'left';
  const lineH = fontSize + 3;
  const pad = 5;
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lineH + pad;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.fillStyle = 'rgba(0,0,0,.78)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  lines.forEach((line, i) => ctx.fillText(line, x + pad, y + pad + 8 + i * lineH));
}

function drawRoutePlan(ctx, plan) {
  if (!plan || !plan.length) return;
  const lines = ['ROUTE', ''];
  for (const leg of plan) {
    lines.push(leg.spotNum + ' ' + leg.decision);
  }
  drawDebugBox(ctx, Road.rect.x0 + 52, Road.rect.y0 + 48, lines, '#fff59d', 9);
}

function drawEventLog(ctx, log) {
  if (!log || !log.length) return;
  const lines = ['LOG', ''];
  for (const e of log.slice(-10)) lines.push(e);
  const x = Road.rect.x1 - 58;
  const y = Road.rect.y0 + 48;
  drawDebugBox(ctx, x, y, lines, '#81d4fa', 8);
}

export function drawTankerMapDebug(ctx) {
  for (const slot of Road.slots) drawSpotDebug(ctx, slot);
  const tk = Game.tanker.unit;
  if (tk?.routePlan) drawRoutePlan(ctx, tk.routePlan);
  if (tk) drawEventLog(ctx, getTankerEventLog(tk));
}
