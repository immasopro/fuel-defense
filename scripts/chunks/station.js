class Pump {
  constructor(fuel) {
    this.fuel = fuel;
    this.level = 1;
    this.buffer = CONFIG.pump.bufferMax();
    this.cars = [];
    this.claimed = null;
    this.blocked = false;
    this.serving = false;
  }
  get rate() { return CONFIG.pump.rates[this.level - 1]; }
}

class Station {
  constructor(fuel) {
    this.unlocked = [fuel];
    this.resLevel = 1;
    this.cap = CONFIG.station.resLevels[0];
    this.res = Math.round(this.cap * CONFIG.station.startFill);  // стартовая доля, далее — из нефтебазы
    this.pumps = [new Pump(fuel)];
    this.pocket = [];   // карман ожидания (до pocketMax машин)
    this.served = 0;
    this.slot = null;
    // резерв канистр (улучшение за $500)
    this.canisterUp = false;
    this.canRes = 0;
    this.canCap = CONFIG.canisterReserve.cap;
    this.canCd = 0;
  }
}
