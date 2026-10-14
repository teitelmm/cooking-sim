/** Surface materials: physics response + render look + impact sound character. */
export interface SurfaceMaterial {
  friction: number;
  restitution: number;
  color: number;
  roughness: number;
  metalness: number;
  /** Impact sound: base pitch (Hz) and how ringy (0 = thud, 1 = clang). */
  pitch: number;
  ring: number;
}

export const MATERIALS = {
  wood: { friction: 0.7, restitution: 0.2, color: 0x9a6b43, roughness: 0.75, metalness: 0, pitch: 420, ring: 0.15 },
  butcherBlock: { friction: 0.75, restitution: 0.15, color: 0xb98a5a, roughness: 0.7, metalness: 0, pitch: 380, ring: 0.1 },
  granite: { friction: 0.55, restitution: 0.15, color: 0xd9d4cc, roughness: 0.35, metalness: 0, pitch: 900, ring: 0.2 },
  steel: { friction: 0.45, restitution: 0.25, color: 0xc4c8cc, roughness: 0.3, metalness: 0.9, pitch: 1400, ring: 0.8 },
  castIron: { friction: 0.6, restitution: 0.1, color: 0x2b2b2d, roughness: 0.6, metalness: 0.6, pitch: 600, ring: 0.5 },
  enamel: { friction: 0.5, restitution: 0.2, color: 0xeeeeea, roughness: 0.25, metalness: 0.1, pitch: 1100, ring: 0.4 },
  ceramic: { friction: 0.5, restitution: 0.2, color: 0xf3efe7, roughness: 0.2, metalness: 0, pitch: 1800, ring: 0.6 },
  tile: { friction: 0.5, restitution: 0.2, color: 0xe9e2d6, roughness: 0.3, metalness: 0, pitch: 1200, ring: 0.3 },
  glass: { friction: 0.4, restitution: 0.25, color: 0xbfd8e0, roughness: 0.05, metalness: 0, pitch: 2400, ring: 0.7 },
  plastic: { friction: 0.5, restitution: 0.3, color: 0x333333, roughness: 0.5, metalness: 0, pitch: 800, ring: 0.1 },
  paper: { friction: 0.8, restitution: 0.05, color: 0xe8dcc4, roughness: 0.95, metalness: 0, pitch: 250, ring: 0 },
  meat: { friction: 0.9, restitution: 0.02, color: 0xa8333a, roughness: 0.55, metalness: 0, pitch: 180, ring: 0 },
  produce: { friction: 0.7, restitution: 0.15, color: 0xb08850, roughness: 0.7, metalness: 0, pitch: 320, ring: 0 },
  leafy: { friction: 0.9, restitution: 0.02, color: 0x4f8a3a, roughness: 0.8, metalness: 0, pitch: 200, ring: 0 },
  rubber: { friction: 1.0, restitution: 0.4, color: 0x222222, roughness: 0.8, metalness: 0, pitch: 200, ring: 0 },
} satisfies Record<string, SurfaceMaterial>;

export type MaterialId = keyof typeof MATERIALS;
