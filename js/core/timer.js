import { CANVAS } from '../config/constants.js';

export class FrameTimer {
  constructor() {
    this.lastTs = null;
  }
  step(ts) {
    if (this.lastTs == null) {
      this.lastTs = ts;
      return 0;
    }
    const dt = Math.min((ts - this.lastTs) / 1000, CANVAS.maxDeltaTime);
    this.lastTs = ts;
    return dt;
  }
}
