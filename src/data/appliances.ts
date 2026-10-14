/**
 * Appliance specs. Powers, thermal masses and losses are typical home-kitchen numbers, so preheat times
 * and recovery come out true to life (oven ≈ 12–15 min to 350 °F, sous vide bath ≈ 15–20 min to 135 °F).
 */
export type Fuel = 'gas' | 'electric';

export interface BurnerSpec {
  fuel: Fuel;
  /** Heat output at the lowest flame / at full, W. */
  minW: number;
  maxW: number;
  /** Fraction of output that goes into a pan sitting on it. */
  efficiency: number;
  /** Response time constant, s (gas is near-instant, electric coils lag). */
  tau: number;
}

export const BURNER: BurnerSpec = { fuel: 'gas', minW: 350, maxW: 3500, efficiency: 0.38, tau: 1.5 };

export const GRIDDLE = {
  /** Steel plate heat capacity, J/K (≈ 21 kg of 12 mm steel). */
  heatCapacity: 10_800,
  heaterW: 8000,
  efficiency: 0.42,
  /** Loss coefficient from the top surface (convection + radiation linearized), W/K. */
  lossWPerK: 7,
  /** Setpoint range, °F. */
  minF: 200,
  maxF: 550,
};

export const GRILL = {
  zones: 2,
  /** Per-zone burner output, W. */
  zoneW: 4000,
  /** Cast-iron grate heat capacity per zone, J/K. */
  grateHeatCapacity: 1800,
  /** Hood air heat capacity (lid closed), J/K. */
  hoodHeatCapacity: 3000,
  /** Radiant briquette / flame-tamer temperature at full flame, °C. */
  radiantMaxC: 560,
  /** Fat (kg) that starts a flare-up, and how long 1 g burns, s. */
  flareThresholdKg: 0.004,
  flareSecondsPerGram: 1.2,
};

export const OVEN = {
  /** Two-node model: cavity air + walls/racks. */
  airHeatCapacity: 1500,
  wallHeatCapacity: 9000,
  bakeW: 2500,
  broilW: 3400,
  /** Air ↔ walls coupling, W/K (fan doubles it). */
  airWallWPerK: 30,
  /** Losses through insulation (walls → room), W/K; air → room with the door open. */
  wallLossWPerK: 4,
  doorOpenAirLossWPerK: 90,
  /** Thermostat hysteresis, °C (cycles about ± this). */
  hysteresisC: 6,
  minF: 170,
  maxF: 550,
  /** Broiler element glow temperature, °C. */
  broilElementC: 900,
};

export const AIR_FRYER = {
  heatCapacity: 1200,
  heaterW: 1500,
  lossWPerK: 3,
  hysteresisC: 3,
  minF: 180,
  maxF: 400,
  maxMinutes: 60,
};

export const SOUS_VIDE = {
  /** 6 L of water. */
  waterKg: 6,
  heaterW: 1100,
  /** Losses: walls + open top (evaporation grows with temperature), W/K. */
  lossWPerK: 2.2,
  evapWPerK: 0.6,
  minF: 68,
  maxF: 203,
};

export const WATER_CP = 4186;
