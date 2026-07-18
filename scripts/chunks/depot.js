const Depot = {
  pos: null, accessS: 0,
  init() {
    const cx = (Road.rect.x0 + Road.rect.x1) / 2;
    const cy = (Road.rect.y0 + Road.rect.y1) / 2;
    this.pos = { x: cx, y: cy };
    let bestD = Infinity;
    for (let s = 0; s < Road.length; s += 4) {
      const p = Road.posAt(s, 0);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bestD) { bestD = d; this.accessS = s; }
    }
  },
  cap() { return CONFIG.depot.levels[Game.depot.level - 1]; },
  deliveryRate() { return this.cap() * CONFIG.depot.deliveryFrac; },
  upgradeCost() {
    return Game.depot.level >= CONFIG.depot.levels.length ? null : CONFIG.depot.upgradeCosts[Game.depot.level - 1];
  }
};
