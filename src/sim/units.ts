/** The sim runs in SI and °C internally; the UI and recipes talk °F (with a °C toggle). */
export const fToC = (f: number): number => ((f - 32) * 5) / 9;
export const cToF = (c: number): number => (c * 9) / 5 + 32;
/** Temperature difference °F → °C. */
export const dFtoC = (df: number): number => (df * 5) / 9;

export const ROOM_C = 22;
export const FRIDGE_C = 4;
export const BOIL_C = 100;
/** Latent heat of vaporization of water, J/kg. */
export const LATENT = 2.26e6;
export const SIGMA = 5.670374e-8;
export const KELVIN = 273.15;
