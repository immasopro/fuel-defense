import { CONFIG } from '../config/index.js';

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

export { Pump };
