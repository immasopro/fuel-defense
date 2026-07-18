const GBRBase = {
  pos: null, spawnS: 0,
  init() {
    const s0 = Road.slots[0].s, s6 = Road.slots[6].s;
    const L = Road.length;
    const span = mod(s6 - s0, L);
    this.spawnS = mod(s0 + span * 0.5, L);
    this.pos = Road.posAt(this.spawnS, -Road.laneW * 0.9);
  }
};
