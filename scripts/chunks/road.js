const Road = {
  segs: [], length: 0, slots: [], spawnS: 0, laneW: 15, rect: null,

  build(W, H) {
    const C = CONFIG.road;
    this.laneW = C.laneWidth;
    const x0 = C.marginX, x1 = W - C.marginX;
    const y0 = C.marginTop, y1 = H - C.marginBottom;
    const r = C.cornerR;
    this.rect = { x0, y0, x1, y1, r };
    const wTop = (x1 - r) - (x0 + r);
    const hSide = (y1 - r) - (y0 + r);
    const arc = Math.PI * r / 2;
    // 8 сегментов по часовой стрелке, начиная с верхней прямой
    this.segs = [
      { type: 's', len: wTop,  x: x0 + r, y: y0,     dx: 1,  dy: 0 },
      { type: 'a', len: arc,   cx: x1 - r, cy: y0 + r, a0: -Math.PI / 2 },
      { type: 's', len: hSide, x: x1,     y: y0 + r, dx: 0,  dy: 1 },
      { type: 'a', len: arc,   cx: x1 - r, cy: y1 - r, a0: 0 },
      { type: 's', len: wTop,  x: x1 - r, y: y1,     dx: -1, dy: 0 },
      { type: 'a', len: arc,   cx: x0 + r, cy: y1 - r, a0: Math.PI / 2 },
      { type: 's', len: hSide, x: x0,     y: y1 - r, dx: 0,  dy: -1 },
      { type: 'a', len: arc,   cx: x0 + r, cy: y0 + r, a0: Math.PI }
    ];
    let s = 0;
    for (const seg of this.segs) { seg.start = s; s += seg.len; }
    this.length = s;
    this.spawnS = this.segs[4].start + wTop / 2;   // середина нижней прямой

    // Площадки под АЗС: 1 сверху, 3 справа, 3 слева (низ — въезд).
    // Каждая АЗС занимает много места (до 5 колонок с очередями).
    const defs = [[0, .5], [2, .22], [2, .5], [2, .78], [6, .22], [6, .5], [6, .78]];
    this.slots = defs.map(([si, f], i) => {
      const seg = this.segs[si];
      const slotS = seg.start + seg.len * f;
      return {
        i, s: slotS, station: null,
        pos: this.posAt(mod(slotS - 30, s), 56)   // якорь для тапа/подписей
      };
    });
  },

  posAt(s, lat) {
    s = mod(s, this.length);
    let seg = this.segs[0];
    for (const sg of this.segs) { if (s >= sg.start && s < sg.start + sg.len) { seg = sg; break; } }
    const t = s - seg.start;
    if (seg.type === 's') {
      // inward-нормаль (по часовой стрелке): n = (-dy, dx)
      return {
        x: seg.x + seg.dx * t - seg.dy * lat,
        y: seg.y + seg.dy * t + seg.dx * lat,
        a: Math.atan2(seg.dy, seg.dx)
      };
    }
    const a = seg.a0 + (t / seg.len) * Math.PI / 2;
    const rr = this.rect.r - lat;
    return { x: seg.cx + rr * Math.cos(a), y: seg.cy + rr * Math.sin(a), a: a + Math.PI / 2 };
  }
};

// Позиция колонки j на АЗС (место обслуживания машины)
function pumpPose(slot, j) {
  return Road.posAt(slot.s, CONFIG.road.serviceLat + j * CONFIG.road.pumpDepth);
}
// Позиция ожидания в очереди на апроне (без «перелёта» по всему кольцу)
function apronPoseForRank(slot, j, rank) {
  const back = Math.min(rank * CONFIG.road.queueGap, CONFIG.road.apronDepth);
  return Road.posAt(mod(slot.s - back, Road.length),
    CONFIG.road.serviceLat + j * CONFIG.road.pumpDepth);
}
// Единая точка съезда с дороги на апрон (все ранги)
function approachStopS(slot) {
  return mod(slot.s - CONFIG.road.approachOffset, Road.length);
}
// Точка начала кармана АЗС (съезд с основной дороги)
function pocketEntryS(slot) {
  return mod(slot.s - CONFIG.road.approachOffset - CONFIG.road.decelLen, Road.length);
}
// Точка начала полосы торможения перед АЗС (алиас)
function decelStopS(slot) { return pocketEntryS(slot); }
// Позиция в кармане ожидания АЗС (внутри территории, без mod-перелёта)
function pocketPoseForRank(slot, rank) {
  const back = Math.min(16 + rank * CONFIG.road.pocketGap, CONFIG.road.pocketDepth);
  return Road.posAt(mod(slot.s - back, Road.length), CONFIG.road.pocketLat);
}
// Позиция в накопителе перед светофором
function holderPose(rank) {
  const sp = Road.posAt(Road.spawnS, 0);
  return { x: sp.x, y: sp.y + 14 + rank * CONFIG.holder.gap, a: Math.PI / 2 };
}
// Дистанция вперёд по ходу движения (по часовой стрелке)
function distAhead(from, to, L) {
  return mod(to - from, L);
}
// Занята ли «форсунка» колонки (машина у пистолета заправляется или перекуп блокирует)
function pumpNozzleBusy(p) {
  const front = p.cars[0];
  if (!front) return false;
  if (front.kind === 'tanker') return true;
  if (front.state === 'block') return true;
  if ((front.state === 'station' || front.state === 'pullIn') && front.targetSlot) {
    const nozzle = pumpPose(front.targetSlot, front.pumpJ);
    const pose = front.pose || front.animTo;
    if (!pose) return false;
    const atNozzle = Math.hypot(pose.x - nozzle.x, pose.y - nozzle.y) < 7;
    if (!atNozzle) return false;
    if (front.kind === 'scalper') return true;
    if (front.kind === 'car') return front.got < front.need - 0.01;
  }
  return false;
}
// Свободная колонка для бензовоза: форсунка свободна, колонка не заблокирована
function findTankerPump(st) {
  for (let j = 0; j < st.pumps.length; j++) {
    const p = st.pumps[j];
    if (!p.blocked && !pumpNozzleBusy(p)) return j;
  }
  return -1;
}
