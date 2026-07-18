export const Events = {
  VehicleSpawned: 'VehicleSpawned',
  VehicleDestroyed: 'VehicleDestroyed',
  PumpReleased: 'PumpReleased',
  StationRefilled: 'StationRefilled',
  FuelTruckArrived: 'FuelTruckArrived',
  GameLost: 'GameLost',
  GameWon: 'GameWon'
};

export const COLORS = {
  bg: '#1d232c', road: '#454c58', roadEdge: '#2a2f38',
  marking: 'rgba(230,237,243,.45)', slot: '#5a6472',
  stub: '#3a404b', apron: 'rgba(90,100,114,.22)'
};

export const CANVAS = {
  designWidth: 420,
  minHeight: 560,
  maxHeight: 940,
  maxDeltaTime: 0.05,
  maxDevicePixelRatio: 2.5
};
