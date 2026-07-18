/** Фазы спецтехники — одна активная фаза на сущность */

export const ScalperPhase = {
  SPAWN: 'spawn',
  DRIVING: 'driving',
  QUEUE: 'queue',
  REFUELING: 'refueling',
  ESCAPING: 'escaping',
  ARRESTING: 'arresting',
  EXITING: 'exiting',
  DESPAWN: 'despawn',
  /** @deprecated use ARRESTING */
  ARRESTED: 'arresting'
};

export const GbrPhase = {
  PATROL: 'patrol',
  CHASE: 'chase',
  ENTER_SERVICE_LANE: 'enter_service_lane',
  ARREST: 'arrest',
  RETURNING: 'returning',
  DISPATCH: 'dispatch'
};

export const TankerPhase = {
  SPAWNING: 'spawning',
  MOVING: 'moving',
  REFUELLING: 'refuelling',
  MAIN_STORAGE: 'main_storage',
  EXIT: 'exit'
};

export function setScalperPhase(v, phase) {
  v.scalperPhase = phase;
}

export function setGbrPhase(g, phase) {
  g.gbrPhase = phase;
}

export function setTankerPhase(v, phase) {
  v.tankerPhase = phase;
  v.phase = phase; // legacy alias for tanker tour logic
}
